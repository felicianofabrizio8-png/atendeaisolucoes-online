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
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const admin = supabaseAdmin as unknown as { from: (t: string) => any };
    const q = await admin
      .from("marketing_schedule")
      .select("id", { count: "exact", head: true })
      .eq("company_id", companyId)
      .eq("status", "planned");
    return { ...base, scheduled: (q as { count?: number }).count ?? 0 };
  }
}
