import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { Loader2, Search, X, ArrowLeft, Send, FileText } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";

interface MetaTemplate {
  id: string;
  name: string;
  language: string;
  category: string;
  status: string;
  variables: string[];
  components: Array<{ type: string; text?: string }>;
}

interface Props {
  open: boolean;
  conversationId: string;
  onClose: () => void;
  onSent?: () => void;
  /** Nome opcional de template a pré-selecionar ao abrir (recomendação). */
  suggestedTemplateName?: string;
}

type StatusFilter = "approved" | "all";

export function MetaTemplatesModal({ open, conversationId, onClose, onSent, suggestedTemplateName }: Props) {

  const [loading, setLoading] = useState(false);
  const [items, setItems] = useState<MetaTemplate[]>([]);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("approved");
  const [selected, setSelected] = useState<MetaTemplate | null>(null);
  const [vars, setVars] = useState<Record<string, string>>({});
  const [sending, setSending] = useState(false);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const { data: sess } = await supabase.auth.getSession();
        const token = sess.session?.access_token;
        if (!token) return;
        const res = await fetch("/api/whatsapp/templates/list", {
          headers: { Authorization: `Bearer ${token}` },
        });
        const json = await res.json();
        if (cancelled) return;
        if (!res.ok) {
          toast.error(json.error ?? "Falha ao carregar templates");
          return;
        }
        setItems(
          (json.templates ?? []).filter(
            (t: MetaTemplate) => t.name?.toLowerCase() !== "hello_world",
          ),
        );
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open]);

  useEffect(() => {
    if (!open) {
      setSelected(null);
      setVars({});
      setSearch("");
      setStatusFilter("approved");
    }
  }, [open]);

  // Pré-seleciona template sugerido quando lista carrega
  useEffect(() => {
    if (!open || !suggestedTemplateName || selected || items.length === 0) return;
    const found = items.find(
      (t) =>
        t.name.toLowerCase() === suggestedTemplateName.toLowerCase() &&
        t.status === "approved",
    );
    if (found) {
      setSelected(found);
      const init: Record<string, string> = {};
      (found.variables ?? []).forEach((n) => {
        init[n] = "";
      });
      setVars(init);
    }
  }, [open, suggestedTemplateName, items, selected]);


  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return items.filter((t) => {
      if (statusFilter === "approved" && t.status !== "approved") return false;
      if (!q) return true;
      return (
        t.name.toLowerCase().includes(q) ||
        (t.category ?? "").toLowerCase().includes(q) ||
        (t.language ?? "").toLowerCase().includes(q)
      );
    });
  }, [items, search, statusFilter]);

  function openTemplate(tpl: MetaTemplate) {
    setSelected(tpl);
    const init: Record<string, string> = {};
    (tpl.variables ?? []).forEach((name) => {
      init[name] = "";
    });
    setVars(init);
  }

  async function handleSend() {
    if (!selected) return;
    setSending(true);
    try {
      const { data: sess } = await supabase.auth.getSession();
      const token = sess.session?.access_token;
      if (!token) {
        toast.error("Sessão expirada");
        return;
      }
      const res = await fetch("/api/whatsapp/templates/send", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          conversationId,
          templateId: selected.id,
          variables: vars,
        }),
      });
      const json = await res.json();
      if (!res.ok) {
        toast.error(json.error ?? "Falha ao enviar template");
        return;
      }
      toast.success("Template enviado");
      onSent?.();
      onClose();
    } finally {
      setSending(false);
    }
  }

  if (!open || typeof document === "undefined") return null;

  const bodyText =
    selected?.components?.find((c) => c.type?.toUpperCase() === "BODY")?.text ?? "";

  function statusBadge(status: string) {
    if (status === "approved") return "bg-emerald-500/15 text-emerald-600 border-emerald-500/30";
    if (status === "pending") return "bg-amber-500/15 text-amber-600 border-amber-500/30";
    if (status === "rejected") return "bg-red-500/15 text-red-600 border-red-500/30";
    return "bg-secondary text-muted-foreground border-border";
  }
  function catBadge(cat: string) {
    const c = (cat ?? "").toLowerCase();
    if (c === "utility") return "bg-primary/15 text-primary border-primary/30";
    if (c === "marketing") return "bg-fuchsia-500/15 text-fuchsia-600 border-fuchsia-500/30";
    if (c === "authentication") return "bg-indigo-500/15 text-indigo-600 border-indigo-500/30";
    return "bg-secondary text-muted-foreground border-border";
  }

  return createPortal(
    <div className="fixed inset-0 z-[1000] flex items-end md:items-center justify-center bg-black/50 backdrop-blur-sm p-0 md:p-4">
      <div className="w-full md:max-w-2xl bg-background border border-border rounded-t-2xl md:rounded-xl shadow-xl flex flex-col max-h-[90vh]">
        <div className="flex items-center gap-2 px-4 py-3 border-b border-border">
          {selected ? (
            <button
              type="button"
              onClick={() => setSelected(null)}
              className="h-8 w-8 inline-flex items-center justify-center rounded-md hover:bg-accent"
              aria-label="Voltar"
            >
              <ArrowLeft className="h-4 w-4" />
            </button>
          ) : (
            <FileText className="h-4 w-4 text-primary" />
          )}
          <div className="flex-1 min-w-0">
            <h2 className="text-sm font-semibold truncate">
              {selected ? selected.name : "Templates da Meta"}
            </h2>
            <p className="text-[11px] text-muted-foreground truncate">
              {selected
                ? "Preencha as variáveis e envie para reabrir a conversa"
                : "Modelos oficiais sincronizados da Meta"}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="h-8 w-8 inline-flex items-center justify-center rounded-md hover:bg-accent"
            aria-label="Fechar"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {!selected ? (
          <>
            <div className="px-4 py-3 border-b border-border space-y-2">
              <div className="relative">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                <input
                  type="text"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Pesquisar pelo nome do template..."
                  className="w-full h-9 pl-8 pr-3 text-sm rounded-md border border-border bg-background"
                />
              </div>
              <div className="flex items-center gap-1.5 text-[11px]">
                <button
                  type="button"
                  onClick={() => setStatusFilter("approved")}
                  className={cn(
                    "h-7 px-2.5 rounded-full border",
                    statusFilter === "approved"
                      ? "bg-primary text-primary-foreground border-primary"
                      : "bg-background text-muted-foreground border-border hover:bg-accent",
                  )}
                >
                  Apenas aprovados
                </button>
                <button
                  type="button"
                  onClick={() => setStatusFilter("all")}
                  className={cn(
                    "h-7 px-2.5 rounded-full border",
                    statusFilter === "all"
                      ? "bg-primary text-primary-foreground border-primary"
                      : "bg-background text-muted-foreground border-border hover:bg-accent",
                  )}
                >
                  Todos
                </button>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto p-3 space-y-2">
              {loading ? (
                <div className="flex items-center gap-2 text-sm text-muted-foreground p-3">
                  <Loader2 className="h-4 w-4 animate-spin" /> Carregando templates...
                </div>
              ) : filtered.length === 0 ? (
                <p className="text-sm text-muted-foreground p-3 text-center">
                  Nenhum template encontrado.
                  {statusFilter === "approved" && items.length > 0 && (
                    <> Tente trocar o filtro para "Todos".</>
                  )}
                </p>
              ) : (
                filtered.map((t) => {
                  const body =
                    t.components?.find((c) => c.type?.toUpperCase() === "BODY")?.text ?? "";
                  const disabled = t.status !== "approved";
                  return (
                    <button
                      type="button"
                      key={t.id}
                      disabled={disabled}
                      onClick={() => openTemplate(t)}
                      className={cn(
                        "w-full text-left rounded-lg border border-border p-3 bg-card space-y-1.5",
                        disabled
                          ? "opacity-60 cursor-not-allowed"
                          : "hover:border-primary/40 hover:bg-accent/30",
                      )}
                    >
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="font-mono text-sm font-medium break-all">{t.name}</span>
                        <span
                          className={`text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded border ${catBadge(t.category)}`}
                        >
                          {t.category}
                        </span>
                        <span
                          className={`text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded border ${statusBadge(t.status)}`}
                        >
                          {t.status}
                        </span>
                        <span className="text-[10px] text-muted-foreground px-1.5 py-0.5 rounded border border-border">
                          {t.language}
                        </span>
                      </div>
                      {body && (
                        <p className="text-xs text-muted-foreground whitespace-pre-wrap line-clamp-3">
                          {body}
                        </p>
                      )}
                    </button>
                  );
                })
              )}
            </div>
          </>
        ) : (
          <>
            <div className="flex-1 overflow-y-auto p-4 space-y-4">
              <div className="rounded-md border border-border bg-muted/30 p-3">
                <div className="flex flex-wrap items-center gap-1.5 mb-2">
                  <span
                    className={`text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded border ${catBadge(selected.category)}`}
                  >
                    {selected.category}
                  </span>
                  <span
                    className={`text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded border ${statusBadge(selected.status)}`}
                  >
                    {selected.status}
                  </span>
                  <span className="text-[10px] text-muted-foreground px-1.5 py-0.5 rounded border border-border">
                    {selected.language}
                  </span>
                </div>
                <p className="text-xs text-foreground whitespace-pre-wrap leading-relaxed">
                  {bodyText || "(sem corpo)"}
                </p>
              </div>

              {(selected.variables ?? []).length > 0 ? (
                <div className="space-y-2">
                  <p className="text-xs font-semibold text-muted-foreground">
                    Variáveis do template
                  </p>
                  {selected.variables.map((name) => (
                    <div key={name} className="space-y-1">
                      <label className="text-[11px] text-muted-foreground font-medium">
                        {name}
                      </label>
                      <input
                        type="text"
                        value={vars[name] ?? ""}
                        onChange={(e) =>
                          setVars((prev) => ({ ...prev, [name]: e.target.value }))
                        }
                        placeholder={`Valor para ${name}`}
                        className="w-full h-9 px-3 text-sm rounded-md border border-border bg-background"
                      />
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-xs text-muted-foreground">
                  Este template não possui variáveis. Pode ser enviado diretamente.
                </p>
              )}
            </div>
            <div className="flex items-center justify-end gap-2 px-4 py-3 border-t border-border">
              <button
                type="button"
                onClick={() => setSelected(null)}
                disabled={sending}
                className="h-9 px-3 text-xs rounded-md border border-border hover:bg-accent disabled:opacity-50"
              >
                Voltar
              </button>
              <button
                type="button"
                onClick={handleSend}
                disabled={sending || selected.status !== "approved"}
                className="h-9 px-3 text-xs font-semibold rounded-md bg-primary text-primary-foreground hover:opacity-90 inline-flex items-center gap-1.5 disabled:opacity-50"
              >
                {sending ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Send className="h-3.5 w-3.5" />
                )}
                Enviar template
              </button>
            </div>
          </>
        )}
      </div>
    </div>,
    document.body,
  );
}
