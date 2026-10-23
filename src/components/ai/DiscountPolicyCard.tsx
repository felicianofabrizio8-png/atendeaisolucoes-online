import { useEffect, useState } from "react";
import { Loader2, Percent, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useIsAdmin } from "@/hooks/useIsAdmin";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  DISCOUNT_RULES_MAX,
  parseDiscountPolicy,
  type DiscountPolicyMode,
} from "@/lib/discount-policy";

type DraftRule = { percent: string; condition: string };

const MODE_HELP: Record<DiscountPolicyMode, string> = {
  none: "A vendedora não oferece desconto. Se o cliente pedir, ela mantém o valor cadastrado e segue vendendo.",
  authorized: "A vendedora cita somente os descontos abaixo, com o percentual e a condição exatos.",
  approval_required: "Pedido de desconto vai para a equipe aprovar. A vendedora não oferece nenhum.",
};

/** Regras válidas para salvar; `null` se alguma linha estiver incompleta ou fora da faixa. */
function toRules(drafts: DraftRule[]): Array<{ percent: number; condition: string }> | null {
  const rules = [];
  for (const draft of drafts) {
    const percent = Number(draft.percent.replace(",", "."));
    const condition = draft.condition.trim();
    if (!Number.isFinite(percent) || percent <= 0 || percent > 100 || !condition || condition.length > 160) return null;
    rules.push({ percent: Math.round(percent * 100) / 100, condition });
  }
  return rules;
}

/**
 * Política de desconto da Vendedora IA (company_settings.ai_discount_mode/_rules), da
 * empresa do usuário logado. Só o administrador altera; a IA nunca cria desconto.
 */
export function DiscountPolicyCard({ companyId }: { companyId: string }) {
  const { isAdmin, isLoading: adminLoading } = useIsAdmin();
  const [mode, setMode] = useState<DiscountPolicyMode>("none");
  const [drafts, setDrafts] = useState<DraftRule[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      // `*`: antes da migration as colunas não existem e pedi-las faria a leitura falhar.
      const { data } = await supabase.from("company_settings").select("*").eq("company_id", companyId).maybeSingle();
      if (cancelled) return;
      const row = data as { ai_discount_mode?: unknown; ai_discount_rules?: unknown } | null;
      const policy = parseDiscountPolicy(row);
      setMode(row?.ai_discount_mode === "authorized" || row?.ai_discount_mode === "approval_required"
        ? row.ai_discount_mode
        : "none");
      setDrafts(policy.rules.map((rule) => ({ percent: String(rule.percent).replace(".", ","), condition: rule.condition })));
      setLoaded(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [companyId]);

  const save = async () => {
    const rules = mode === "authorized" ? toRules(drafts) : [];
    if (rules === null) {
      toast.error("Revise os descontos", { description: "Cada linha precisa de percentual entre 0 e 100 e de uma condição." });
      return;
    }
    if (mode === "authorized" && rules.length === 0) {
      toast.error("Cadastre ao menos um desconto", { description: "Sem desconto cadastrado, escolha \"Nenhum desconto\"." });
      return;
    }
    setSaving(true);
    const { error } = await supabase
      .from("company_settings")
      .update({ ai_discount_mode: mode, ai_discount_rules: rules } as never)
      .eq("company_id", companyId);
    setSaving(false);
    if (error) {
      toast.error("Falha ao salvar a política de desconto", { description: error.message });
      return;
    }
    toast.success("Política de desconto salva");
  };

  const editable = isAdmin && !adminLoading;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          <Percent className="h-4 w-4" /> Política de desconto
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {!loaded ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Carregando…
          </div>
        ) : (
          <>
            <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between rounded-md border border-border p-3">
              <div className="text-xs text-muted-foreground md:max-w-md">{MODE_HELP[mode]}</div>
              <Select value={mode} onValueChange={(value: DiscountPolicyMode) => setMode(value)} disabled={!editable}>
                <SelectTrigger className="w-full md:w-56"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Nenhum desconto</SelectItem>
                  <SelectItem value="authorized">Descontos autorizados</SelectItem>
                  <SelectItem value="approval_required">Só com aprovação da equipe</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {mode === "authorized" && (
              <div className="space-y-2">
                {drafts.map((draft, index) => (
                  <div key={index} className="flex flex-col gap-2 md:flex-row md:items-center">
                    <Input
                      aria-label="Percentual máximo"
                      inputMode="decimal"
                      placeholder="5"
                      className="md:w-24"
                      value={draft.percent}
                      disabled={!editable}
                      onChange={(e) => setDrafts((rows) => rows.map((row, i) => (i === index ? { ...row, percent: e.target.value } : row)))}
                    />
                    <span className="hidden md:inline text-sm text-muted-foreground">%</span>
                    <Input
                      aria-label="Condição"
                      placeholder="Pagamento à vista no Pix"
                      maxLength={160}
                      value={draft.condition}
                      disabled={!editable}
                      onChange={(e) => setDrafts((rows) => rows.map((row, i) => (i === index ? { ...row, condition: e.target.value } : row)))}
                    />
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label="Remover desconto"
                      disabled={!editable}
                      onClick={() => setDrafts((rows) => rows.filter((_, i) => i !== index))}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                ))}
                <Button
                  variant="outline"
                  size="sm"
                  disabled={!editable || drafts.length >= DISCOUNT_RULES_MAX}
                  onClick={() => setDrafts((rows) => [...rows, { percent: "", condition: "" }])}
                >
                  <Plus className="h-4 w-4" /> Adicionar desconto
                </Button>
              </div>
            )}

            {!editable && !adminLoading && (
              <p className="text-xs text-muted-foreground">Só o administrador da empresa altera a política de desconto.</p>
            )}

            <div className="flex justify-end">
              <Button onClick={save} disabled={!editable || saving} className="w-full md:w-auto min-h-11 md:min-h-9">
                {saving && <Loader2 className="h-4 w-4 animate-spin" />}
                Salvar política de desconto
              </Button>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
