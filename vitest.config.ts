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
      "src/lib/__tests__/**/*.test.ts",
      "src/lib/meta-disconnect/__tests__/**/*.test.ts",
      "src/lib/marketing-publisher/__tests__/**/*.test.ts",
      "src/lib/meta-oauth/__tests__/**/*.test.ts",
      "src/lib/audio-library/__tests__/**/*.test.ts",
      "src/lib/brand-center/__tests__/**/*.test.ts",
      "src/lib/marketing/__tests__/**/*.test.ts",
      "src/components/marketing/audio-library/__tests__/**/*.test.ts",
      "src/lib/render-engine/__tests__/**/*.test.ts",
      "worker/render-engine/src/__tests__/**/*.test.ts",
      "src/routes/__tests__/**/*.test.ts",
      "src/routes/__tests__/**/*.test.tsx",
      "src/lib/runtime/__tests__/**/*.test.ts",
      "src/lib/coach-rules/__tests__/**/*.test.ts",
      "src/lib/coach-interpreter/__tests__/**/*.test.ts",
      "src/lib/coach-learnings/__tests__/**/*.test.ts",
      "src/lib/coach/__tests__/**/*.test.ts",
      "src/lib/responsive/__tests__/**/*.test.ts",
      "src/lib/audit/__tests__/**/*.test.ts",
      "src/data/__tests__/**/*.test.ts",
      "src/lib/quote-send/__tests__/**/*.test.ts",
      "src/lib/scientific-knowledge/__tests__/**/*.test.ts",
      "src/lib/meta-webhook/__tests__/**/*.test.ts",
      "src/lib/recovery/__tests__/**/*.test.ts",
      "src/lib/recovery-ai/__tests__/**/*.test.ts",
      "src/lib/recovery-exec/__tests__/**/*.test.ts",
      "src/lib/recovery-learning/__tests__/**/*.test.ts",
      "src/lib/whatsapp/__tests__/**/*.test.ts",
      "src/lib/shared/__tests__/**/*.test.ts",
      "src/components/orcamentos/__tests__/**/*.test.ts",
      "src/components/inbox/__tests__/**/*.test.ts",
    ],

    environment: "node",
    globals: false,
  },
});
