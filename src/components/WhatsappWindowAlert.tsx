import { Link } from "@tanstack/react-router";
import { AlertTriangle, Lock, Send, FileText } from "lucide-react";
import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import {
  computeWindow,
  formatDuration,
  type WindowInfo,
} from "@/lib/whatsapp-window";
import type { Conversation, Lead, Message } from "@/data/mock";

interface Props {
  conversation?: Pick<Conversation, "channel">;
  lead?: Pick<Lead, "channel">;
  messages?: Message[];
  /** Foca o composer para incentivar envio rápido. */
  onSendNow?: () => void;
  /** Abre a lista de templates aprovados (quando fechada). */
  onOpenTemplates?: () => void;
}

/**
 * Banner exibido na conversa com o estado da janela de 24h da WhatsApp Cloud API.
 * - Aberta: discreto, apenas informa quando fecha.
 * - Fecha em <3h: alerta amarelo com botão "Enviar mensagem agora".
 * - Fechada: bloco vermelho com instruções e atalho para templates.
 */
export function WhatsappWindowAlert({
  conversation,
  lead,
  messages,
  onSendNow,
  onOpenTemplates,
}: Props) {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const id = window.setInterval(() => setTick((v) => v + 1), 60_000);
    return () => window.clearInterval(id);
  }, []);
  const info: WindowInfo = computeWindow(conversation, lead, messages, Date.now() + tick * 0);

  if (info.state === "not_applicable") return null;
  if (info.state === "open") {
    return (
      <div className="mx-2 md:mx-3 mb-2 rounded-md border border-emerald-500/30 bg-emerald-500/5 px-3 py-1.5 text-[11px] text-emerald-600 dark:text-emerald-400 flex items-center gap-2">
        <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 shrink-0" />
        <span>
          Janela WhatsApp aberta · resta {formatDuration(info.remainingMs)}{" "}
          (aberta há {formatDuration(info.elapsedMs)})
        </span>
      </div>
    );
  }
  if (info.state === "closing_soon") {
    return (
      <div className="mx-2 md:mx-3 mb-2 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 flex items-start gap-2">
        <AlertTriangle className="h-4 w-4 text-amber-500 shrink-0 mt-0.5" />
        <div className="flex-1 text-[12px] text-amber-700 dark:text-amber-300">
          <strong className="font-semibold">
            Atenção: esta conversa fechará em {formatDuration(info.remainingMs)}.
          </strong>{" "}
          Após isso será necessário utilizar um template aprovado.
        </div>
        {onSendNow && (
          <button
            type="button"
            onClick={onSendNow}
            className={cn(
              "shrink-0 inline-flex items-center gap-1 rounded-md bg-amber-500 text-white",
              "h-7 px-2.5 text-[11px] font-semibold hover:bg-amber-600",
            )}
          >
            <Send className="h-3 w-3" />
            Enviar mensagem agora
          </button>
        )}
      </div>
    );
  }
  // closed | never_opened
  const closed = info.state === "closed";
  return (
    <div className="mx-2 md:mx-3 mb-2 rounded-md border border-[var(--status-urgent)]/40 bg-[var(--status-urgent)]/10 px-3 py-2 flex items-start gap-2 flex-wrap">
      <Lock className="h-4 w-4 text-[var(--status-urgent)] shrink-0 mt-0.5" />
      <div className="flex-1 min-w-0 text-[12px] text-[var(--status-urgent)]">
        <strong className="font-semibold">
          {closed ? "Cliente fora da janela de 24 horas." : "Aguardando primeira mensagem do cliente."}
        </strong>{" "}
        {closed
          ? `Fechada há ${formatDuration(-info.remainingMs)}. Envie um template aprovado para reabrir a conversa.`
          : "Envie um template aprovado para iniciar a conversa."}
      </div>
      <div className="flex items-center gap-1.5 shrink-0">
        {onOpenTemplates && (
          <button
            type="button"
            onClick={onOpenTemplates}
            className="inline-flex items-center gap-1 rounded-md bg-[var(--status-urgent)] text-white h-7 px-2.5 text-[11px] font-semibold hover:opacity-90"
          >
            <Send className="h-3 w-3" />
            Enviar template aprovado
          </button>
        )}
        <Link
          to="/configuracoes"
          className="inline-flex items-center gap-1 rounded-md border border-[var(--status-urgent)]/40 text-[var(--status-urgent)] h-7 px-2.5 text-[11px] font-semibold hover:bg-[var(--status-urgent)]/10"
        >
          <FileText className="h-3 w-3" />
          Abrir modelos
        </Link>
      </div>
    </div>
  );
}
