import { quickReplyValidity, quickReplyValidityLabel } from "@/lib/quick-replies/validity";
import { cn } from "@/lib/utils";

/** Aviso para a equipe: resposta rápida vencida ou perto de vencer. Sem prazo, não mostra nada. */
export function QuickReplyValidityBadge({ validUntil }: { validUntil?: string | null }) {
  const validity = quickReplyValidity(validUntil);
  const label = quickReplyValidityLabel(validity);
  if (!label) return null;
  return (
    <span
      data-testid="quick-reply-validity"
      title={
        validity.state === "expired"
          ? "A IA não usa mais esta informação. Atualize o texto e a validade."
          : "Atualize o texto e a validade antes de vencer."
      }
      className={cn(
        "ml-2 inline-flex items-center rounded px-1.5 py-0.5 align-middle text-[10px] font-semibold",
        validity.state === "expired" ? "bg-destructive/15 text-destructive" : "bg-amber-500/15 text-amber-500",
      )}
    >
      {label}
    </span>
  );
}
