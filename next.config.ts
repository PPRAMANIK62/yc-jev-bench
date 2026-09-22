import type { NextConfig } from "next";

// The search route reads three things off disk that no import mentions: the company snapshot, the
// embedding index, and the vendored ONNX model. Next's tracer resolves the first two from the
// constant paths in src/lib, but that is a static-analysis accident, so pin all of them here.
// onnxruntime-node is a different problem: @huggingface/transformers reaches it through a runtime
// require the tracer cannot follow, so without this the function has no ONNX backend and the route
// module throws `Cannot find module 'onnxruntime-node'` on import.
const nextConfig: NextConfig = {
  outputFileTracingIncludes: {
    "/api/search": [
      "data/companies-*.json",
      "data/index/**",
      "models/**",
      // onnxruntime-node needs its JavaScript, not only the binary. dist/binding.js builds the
      // native path from a template literal (`../bin/napi-v6/${process.platform}/${process.arch}/…`)
      // and nothing statically references the package, so tracing finds none of it. Shipping bin/
      // alone leaves .node files with no package.json to resolve through, which fails exactly like
      // shipping nothing. Only the linux binaries, since darwin and win32 are 220 MB unused.
      "node_modules/onnxruntime-node/package.json",
      "node_modules/onnxruntime-node/dist/**",
      "node_modules/onnxruntime-node/bin/napi-v6/linux/**",
      // Traced already, but only dist/esm, the half transformers imports. onnxruntime-node is CJS
      // and resolves this package's "require" export to dist/cjs, which nothing else pulls in.
      "node_modules/onnxruntime-common/**",
    ],
  },
  // Whatever a developer has pulled into the transformers download cache, including the 570 MB
  // reranker the benchmark uses and the app never does, would otherwise be traced into the function.
  outputFileTracingExcludes: {
    "/api/search": ["node_modules/@huggingface/transformers/.cache/**"],
  },
};

export default nextConfig;
