// ============================================================================
// Autonomous Runtime — Types (Etapa 1: Fundação)
// READ-ONLY / stateless. Nenhum agente é executado nesta fase.
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

export interface AgentPriority {
  /** 1 = mais alto; 10 = mais baixo. */
  level: number;
  /** Peso relativo para tie-break. */
  weight: number;
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

export interface HeartbeatTick {
  ts: string;
  uptimeMs: number;
  registeredAgents: number;
  healthyAgents: number;
  disabledAgents: number;
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

export interface DispatchRequest {
  agentId: string;
  companyId?: string | null;
  payload?: Record<string, unknown>;
  reason?: string;
}

export interface DispatchResult {
  accepted: boolean;
  reason: string;
  agentId: string;
  dispatchedAt: string;
}

export const RUNTIME_VERSION = "1.0.0-foundation";
