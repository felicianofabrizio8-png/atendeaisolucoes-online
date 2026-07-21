// ============================================================================
// Coach Interpreter — Admin console (barrel).
//
// A implementação real foi dividida em módulos focados sob
// `src/lib/coach-interpreter/admin/`. Este arquivo permanece como barrel
// para (a) manter a rota `configuracoes_.coach-interpreter.tsx` importando
// um único símbolo (AdminPageBody) e (b) preservar compatibilidade com os
// testes já existentes que importam diretamente daqui.
//
// Não adicione lógica neste arquivo. Novos componentes vão em admin/*.tsx;
// novos helpers/constants vão em admin/helpers.ts | admin/constants.ts.
// ============================================================================

export { AdminPageBody } from "./admin/interpreter-admin-page";
export { InterpreterShell } from "./admin/interpreter-shell";
export {
  ConversationsPanel,
  NewConversationButton,
} from "./admin/conversations-panel";
export { ConversationView } from "./admin/conversation-view";
export { ChatTimeline, KIND_META } from "./admin/chat-timeline";
export { MessageComposer } from "./admin/message-composer";
export { ProposalFilterBar } from "./admin/proposal-filters";
export { ProposalCard } from "./admin/proposal-card";
export { ProposalStatusBadge, ConversationStatusBadge } from "./admin/status-badges";
export { ErrorBanner } from "./admin/error-banner";
export { FeatureDisabledScreen } from "./admin/feature-disabled-screen";
export {
  PAGE_SIZE,
  DEFAULT_FILTERS,
  PROPOSAL_STATUS_LABEL,
  PROPOSAL_STATUS_STYLE,
} from "./admin/constants";
export { extractDisabledMessage, formatDateTime } from "./admin/helpers";
export type {
  ConversationRow,
  MessageRow,
  ProposalRow,
  ProposalFilters,
} from "./admin/types";
