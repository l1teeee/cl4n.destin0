import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    include: ["tests/concurrency/**/*.test.ts"],
    setupFiles: ["./tests/setup/test-env.ts"],
    fileParallelism: false,
    testTimeout: 120000,
    hookTimeout: 120000,
    env: {
      DATABASE_POOL_MAX: "50",
    },
  },
});
