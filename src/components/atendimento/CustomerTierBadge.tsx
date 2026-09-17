import { cn } from "@/lib/utils";
import { classifyCustomer, type CustomerHistory } from "@/lib/customer-loyalty";

/**
 * Selo "Novo" / "Fiel" ao lado do nome. O `title` carrega o porquê — o
 * atendente precisa confiar no rótulo antes de usá-lo numa negociação, então
 * o motivo nunca fica escondido.
 */
export function CustomerTierBadge({
  history,
  size = "md",
  className,
}: {
  history: CustomerHistory;
  size?: "sm" | "md";
  className?: string;
}) {
  const info = classifyCustomer(history);

  return (
    <span
      title={info.reason}
      className={cn(
        "inline-flex items-center gap-1 rounded-full font-bold whitespace-nowrap",
        size === "sm" ? "text-[10px] px-1.5 py-0.5" : "text-[13px] px-2 py-0.5",
        className,
      )}
      style={{ color: info.color, background: `color-mix(in oklab, ${info.color} 14%, transparent)` }}
    >
      <span aria-hidden>{info.emoji}</span>
      {info.label}
    </span>
  );
}
