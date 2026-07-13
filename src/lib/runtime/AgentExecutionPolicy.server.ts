// ============================================================================
// AgentExecutionPolicy — Contratos de execução (concorrência, retry, janela).
// Etapa 1: apenas estrutura. Nenhum agente é executado aqui.
// ============================================================================

import type { AgentExecutionPolicySpec } from "./RuntimeTypes";

export const DEFAULT_POLICY: AgentExecutionPolicySpec = {
  concurrency: 1,
  timeoutMs: 60_000,
  retries: 0,
  retryBackoffMs: 5_000,
  dependsOn: [],
};

export class AgentExecutionPolicy {
  static create(overrides: Partial<AgentExecutionPolicySpec> = {}): AgentExecutionPolicySpec {
    return { ...DEFAULT_POLICY, ...overrides };
  }

  /** Valida sanidade dos parâmetros. Não executa nada. */
  static validate(policy: AgentExecutionPolicySpec): { ok: boolean; error?: string } {
    if (policy.concurrency < 1) return { ok: false, error: "concurrency<1" };
    if (policy.timeoutMs < 1_000) return { ok: false, error: "timeoutMs<1000" };
    if (policy.retries < 0) return { ok: false, error: "retries<0" };
    if (policy.retryBackoffMs < 0) return { ok: false, error: "retryBackoffMs<0" };
    if (policy.window && !/^\d{2}:\d{2}-\d{2}:\d{2}$/.test(policy.window)) {
      return { ok: false, error: "window inválida (HH:mm-HH:mm)" };
    }
    return { ok: true };
  }

  /** Verifica se `dateUtc` cai dentro da janela declarada. */
  static isWithinWindow(policy: AgentExecutionPolicySpec, dateUtc: Date): boolean {
    if (!policy.window) return true;
    const [start, end] = policy.window.split("-");
    const [sh, sm] = start.split(":").map(Number);
    const [eh, em] = end.split(":").map(Number);
    const mins = dateUtc.getUTCHours() * 60 + dateUtc.getUTCMinutes();
    const sMins = sh * 60 + sm;
    const eMins = eh * 60 + em;
    return sMins <= eMins ? mins >= sMins && mins <= eMins : mins >= sMins || mins <= eMins;
  }
}
