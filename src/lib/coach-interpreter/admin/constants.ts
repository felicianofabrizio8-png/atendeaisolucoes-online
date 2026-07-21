// Constantes reutilizadas pelo console admin do Coach Interpreter.
// Módulo puro (sem componentes) — permite tree-shake e evita warnings de
// react-refresh/only-export-components.
import type { ProposalFilters } from "./types";

export const PAGE_SIZE = 15;

export const DEFAULT_FILTERS: ProposalFilters = {
  category: "",
  ruleType: "",
  status: "",
  minConfidence: 0,
  ownerUser: "",
  dateFrom: "",
  dateTo: "",
};

export const PROPOSAL_STATUS_LABEL: Record<string, string> = {
  pending: "Pending",
  edited: "Edited",
  discarded: "Discarded",
  confirmed: "Confirmed",
  failed: "Failed",
  clarification: "Clarification",
  classified: "Classified",
  duplicate: "Duplicate",
};

export const PROPOSAL_STATUS_STYLE: Record<string, string> = {
  pending: "bg-muted text-foreground border-border",
  edited: "bg-blue-500/15 text-blue-600 dark:text-blue-400 border-blue-500/30",
  discarded: "bg-muted text-muted-foreground border-border line-through",
  confirmed: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-emerald-500/30",
  failed: "bg-destructive/15 text-destructive border-destructive/30",
  clarification: "bg-blue-500/15 text-blue-600 dark:text-blue-400 border-blue-500/30",
  classified: "bg-purple-500/15 text-purple-600 dark:text-purple-400 border-purple-500/30",
  duplicate: "bg-amber-500/15 text-amber-600 dark:text-amber-400 border-amber-500/30",
};
