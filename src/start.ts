// Registra middlewares globais do TanStack Start.
// Em especial, attachSupabaseAuth garante que toda chamada de serverFn
// envie automaticamente o header `Authorization: Bearer <token>` quando
// existir uma sessão Supabase ativa no browser. Sem isso, serverFns
// protegidas por `requireSupabaseAuth` retornam 401.
import { createStart } from "@tanstack/react-start";
import { attachSupabaseAuth } from "@/integrations/supabase/auth-attacher";
import { teamRequestMiddleware } from "@/lib/team/middleware";

export const startInstance = createStart(() => ({
  functionMiddleware: [attachSupabaseAuth],
  requestMiddleware: [teamRequestMiddleware],
}));
