// Orquestrador puro do envio em lote de blocos de orçamento.
//
// Objetivo: encapsular a lógica de "para no primeiro erro, mantém memória do
// que já foi enviado, decide se retry é seguro" — sem tocar em React, DOM
// ou Supabase. Testável em isolamento.

import { newQuoteSendAttemptId, type NormalizedQuoteSendError } from "./errors";

export interface BlockSendSuccess {
  ok: true;
  externalMessageId?: string;
}
export interface BlockSendFailure {
  ok: false;
  normalized: NormalizedQuoteSendError;
}
export type BlockSendResult = BlockSendSuccess | BlockSendFailure;

export interface OrchestratorBlock<K extends string = string> {
  key: K;
  /** Descrição legível — usada só para logs/relatório. */
  label?: string;
}

export interface OrchestratorInput<K extends string> {
  blocks: ReadonlyArray<OrchestratorBlock<K>>;
  attemptId?: string;
  /** Executa um bloco individual. Recebe attemptId compartilhado da tentativa. */
  sendOne: (block: OrchestratorBlock<K>, ctx: { attemptId: string; blockIndex: number }) => Promise<BlockSendResult>;
  /** Callback opcional entre blocos, útil para instrumentação/testes. */
  onProgress?: (evt: { attemptId: string; blockIndex: number; result: BlockSendResult }) => void;
}

export interface OrchestratorOutcome<K extends string> {
  attemptId: string;
  total: number;
  completed: number;
  completedKeys: K[];
  failedAt: { blockIndex: number; key: K; normalized: NormalizedQuoteSendError } | null;
  /**
   * Retry é seguro quando NENHUM bloco chegou a ser confirmado.
   * Se ao menos um bloco foi entregue, o retry do lote inteiro poderia
   * duplicar mensagens ao cliente — nesse caso, `false`.
   */
  canRetryWithoutDuplication: boolean;
}

/**
 * Envia blocos em ordem. Para no primeiro erro. Preserva evidência dos
 * blocos concluídos. Não faz retry automático; a decisão fica com o caller.
 */
export async function runQuoteSendBatch<K extends string>(
  input: OrchestratorInput<K>,
): Promise<OrchestratorOutcome<K>> {
  const attemptId = input.attemptId ?? newQuoteSendAttemptId();
  const total = input.blocks.length;
  const completedKeys: K[] = [];
  let failedAt: OrchestratorOutcome<K>["failedAt"] = null;

  for (let i = 0; i < total; i += 1) {
    const block = input.blocks[i];
    const result = await input.sendOne(block, { attemptId, blockIndex: i });
    input.onProgress?.({ attemptId, blockIndex: i, result });
    if (result.ok) {
      completedKeys.push(block.key);
      continue;
    }
    failedAt = { blockIndex: i, key: block.key, normalized: result.normalized };
    break;
  }

  return {
    attemptId,
    total,
    completed: completedKeys.length,
    completedKeys,
    failedAt,
    canRetryWithoutDuplication: completedKeys.length === 0 && !!failedAt,
  };
}
