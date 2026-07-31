// Extraído de src/routes/orcamentos.tsx (Sprint 7 — Fase 7.2).
// Movimento literal: JSX, estados, efeitos, queries, mutations, cálculos e
// validações permanecem idênticos ao original.

import * as React from "react";
import { useMemo, useState } from "react";
import { X, Send, Check, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { formatBRL } from "@/data/mock";
import { getProduct } from "@/data/products";
import { sendQuoteWhatsApp, QuoteSendError } from "@/data/quotes";
import { newQuoteSendAttemptId, friendlyQuoteSendMessage } from "@/lib/quote-send/errors";
import { qsCode, qsDebug } from "@/lib/quote-send/diagnostics";
import { cn } from "@/lib/utils";
import { SmartImage } from "@/components/SmartImage";
import type { Quote } from "@/data/quotes";

// ===== Modal de envio em partes =====

export type BlockKey = "photos" | "base" | "inclusos" | "brindes" | "porConta" | "notes";
export type BlockStatus = "pendente" | "enviando" | "enviado" | "erro";

export function buildBaseText(quote: Quote): string {
  const validStr = new Date(quote.validUntil).toLocaleDateString("pt-BR");
  const lines: string[] = [];
  lines.push(`Seu orçamento de *${quote.productName}* ficou em *${formatBRL(quote.finalValue)}*.`);
  if (quote.installments > 1) {
    const parcela = quote.finalValue / quote.installments;
    lines.push(
      `Pode ser parcelado em até *${quote.installments}x de ${formatBRL(parcela)}* no ${quote.paymentMethod.toLowerCase()}.`,
    );
  } else {
    lines.push(`Forma de pagamento: *${quote.paymentMethod}* (à vista).`);
  }
  lines.push(`Proposta válida até *${validStr}*.`);
  return lines.join("\n");
}

export function buildListText(title: string, items: string[], bullet = "💧"): string {
  if (items.length === 0) return "";
  return [title, ...items.map((it) => `${bullet} ${it}`)].join("\n");
}

export function SendWhatsAppModal({
  quote,
  leadName,
  phone,
  onClose,
  onSent,
}: {
  quote: Quote;
  leadName: string;
  phone: string;
  onClose: () => void;
  onSent: (conversationId?: string) => void;
}) {
  const product = getProduct(quote.productId);
  const availableImages = product?.images ?? [];

  // Texto padrão por bloco
  const defaults = useMemo(
    () => ({
      base: buildBaseText(quote),
      inclusos: buildListText("✅ *Itens inclusos:*", quote.inclusos),
      brindes: buildListText("🎁 *Brindes:*", quote.brindes),
      porConta: buildListText("⚠️ *Por conta do cliente:*", quote.porConta, "•"),
      notes: quote.notes.trim() ? `📝 *Observações:*\n${quote.notes.trim()}` : "",
    }),
    [quote],
  );

  const available: Record<BlockKey, boolean> = {
    photos: availableImages.length > 0,
    base: true,
    inclusos: quote.inclusos.length > 0,
    brindes: quote.brindes.length > 0,
    porConta: quote.porConta.length > 0,
    notes: quote.notes.trim().length > 0,
  };

  const [texts, setTexts] = useState<Record<Exclude<BlockKey, "photos">, string>>({
    base: defaults.base,
    inclusos: defaults.inclusos,
    brindes: defaults.brindes,
    porConta: defaults.porConta,
    notes: defaults.notes,
  });

  const [selected, setSelected] = useState<Record<BlockKey, boolean>>({
    photos: available.photos,
    base: true,
    inclusos: available.inclusos,
    brindes: available.brindes,
    porConta: available.porConta,
    notes: available.notes,
  });

  const [status, setStatus] = useState<Record<BlockKey, BlockStatus>>({
    photos: "pendente",
    base: "pendente",
    inclusos: "pendente",
    brindes: "pendente",
    porConta: "pendente",
    notes: "pendente",
  });

  const [selectedImages, setSelectedImages] = useState<string[]>(availableImages);
  const [busyAll, setBusyAll] = useState(false);

  const toggleImage = (url: string) => {
    setSelectedImages((prev) =>
      prev.includes(url) ? prev.filter((u) => u !== url) : [...prev, url],
    );
  };

  // Rastreia blocos concluídos por tentativa (mesmo attemptId).
  // Se >0, retry do lote inteiro é inseguro (duplicaria mensagens).
  const completedByAttempt = useMemo(() => new Map<string, number>(), []);

  const showErrorToast = (
    norm: { code: import("@/lib/quote-send/errors").QuoteSendErrorCode; retryable: boolean },
    attemptId: string,
    opts?: { onRetry?: () => void },
  ) => {
    const code = qsCode(attemptId);
    const msg = friendlyQuoteSendMessage(norm.code);
    const priorCompleted = completedByAttempt.get(attemptId) ?? 0;
    const safeRetry = norm.retryable && priorCompleted === 0 && !!opts?.onRetry;
    toast.error(msg, {
      description: `Código de atendimento: ${code}`,
      duration: 12000,
      action: safeRetry
        ? { label: "Tentar novamente", onClick: opts!.onRetry! }
        : {
            label: "Copiar código",
            onClick: () => void navigator.clipboard.writeText(code).catch(() => undefined),
          },
    });
  };

  const sendBlock = async (
    key: BlockKey,
    ctx?: { attemptId?: string; blockIndex?: number },
  ): Promise<boolean> => {
    if (!available[key]) return false;
    if (status[key] === "enviando") return false;
    const attemptId = ctx?.attemptId ?? newQuoteSendAttemptId();
    const blockIndex = ctx?.blockIndex ?? 0;
    qsDebug("QUOTE_SEND_CLICKED", {
      attemptId,
      quoteIdMasked: quote.id.slice(0, 8),
      blockType: key,
      blockIndex,
    });
    setStatus((s) => ({ ...s, [key]: "enviando" }));
    try {
      if (key === "photos") {
        if (selectedImages.length === 0) throw new Error("Selecione ao menos uma foto");
        const res = await sendQuoteWhatsApp({
          quoteId: quote.id,
          phone,
          contactName: leadName,
          leadId: quote.leadId || undefined,
          text: "",
          imageUrls: selectedImages,
          attemptId,
          blockIndex,
          blockType: key,
        });
        setStatus((s) => ({ ...s, [key]: "enviado" }));
        completedByAttempt.set(attemptId, (completedByAttempt.get(attemptId) ?? 0) + 1);
        onSent(res.conversationId);
        return true;
      }
      const text = texts[key].trim();
      if (!text) throw new Error("Texto vazio");
      const res = await sendQuoteWhatsApp({
        quoteId: quote.id,
        phone,
        contactName: leadName,
        leadId: quote.leadId || undefined,
        text,
        attemptId,
        blockIndex,
        blockType: key,
      });
      setStatus((s) => ({ ...s, [key]: "enviado" }));
      completedByAttempt.set(attemptId, (completedByAttempt.get(attemptId) ?? 0) + 1);
      onSent(res.conversationId);
      return true;
    } catch (e) {
      setStatus((s) => ({ ...s, [key]: "erro" }));
      if (e instanceof QuoteSendError) {
        console.error("QUOTE_SEND_ERROR", {
          attemptIdMasked: qsCode(attemptId),
          blockType: key,
          blockIndex,
          code: e.normalized.code,
          step: e.normalized.step,
          status: e.normalized.status,
        });
        showErrorToast(e.normalized, attemptId, { onRetry: () => void sendBlock(key) });
      } else {
        console.error("QUOTE_SEND_ERROR", {
          attemptIdMasked: qsCode(attemptId),
          blockType: key,
          blockIndex,
          message: e instanceof Error ? e.message : String(e),
        });
        toast.error(e instanceof Error ? e.message : "Falha ao enviar", {
          description: `Código de atendimento: ${qsCode(attemptId)}`,
        });
      }
      return false;
    }
  };

  const sendSelected = async () => {
    const attemptId = newQuoteSendAttemptId();
    const order: BlockKey[] = ["photos", "base", "inclusos", "brindes", "porConta", "notes"];
    const toSend = order.filter((k) => selected[k] && available[k] && status[k] !== "enviado");
    qsDebug("QUOTE_SEND_SELECTED_START", {
      attemptId,
      quoteIdMasked: quote.id.slice(0, 8),
      blocks: toSend.length,
      types: toSend,
    });
    if (toSend.length === 0) {
      toast.error("Selecione ao menos um bloco");
      return;
    }
    setBusyAll(true);
    let okCount = 0;
    let idx = 0;
    let failedKey: BlockKey | null = null;
    for (const k of toSend) {
      const ok = await sendBlock(k, { attemptId, blockIndex: idx });
      if (ok) okCount += 1;
      else {
        failedKey = k;
        break;
      }
      idx += 1;
    }
    setBusyAll(false);
    qsDebug("QUOTE_SEND_SELECTED_END", {
      attemptId,
      quoteIdMasked: quote.id.slice(0, 8),
      total: toSend.length,
      ok: okCount,
      failedAt: failedKey,
    });
    if (okCount > 0 && !failedKey) {
      toast.success(`${okCount} mensagem(ns) enviada(s)`);
      return;
    }
    if (okCount > 0 && failedKey) {
      // Envio parcial: NÃO oferecer retry do lote (duplicaria blocos entregues).
      const code = qsCode(attemptId);
      toast.warning("Parte do orçamento pode já ter sido enviada.", {
        description: `Foram enviados ${okCount} de ${toSend.length} blocos. Evite reenviar imediatamente para não duplicar mensagens. Código: ${code}`,
        duration: 20000,
        action: {
          label: "Copiar código",
          onClick: () => void navigator.clipboard.writeText(code).catch(() => undefined),
        },
      });
    }
  };

  const StatusPill = ({ s }: { s: BlockStatus }) => {
    if (s === "enviado")
      return (
        <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 px-2 py-0.5 text-[10px] font-semibold">
          <Check className="h-3 w-3" /> enviado
        </span>
      );
    if (s === "enviando")
      return (
        <span className="inline-flex items-center gap-1 rounded-full bg-primary/15 text-primary px-2 py-0.5 text-[10px] font-semibold">
          <Loader2 className="h-3 w-3 animate-spin" /> enviando
        </span>
      );
    if (s === "erro")
      return (
        <span className="inline-flex items-center gap-1 rounded-full bg-destructive/15 text-destructive px-2 py-0.5 text-[10px] font-semibold">
          erro
        </span>
      );
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-secondary text-muted-foreground px-2 py-0.5 text-[10px] font-semibold">
        pendente
      </span>
    );
  };

  const BlockRow = ({
    blockKey,
    title,
    children,
  }: {
    blockKey: BlockKey;
    title: string;
    children: React.ReactNode;
  }) => {
    const isAvail = available[blockKey];
    const st = status[blockKey];
    return (
      <div
        className={cn(
          "rounded-md border border-border bg-background/40 p-3 space-y-2",
          !isAvail && "opacity-50",
        )}
      >
        <div className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={selected[blockKey] && isAvail}
            disabled={!isAvail}
            onChange={(e) => setSelected((s) => ({ ...s, [blockKey]: e.target.checked }))}
            className="h-3.5 w-3.5 accent-primary"
          />
          <span className="text-xs font-semibold">{title}</span>
          {!isAvail && <span className="text-[10px] text-muted-foreground">(vazio)</span>}
          <div className="ml-auto flex items-center gap-2">
            <StatusPill s={st} />
            <button
              type="button"
              onClick={() => sendBlock(blockKey)}
              disabled={!isAvail || st === "enviando" || busyAll}
              className="inline-flex items-center gap-1 text-[11px] font-semibold rounded-md bg-[#25D366] text-white px-2 py-1 hover:opacity-90 disabled:opacity-50"
            >
              {st === "enviando" ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <Send className="h-3 w-3" />
              )}
              Enviar agora
            </button>
          </div>
        </div>
        {children}
      </div>
    );
  };

  const TextBlock = ({ blockKey }: { blockKey: Exclude<BlockKey, "photos"> }) => (
    <textarea
      value={texts[blockKey]}
      onChange={(e) => setTexts((t) => ({ ...t, [blockKey]: e.target.value }))}
      rows={Math.min(10, Math.max(3, texts[blockKey].split("\n").length))}
      placeholder="Texto vazio"
      className="w-full rounded-md bg-input px-3 py-2 text-xs leading-relaxed outline-none focus:ring-2 focus:ring-ring resize-y font-mono"
    />
  );

  return (
    <div
      className="fixed inset-0 z-50 bg-background/70 backdrop-blur-sm flex items-stretch md:items-center justify-center md:p-4 overflow-y-auto"
      onClick={onClose}
    >
      <div
        className="w-full md:max-w-2xl md:rounded-lg border-0 md:border md:border-border bg-card shadow-xl md:my-4 min-h-screen md:min-h-0 md:max-h-[calc(100vh-2rem)] overflow-y-auto safe-top safe-bottom"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sticky top-0 z-10 bg-card p-4 border-b border-border flex items-center gap-2">
          <Send className="h-4 w-4 text-primary" />
          <div>
            <h2 className="text-sm font-semibold">Enviar pelo WhatsApp</h2>
            <p className="text-[11px] text-muted-foreground">
              Para <span className="font-semibold text-foreground">{leadName}</span> • +{phone}
            </p>
          </div>
          <button onClick={onClose} className="ml-auto p-1 rounded hover:bg-accent">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="p-4 space-y-3">
          <div className="text-[11px] uppercase tracking-wide text-muted-foreground font-semibold">
            Enviar por partes
          </div>

          {/* Fotos */}
          <BlockRow blockKey="photos" title="1. Fotos do produto">
            {availableImages.length > 0 ? (
              <>
                <div className="flex items-center justify-between">
                  <span className="text-[10px] text-muted-foreground">
                    {selectedImages.length}/{availableImages.length} selecionadas
                  </span>
                  <button
                    type="button"
                    onClick={() =>
                      setSelectedImages(
                        selectedImages.length === availableImages.length ? [] : availableImages,
                      )
                    }
                    className="text-[11px] text-primary hover:underline"
                  >
                    {selectedImages.length === availableImages.length
                      ? "Desmarcar todas"
                      : "Selecionar todas"}
                  </button>
                </div>
                <div className="grid grid-cols-5 sm:grid-cols-6 gap-1.5">
                  {availableImages.map((url) => {
                    const checked = selectedImages.includes(url);
                    return (
                      <button
                        key={url}
                        type="button"
                        onClick={() => toggleImage(url)}
                        className={cn(
                          "relative aspect-square rounded-md overflow-hidden border-2 transition",
                          checked
                            ? "border-primary"
                            : "border-transparent opacity-60 hover:opacity-100",
                        )}
                      >
                        <SmartImage src={url} aspectRatio="1/1" wrapperClassName="w-full h-full" />
                        {checked && (
                          <div className="absolute top-1 right-1 bg-primary rounded-full p-0.5">
                            <Check className="h-2.5 w-2.5 text-primary-foreground" />
                          </div>
                        )}
                      </button>
                    );
                  })}
                </div>
              </>
            ) : (
              <p className="text-[11px] text-muted-foreground">Nenhuma foto cadastrada.</p>
            )}
          </BlockRow>

          <BlockRow blockKey="base" title="2. Mensagem principal do orçamento">
            <TextBlock blockKey="base" />
          </BlockRow>

          <BlockRow blockKey="inclusos" title="3. Itens inclusos">
            <TextBlock blockKey="inclusos" />
          </BlockRow>

          <BlockRow blockKey="brindes" title="4. Brindes">
            <TextBlock blockKey="brindes" />
          </BlockRow>

          <BlockRow blockKey="porConta" title="5. Por conta do cliente">
            <TextBlock blockKey="porConta" />
          </BlockRow>

          <BlockRow blockKey="notes" title="6. Observações">
            <TextBlock blockKey="notes" />
          </BlockRow>
        </div>

        <div className="sticky bottom-0 bg-card p-4 border-t border-border flex flex-col-reverse md:flex-row md:flex-wrap items-stretch md:items-center md:justify-end gap-2 safe-bottom">
          <button
            onClick={onClose}
            disabled={busyAll}
            className="text-sm md:text-xs rounded-md bg-secondary px-3 min-h-11 md:min-h-0 md:py-2 hover:bg-accent disabled:opacity-50"
          >
            Fechar
          </button>
          <button
            onClick={sendSelected}
            disabled={busyAll}
            className="inline-flex items-center justify-center gap-1.5 text-sm md:text-xs font-semibold rounded-md bg-[#25D366] text-white px-3 min-h-11 md:min-h-0 md:py-2 hover:opacity-90 disabled:opacity-50"
          >
            {busyAll ? (
              <Loader2 className="h-4 w-4 md:h-3.5 md:w-3.5 animate-spin" />
            ) : (
              <Send className="h-4 w-4 md:h-3.5 md:w-3.5" />
            )}
            {busyAll ? "Enviando…" : "Enviar em sequência"}
          </button>
        </div>
      </div>
    </div>
  );
}

export function Chip({ children }: { children: React.ReactNode }) {
  return <span className="rounded bg-secondary px-1.5 py-0.5">{children}</span>;
}
