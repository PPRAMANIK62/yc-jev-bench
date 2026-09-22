// Claude via Claude Code headless on a subscription (EXPERIMENT.md "How arm C runs"). Bench only.
import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { CallCost } from "./domain";

export const HAIKU = "claude-haiku-4-5-20251001";
export const OPUS = "claude-opus-5";

interface ModelSpec {
  usdPerInput: number;
  usdPerOutput: number;
  // Input tokens Claude Code adds to every call under the isolation flags below, measured 2026-09-22
  // with a one-character system prompt and prompt (383 and 441 total, minus ~2 for the "x" pair).
  overheadTokens: number;
}

const MODELS: Record<string, ModelSpec> = {
  [HAIKU]: { usdPerInput: 1 / 1e6, usdPerOutput: 5 / 1e6, overheadTokens: 381 },
  // Opus 5 list price reconciles exactly with total_cost_usd on the overhead probe (441 in, 27 out → $0.00288).
  [OPUS]: { usdPerInput: 5 / 1e6, usdPerOutput: 25 / 1e6, overheadTokens: 439 },
};

const CONCURRENCY = 4;
let inFlight = 0;
const waiters: (() => void)[] = [];
async function slot<T>(fn: () => Promise<T>): Promise<T> {
  if (inFlight >= CONCURRENCY) await new Promise<void>((r) => waiters.push(r));
  inFlight++;
  try {
    return await fn();
  } finally {
    inFlight--;
    waiters.shift()?.();
  }
}

// A neutral cwd plus these switches keep project CLAUDE.md, user memory, plugins and their
// hooks out of the context, so every call carries the same fixed Claude Code overhead.
const CWD = join(tmpdir(), "yc-jev-bench-claude");
const ENV = { CLAUDE_CODE_DISABLE_CLAUDE_MDS: "1", CLAUDE_CODE_DISABLE_AUTO_MEMORY: "1", MAX_THINKING_TOKENS: "0" };

export interface ClaudeResult {
  text: string;
  cost: CallCost;
  totalCostUsd: number;
}

interface ClaudeJson {
  result: string;
  is_error?: boolean;
  duration_api_ms: number;
  total_cost_usd: number;
  usage: { input_tokens: number; cache_creation_input_tokens?: number; cache_read_input_tokens?: number; output_tokens: number };
}

async function runOnce(model: string, system: string, prompt: string): Promise<ClaudeResult> {
  const spec = MODELS[model];
  if (!spec) throw new Error(`no price/overhead measured for ${model}`);
  mkdirSync(CWD, { recursive: true });
  const t0 = performance.now();
  const { stdout, stderr, code } = await new Promise<{ stdout: string; stderr: string; code: number | null }>((resolve, reject) => {
    const proc = spawn(
      "claude",
      [
        "-p", "--model", model, "--system-prompt", system,
        "--tools", "", "--strict-mcp-config", "--no-session-persistence", "--output-format", "json",
        "--setting-sources", "", "--disable-slash-commands",
      ],
      { cwd: CWD, env: { ...process.env, ...ENV } },
    );
    let out = "";
    let err = "";
    proc.stdout.on("data", (d) => (out += d));
    proc.stderr.on("data", (d) => (err += d));
    proc.on("error", reject);
    proc.on("close", (c) => resolve({ stdout: out, stderr: err, code: c }));
    proc.stdin.end(prompt);
  });
  const wallMs = performance.now() - t0;
  const line = stdout.split("\n").find((l) => l.startsWith("{"));
  if (!line) throw new Error(`claude exited ${code} with no JSON: ${(stderr || stdout).slice(0, 300)}`);
  const j = JSON.parse(line) as ClaudeJson;
  if (j.is_error) throw new Error(`claude error: ${j.result}`);
  const totalIn = j.usage.input_tokens + (j.usage.cache_creation_input_tokens ?? 0) + (j.usage.cache_read_input_tokens ?? 0);
  const inputTokens = Math.max(0, totalIn - spec.overheadTokens);
  return {
    text: j.result,
    totalCostUsd: j.total_cost_usd,
    cost: {
      wallMs,
      apiMs: j.duration_api_ms,
      inputTokens,
      outputTokens: j.usage.output_tokens,
      costUsd: inputTokens * spec.usdPerInput + j.usage.output_tokens * spec.usdPerOutput,
    },
  };
}

// Runs the call and hands the text to parse; one retry when the call or the parse fails.
export async function claudeJson<T>(model: string, system: string, prompt: string, parse: (text: string) => T): Promise<{ value: T } & ClaudeResult> {
  return slot(async () => {
    let lastError: unknown;
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const r = await runOnce(model, system, prompt);
        return { ...r, value: parse(r.text) };
      } catch (e) {
        lastError = e;
      }
    }
    throw lastError;
  });
}

export function extractJson(text: string): unknown {
  const start = text.search(/[[{]/);
  const end = Math.max(text.lastIndexOf("]"), text.lastIndexOf("}"));
  if (start < 0 || end < start) throw new Error(`no JSON in: ${text.slice(0, 200)}`);
  return JSON.parse(text.slice(start, end + 1));
}
