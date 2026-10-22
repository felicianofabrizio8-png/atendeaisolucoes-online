import { Clock, Lock, Send } from "lucide-react";
import { useEffect, useState, type CSSProperties, type ReactNode } from "react";
import { computeWindow, formatDuration, WINDOW_MS, type WindowInfo } from "@/lib/whatsapp-window";
import type { Conversation, Lead, Message } from "@/data/mock";
import "./whatsapp-window.css";

interface Props {
  conversation?: Pick<Conversation, "channel">;
  lead?: Pick<Lead, "channel">;
  messages?: Message[];
  /** Foca o composer para incentivar envio rápido. */
  onSendNow?: () => void;
  /** Abre a lista de templates aprovados (quando fechada). */
  onOpenTemplates?: () => void;
}

const clock = (iso: string | null) =>
  iso ? new Date(iso).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }) : "";

/**
 * Estado da janela de 24h da WhatsApp Cloud API em uma linha só, logo acima
 * do composer — a conversa é a prioridade, o aviso não pode tomar a tela.
 * - Aberta: quanto resta, com a régua do tempo.
 * - Fecha em <3h: o mesmo, em âmbar, com "Responder".
 * - Fechada / nunca aberta: cadeado e "Usar template" (a lista de templates
 *   aprovados; antes eram dois botões que abriam a mesma lista).
 */
export function WhatsappWindowAlert({
  conversation,
  lead,
  messages,
  onSendNow,
  onOpenTemplates,
}: Props) {
  // Re-render por minuto: a régua e o "resta" andam sozinhos.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(id);
  }, []);
  const info: WindowInfo = computeWindow(conversation, lead, messages, now);

  if (info.state === "not_applicable") return null;

  const left = Math.max(0, Math.min(1, info.remainingMs / WINDOW_MS));

  if (info.state === "open") {
    return (
      <Line tone="open" left={left} icon={<span className="ww-dot" />}>
        <b>Janela aberta</b>
        <span>
          resta {formatDuration(info.remainingMs)} · fecha às {clock(info.closesAt)}
        </span>
      </Line>
    );
  }

  if (info.state === "closing_soon") {
    return (
      <Line
        tone="soon"
        left={left}
        icon={<Clock />}
        action={
          onSendNow && (
            <button
              type="button"
              onClick={onSendNow}
              className="ww-btn"
              title="Depois que a janela fechar, só com template aprovado da Meta."
            >
              <Send aria-hidden="true" />
              Responder
            </button>
          )
        }
      >
        <b>Janela fecha em {formatDuration(info.remainingMs)}</b>
        <span>às {clock(info.closesAt)}</span>
      </Line>
    );
  }

  const closed = info.state === "closed";
  return (
    <Line
      tone="closed"
      left={0}
      icon={<Lock />}
      action={
        onOpenTemplates && (
          <button
            type="button"
            onClick={onOpenTemplates}
            className="ww-btn"
            title="Templates Meta — mensagens oficiais aprovadas pela Meta, que reabrem a conversa fora da janela de 24h."
          >
            <Send aria-hidden="true" />
            Usar template
          </button>
        )
      }
    >
      <b>{closed ? "Fora da janela de 24h" : "Aguardando o 1º contato"}</b>
      <span>
        {closed
          ? `fechou há ${formatDuration(-info.remainingMs)}`
          : "só template inicia a conversa"}
      </span>
    </Line>
  );
}

function Line({
  tone,
  left,
  icon,
  action,
  children,
}: {
  tone: "open" | "soon" | "closed";
  left: number;
  icon: ReactNode;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="ww" data-tone={tone} style={{ "--ww-left": left } as CSSProperties}>
      <span className="ww-icon" aria-hidden="true">
        {icon}
      </span>
      <p className="ww-line">{children}</p>
      {tone !== "closed" && (
        <span className="ww-track" aria-hidden="true">
          <i />
        </span>
      )}
      {action}
    </div>
  );
}
