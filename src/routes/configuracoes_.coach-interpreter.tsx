// ============================================================================
// FASE 3.0 — Rota administrativa isolada do Coach Interpreter.
//
// Este módulo é intencionalmente MÍNIMO: apenas o `createFileRoute` + wrapper
// de componente. Toda a UI vive em `@/lib/coach-interpreter/admin-console`,
// fora do diretório de rotas, para que:
//
//  1. O auto code-splitter do TanStack Router (que remove funções usadas em
//     `component:` do escopo do módulo) não possa quebrar referências entre
//     helpers e componentes internos;
//  2. Os testes de interação da Fase 3.1a possam importar componentes
//     diretamente do módulo compartilhado, sem depender de exports
//     condicionais (`__test__`, `import.meta.env.MODE === "test"`) no módulo
//     da rota de produção.
// ============================================================================
import { createFileRoute } from "@tanstack/react-router";
import { AdminPageBody } from "@/lib/coach-interpreter/admin-console";
import { getSafeInterpreterError } from "@/lib/coach-interpreter/errors";

export const Route = createFileRoute("/configuracoes_/coach-interpreter")({
  component: InterpreterAdminPage,
  head: () => ({
    meta: [
      { title: "Coach Interpreter — Console Admin" },
      {
        name: "description",
        content:
          "Console administrativo para inspecionar conversas, mensagens e proposals do Coach Interpreter (Fase 2).",
      },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
  errorComponent: ({ error, reset }) => {
    const safe = getSafeInterpreterError(error);
    return (
      <div className="max-w-2xl mx-auto p-8">
        <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-6">
          <h2 className="font-semibold text-destructive">Erro ao carregar Coach Interpreter</h2>
          <p className="text-sm text-muted-foreground mt-1 break-words">{safe.message}</p>
          <p className="text-[11px] text-muted-foreground mt-1 font-mono">code: {safe.code}</p>
          <button
            type="button"
            onClick={() => reset()}
            className="mt-3 text-sm text-primary underline"
          >
            Tentar novamente
          </button>
        </div>
      </div>
    );
  },
});

function InterpreterAdminPage() {
  return <AdminPageBody />;
}
