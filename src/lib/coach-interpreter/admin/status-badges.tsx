// Badges de status para conversas e proposals.
import { cn } from "@/lib/utils";
import { PROPOSAL_STATUS_LABEL, PROPOSAL_STATUS_STYLE } from "./constants";

export function ProposalStatusBadge({ status }: { status: string }) {
  const style = PROPOSAL_STATUS_STYLE[status] ?? "bg-muted text-muted-foreground border-border";
  return (
    <span
      className={cn("text-[10px] px-1.5 py-0.5 rounded border font-medium", style)}
      data-testid={`proposal-status-${status}`}
    >
      {PROPOSAL_STATUS_LABEL[status] ?? status}
    </span>
  );
}

export function ConversationStatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    open: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400",
    closed: "bg-muted text-muted-foreground",
    archived: "bg-muted text-muted-foreground",
  };
  return (
    <span
      className={cn(
        "text-[10px] px-1.5 py-0.5 rounded font-medium",
        map[status] ?? "bg-muted text-muted-foreground",
      )}
    >
      {status}
    </span>
  );
}
