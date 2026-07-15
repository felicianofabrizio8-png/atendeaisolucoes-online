// ============================================================================
// Manual Follow-up — server function exposta ao cliente (inbox).
// A lógica canônica vive em `src/lib/followup/manual.ts`. Este arquivo
// mantém apenas o wrapper createServerFn + auth (mesma assinatura pública,
// mesmo comportamento) para preservar consumidores existentes.
// Consolidado na Fase A do Plano Diretor da Arquitetura 2.0.
// ============================================================================

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const Input = z.object({ conversationId: z.string().uuid() });

// Re-export do tipo público para compatibilidade com imports existentes.
export type { ManualFollowupResult } from "@/lib/followup";

export const runFollowupNowForConversation = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => Input.parse(data))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context as unknown as {
      supabase: {
        from: (t: string) => {
          select: (c: string) => {
            eq: (
              col: string,
              v: string,
            ) => { maybeSingle: () => Promise<{ data: { company_id: string } | null }> };
          };
        };
        rpc: (
          fn: string,
          args: Record<string, unknown>,
        ) => Promise<{ data: boolean | null }>;
      };
      userId: string;
    };

    // 1) Confere empresa do usuário
    const { data: prof } = await supabase
      .from("profiles")
      .select("company_id")
      .eq("id", userId)
      .maybeSingle();
    if (!prof?.company_id) throw new Error("Usuário sem empresa.");
    const companyId = prof.company_id;

    // 2) Confere role de admin
    const { data: isAdmin } = await supabase.rpc("has_role", {
      _user_id: userId,
      _company_id: companyId,
      _role: "admin",
    });
    if (!isAdmin) throw new Error("Apenas administradores podem executar.");

    // 3) Delega para o núcleo canônico
    const { runManualFollowup } = await import("@/lib/followup");
    return runManualFollowup({
      companyId,
      userId,
      conversationId: data.conversationId,
    });
  });
