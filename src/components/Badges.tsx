import type { Channel, LeadStatus } from "@/data/mock";
import { cn } from "@/lib/utils";

const channelLabel: Record<Channel, string> = {
  whatsapp: "WhatsApp",
  instagram: "Instagram",
  facebook: "Facebook",
};

export function ChannelBadge({ channel, className }: { channel: Channel; className?: string }) {
  const color = {
    whatsapp: "bg-[var(--channel-whatsapp)]",
    instagram: "bg-[var(--channel-instagram)]",
    facebook: "bg-[var(--channel-facebook)]",
  }[channel];

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-md px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-foreground/90",
        "bg-secondary",
        className,
      )}
    >
      <span className={cn("h-1.5 w-1.5 rounded-full", color)} />
      {channelLabel[channel]}
    </span>
  );
}

const statusMap: Record<LeadStatus, { label: string; bg: string; fg: string }> = {
  novo: { label: "Novo", bg: "bg-[var(--status-cold)]", fg: "text-[var(--status-cold-foreground)]" },
  aguardando: { label: "Aguardando", bg: "bg-[var(--status-warm)]", fg: "text-[var(--status-warm-foreground)]" },
  quente: { label: "Quente", bg: "bg-[var(--status-hot)]", fg: "text-[var(--status-hot-foreground)]" },
  morno: { label: "Morno", bg: "bg-[var(--status-warm)]", fg: "text-[var(--status-warm-foreground)]" },
  frio: { label: "Frio", bg: "bg-[var(--status-cold)]", fg: "text-[var(--status-cold-foreground)]" },
  fechado: { label: "Fechado", bg: "bg-[var(--status-won)]", fg: "text-[var(--status-won-foreground)]" },
  perdido: { label: "Perdido", bg: "bg-[var(--status-lost)]", fg: "text-[var(--status-lost-foreground)]" },
};

export function StatusBadge({ status, className }: { status: LeadStatus; className?: string }) {
  const s = statusMap[status];
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-md px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
        s.bg,
        s.fg,
        className,
      )}
    >
      {s.label}
    </span>
  );
}

export function UrgentDot({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        "h-2 w-2 rounded-full bg-[var(--status-urgent)] animate-urgent",
        className,
      )}
      aria-label="Urgente"
    />
  );
}
