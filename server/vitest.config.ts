import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Each test file boots its own in-memory PGlite (~100 MB of WASM heap);
    // running them one at a time keeps memory predictable on dev machines and CI.
    fileParallelism: false,
    hookTimeout: 30_000,
    testTimeout: 20_000,
  },
});
