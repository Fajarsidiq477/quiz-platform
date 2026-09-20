import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: { alias: { "@": path.resolve(import.meta.dirname, "src") } },
  esbuild: { jsx: "automatic" },
  test: {
    environment: "node",
    // Component tests (.tsx) opt in to a browser-like environment with a `@vitest-environment jsdom`
    // comment at the top of the file; everything else runs in plain Node.
    include: ["tests/**/*.test.{ts,tsx}"],
    testTimeout: 30_000,
    hookTimeout: 60_000,
    // Most test files boot their own in-process Postgres (PGlite, WebAssembly). Left to default, a
    // many-core machine starts a worker per core, all booting a database at once; on a 20-core
    // machine that starved them past the 60 s hook timeout (16 files failed, in runs while the
    // machine was busy), while 4 workers finish the whole suite in about 20 s, as fast as 19 do.
    maxWorkers: 4,
  },
});
