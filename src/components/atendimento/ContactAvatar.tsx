import { cn } from "@/lib/utils";

/**
 * Avatar por iniciais. A empresa não tem foto de perfil dos leads do WhatsApp,
 * então em vez de um cinza morto geramos um disco com a matiz estável do
 * contato — a lista fica escaneável de relance, que é o que o atendente faz.
 */
export function ContactAvatar({
  name,
  hue,
  size = 44,
  online,
  className,
}: {
  name: string;
  hue: number;
  size?: number;
  online?: boolean;
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
    <span className={cn("relative inline-flex shrink-0", className)}>
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
      {online && (
        <span
          className="absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-2 border-background"
          style={{ background: "var(--status-won)" }}
          title="Janela de 24h aberta"
        />
      )}
    </span>
  );
}
