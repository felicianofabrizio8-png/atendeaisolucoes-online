import { cn } from "@/lib/utils";
import type { Channel } from "@/data/mock";

const CHANNEL_LABEL: Record<Channel, string> = {
  whatsapp: "WhatsApp",
  instagram: "Instagram",
  facebook: "Facebook",
};

/**
 * Avatar por iniciais. A empresa não tem foto de perfil dos leads do WhatsApp,
 * então em vez de um cinza morto geramos um disco com a matiz estável do
 * contato — a lista fica escaneável de relance, que é o que o atendente faz.
 * O selo do canal fica no canto (quem atende vários canais vê de onde veio);
 * com a janela de 24h aberta o selo acende.
 */
export function ContactAvatar({
  name,
  hue,
  size = 44,
  online,
  channel,
  className,
}: {
  name: string;
  hue: number;
  size?: number;
  online?: boolean;
  channel?: Channel;
  className?: string;
}) {
  const initials = name
    .replace(/[^\p{L}\s]/gu, "")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase())
    .join("");

  return (
    <span className={cn("at-avatar relative inline-flex shrink-0", className)}>
      <span
        className="inline-flex items-center justify-center rounded-full font-semibold text-white"
        style={{
          width: size,
          height: size,
          fontSize: size * 0.36,
          background: `linear-gradient(140deg, oklch(0.55 0.16 ${hue}) 0%, oklch(0.38 0.10 ${(hue + 40) % 360}) 100%)`,
        }}
        aria-hidden
      >
        {initials || "?"}
      </span>
      {channel ? (
        <span
          className="at-avatar-channel"
          data-channel={channel}
          data-online={online || undefined}
          title={`${CHANNEL_LABEL[channel]}${online ? " · janela de 24h aberta" : ""}`}
        >
          <ChannelGlyph channel={channel} />
        </span>
      ) : (
        online && (
          <span
            className="absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-2 border-background"
            style={{ background: "var(--status-won)" }}
            title="Janela de 24h aberta"
          />
        )
      )}
    </span>
  );
}

/** Marcas simplificadas, só para reconhecer o canal num selo de 16px. */
function ChannelGlyph({ channel }: { channel: Channel }) {
  if (channel === "instagram") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <rect
          x="4"
          y="4"
          width="16"
          height="16"
          rx="5"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.2"
        />
        <circle cx="12" cy="12" r="3.6" fill="none" stroke="currentColor" strokeWidth="2.2" />
        <circle cx="17" cy="7" r="1.3" fill="currentColor" />
      </svg>
    );
  }
  if (channel === "facebook") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path
          d="M13.5 21v-7.2h2.4l.4-2.8h-2.8V9.3c0-.8.2-1.4 1.4-1.4h1.5V5.4c-.3 0-1.1-.1-2.1-.1-2.1 0-3.6 1.3-3.6 3.7V11H8.3v2.8h2.4V21h2.8z"
          fill="currentColor"
        />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path
        d="M12 3.5a8.5 8.5 0 0 0-7.3 12.8L3.5 20.5l4.3-1.1A8.5 8.5 0 1 0 12 3.5z"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinejoin="round"
      />
      <path
        d="M9.2 8.6c.2-.4.4-.4.6-.4h.5c.2 0 .4 0 .5.4l.7 1.7c.1.2 0 .4-.1.6l-.4.5c-.1.1-.2.3 0 .5.5.8 1.2 1.5 2 2 .2.1.4.1.5 0l.6-.6c.1-.2.3-.2.5-.1l1.6.8c.2.1.3.2.3.4 0 .6-.3 1.3-.9 1.6-.6.3-1.4.4-3.1-.4-1.6-.8-2.9-2.3-3.5-3.5-.6-1.2-.4-2.3.2-3.5z"
        fill="currentColor"
      />
    </svg>
  );
}
