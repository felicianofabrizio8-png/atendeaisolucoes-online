import { useEffect, useState } from "react";
import { Power } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useIsAdmin } from "@/hooks/useIsAdmin";
import { Switch } from "@/components/ui/switch";
import { isSalesAgentMasterOff } from "@/lib/sales-agent-mode";

/** A empresa do usuário logado usa a Vendedora IA? Quem responde é o servidor. */
async function loadEligibility(): Promise<boolean> {
  try {
    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token;
    if (!token) return false;
    const response = await fetch("/api/ai/readiness", {
      headers: { Authorization: `Bearer ${token}` },
    });
    const json = (await response.json()) as { ok?: boolean; salesAgentEligible?: boolean };
    return json.ok === true && json.salesAgentEligible === true;
  } catch {
    return false;
  }
}

async function saveMaster(enabled: boolean): Promise<{ ok: true } | { ok: false; error: string }> {
  const fallback = "Tente novamente em instantes.";
  try {
    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token;
    if (!token) return { ok: false, error: "Sessão expirada. Entre novamente." };
    const response = await fetch("/api/ai/sales-agent-master", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ enabled }),
    });
    const json = (await response.json()) as { ok?: boolean; enabled?: boolean; error?: string };
    if (response.ok && json.ok === true && json.enabled === enabled) return { ok: true };
    return { ok: false, error: json.error ?? fallback };
  } catch {
    return { ok: false, error: fallback };
  }
}

/**
 * Botão mestre da Vendedora IA (company_settings.sales_agent_master_enabled), sempre da
 * empresa do usuário logado e só para empresa que usa a Vendedora. Desligado, nenhuma
 * mensagem recebida aciona a Vendedora e ninguém responde no lugar dela: o atendimento
 * fica com a equipe. Coach e ferramentas manuais seguem funcionando. Salva na hora, e o
 * modo da empresa e o automático por conversa ficam como estão.
 */
export function SalesAgentMasterSwitch({ companyId }: { companyId: string }) {
  const { isAdmin, isLoading: adminLoading } = useIsAdmin();
  const [state, setState] = useState<{ companyId: string; enabled: boolean } | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      if (!(await loadEligibility()) || cancelled) return;
      // `*`: antes da migration a coluna não existe, e pedir só ela faria a leitura falhar.
      const { data, error } = await supabase
        .from("company_settings")
        .select("*")
        .eq("company_id", companyId)
        .maybeSingle();
      if (cancelled || error || !data || !("sales_agent_master_enabled" in data)) return;
      setState({ companyId, enabled: !isSalesAgentMasterOff(data) });
    })();
    return () => {
      cancelled = true;
    };
  }, [companyId]);

  // Empresa que não usa a Vendedora, coluna ausente (migration pendente) ou leitura
  // indisponível: o botão não aparece e nada muda.
  if (!state || state.companyId !== companyId) return null;

  const toggle = async (enabled: boolean) => {
    setSaving(true);
    // A troca passa pelo servidor: é ele que confere empresa e papel e tira do cartão as
    // sugestões pendentes da Vendedora, para nada antigo reaparecer ao religar.
    const saved = await saveMaster(enabled);
    setSaving(false);
    if (!saved.ok) {
      toast.error("Não foi possível salvar", { description: saved.error });
      return;
    }
    setState({ companyId, enabled });
    toast.success(enabled ? "Vendedora IA ativada" : "Vendedora IA desativada");
  };

  return (
    <div
      data-testid="sales-agent-master-switch"
      className={`flex items-center justify-between gap-3 rounded-md border p-3 ${state.enabled ? "border-border" : "border-destructive/40 bg-destructive/5"}`}
    >
      <div className="flex items-start gap-2 min-w-0">
        <Power className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
        <div className="min-w-0">
          <div className="text-sm font-medium">
            {state.enabled ? "Vendedora IA ativada" : "Vendedora IA desativada"}
          </div>
          <div className="text-xs text-muted-foreground">
            {state.enabled
              ? "A Vendedora IA atua conforme as configurações desta empresa."
              : "Nenhuma mensagem recebida aciona a Vendedora IA e nenhuma resposta automática é enviada: o atendimento fica com a equipe. O Coach continua disponível."}
            {!isAdmin && !adminLoading ? " Apenas administradores podem alterar." : ""}
          </div>
        </div>
      </div>
      <Switch
        aria-label="Ativar a Vendedora IA"
        checked={state.enabled}
        disabled={saving || adminLoading || !isAdmin}
        onCheckedChange={(value) => void toggle(value)}
      />
    </div>
  );
}
