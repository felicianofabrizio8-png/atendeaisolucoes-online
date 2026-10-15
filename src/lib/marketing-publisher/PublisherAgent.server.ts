// PublisherAgent — facade pública do módulo. Único ponto de entrada usado
// pelo hook público e pelas server functions autenticadas.

import { PublisherRepository } from "./PublisherRepository.server";
import { PublisherWorker } from "./PublisherWorker.server";
import type { PublisherStats } from "./types";

export class PublisherAgent {
  private readonly worker: PublisherWorker;
  private readonly repo: PublisherRepository;

  constructor() {
    this.repo = new PublisherRepository();
    this.worker = new PublisherWorker(this.repo);
  }

  tick(workerId: string) {
    return this.worker.tick({ workerId });
  }

  retry(publicationId: string, companyId: string) {
    return this.repo.resetForRetry(publicationId, companyId);
  }

  async stats(companyId: string): Promise<PublisherStats & { scheduled: number }> {
    const base = await this.repo.stats(companyId);
    // 'scheduled' = agendamentos planned pendentes que ainda não viraram publicação.
    // Indicadores do painel ignoram conteúdos ocultados (hidden_from_publish).
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const admin = supabaseAdmin as unknown as { from: (t: string) => any };
    const q = await admin
      .from("marketing_schedule")
      .select("id, marketing_contents!inner(hidden_from_publish)", { count: "exact", head: true })
      .eq("company_id", companyId)
      .eq("marketing_contents.hidden_from_publish", false)
      .eq("status", "planned");
    if (q.error) throw new Error(q.error.message);
    return { ...base, scheduled: (q as { count?: number }).count ?? 0 };
  }
}
