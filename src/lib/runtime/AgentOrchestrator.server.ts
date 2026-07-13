// ============================================================================
// AgentOrchestrator — Facade de orquestração.
// Etapa 2: valida dependências / concorrência / prioridade. NÃO executa.
// ============================================================================

import type { AgentRegistry } from "./AgentRegistry.server";
import type {
  DispatchRequest,
  OrchestratorValidation,
  RegisteredAgent,
  RuntimeJobCounters,
} from "./RuntimeTypes";

export interface OrchestratorContext {
  processingByAgent?: Record<string, number>;
  counters?: RuntimeJobCounters;
}

export class AgentOrchestrator {
  constructor(private readonly registry: AgentRegistry) {}

  listByCategory(): Record<string, RegisteredAgent[]> {
    const acc: Record<string, RegisteredAgent[]> = {};
    for (const a of this.registry.list()) {
      const key = a.descriptor.category;
      (acc[key] ||= []).push(a);
    }
    return acc;
  }

  /** Valida se um agente pode ser despachado agora. */
  validate(req: DispatchRequest, ctx: OrchestratorContext = {}): OrchestratorValidation {
    const agent = this.registry.get(req.agentId);
    if (!agent) return { ok: false, reason: "agent_not_found" };
    const d = agent.descriptor;
    if (!d.enabled || d.executionMode === "disabled") {
      return { ok: false, reason: "agent_disabled" };
    }
    const mode = req.executionMode ?? d.executionMode;
    if (!d.supportedExecutionModes.includes(mode)) {
      return { ok: false, reason: `unsupported_execution_mode:${mode}` };
    }
    const priority = req.priority ?? "normal";
    if (!d.supportedPriorities.includes(priority)) {
      return { ok: false, reason: `unsupported_priority:${priority}` };
    }
    for (const dep of d.dependencies) {
      const depAgent = this.registry.get(dep);
      if (!depAgent) return { ok: false, reason: `missing_dependency:${dep}` };
      if (!depAgent.descriptor.enabled) return { ok: false, reason: `dependency_disabled:${dep}` };
    }
    const inflight = ctx.processingByAgent?.[req.agentId] ?? 0;
    if (inflight >= d.maxConcurrency) {
      return { ok: false, reason: `concurrency_limit:${d.maxConcurrency}` };
    }
    return { ok: true };
  }

  /** Ordenação topológica estável (Kahn). Lança se houver ciclo. */
  topologicalOrder(): string[] {
    const all = this.registry.list();
    const indeg = new Map<string, number>();
    const graph = new Map<string, string[]>();
    for (const a of all) {
      indeg.set(a.descriptor.id, 0);
      graph.set(a.descriptor.id, []);
    }
    for (const a of all) {
      for (const dep of a.descriptor.dependencies) {
        if (!indeg.has(dep)) continue;
        graph.get(dep)!.push(a.descriptor.id);
        indeg.set(a.descriptor.id, (indeg.get(a.descriptor.id) ?? 0) + 1);
      }
    }
    const queue: string[] = [];
    const byId = new Map(all.map((a) => [a.descriptor.id, a] as const));
    const sortKeys = (ids: string[]) =>
      ids.sort((x, y) => {
        const a = byId.get(x)!.descriptor.priority;
        const b = byId.get(y)!.descriptor.priority;
        return a.level - b.level || b.weight - a.weight || x.localeCompare(y);
      });

    for (const [id, d] of indeg) if (d === 0) queue.push(id);
    sortKeys(queue);
    const out: string[] = [];
    while (queue.length) {
      const id = queue.shift()!;
      out.push(id);
      for (const next of graph.get(id) ?? []) {
        indeg.set(next, (indeg.get(next) ?? 0) - 1);
        if (indeg.get(next) === 0) queue.push(next);
      }
      sortKeys(queue);
    }
    if (out.length !== all.length) {
      throw new Error("[AgentOrchestrator] ciclo detectado em dependências");
    }
    return out;
  }
}
