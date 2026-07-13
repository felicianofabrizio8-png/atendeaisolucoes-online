// Orquestrador batch: dry-run + backfill controlado. Shadow mode.
// - Falha em uma conversa não interrompe o lote.
// - Concorrência baixa (sequencial neste estágio para máxima previsibilidade).
// - Nunca modifica dados operacionais.
import { selectConversations } from "./ConversationSelector.server";
import { buildFacts } from "./ConversationFactsBuilder.server";
import { upsertFactIfNew } from "./ConversationFactsRepository.server";
import { markState } from "./ConversationAnalyzerStateRepository.server";
import type { BackfillReport, DryRunReport } from "./ConversationIntelligenceTypes";

interface RunOpts {
  companyId: string;
  limit: number;
  channels?: string[];
  onlyTerminated?: boolean;
  olderThanDays?: number;
}

export async function dryRun(opts: RunOpts): Promise<DryRunReport> {
  const convs = await selectConversations({ ...opts, limit: Math.min(opts.limit, 100) });
  const report: DryRunReport = {
    scanned: convs.length,
    would_process: 0,
    would_skip: 0,
    by_lifecycle: {},
    by_channel: {},
    low_confidence: 0,
    pii_residual_suspected: 0,
    errors: 0,
  };

  for (const raw of convs) {
    try {
      if (raw.messages.length === 0) {
        report.would_skip += 1;
        continue;
      }
      const { row, pii_suspected } = buildFacts(raw);
      report.would_process += 1;
      report.by_lifecycle[row.lifecycle_status] =
        (report.by_lifecycle[row.lifecycle_status] ?? 0) + 1;
      const ch = row.channel ?? "unknown";
      report.by_channel[ch] = (report.by_channel[ch] ?? 0) + 1;
      if (row.confidence < 0.5) report.low_confidence += 1;
      if (pii_suspected) report.pii_residual_suspected += 1;
    } catch {
      report.errors += 1;
    }
  }
  return report;
}

export async function backfill(opts: RunOpts): Promise<BackfillReport> {
  const cap = Math.min(opts.limit, 50);
  const convs = await selectConversations({ ...opts, limit: cap });
  const report: BackfillReport = {
    scanned: convs.length,
    processed: 0,
    duplicates_skipped: 0,
    low_confidence: 0,
    errors: 0,
    by_lifecycle: {},
    by_channel: {},
    by_intent: {},
    by_objection: {},
    by_buying_signal: {},
    avg_processing_ms: 0,
    samples: [],
  };
  let totalMs = 0;

  for (const raw of convs) {
    const t0 = Date.now();
    try {
      if (raw.messages.length === 0) {
        await markState({
          companyId: raw.company_id,
          conversationId: raw.conversation_id,
          contentHash: "empty",
          lastMessageAt: null,
          status: "skipped",
          errorCode: "no_messages",
        });
        continue;
      }
      const { row, content_hash } = buildFacts(raw);
      const res = await upsertFactIfNew(row);
      if (res.error) {
        report.errors += 1;
        await markState({
          companyId: raw.company_id,
          conversationId: raw.conversation_id,
          contentHash: content_hash,
          lastMessageAt: row.last_message_at,
          status: "failed",
          errorCode: res.error,
        });
        continue;
      }
      if (!res.inserted) {
        // Idempotência não é erro: preserva estado semântico "completed"
        // e mantém last_error_code=null. O "duplicate" fica apenas no
        // relatório da execução (duplicates_skipped), não no watermark.
        report.duplicates_skipped += 1;
        await markState({
          companyId: raw.company_id,
          conversationId: raw.conversation_id,
          contentHash: content_hash,
          lastMessageAt: row.last_message_at,
          status: "completed",
          errorCode: null,
        });
        continue;
      }
      report.processed += 1;
      if (row.confidence < 0.5) report.low_confidence += 1;
      report.by_lifecycle[row.lifecycle_status] =
        (report.by_lifecycle[row.lifecycle_status] ?? 0) + 1;
      const ch = row.channel ?? "unknown";
      report.by_channel[ch] = (report.by_channel[ch] ?? 0) + 1;
      for (const i of row.intents_json)
        report.by_intent[i] = (report.by_intent[i] ?? 0) + 1;
      for (const o of row.objections_json)
        report.by_objection[o] = (report.by_objection[o] ?? 0) + 1;
      for (const b of row.buying_signals_json)
        report.by_buying_signal[b] = (report.by_buying_signal[b] ?? 0) + 1;
      if (report.samples.length < 5) report.samples.push(row);

      await markState({
        companyId: raw.company_id,
        conversationId: raw.conversation_id,
        contentHash: content_hash,
        lastMessageAt: row.last_message_at,
        status: "completed",
      });
    } catch {
      report.errors += 1;
    } finally {
      totalMs += Date.now() - t0;
    }
  }

  report.avg_processing_ms =
    report.scanned > 0 ? Math.round(totalMs / report.scanned) : 0;
  return report;
}
