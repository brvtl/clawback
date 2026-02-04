import { defineConfig } from "vitest/config";
import { resolve } from "path";

export default defineConfig({
  resolve: {
    alias: {
      "@clawback/shared": resolve(__dirname, "packages/shared/src/index.ts"),
      "@clawback/db": resolve(__dirname, "packages/db/src/index.ts"),
    },
  },
  test: {
    globals: true,
    environment: "node",
    include: ["packages/**/*.test.ts", "apps/**/*.test.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text", "json", "html"],
      exclude: ["node_modules", "dist", ".svelte-kit", "**/*.test.ts", "**/*.spec.ts"],
    },
  },
});
