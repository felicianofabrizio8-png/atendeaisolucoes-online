import { cn } from "@/lib/utils";
import { classifyCustomer, type CustomerHistory } from "@/lib/customer-loyalty";

export function CustomerTierBadge({ history, size = "md", className }: { history: CustomerHistory; size?: "sm" | "md"; className?: string }) {
  const tier = classifyCustomer(history);
  return <span className={cn("inline-flex items-center gap-1 rounded-full bg-secondary px-2 py-0.5 font-semibold", size === "sm" ? "text-[10px]" : "text-xs", className)} style={{ color: tier.color }} title={tier.reason}>
    <span aria-hidden>{tier.emoji}</span>{tier.label}
  </span>;
}
