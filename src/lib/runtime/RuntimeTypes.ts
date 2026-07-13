// ============================================================================
// Autonomous Runtime — Types (Etapa 2: Job Queue + Dispatcher)
// READ-ONLY sobre a infraestrutura existente. Nenhum agente é executado.
// ============================================================================

export type AgentCategory =
  | "conversation"
  | "brain"
  | "learning"
  | "scientific"
  | "executive"
  | "sales"
  | "coach"
  | "followup"
  | "billing"
  | "health"
  | "llm"
  | "professor"
  | "meta"
  | "infra";

export type AgentExecutionMode =
  | "manual"
  | "scheduled"
  | "event"
  | "queue"
  | "disabled";

export type AgentStatus =
  | "idle"
  | "running"
  | "success"
  | "failure"
  | "unknown"
  | "disabled";

export type AgentHealthLevel = "healthy" | "degraded" | "unknown" | "down";

/** Estados oficiais do Runtime (superconjunto lógico do agent_jobs). */
export type RuntimeJobStatus =
  | "queued"
  | "scheduled"
  | "processing"
  | "completed"
  | "failed"
  | "retry"
  | "dead_letter"
  | "cancelled"
  | "timeout"
  | "blocked";

export type RuntimeJobPriority = "critical" | "high" | "normal" | "low" | "background";

export const PRIORITY_WEIGHTS: Record<RuntimeJobPriority, number> = {
  critical: 10,
  high: 25,
  normal: 100,
  low: 250,
  background: 500,
};

export interface AgentPriority {
  /** 1 = mais alto; 10 = mais baixo. */
  level: number;
  /** Peso relativo para tie-break. */
  weight: number;
}

export interface AgentRetryPolicy {
  maxAttempts: number;
  backoffSeconds: number;
  jitter: boolean;
}

export interface AgentTimeoutPolicy {
  softTimeoutMs: number;
  hardTimeoutMs: number;
}

export interface AgentExecutionPolicySpec {
  concurrency: number;
  timeoutMs: number;
  retries: number;
  retryBackoffMs: number;
  /** Janela horária em UTC no formato "HH:mm-HH:mm" (opcional). */
  window?: string;
  /** Dependências (ids de outros agentes). */
  dependsOn: string[];
}

export interface AgentDescriptor {
  id: string;
  name: string;
  version: string;
  category: AgentCategory;
  enabled: boolean;
  executionMode: AgentExecutionMode;
  supportedExecutionModes: AgentExecutionMode[];
  supportedPriorities: RuntimeJobPriority[];
  maxConcurrency: number;
  retryPolicy: AgentRetryPolicy;
  timeoutPolicy: AgentTimeoutPolicy;
  dependencies: string[];
  priority: AgentPriority;
  policy: AgentExecutionPolicySpec;
  description?: string;
}

export interface AgentRuntimeState {
  status: AgentStatus;
  health: AgentHealthLevel;
  lastExecution: string | null;
  lastSuccess: string | null;
  lastFailure: string | null;
  lastError: string | null;
}

export interface RegisteredAgent {
  descriptor: AgentDescriptor;
  state: AgentRuntimeState;
}

export interface RuntimeJobCounters {
  queued: number;
  scheduled: number;
  processing: number;
  completed: number;
  failed: number;
  retry: number;
  deadLetter: number;
  cancelled: number;
  blocked: number;
}

export interface HeartbeatTick {
  ts: string;
  uptimeMs: number;
  registeredAgents: number;
  healthyAgents: number;
  disabledAgents: number;
  jobs: RuntimeJobCounters;
}

export interface RuntimeStatus {
  online: boolean;
  version: string;
  startedAt: string;
  uptimeMs: number;
  registeredAgents: number;
  healthyAgents: number;
  disabledAgents: number;
  lastHeartbeat: HeartbeatTick | null;
}

export interface RuntimeJobRecord {
  id: string;
  agentId: string;
  tenantId: string;
  priority: RuntimeJobPriority;
  status: RuntimeJobStatus;
  createdAt: string;
  scheduledAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  attempt: number;
  maxAttempts: number;
  retryAt: string | null;
  timeoutMs: number;
  executionMode: AgentExecutionMode;
  payloadHash: string | null;
  correlationId: string | null;
  lastError: string | null;
}

export interface DispatchRequest {
  agentId: string;
  tenantId: string;
  priority?: RuntimeJobPriority;
  executionMode?: AgentExecutionMode;
  scheduledAt?: string;
  dedupeKey?: string | null;
  correlationId?: string | null;
  payloadHash?: string | null;
  reason?: string;
}

export interface DispatchResult {
  accepted: boolean;
  reason: string;
  agentId: string;
  jobId: string | null;
  status: RuntimeJobStatus | null;
  dispatchedAt: string;
}

export interface OrchestratorValidation {
  ok: boolean;
  reason?: string;
}

export const RUNTIME_VERSION = "1.1.0-dispatcher";
