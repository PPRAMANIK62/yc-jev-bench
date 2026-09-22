// Runs the search route's dependencies against ONLY the files Next traced into the function, which
// is what Vercel actually deploys. A full node_modules on disk hides missing files; this does not.
//
// The first deploy of this app returned 500 because the trace carried onnxruntime-node's native
// binaries and not its package.json, so `require` could not resolve the package. Everything passed
// locally, because locally the package was there in full.
//
// Run after `bun run build`. Exits non-zero on a missing dependency or a failed embedding.
import { existsSync, lstatSync, mkdirSync, copyFileSync, readFileSync, readlinkSync, rmSync, symlinkSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { execFileSync } from "node:child_process";

const ROOT = process.cwd();
const TRACE = ".next/server/app/api/search/route.js.nft.json";
const SANDBOX = join(ROOT, ".next/cache/function-bundle");

if (!existsSync(TRACE)) throw new Error(`missing ${TRACE}; run \`bun run build\` first`);

const files = (JSON.parse(readFileSync(TRACE, "utf8")) as { files: string[] }).files;
const traceDir = dirname(resolve(TRACE));

rmSync(SANDBOX, { recursive: true, force: true });
let copied = 0;
let bytes = 0;
for (const f of files) {
  const src = resolve(traceDir, f);
  if (!existsSync(src) || !src.startsWith(ROOT)) continue;
  const dst = join(SANDBOX, relative(ROOT, src));
  if (existsSync(dst)) continue;
  mkdirSync(dirname(dst), { recursive: true });
  // Next links the bundled copy of transformers into .next/node_modules; copying through the link
  // would put a second 8 MB tree in the sandbox and lose what the function actually resolves.
  const stat = lstatSync(src);
  if (stat.isSymbolicLink()) {
    symlinkSync(readlinkSync(src), dst);
  } else {
    copyFileSync(src, dst);
    bytes += stat.size;
  }
  copied++;
}
console.log(`${copied} traced files, ${(bytes / 1e6).toFixed(1)} MB`);

// Runs inside the sandbox, so it sees the deployed file set and nothing else.
const probe = `
const t0 = Date.now();
require("onnxruntime-node");
const { env, pipeline } = require("@huggingface/transformers");
env.localModelPath = require("node:path").join(process.cwd(), "models");
env.allowRemoteModels = false;
env.useFSCache = false;
env.useBrowserCache = false;
pipeline("feature-extraction", "Xenova/bge-small-en-v1.5", { dtype: "q8" })
  .then((p) => p(["a tool to catch flaky tests in CI"], { pooling: "cls", normalize: true }))
  .then((out) => {
    if (out.data.length !== 384) throw new Error("expected 384 dims, got " + out.data.length);
    console.log("embedded a query in " + (Date.now() - t0) + " ms");
  })
  .catch((e) => { console.error("FAILED: " + (e.code ? e.code + " " : "") + e.message.split("\\n")[0]); process.exit(1); });
`;

for (const f of ["data/companies-2026-09-22.json", "data/index/embeddings.f32", "models/Xenova/bge-small-en-v1.5/onnx/model_quantized.onnx"]) {
  if (!existsSync(join(SANDBOX, f))) throw new Error(`${f} is not in the traced function`);
}

// node, not whatever runs this script: the function runs on node, and the two resolve differently.
execFileSync("node", ["-e", probe], { cwd: SANDBOX, stdio: "inherit" });
console.log("the traced function can load its model and embed a query");
