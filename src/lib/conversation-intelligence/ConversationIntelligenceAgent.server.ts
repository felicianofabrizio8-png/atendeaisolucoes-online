// Ponto de entrada de alto nível — abstrai o Service para os endpoints.
// Nesta fase permanece thin; futuras fases adicionarão IntelligenceReader.
export { dryRun, backfill } from "./ConversationIntelligenceService.server";
export { listFactsForInspection } from "./ConversationFactsRepository.server";
export { ANALYZER_VERSION } from "./ConversationIntelligenceTypes";
