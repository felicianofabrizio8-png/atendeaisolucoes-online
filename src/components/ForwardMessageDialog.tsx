// Modal de encaminhamento de mídia (imagem/vídeo) recebida do cliente
// para outro lead da mesma empresa.
//
// V1 — UI apenas. Toda lógica de envio é do endpoint
// /api/whatsapp/forward-message. Aqui só:
//  - lista leads da empresa atual com conversa WhatsApp aberta;
//  - permite busca textual (nome/telefone);
//  - coleta observação opcional;
//  - dispara o POST e mostra feedback.

import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { Loader2, Search, Send, X, Forward } from "lucide-react";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";
import { safeErrorMessage, summarizeHttp } from "@/lib/audit/sanitize";

export interface ForwardMessageTarget {
  messageId: string;
  kind: "image" | "video";
  preview?: { thumbUrl?: string | null; filename?: string | null };
}

interface LeadOption {
  id: string;
  name: string | null;
  phone: string | null;
  conversationId: string;
}

interface ForwardMessageDialogProps {
  open: boolean;
  target: ForwardMessageTarget | null;
  currentConversationId?: string;
  onClose: () => void;
  onSuccess?: (info: { conversationId: string }) => void;
}

interface ForwardErrorResponse {
  error?: string;
  status?: number;
  metaError?: { message?: string; code?: number; error_subcode?: number; type?: string } | null;
  debug?: {
    requestId?: string;
    targetConversation?: { id?: string | null } | null;
    window24h?: { inside?: boolean; lastLeadAt?: string | null; conversationId?: string | null };
    signedUrl?: { headStatus?: number; getRangeStatus?: number; error?: string };
    meta?: { status?: number; rawBody?: string; error?: { message?: string } | null };
  };
  conversationId?: string;
}

function summarizeForwardError(status: number, json: ForwardErrorResponse): string {
  const parts = [
    `HTTP ${status}`,
    json.error,
    json.debug?.requestId ? `req ${json.debug.requestId}` : null,
    json.debug?.targetConversation?.id ? `conv ${json.debug.targetConversation.id}` : null,
    json.debug?.window24h
      ? `24h ${json.debug.window24h.inside ? "sim" : "não"}${json.debug.window24h.lastLeadAt ? ` (${json.debug.window24h.lastLeadAt})` : ""}`
      : null,
    json.debug?.signedUrl
      ? `mídia HEAD ${json.debug.signedUrl.headStatus ?? "?"}${json.debug.signedUrl.getRangeStatus ? ` GET ${json.debug.signedUrl.getRangeStatus}` : ""}`
      : null,
    json.debug?.meta?.status || json.metaError
      ? `Meta ${json.debug?.meta?.status ?? json.status ?? "?"}: ${json.debug?.meta?.error?.message ?? json.metaError?.message ?? json.debug?.meta?.rawBody ?? "erro"}`
      : null,
  ];
  return parts.filter(Boolean).join(" · ").slice(0, 480);
}

export function ForwardMessageDialog({
  open,
  target,
  currentConversationId,
  onClose,
  onSuccess,
}: ForwardMessageDialogProps) {
  const [leads, setLeads] = useState<LeadOption[]>([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState("");
  const [selectedLeadId, setSelectedLeadId] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [sending, setSending] = useState(false);

  useEffect(() => {
    if (!open) return;
    setSearch("");
    setSelectedLeadId(null);
    setNote("");
    setLoading(true);

    (async () => {
      try {
        const { data, error } = await supabase
          .from("conversations")
          .select("id, lead_id, channel, leads(id, name, phone)")
          .eq("channel", "whatsapp")
          .order("last_message_at", { ascending: false })
          .limit(200);
        if (error) throw error;
        const opts: LeadOption[] = (data ?? [])
          .map((row) => {
            const lead = (row as { leads?: { id: string; name: string | null; phone: string | null } | null }).leads;
            if (!lead) return null;
            return {
              id: lead.id,
              name: lead.name,
              phone: lead.phone,
              conversationId: row.id,
            } satisfies LeadOption;
          })
          .filter((x): x is LeadOption => x !== null)
          // Não mostra a própria conversa.
          .filter((x) => x.conversationId !== currentConversationId);
        // Dedup por lead.id (lead pode ter mais de uma conversa)
        const seen = new Set<string>();
        const dedup = opts.filter((o) => {
          if (seen.has(o.id)) return false;
          seen.add(o.id);
          return true;
        });
        setLeads(dedup);
      } catch (e) {
        toast.error("Falha ao carregar contatos", {
          description: e instanceof Error ? e.message : String(e),
        });
      } finally {
        setLoading(false);
      }
    })();
  }, [open, currentConversationId]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return leads;
    return leads.filter((l) => {
      const n = (l.name ?? "").toLowerCase();
      const p = (l.phone ?? "").toLowerCase();
      return n.includes(q) || p.includes(q);
    });
  }, [leads, search]);

  async function handleSend() {
    if (!target || !selectedLeadId) return;
    setSending(true);
    try {
      const { data: sess } = await supabase.auth.getSession();
      const token = sess.session?.access_token;
      if (!token) throw new Error("Sessão expirada. Faça login novamente.");
      const res = await fetch("/api/whatsapp/forward-message", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          sourceMessageId: target.messageId,
          targetLeadId: selectedLeadId,
          note: note.trim() || undefined,
        }),
      });
      const json = (await res.json().catch(() => ({}))) as ForwardErrorResponse;
      if (!res.ok) {
        console.error("FORWARD_DEBUG", summarizeHttp(res.status, json));
        const mainMsg =
          json.error ??
          json.debug?.meta?.error?.message ??
          json.metaError?.message ??
          "erro desconhecido";
        const detail = [
          `HTTP ${res.status}`,
          `msg: ${mainMsg}`,
          `targetConv: ${json.debug?.targetConversation?.id ?? "—"}`,
          `janela24h: ${
            json.debug?.window24h?.inside === true
              ? "true"
              : json.debug?.window24h?.inside === false
                ? "false"
                : "—"
          }`,
          `signedUrl: HEAD ${json.debug?.signedUrl?.headStatus ?? "—"}${
            json.debug?.signedUrl?.getRangeStatus
              ? ` / GET ${json.debug.signedUrl.getRangeStatus}`
              : ""
          }`,
          `Meta: ${json.debug?.meta?.status ?? "—"} ${
            json.debug?.meta?.error?.message ??
            json.debug?.meta?.rawBody ??
            json.metaError?.message ??
            "—"
          }`,
        ].join(" · ");
        toast.error(`Erro ao encaminhar: ${mainMsg}`, { description: detail });
        return;
      }
      toast.success("Mensagem encaminhada");
      onSuccess?.({ conversationId: json.conversationId ?? "" });
      onClose();
    } catch (e) {
      console.error("FORWARD_DEBUG", safeErrorMessage(e));
      toast.error("Erro ao encaminhar", {
        description: e instanceof Error ? e.message : String(e),
      });
    } finally {
      setSending(false);
    }
  }

  if (!open || !target || typeof document === "undefined") return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center bg-background/80 backdrop-blur-sm p-4"
      onClick={() => !sending && onClose()}
    >
      <div
        className="w-full max-w-md rounded-lg border border-border bg-card shadow-2xl flex flex-col max-h-[85vh]"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex items-center justify-between border-b border-border px-4 py-3">
          <div className="flex items-center gap-2">
            <Forward className="h-4 w-4 text-primary" />
            <h2 className="text-sm font-semibold">Encaminhar mensagem</h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={sending}
            className="h-8 w-8 inline-flex items-center justify-center rounded-md hover:bg-accent text-muted-foreground"
            aria-label="Fechar"
          >
            <X className="h-4 w-4" />
          </button>
        </header>

        <div className="px-4 py-3 border-b border-border">
          <div className="flex items-center gap-3">
            {target.preview?.thumbUrl ? (
              <img
                src={target.preview.thumbUrl}
                alt=""
                className="h-12 w-12 rounded object-cover border border-border"
              />
            ) : (
              <div className="h-12 w-12 rounded bg-muted grid place-items-center text-xs text-muted-foreground">
                {target.kind === "video" ? "🎬" : "📷"}
              </div>
            )}
            <div className="min-w-0">
              <div className="text-xs text-muted-foreground">
                {target.kind === "video" ? "Vídeo" : "Imagem"}
              </div>
              <div className="text-sm truncate">
                {target.preview?.filename ?? "Mídia recebida do cliente"}
              </div>
            </div>
          </div>
        </div>

        <div className="px-4 py-3 border-b border-border">
          <label className="block text-xs font-medium text-muted-foreground mb-1.5">
            Para
          </label>
          <div className="relative mb-2">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar por nome ou telefone…"
              className="w-full pl-7 pr-2 py-1.5 text-sm rounded-md bg-input border border-border outline-none focus:ring-2 focus:ring-ring"
            />
          </div>
          <div className="max-h-48 overflow-y-auto rounded-md border border-border bg-background/40">
            {loading ? (
              <div className="flex items-center justify-center gap-2 py-6 text-xs text-muted-foreground">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                Carregando contatos…
              </div>
            ) : filtered.length === 0 ? (
              <div className="py-6 text-center text-xs text-muted-foreground">
                Nenhum contato encontrado
              </div>
            ) : (
              filtered.map((l) => (
                <button
                  key={l.id}
                  type="button"
                  onClick={() => setSelectedLeadId(l.id)}
                  className={cn(
                    "w-full text-left px-3 py-2 text-sm flex flex-col gap-0.5 border-b border-border/50 last:border-b-0 hover:bg-accent transition-colors",
                    selectedLeadId === l.id && "bg-primary/10",
                  )}
                >
                  <span className="font-medium truncate">
                    {l.name ?? "Sem nome"}
                  </span>
                  <span className="text-[11px] text-muted-foreground truncate">
                    {l.phone ?? "—"}
                  </span>
                </button>
              ))
            )}
          </div>
        </div>

        <div className="px-4 py-3 flex-1">
          <label className="block text-xs font-medium text-muted-foreground mb-1.5">
            Observação (opcional)
          </label>
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value.slice(0, 1024))}
            rows={3}
            placeholder="Adicione um contexto para o destinatário…"
            className="w-full resize-none rounded-md bg-input border border-border px-2 py-1.5 text-sm outline-none focus:ring-2 focus:ring-ring"
          />
          <div className="text-[10px] text-muted-foreground text-right mt-1">
            {note.length}/1024
          </div>
        </div>

        <footer className="border-t border-border px-4 py-3 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={sending}
            className="px-3 py-1.5 text-sm rounded-md border border-border hover:bg-accent"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={handleSend}
            disabled={sending || !selectedLeadId}
            className="px-3 py-1.5 text-sm rounded-md bg-primary text-primary-foreground inline-flex items-center gap-1.5 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {sending ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Send className="h-3.5 w-3.5" />
            )}
            Encaminhar
          </button>
        </footer>
      </div>
    </div>,
    document.body,
  );
}
