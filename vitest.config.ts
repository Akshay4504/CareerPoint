import { defineConfig } from "vitest/config";
import { fileURLToPath } from "url";

const p = (rel: string) => fileURLToPath(new URL(rel, import.meta.url));

export default defineConfig({
  resolve: { alias: { "@": p("./src"), "server-only": p("./tests/stubs/empty.ts") } },
  test: { environment: "node", include: ["tests/**/*.test.ts"], // integration files share one database, so files run one at a time
    fileParallelism: false },
});
