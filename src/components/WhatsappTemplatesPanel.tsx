import { useEffect, useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Loader2, RefreshCw, MessageSquareText } from "lucide-react";
import { toast } from "sonner";
import { WhatsappTemplateSuggestions } from "./WhatsappTemplateSuggestions";

interface TemplateRow {
  id: string;
  name: string;
  language: string;
  category: "utility" | "marketing" | "authentication" | string;
  status: string;
  purpose: string | null;
  auto_use: boolean;
  variables: string[];
  components: Array<{ type: string; text?: string }>;
  last_synced_at: string | null;
  meta_template_id: string | null;
}

const NONE_PURPOSE = "__none__";
// Propósito → categoria esperada (informativa no select).
const PURPOSE_CATEGORY: Record<string, "marketing" | "utility"> = {
  quote_no_reply: "marketing",
  lead_silent: "marketing",
  hot_lead_idle: "marketing",
  returning_customer: "marketing",
  conversation_resume: "marketing",
  quote_followup: "marketing",
  reactivation: "marketing",
  visit_no_return: "utility",
  appointment_confirmation: "utility",
  visit_confirmed: "utility",
  visit_rescheduled: "utility",
  installation_confirmed: "utility",
};
const PURPOSES: { value: string; label: string; group: "marketing" | "utility" }[] = [
  // Marketing (follow-ups / reativação)
  { value: "quote_no_reply", label: "Orçamento sem resposta", group: "marketing" },
  { value: "lead_silent", label: "Cliente sumiu", group: "marketing" },
  { value: "hot_lead_idle", label: "Lead quente parado", group: "marketing" },
  { value: "returning_customer", label: "Reativação de cliente", group: "marketing" },
  { value: "conversation_resume", label: "Retomar conversa", group: "marketing" },
  // Utility (eventos operacionais)
  { value: "visit_confirmed", label: "Visita confirmada", group: "utility" },
  { value: "visit_rescheduled", label: "Visita reagendada", group: "utility" },
  { value: "visit_no_return", label: "Visita sem retorno", group: "utility" },
  { value: "appointment_confirmation", label: "Confirmação de agendamento", group: "utility" },
  { value: "installation_confirmed", label: "Instalação confirmada", group: "utility" },
];

function statusBadge(status: string) {
  const map: Record<string, string> = {
    approved: "bg-green-500/15 text-green-600 border-green-500/30",
    pending: "bg-amber-500/15 text-amber-600 border-amber-500/30",
    rejected: "bg-red-500/15 text-red-600 border-red-500/30",
    paused: "bg-zinc-500/15 text-zinc-600 border-zinc-500/30",
    disabled: "bg-zinc-500/15 text-zinc-600 border-zinc-500/30",
  };
  return map[status] ?? "bg-secondary text-muted-foreground border-border";
}

function categoryBadge(cat: string) {
  if (cat === "utility") return "bg-primary/15 text-primary border-primary/30";
  if (cat === "marketing") return "bg-fuchsia-500/15 text-fuchsia-600 border-fuchsia-500/30";
  return "bg-amber-500/15 text-amber-600 border-amber-500/30";
}

export function WhatsappTemplatesPanel() {
  const [items, setItems] = useState<TemplateRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);

  const fetchList = useCallback(async () => {
    setLoading(true);
    try {
      const { data: sess } = await supabase.auth.getSession();
      const token = sess.session?.access_token;
      if (!token) return;
      const res = await fetch("/api/whatsapp/templates/list", {
        headers: { Authorization: `Bearer ${token}` },
      });
      const json = await res.json();
      if (!res.ok) {
        toast.error(json.error ?? "Falha ao carregar templates");
        return;
      }
      setItems(json.templates ?? []);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchList();
  }, [fetchList]);

  async function sync() {
    setSyncing(true);
    try {
      const { data: sess } = await supabase.auth.getSession();
      const token = sess.session?.access_token;
      if (!token) return;
      const res = await fetch("/api/whatsapp/templates/sync", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });
      const json = await res.json();
      if (!res.ok) {
        toast.error(json.error ?? "Falha ao sincronizar");
        return;
      }
      toast.success(`Sincronizados ${json.count ?? 0} (aprovados: ${json.approved ?? 0})`);
      await fetchList();
    } finally {
      setSyncing(false);
    }
  }

  async function patch(id: string, body: { purpose?: string | null; auto_use?: boolean }) {
    const { data: sess } = await supabase.auth.getSession();
    const token = sess.session?.access_token;
    if (!token) return;
    const res = await fetch("/api/whatsapp/templates/update", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ id, ...body }),
    });
    const json = await res.json();
    if (!res.ok) {
      toast.error(json.error ?? "Falha ao atualizar");
      return;
    }
    setItems((prev) =>
      prev.map((t) =>
        t.id === id ? { ...t, purpose: json.template.purpose, auto_use: json.template.auto_use } : t,
      ),
    );
  }

  return (
    <div className="space-y-4">
      <WhatsappTemplateSuggestions />

      <Card>
        <CardHeader className="flex flex-row items-start md:items-center gap-2">
          <MessageSquareText className="h-5 w-5 text-primary shrink-0 mt-1 md:mt-0" />
          <div className="flex-1 min-w-0">
            <CardTitle className="text-base md:text-lg">Templates WhatsApp</CardTitle>
            <p className="text-xs text-muted-foreground mt-1 hidden md:block">
              Templates aprovados pela Meta são usados automaticamente fora da janela
              de 24h: Marketing para follow-ups e reativação, Utility para eventos
              operacionais (visita / instalação).
            </p>
          </div>
          <Button variant="outline" size="sm" onClick={sync} disabled={syncing} className="shrink-0 min-h-11 md:min-h-8 min-w-11 md:min-w-0 px-2 md:px-3">
            {syncing ? (
              <Loader2 className="h-4 w-4 md:mr-2 animate-spin" />
            ) : (
              <RefreshCw className="h-4 w-4 md:mr-2" />
            )}
            <span className="hidden md:inline">Sincronizar com Meta</span>
          </Button>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Carregando...
            </div>
          ) : items.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Nenhum template encontrado. Clique em "Sincronizar com Meta" para puxar os
              templates aprovados da sua conta WhatsApp Business.
            </p>
          ) : (
            <div className="space-y-3">
              {items.map((t) => {
                const canAuto = t.category === "utility" && t.status === "approved";
                const body =
                  (t.components ?? []).find((c) => c.type?.toUpperCase() === "BODY")?.text ??
                  "(sem corpo)";
                return (
                  <div
                    key={t.id}
                    className="rounded-lg border border-border p-3 bg-card space-y-2"
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-mono text-sm font-medium break-all min-w-0">{t.name}</span>
                      <span
                        className={`text-[10px] uppercase tracking-wide px-2 py-0.5 rounded border ${categoryBadge(t.category)}`}
                      >
                        {t.category}
                      </span>
                      <span
                        className={`text-[10px] uppercase tracking-wide px-2 py-0.5 rounded border ${statusBadge(t.status)}`}
                      >
                        {t.status}
                      </span>
                      <span className="text-[10px] text-muted-foreground px-2 py-0.5 rounded border border-border">
                        {t.language}
                      </span>
                    </div>
                    <p className="text-xs text-muted-foreground whitespace-pre-wrap leading-relaxed">
                      {body}
                    </p>
                    <div className="grid grid-cols-1 md:grid-cols-[1fr_auto] gap-3 pt-1">
                      <div className="flex flex-col md:flex-row md:items-center gap-1 md:gap-2">
                        <span className="text-xs text-muted-foreground md:w-20">Propósito:</span>
                        <Select
                          value={t.purpose ?? NONE_PURPOSE}
                          onValueChange={(v) =>
                            patch(t.id, { purpose: v === NONE_PURPOSE ? null : v })
                          }
                        >
                          <SelectTrigger className="h-11 md:h-8 w-full md:max-w-xs text-base md:text-xs">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {PURPOSES.map((p) => (
                              <SelectItem key={p.value} value={p.value} className="text-sm md:text-xs">
                                {p.label}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="flex items-center gap-2 min-h-11 md:min-h-0">
                        <span className="text-xs text-muted-foreground">Auto-usar:</span>
                        <Switch
                          checked={t.auto_use}
                          disabled={!canAuto}
                          onCheckedChange={(v) => patch(t.id, { auto_use: v })}
                        />
                        {!canAuto && (
                          <span className="text-[10px] text-muted-foreground">
                            só Utility aprovado
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
