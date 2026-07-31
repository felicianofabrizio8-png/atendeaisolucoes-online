import type { LibraryPick } from "@/lib/inbox/types";
import { Link } from "@tanstack/react-router";
import { Zap } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Virtuoso } from "react-virtuoso";
import { cn } from "@/lib/utils";
import { Send, Loader2, X, Check, Copy, Plus, Image as ImageIcon, Video as VideoIcon, Library as LibraryIcon, MapPin } from "lucide-react";
import { SendLocationDialog } from "@/components/SendLocationDialog";
import { listProducts, subscribeProducts, type Product } from "@/data/products";
import { productMatches } from "@/lib/product-search";
import { buildProductCaption, buildProductCardSubtitle } from "@/lib/product-caption";
import { listQuickReplies, ensureDefaultQuickReplies, updateQuickReply, type QuickReply } from "@/data/quickReplies";
import { SmartImage } from "@/components/SmartImage";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

export type PendingMedia = {
  kind: "image" | "video";
  // Path no bucket product-images (para mídias já carregadas via produto)
  // ou null quando ainda precisamos fazer upload de um File local.
  path: string | null;
  // URL local (blob:) ou signed URL para pré-visualização.
  previewUrl: string;
  file?: File;
  fileName?: string;
};

// ============================================================================
// PlusMenuPortal — menu do "+" renderizado em portal (acima de tudo)
// Desktop: popover ancorado acima do botão. Mobile: bottom sheet.
// ============================================================================
export function PlusMenuPortal({
  anchorRef,
  panelRef,
  onClose,
  onPickImage,
  onPickVideo,
  onOpenLibrary,
  onPickLocation,
}: {
  anchorRef: React.RefObject<HTMLButtonElement | null>;
  panelRef: React.RefObject<HTMLDivElement | null>;
  onClose: () => void;
  onPickImage: () => void;
  onPickVideo: () => void;
  onOpenLibrary: () => void;
  onPickLocation: () => void;
}) {

  const [isMobile, setIsMobile] = useState(
    typeof window !== "undefined" ? window.innerWidth < 768 : false,
  );
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  useEffect(() => {
    const onResize = () => setIsMobile(window.innerWidth < 768);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  // Calcula posição do popover desktop ancorado acima do botão "+"
  useEffect(() => {
    if (isMobile) return;
    const compute = () => {
      const btn = anchorRef.current;
      const panel = panelRef.current;
      if (!btn) return;
      const rect = btn.getBoundingClientRect();
      const panelW = panel?.offsetWidth ?? 224;
      const panelH = panel?.offsetHeight ?? 320;
      const margin = 8;
      // Acima do botão por padrão; se não couber, abre embaixo
      let top = rect.top - panelH - margin;
      if (top < margin) top = rect.bottom + margin;
      let left = rect.right - panelW;
      if (left < margin) left = margin;
      if (left + panelW > window.innerWidth - margin) {
        left = window.innerWidth - panelW - margin;
      }
      setPos({ top, left });
    };
    compute();
    window.addEventListener("resize", compute);
    window.addEventListener("scroll", compute, true);
    return () => {
      window.removeEventListener("resize", compute);
      window.removeEventListener("scroll", compute, true);
    };
  }, [isMobile, anchorRef, panelRef]);

  // Fecha com ESC
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const items = (
    <>
      <button
        type="button"
        onClick={onPickImage}
        className="w-full flex items-center gap-3 px-4 py-3 text-sm hover:bg-accent text-left"
      >
        <ImageIcon className="h-5 w-5 text-primary" /> Foto
      </button>
      <button
        type="button"
        onClick={onPickVideo}
        className="w-full flex items-center gap-3 px-4 py-3 text-sm hover:bg-accent text-left"
      >
        <VideoIcon className="h-5 w-5 text-primary" /> Vídeo
      </button>
      <button
        type="button"
        onClick={onOpenLibrary}
        className="w-full flex items-center gap-3 px-4 py-3 text-sm hover:bg-accent text-left border-t border-border"
      >
        <LibraryIcon className="h-5 w-5 text-primary" /> Biblioteca de Produtos
      </button>
      <button
        type="button"
        onClick={onPickLocation}
        className="w-full flex items-center gap-3 px-4 py-3 text-sm hover:bg-accent text-left border-t border-border"
      >
        <MapPin className="h-5 w-5 text-primary" /> Localização
      </button>
    </>
  );


  if (isMobile) {
    return (
      <div
        className="fixed inset-0 z-[9999] bg-black/40 flex items-end"
        onClick={onClose}
      >
        <div
          ref={panelRef}
          className="w-full bg-popover rounded-t-2xl border-t border-border shadow-2xl max-h-[75vh] overflow-y-auto"
          style={{ paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 8px)" }}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="flex justify-center pt-2 pb-1">
            <div className="h-1.5 w-10 rounded-full bg-muted-foreground/30" />
          </div>
          {items}
        </div>
      </div>
    );
  }

  return (
    <div
      ref={panelRef}
      className="fixed z-[9999] w-56 rounded-md border border-border bg-popover shadow-2xl overflow-hidden max-h-[70vh] overflow-y-auto"
      style={{
        top: pos?.top ?? -9999,
        left: pos?.left ?? -9999,
        visibility: pos ? "visible" : "hidden",
      }}
    >
      {items}
    </div>
  );
}


// ============================================================================
// QuickRepliesButton — botão dedicado "Respostas Rápidas" ao lado do "+".
// Carrega itens cadastrados em Configurações > Respostas Rápidas.
// Ao clicar em uma resposta, PREENCHE a caixa de mensagem (não envia).
// ============================================================================
export function QuickRepliesButton({
  companyId,
  disabled,
  onPick,
}: {
  companyId: string | null;
  disabled: boolean;
  onPick: (text: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<QuickReply[]>([]);
  const [query, setQuery] = useState("");
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const [isMobile, setIsMobile] = useState(
    typeof window !== "undefined" ? window.innerWidth < 768 : false,
  );
  const btnRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onResize = () => setIsMobile(window.innerWidth < 768);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  useEffect(() => {
    if (!companyId) return;
    let cancelled = false;
    ensureDefaultQuickReplies(companyId)
      .then((rows) => {
        if (cancelled) return;
        setItems(rows.filter((r) => r.active));
      })
      .catch(() => {
        listQuickReplies(companyId, { activeOnly: true })
          .then((rows) => !cancelled && setItems(rows))
          .catch(() => {});
      });
    return () => {
      cancelled = true;
    };
  }, [companyId, open]);

  useEffect(() => {
    if (!open || isMobile) return;
    const compute = () => {
      const btn = btnRef.current;
      const panel = panelRef.current;
      if (!btn) return;
      const rect = btn.getBoundingClientRect();
      const panelW = panel?.offsetWidth ?? 320;
      const panelH = panel?.offsetHeight ?? 380;
      const margin = 8;
      let top = rect.top - panelH - margin;
      if (top < margin) top = rect.bottom + margin;
      let left = rect.right - panelW;
      if (left < margin) left = margin;
      if (left + panelW > window.innerWidth - margin) {
        left = window.innerWidth - panelW - margin;
      }
      setPos({ top, left });
    };
    compute();
    window.addEventListener("resize", compute);
    window.addEventListener("scroll", compute, true);
    return () => {
      window.removeEventListener("resize", compute);
      window.removeEventListener("scroll", compute, true);
    };
  }, [open, isMobile, items.length]);

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      const t = e.target as Node;
      if (btnRef.current?.contains(t)) return;
      if (panelRef.current?.contains(t)) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const normalize = (s: string) =>
    s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  const q = normalize(query.trim());
  const filtered = q
    ? items.filter(
        (it) =>
          normalize(it.name).includes(q) ||
          normalize(it.category ?? "").includes(q) ||
          normalize(it.content).includes(q),
      )
    : items;

  const panel = (
    <div
      ref={panelRef}
      className={
        isMobile
          ? "w-full bg-popover rounded-t-2xl border-t border-border shadow-2xl max-h-[75vh] flex flex-col"
          : "fixed z-[9999] w-80 rounded-md border border-border bg-popover shadow-2xl overflow-hidden flex flex-col max-h-[70vh]"
      }
      style={
        isMobile
          ? { paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 8px)" }
          : { top: pos?.top ?? -9999, left: pos?.left ?? -9999 }
      }
      onClick={(e) => e.stopPropagation()}
    >
      {isMobile && (
        <div className="flex justify-center pt-2 pb-1">
          <div className="h-1.5 w-10 rounded-full bg-muted-foreground/30" />
        </div>
      )}
      <div className="px-3 py-2 border-b border-border">
        <div className="flex items-center justify-between mb-2">
          <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            Respostas Rápidas
          </div>
          <Link
            to="/configuracoes/respostas-rapidas"
            className="text-[10px] text-primary hover:underline"
            onClick={() => setOpen(false)}
          >
            Gerenciar
          </Link>
        </div>
        <input
          autoFocus
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Pesquisar resposta…"
          className="w-full rounded-md bg-input px-3 py-1.5 text-sm outline-none focus:ring-2 focus:ring-ring"
        />
      </div>
      <div className="overflow-y-auto flex-1">
        {filtered.length === 0 ? (
          <div className="px-4 py-6 text-center text-xs text-muted-foreground">
            {items.length === 0
              ? "Nenhuma resposta cadastrada. Cadastre em Configurações > Respostas Rápidas."
              : "Nenhuma resposta encontrada."}
          </div>
        ) : (
          filtered.map((it) => (
            <button
              key={it.id}
              type="button"
              onClick={() => {
                onPick(it.content);
                setOpen(false);
                setQuery("");
              }}
              className="w-full flex items-start gap-3 px-3 py-2.5 text-sm hover:bg-accent text-left border-b border-border/40 last:border-b-0"
              title={it.category ?? undefined}
            >
              <span className="text-lg w-6 text-center shrink-0">{it.icon || "💬"}</span>
              <span className="flex-1 min-w-0">
                <span className="block font-medium truncate">{it.name}</span>
                <span className="block text-[11px] text-muted-foreground line-clamp-2">
                  {it.content}
                </span>
              </span>
            </button>
          ))
        )}
      </div>
    </div>
  );

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        disabled={disabled}
        className="h-9 w-9 inline-flex items-center justify-center rounded-md bg-muted hover:bg-muted/80 text-foreground disabled:opacity-40 shrink-0"
        title="Respostas Rápidas — mensagens internas cadastradas pela sua empresa. Ao clicar, o texto é preenchido na caixa de mensagem (não envia automaticamente)."
        aria-label="Respostas Rápidas"
      >
        <Zap className="h-4 w-4" />
      </button>
      {open && typeof document !== "undefined" && createPortal(
        isMobile ? (
          <div
            className="fixed inset-0 z-[9999] bg-black/40 flex items-end"
            onClick={() => setOpen(false)}
          >
            {panel}
          </div>
        ) : (
          panel
        ),
        document.body,
      )}
    </>
  );
}






export function MediaSendPanel({
  conversationId,
  channel,
  disabled,
  companyId,
  leadId,
  onSent,
  onSendText,
  onInsertText,
}: {
  conversationId: string;
  channel: string | undefined;
  disabled: boolean;
  companyId: string | null;
  leadId?: string | null;
  onSent: () => void;
  onSendText: (text: string) => void;
  onInsertText: (text: string) => void;
}) {

  const [menuOpen, setMenuOpen] = useState(false);
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [locationOpen, setLocationOpen] = useState(false);
  const [pending, setPending] = useState<PendingMedia | null>(null);
  const [caption, setCaption] = useState("");
  const [sending, setSending] = useState(false);
  const imgInputRef = useRef<HTMLInputElement>(null);
  const vidInputRef = useRef<HTMLInputElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const menuPanelRef = useRef<HTMLDivElement>(null);
  const isWhats = channel === "whatsapp";

  // Quick replies (respostas rápidas configuráveis)
  const [quickReplies, setQuickReplies] = useState<QuickReply[]>([]);
  const [activeReply, setActiveReply] = useState<QuickReply | null>(null);
  const [replyText, setReplyText] = useState("");

  const [savingReply, setSavingReply] = useState(false);
  const [multiSendProgress, setMultiSendProgress] = useState<{ current: number; total: number } | null>(null);

  useEffect(() => {
    if (!companyId) return;
    let cancelled = false;
    ensureDefaultQuickReplies(companyId)
      .then((rows) => {
        if (cancelled) return;
        setQuickReplies(rows.filter((r) => r.active));
      })
      .catch((e) => {
        console.error("[quick_replies load]", e);
        // Fallback: tenta apenas listar sem semear
        listQuickReplies(companyId, { activeOnly: true })
          .then((rows) => !cancelled && setQuickReplies(rows))
          .catch(() => {});
      });
    return () => {
      cancelled = true;
    };
  }, [companyId, menuOpen]);

  // Fecha menu ao clicar fora (considera portal — checa botão E painel)
  useEffect(() => {
    if (!menuOpen) return;
    const onClick = (e: MouseEvent) => {
      const target = e.target as Node;
      if (menuButtonRef.current?.contains(target)) return;
      if (menuPanelRef.current?.contains(target)) return;
      setMenuOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [menuOpen]);

  const pickFile = (kind: "image" | "video") => {
    setMenuOpen(false);
    (kind === "image" ? imgInputRef : vidInputRef).current?.click();
  };

  const onFile = (e: React.ChangeEvent<HTMLInputElement>, kind: "image" | "video") => {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (!f) return;
    setPending({
      kind,
      path: null,
      previewUrl: URL.createObjectURL(f),
      file: f,
      fileName: f.name,
    });
    setCaption("");
  };

  const cancelPending = () => {
    if (pending?.previewUrl?.startsWith("blob:")) URL.revokeObjectURL(pending.previewUrl);
    setPending(null);
    setCaption("");
  };

  const send = async () => {
    if (!pending || sending) return;
    if (!isWhats) {
      toast.error("Envio de mídia disponível apenas para WhatsApp.");
      return;
    }
    if (!companyId) {
      toast.error("Perfil ainda carregando. Tente novamente em instantes.");
      return;
    }
    setSending(true);
    const fileName = pending.file?.name ?? pending.fileName ?? null;
    const fileType = pending.file?.type ?? pending.kind;
    try {
      let path = pending.path;
      // Upload se for arquivo local
      if (!path && pending.file) {
        const ext = (pending.file.name.split(".").pop() ?? "bin").toLowerCase().slice(0, 6);
        const uploadPath = `${companyId}/inbox/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
        const { error: upErr } = await supabase.storage
          .from("product-images")
          .upload(uploadPath, pending.file, {
            cacheControl: "3600",
            upsert: false,
            contentType: pending.file.type || undefined,
          });
        if (upErr) {
          console.error("[media upload]", upErr);
          throw new Error(`Falha no upload: ${upErr.message}`);
        }
        path = uploadPath;
      }
      if (!path) throw new Error("Arquivo inválido");

      const { data: sess } = await supabase.auth.getSession();
      const token = sess.session?.access_token;
      if (!token) throw new Error("Sessão expirada. Faça login novamente.");

      const res = await fetch("/api/whatsapp/send-media", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          conversationId,
          mediaPath: path,
          kind: pending.kind,
          caption: caption.trim() || undefined,
        }),
      });
      const json = (await res.json().catch(() => ({}))) as { error?: string; id?: string };
      if (!res.ok) {
        throw new Error(json?.error ?? `HTTP ${res.status}`);
      }
      toast.success(`${pending.kind === "video" ? "Vídeo" : "Foto"} enviado(a)`);
      cancelPending();
      onSent();
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Falha ao enviar";
      console.error("MEDIA_SEND_ERROR", {
        conversation_id: conversationId,
        lead_id: leadId ?? null,
        company_id: companyId,
        file_name: fileName,
        file_type: fileType,
        error: msg,
      });
      toast.error(msg);
      // Mantém o modal aberto para o usuário tentar novamente
    } finally {
      setSending(false);
    }
  };

  const sendMediaPath = useCallback(
    async (path: string, kind: "image" | "video", captionText?: string) => {
      const { data: sess } = await supabase.auth.getSession();
      const token = sess.session?.access_token;
      if (!token) throw new Error("Sessão expirada. Faça login novamente.");
      const res = await fetch("/api/whatsapp/send-media", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          conversationId,
          mediaPath: path,
          kind,
          caption: captionText?.trim() || undefined,
        }),
      });
      const json = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(json?.error ?? `HTTP ${res.status}`);
    },
    [conversationId],
  );

  const sendLibraryBatch = useCallback(
    async (items: LibraryPick[]) => {
      if (items.length === 0) return;
      if (!isWhats) {
        toast.error("Envio de mídia disponível apenas para WhatsApp.");
        return;
      }
      setMultiSendProgress({ current: 0, total: items.length });
      let ok = 0;
      for (let i = 0; i < items.length; i++) {
        try {
          await sendMediaPath(items[i].path, "image", items[i].caption);
          ok++;
          onSent();
        } catch (e) {
          console.error("MULTI_MEDIA_SEND_ERROR", { path: items[i].path, error: e });
          toast.error(
            `Falha ao enviar ${i + 1}/${items.length}: ${
              e instanceof Error ? e.message : "erro"
            }`,
          );
        }
        setMultiSendProgress({ current: i + 1, total: items.length });
      }
      setMultiSendProgress(null);
      if (ok > 0) toast.success(`${ok} foto(s) enviada(s)`);
    },
    [isWhats, onSent, sendMediaPath],
  );

  const selectFromLibrary = (items: LibraryPick[]) => {
    setLibraryOpen(false);
    if (items.length === 0) return;
    if (items.length === 1) {
      const { path, caption: cap } = items[0];
      setPending({ kind: "image", path, previewUrl: path });
      setCaption(cap ?? "");
      return;
    }
    void sendLibraryBatch(items);
  };


  return (
    <>
      <input
        ref={imgInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => onFile(e, "image")}
      />
      <input
        ref={vidInputRef}
        type="file"
        accept="video/*"
        className="hidden"
        onChange={(e) => onFile(e, "video")}
      />

      <div className="relative" ref={menuRef}>
        <button
          ref={menuButtonRef}
          type="button"
          onClick={() => setMenuOpen((v) => !v)}
          disabled={disabled}
          className="h-9 w-9 inline-flex items-center justify-center rounded-md bg-muted hover:bg-muted/80 text-foreground disabled:opacity-40 shrink-0"
          title="Anexar mídia"
          aria-label="Anexar mídia"
        >
          <Plus className="h-4 w-4" />
        </button>
      </div>

      {menuOpen && typeof document !== "undefined" && createPortal(
        <PlusMenuPortal
          anchorRef={menuButtonRef}
          panelRef={menuPanelRef}
          onClose={() => setMenuOpen(false)}
          onPickImage={() => pickFile("image")}
          onPickVideo={() => pickFile("video")}
          onOpenLibrary={() => {
            setMenuOpen(false);
            setLibraryOpen(true);
          }}
          onPickLocation={() => {
            setMenuOpen(false);
            setLocationOpen(true);
          }}


        />,
        document.body,
      )}

      <SendLocationDialog
        open={locationOpen}
        onOpenChange={setLocationOpen}
        conversationId={conversationId}
        companyId={companyId}
        disabled={disabled || !isWhats}
        onSent={onSent}
      />

      {/* Modal: editar/enviar resposta rápida */}
      {activeReply && (
        <div
          className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4"
          onClick={() => setActiveReply(null)}
        >
          <div
            className="bg-card rounded-lg border border-border max-w-lg w-full overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="p-4 border-b border-border flex items-center justify-between">
              <div className="font-semibold text-sm flex items-center gap-2">
                <span className="text-lg">{activeReply.icon || "💬"}</span>
                {activeReply.name}
              </div>
              <button onClick={() => setActiveReply(null)} className="p-1 hover:bg-muted rounded">
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="p-4">
              <textarea
                value={replyText}
                onChange={(e) => setReplyText(e.target.value)}
                rows={10}
                className="w-full rounded-md bg-input px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring resize-y"
              />
              <p className="mt-2 text-[11px] text-muted-foreground">
                Edite e clique em "Salvar como padrão" para que o texto fique salvo para a empresa em todos os atendimentos.
              </p>
            </div>
            <div className="p-4 border-t border-border flex items-center justify-end gap-2 flex-wrap">
              <button
                onClick={() => setActiveReply(null)}
                className="h-9 px-3 rounded-md text-sm hover:bg-muted"
              >
                Cancelar
              </button>
              <button
                onClick={() => {
                  navigator.clipboard
                    ?.writeText(replyText)
                    .then(() => toast.success("Copiado"))
                    .catch(() => toast.error("Falha ao copiar"));
                }}
                className="h-9 px-3 inline-flex items-center gap-1.5 rounded-md text-sm border border-border hover:bg-muted"
              >
                <Copy className="h-4 w-4" /> Copiar
              </button>
              <button
                type="button"
                disabled={savingReply || !companyId || !activeReply}
                onClick={async () => {
                  if (!companyId || !activeReply) return;
                  setSavingReply(true);
                  try {
                    const saved = await updateQuickReply(companyId, activeReply.id, {
                      content: replyText,
                    });
                    setQuickReplies((prev) =>
                      prev.map((r) => (r.id === saved.id ? (saved as QuickReply) : r)),
                    );
                    setActiveReply(saved as QuickReply);
                    toast.success("Texto padrão atualizado para a empresa");
                  } catch (e) {
                    const msg = e instanceof Error ? e.message : "Falha ao salvar";
                    toast.error(msg);
                  } finally {
                    setSavingReply(false);
                  }
                }}
                className="h-9 px-3 inline-flex items-center gap-1.5 rounded-md text-sm border border-primary text-primary hover:bg-primary/10 disabled:opacity-50"
              >
                {savingReply ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                Salvar como padrão
              </button>
              <button
                type="button"
                onClick={async () => {
                  const t = replyText.trim();
                  if (!t) {
                    toast.error("Mensagem vazia");
                    return;
                  }
                  // Auto-salva se o texto foi alterado em relação ao salvo
                  if (companyId && activeReply && replyText !== activeReply.content) {
                    try {
                      const saved = await updateQuickReply(companyId, activeReply.id, {
                        content: replyText,
                      });
                      setQuickReplies((prev) =>
                        prev.map((r) => (r.id === saved.id ? (saved as QuickReply) : r)),
                      );
                    } catch (e) {
                      console.warn("[quick_reply auto-save]", e);
                    }
                  }
                  onSendText(t);
                  setActiveReply(null);
                }}
                className="h-9 px-4 inline-flex items-center gap-2 rounded-md bg-primary text-primary-foreground text-sm font-medium"
              >
                <Send className="h-4 w-4" /> Enviar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal: preview + caption */}
      {pending && (
        <div
          className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4"
          onClick={cancelPending}
        >
          <div
            className="bg-card rounded-lg border border-border max-w-lg w-full overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="p-4 border-b border-border flex items-center justify-between">
              <div className="font-semibold text-sm">
                Enviar {pending.kind === "video" ? "vídeo" : "foto"}
                {pending.fileName ? ` · ${pending.fileName}` : ""}
              </div>
              <button onClick={cancelPending} className="p-1 hover:bg-muted rounded">
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="p-4 max-h-[60vh] overflow-auto flex items-center justify-center bg-muted/30">
              {pending.kind === "video" ? (
                <video
                  src={pending.previewUrl}
                  controls
                  className="max-h-[55vh] max-w-full rounded"
                />
              ) : pending.path ? (
                <SmartImage
                  src={pending.previewUrl}
                  alt="Pré-visualização"
                  wrapperClassName="rounded max-h-[55vh] max-w-full"
                  className="object-contain"
                />
              ) : (
                <img
                  src={pending.previewUrl}
                  alt="Pré-visualização"
                  className="max-h-[55vh] max-w-full rounded object-contain"
                />
              )}
            </div>
            <div className="p-4 space-y-3 border-t border-border">
              {caption.trim() && (
                <div className="rounded-md bg-muted/40 border border-border px-3 py-2 text-xs text-foreground whitespace-pre-wrap leading-snug">
                  {caption}
                </div>
              )}
              <input
                type="text"
                value={caption}
                onChange={(e) => setCaption(e.target.value)}
                placeholder="Legenda (opcional)"
                maxLength={1024}
                className="w-full rounded-md bg-input px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
              />

              <div className="flex items-center justify-end gap-2">
                <button
                  onClick={cancelPending}
                  className="h-9 px-3 rounded-md text-sm hover:bg-muted"
                  disabled={sending}
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    void send();
                  }}
                  disabled={sending}
                  className="h-9 px-4 inline-flex items-center gap-2 rounded-md bg-primary text-primary-foreground text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                  {sending ? "Enviando..." : "Enviar"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {libraryOpen && (
        <ProductsLibraryModal
          onClose={() => setLibraryOpen(false)}
          onPick={selectFromLibrary}
        />
      )}

      {multiSendProgress && (
        <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-[60] bg-card border border-border rounded-full shadow-lg px-4 py-2 text-sm flex items-center gap-2">
          <Loader2 className="h-4 w-4 animate-spin text-primary" />
          Enviando fotos {multiSendProgress.current}/{multiSendProgress.total}…
        </div>
      )}
    </>
  );
}

export function ProductsLibraryModal({
  onClose,
  onPick,
}: {
  onClose: () => void;
  onPick: (items: LibraryPick[]) => void;
}) {
  const [, force] = useState(0);
  useEffect(() => subscribeProducts(() => force((n) => n + 1)), []);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const all = listProducts();
  const filtered = useMemo<Product[]>(
    () => all.filter((p) => productMatches(p, query)),
    [all, query],
  );
  const byCategory = useMemo(() => {
    const map = new Map<string, Product[]>();
    for (const p of filtered) {
      if (!p.images || p.images.length === 0) continue;
      const list = map.get(p.category) ?? [];
      list.push(p);
      map.set(p.category, list);
    }
    return Array.from(map.entries());
  }, [filtered]);

  // path → product (para preservar a associação imagem → produto na seleção
  // e ao montar a legenda). Prioriza o primeiro produto que declara a imagem.
  const imageToProduct = useMemo(() => {
    const map = new Map<string, Product>();
    for (const p of all) {
      for (const img of p.images ?? []) {
        if (!map.has(img)) map.set(img, p);
      }
    }
    return map;
  }, [all]);

  const toggle = (img: string) => {
    setSelected((prev) =>
      prev.includes(img) ? prev.filter((p) => p !== img) : [...prev, img],
    );
  };
  const clearSelection = () => setSelected([]);
  const confirmSend = () => {
    if (selected.length === 0) return;
    const items: LibraryPick[] = selected.map((path) => {
      const p = imageToProduct.get(path);
      return {
        path,
        productId: p?.id ?? "",
        caption: p ? buildProductCaption(p) : "",
      };
    });
    onPick(items);
  };


  return (
    <div
      className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="bg-card rounded-lg border border-border max-w-3xl w-full max-h-[85vh] flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="p-4 border-b border-border flex items-center justify-between gap-3 flex-wrap">
          <div className="font-semibold text-sm flex items-center gap-2">
            <LibraryIcon className="h-4 w-4" /> Biblioteca de Produtos
          </div>
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Buscar produto ou categoria…"
            className="flex-1 min-w-[180px] max-w-xs rounded-md bg-input px-3 py-1.5 text-sm outline-none focus:ring-2 focus:ring-ring"
          />
          <button onClick={onClose} className="p-1 hover:bg-muted rounded">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="px-4 py-2 border-b border-border text-[11px] text-muted-foreground">
          Toque nas fotos para selecionar várias. Toque novamente para desmarcar.
        </div>
        <div className="overflow-y-auto p-4 space-y-6 flex-1">
          {byCategory.length === 0 && (
            <div className="text-center text-sm text-muted-foreground py-12">
              Nenhuma foto disponível. Adicione fotos aos seus produtos em /produtos.
            </div>
          )}
          {byCategory.map(([cat, items]) => (
            <div key={cat}>
              <div className="text-xs uppercase tracking-wide text-muted-foreground mb-2">
                {cat}
              </div>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                {items.flatMap((p) => {
                  const subtitle = buildProductCardSubtitle(p);
                  return (p.images ?? []).map((img, i) => {
                    const isSel = selected.includes(img);
                    const selIndex = isSel ? selected.indexOf(img) + 1 : 0;
                    return (
                      <button
                        key={`${p.id}-${i}`}
                        type="button"
                        onClick={() => toggle(img)}
                        className={cn(
                          "group relative rounded-md overflow-hidden border focus:outline-none focus:ring-2 focus:ring-ring transition text-left bg-background",
                          isSel
                            ? "border-primary ring-2 ring-primary"
                            : "border-border hover:border-primary",
                        )}
                        title={p.name}
                      >
                        <div className="relative">
                          <SmartImage
                            src={img}
                            alt={p.name}
                            aspectRatio="1/1"
                            wrapperClassName="w-full"
                            thumbWidth={320}
                            thumbQuality={72}
                          />
                          {isSel && (
                            <div className="absolute top-1 right-1 h-6 w-6 rounded-full bg-primary text-primary-foreground text-xs font-semibold flex items-center justify-center shadow">
                              {selIndex}
                            </div>
                          )}
                        </div>
                        <div className="p-2 space-y-0.5">
                          <div className="text-xs font-semibold text-foreground line-clamp-2 leading-snug">
                            {p.name}
                          </div>
                          {subtitle && (
                            <div className="text-[11px] text-muted-foreground line-clamp-2 leading-snug">
                              {subtitle}
                            </div>
                          )}
                        </div>
                      </button>
                    );
                  });
                })}
              </div>
            </div>

          ))}
        </div>
        <div className="p-3 border-t border-border flex items-center justify-between gap-2 bg-card">
          <div className="text-xs text-muted-foreground">
            {selected.length === 0
              ? "Nenhuma foto selecionada"
              : `${selected.length} foto${selected.length > 1 ? "s" : ""} selecionada${selected.length > 1 ? "s" : ""}`}
          </div>
          <div className="flex items-center gap-2">
            {selected.length > 0 && (
              <button
                onClick={clearSelection}
                className="h-9 px-3 rounded-md text-sm hover:bg-muted"
              >
                Limpar
              </button>
            )}
            <button
              type="button"
              disabled={selected.length === 0}
              onClick={confirmSend}
              className="h-9 px-4 inline-flex items-center gap-2 rounded-md bg-primary text-primary-foreground text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <Send className="h-4 w-4" />
              {selected.length > 1 ? `Enviar ${selected.length} selecionadas` : "Enviar selecionada"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// Referência estável para "sem mensagens". Evita que um literal `[]` novo a
// cada render (quando `conversation` ainda é undefined durante a hidratação
// do leadRepo) invalide as memoizações downstream de `messages` /
// `visibleMessages` e force re-medição do Virtuoso. Congelado para impedir
