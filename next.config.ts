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
      "node_modules/onnxruntime-node/bin/napi-v6/linux/**",
    ],
  },
  // Whatever a developer has pulled into the transformers download cache, including the 570 MB
  // reranker the benchmark uses and the app never does, would otherwise be traced into the function.
  outputFileTracingExcludes: {
    "/api/search": ["node_modules/@huggingface/transformers/.cache/**"],
  },
};

export default nextConfig;
