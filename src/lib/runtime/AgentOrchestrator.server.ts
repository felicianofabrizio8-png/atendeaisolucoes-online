// ============================================================================
// AgentOrchestrator — Facade de orquestração.
// Etapa 1: NÃO orquestra execução. Apenas expõe consulta de topologia,
// dependências e ordem topológica (útil para futuras etapas).
// ============================================================================

import type { AgentRegistry } from "./AgentRegistry.server";
import type { RegisteredAgent } from "./RuntimeTypes";

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
        if (!indeg.has(dep)) continue; // dep desconhecido: ignora
        graph.get(dep)!.push(a.descriptor.id);
        indeg.set(a.descriptor.id, (indeg.get(a.descriptor.id) ?? 0) + 1);
      }
    }
    const queue: string[] = [];
    // ordem determinística: por prioridade level asc, weight desc
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
