// Vitest config isolado para tests do módulo Follow-up.
// Mantém aliases do vite-tsconfig-paths e roda apenas testes locais do módulo.
import { defineConfig } from "vitest/config";
import tsconfigPaths from "vite-tsconfig-paths";

export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    include: [
      "src/lib/followup/__tests__/**/*.test.ts",
      "src/lib/environment/__tests__/**/*.test.ts",
      "src/lib/outbound/__tests__/**/*.test.ts",
    ],
    environment: "node",
    globals: false,
  },
});
