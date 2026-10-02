// ============================================================================
// BackgroundTask — executa trabalho que precisa sobreviver ao fim da requisição.
//
// No Cloudflare Workers, quando o cliente desconecta (ex.: pg_net com timeout
// de 5 s), tudo que a requisição ainda aguardava é cancelado — inclusive
// blocos `finally`. Tarefas registradas em `waitUntil` continuam por até ~30 s
// depois da resposta.
//
// O deploy do Lovable usa o preset `cloudflare-module` do Nitro, cujo handler
// expõe o `ExecutionContext.waitUntil` do Worker em `request.waitUntil`
// (nitro/dist/presets/cloudflare/runtime/_module-handler.mjs, augmentReq).
// Não importamos `cloudflare:workers`: o build do Vite/Nitro não resolve esse
// módulo. Fora do Workers (dev/testes) não há `waitUntil` e quem chama decide
// o fallback (normalmente executar inline).
// ============================================================================

type WaitUntil = (promise: Promise<unknown>) => void;

/**
 * Registra `task` no `waitUntil` exposto na requisição. Retorna `false` (sem
 * executar a tarefa) quando o runtime não oferece `waitUntil`.
 */
export function scheduleBackgroundTask(request: Request, task: () => Promise<void>): boolean {
  const waitUntil = (request as Request & { waitUntil?: unknown }).waitUntil;
  if (typeof waitUntil !== "function") return false;
  (waitUntil as WaitUntil)(task().catch(() => undefined));
  return true;
}
