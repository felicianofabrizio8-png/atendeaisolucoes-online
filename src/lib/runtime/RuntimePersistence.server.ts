// ============================================================================
// RuntimePersistence — Sink de persistência (fail-soft) do Learning Loop
// e do Knowledge Bus. Zero PII. Somente metadados.
// Escreve em runtime_learning_cycles / runtime_knowledge_envelopes.
// Reidrata contadores para observabilidade e widget.
// ============================================================================

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import type { KnowledgeEnvelope } from "./context/KnowledgeContextTypes";
import type { LearningRecord } from "./LearningSnapshot.server";

export interface LearningAggregate {
  cycles: number;
  accepted: number;
  rejected: number;
  consolidated: number;
  averageConfidence: number;
  lastLearningAt: string | null;
  lastAgentId: string | null;
  perAgent: Record<
    string,
    { cycles: number; consolidated: number; lastAt: string | null; averageConfidence: number }
  >;
}

export interface BusAggregate {
  publishCount: number;
  totalEnvelopes: number;
  lastActivityAt: string | null;
  perTopic: Array<{ topic: string; count: number }>;
}

export interface LearningTimelineRow {
  id: string;
  agentId: string;
  decision: string;
  confidence: number;
  createdAt: string;
  executionId: string;
  jobId: string | null;
  reason: string | null;
}

export interface EnvelopeTimelineRow {
  id: string;
  envelopeId: string;
  topic: string;
  agentId: string;
  priority: string | null;
  confidence: number | null;
  version: number | null;
  createdAt: string;
  expiresAt: string | null;
}

type Writer = SupabaseClient<Database>;

export class RuntimePersistence {
  private static _instance: RuntimePersistence | null = null;
  private writer: Writer | null = null;
  private writes = { learning: 0, envelopes: 0, errors: 0 };
  private lastError: string | null = null;

  static instance(): RuntimePersistence {
    if (!RuntimePersistence._instance) {
      RuntimePersistence._instance = new RuntimePersistence();
    }
    return RuntimePersistence._instance;
  }

  bindWriter(writer: Writer): void {
    this.writer = writer;
  }

  hasWriter(): boolean {
    return this.writer !== null;
  }

  stats() {
    return { ...this.writes, lastError: this.lastError };
  }

  /** Persiste um ciclo do Learning Loop. Fail-soft: nunca lança. */
  async recordLearningCycle(record: LearningRecord, durationMs: number | null): Promise<void> {
    if (!this.writer) return;
    try {
      const h = record.hypothesis;
      const row = {
        company_id: h.tenantId,
        agent_id: h.sourceAgent,
        execution_id: h.executionId,
        job_id: h.jobId,
        hypothesis_id: h.hypothesisId,
        decision: record.decision,
        reason: record.note.slice(0, 200),
        confidence: Number(h.confidence.toFixed(3)),
        signature: h.signature.slice(0, 512),
        duration_ms: durationMs ?? null,
        topics_used: (h.topicsUsed ?? []).slice(0, 24),
        published_topics: (h.publishedTopics ?? []).slice(0, 24),
      };
      const { error } = await (
        this.writer.from("runtime_learning_cycles") as unknown as {
          insert: (r: unknown) => Promise<{ error: { message: string } | null }>;
        }
      ).insert(row);
      if (error) throw new Error(error.message);
      this.writes.learning += 1;
    } catch (e) {
      this.writes.errors += 1;
      this.lastError = e instanceof Error ? e.message.slice(0, 200) : "learning_persist_error";
    }
  }

  /** Persiste metadata de envelope. Fail-soft. */
  async recordEnvelope(env: KnowledgeEnvelope): Promise<void> {
    if (!this.writer) return;
    try {
      const meta = env.metadata ?? {};
      // Extra proteção: descarta chaves que aparentem payload de mensagem.
      const safeMeta: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(meta)) safeMeta[k] = v;
      const row = {
        envelope_id: env.id,
        company_id: env.tenantId,
        topic: env.topic,
        agent_id: env.agentId,
        priority: env.priority,
        confidence: Number((env.confidence ?? 0).toFixed(3)),
        version: env.version,
        ttl_ms: env.expiresAt
          ? Math.max(
              0,
              new Date(env.expiresAt).getTime() - new Date(env.createdAt).getTime(),
            )
          : null,
        metadata: safeMeta,
        created_at: env.createdAt,
        expires_at: env.expiresAt,
      };
      const { error } = await (
        this.writer.from("runtime_knowledge_envelopes") as unknown as {
          upsert: (
            r: unknown,
            opts: { onConflict: string },
          ) => Promise<{ error: { message: string } | null }>;
        }
      ).upsert(row, { onConflict: "company_id,envelope_id" });
      if (error) throw new Error(error.message);
      this.writes.envelopes += 1;
    } catch (e) {
      this.writes.errors += 1;
      this.lastError = e instanceof Error ? e.message.slice(0, 200) : "envelope_persist_error";
    }
  }

  async learningAggregate(tenantId: string): Promise<LearningAggregate> {
    const empty: LearningAggregate = {
      cycles: 0,
      accepted: 0,
      rejected: 0,
      consolidated: 0,
      averageConfidence: 0,
      lastLearningAt: null,
      lastAgentId: null,
      perAgent: {},
    };
    if (!this.writer) return empty;
    try {
      const { data, error } = await (
        this.writer.from("runtime_learning_cycles") as unknown as {
          select: (c: string) => {
            eq: (
              col: string,
              v: string,
            ) => {
              order: (
                col: string,
                opts: { ascending: boolean },
              ) => {
                limit: (n: number) => Promise<{
                  data:
                    | Array<{
                        agent_id: string;
                        decision: string;
                        confidence: number;
                        created_at: string;
                      }>
                    | null;
                  error: { message: string } | null;
                }>;
              };
            };
          };
        }
      )
        .select("agent_id, decision, confidence, created_at")
        .eq("company_id", tenantId)
        .order("created_at", { ascending: false })
        .limit(2000);
      if (error) throw new Error(error.message);
      const rows = data ?? [];
      const agg = { ...empty, perAgent: {} as LearningAggregate["perAgent"] };
      let confSum = 0;
      let confCount = 0;
      for (const r of rows) {
        agg.cycles += 1;
        if (r.decision === "accepted") agg.accepted += 1;
        if (r.decision === "rejected") agg.rejected += 1;
        if (r.decision === "consolidated") agg.consolidated += 1;
        const c = Number(r.confidence);
        if (!Number.isNaN(c)) {
          confSum += c;
          confCount += 1;
        }
        const pa = agg.perAgent[r.agent_id] ?? {
          cycles: 0,
          consolidated: 0,
          lastAt: null,
          averageConfidence: 0,
        };
        pa.cycles += 1;
        if (r.decision === "consolidated") pa.consolidated += 1;
        if (!pa.lastAt || r.created_at > pa.lastAt) pa.lastAt = r.created_at;
        pa.averageConfidence =
          (pa.averageConfidence * (pa.cycles - 1) + (Number.isNaN(c) ? 0 : c)) / pa.cycles;
        agg.perAgent[r.agent_id] = pa;
      }
      if (rows[0]) {
        agg.lastLearningAt = rows[0].created_at;
        agg.lastAgentId = rows[0].agent_id;
      }
      agg.averageConfidence =
        confCount > 0 ? Number((confSum / confCount).toFixed(3)) : 0;
      return agg;
    } catch (e) {
      this.lastError = e instanceof Error ? e.message.slice(0, 200) : "learning_agg_error";
      return empty;
    }
  }

  async busAggregate(tenantId: string): Promise<BusAggregate> {
    const empty: BusAggregate = {
      publishCount: 0,
      totalEnvelopes: 0,
      lastActivityAt: null,
      perTopic: [],
    };
    if (!this.writer) return empty;
    try {
      const { data, error } = await (
        this.writer.from("runtime_knowledge_envelopes") as unknown as {
          select: (c: string) => {
            eq: (
              col: string,
              v: string,
            ) => {
              order: (
                col: string,
                opts: { ascending: boolean },
              ) => {
                limit: (n: number) => Promise<{
                  data:
                    | Array<{
                        envelope_id: string;
                        topic: string;
                        created_at: string;
                      }>
                    | null;
                  error: { message: string } | null;
                }>;
              };
            };
          };
        }
      )
        .select("envelope_id, topic, created_at")
        .eq("company_id", tenantId)
        .order("created_at", { ascending: false })
        .limit(2000);
      if (error) throw new Error(error.message);
      const rows = data ?? [];
      const perTopic = new Map<string, number>();
      const uniq = new Set<string>();
      for (const r of rows) {
        perTopic.set(r.topic, (perTopic.get(r.topic) ?? 0) + 1);
        uniq.add(r.envelope_id);
      }
      return {
        publishCount: rows.length,
        totalEnvelopes: uniq.size,
        lastActivityAt: rows[0]?.created_at ?? null,
        perTopic: Array.from(perTopic, ([topic, count]) => ({ topic, count })).sort(
          (a, b) => b.count - a.count,
        ),
      };
    } catch (e) {
      this.lastError = e instanceof Error ? e.message.slice(0, 200) : "bus_agg_error";
      return empty;
    }
  }

  async recentLearning(tenantId: string, limit = 20): Promise<LearningTimelineRow[]> {
    if (!this.writer) return [];
    try {
      const { data } = await (
        this.writer.from("runtime_learning_cycles") as unknown as {
          select: (c: string) => {
            eq: (
              col: string,
              v: string,
            ) => {
              order: (
                col: string,
                opts: { ascending: boolean },
              ) => {
                limit: (n: number) => Promise<{
                  data:
                    | Array<{
                        id: string;
                        agent_id: string;
                        decision: string;
                        confidence: number;
                        created_at: string;
                        execution_id: string;
                        job_id: string | null;
                        reason: string | null;
                      }>
                    | null;
                }>;
              };
            };
          };
        }
      )
        .select("id, agent_id, decision, confidence, created_at, execution_id, job_id, reason")
        .eq("company_id", tenantId)
        .order("created_at", { ascending: false })
        .limit(limit);
      return (data ?? []).map((r) => ({
        id: r.id,
        agentId: r.agent_id,
        decision: r.decision,
        confidence: Number(r.confidence),
        createdAt: r.created_at,
        executionId: r.execution_id,
        jobId: r.job_id,
        reason: r.reason,
      }));
    } catch {
      return [];
    }
  }

  async recentEnvelopes(tenantId: string, limit = 20): Promise<EnvelopeTimelineRow[]> {
    if (!this.writer) return [];
    try {
      const { data } = await (
        this.writer.from("runtime_knowledge_envelopes") as unknown as {
          select: (c: string) => {
            eq: (
              col: string,
              v: string,
            ) => {
              order: (
                col: string,
                opts: { ascending: boolean },
              ) => {
                limit: (n: number) => Promise<{
                  data:
                    | Array<{
                        id: string;
                        envelope_id: string;
                        topic: string;
                        agent_id: string;
                        priority: string | null;
                        confidence: number | null;
                        version: number | null;
                        created_at: string;
                        expires_at: string | null;
                      }>
                    | null;
                }>;
              };
            };
          };
        }
      )
        .select(
          "id, envelope_id, topic, agent_id, priority, confidence, version, created_at, expires_at",
        )
        .eq("company_id", tenantId)
        .order("created_at", { ascending: false })
        .limit(limit);
      return (data ?? []).map((r) => ({
        id: r.id,
        envelopeId: r.envelope_id,
        topic: r.topic,
        agentId: r.agent_id,
        priority: r.priority,
        confidence: r.confidence !== null ? Number(r.confidence) : null,
        version: r.version,
        createdAt: r.created_at,
        expiresAt: r.expires_at,
      }));
    } catch {
      return [];
    }
  }
}
