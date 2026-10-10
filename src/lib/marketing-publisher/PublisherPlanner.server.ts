// PublisherPlanner — materializa publicações a partir do calendário aprovado.
// Idempotente: unique(schedule_id) na tabela.

import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { PublisherRepository } from "./PublisherRepository.server";
import type { PublicationChannel, PublicationFormat } from "./types";
import { isCarouselPublishEnabled } from "./carousel-flag";
import { findDuplicateSchedule, type ScheduleSibling } from "./publish-dedupe";
import { scheduleRejectionReason } from "./publish-compat";
import {
  resolveCampaignFormats,
  roleFromContentFormat,
  formatsTelemetry,
} from "@/lib/marketing/campaign-formats";

// Só canais e formatos suportados pelo Publisher nesta fase.
const SUPPORTED_CHANNELS = new Set(["instagram", "facebook"]);
const FORMAT_MAP: Record<string, PublicationFormat | null> = {
  feed: "feed",
  reel: "reel",
  story: "story",
  whatsapp_cta: null, // WhatsApp fica de fora
};

export class PublisherPlanner {
  constructor(private readonly repo = new PublisherRepository()) {}

  /**
   * Varre `marketing_schedule` vencido (planned + <=now) com content aprovado
   * e cria (se ainda não existe) a linha em `marketing_publications`.
   *
   * Devolve quantas materialições foram efetivadas nesta iteração.
   */
  async materializeDue(now = new Date(), limit = 25): Promise<number> {
    const admin = supabaseAdmin as unknown as { from: (t: string) => any };
    const nowIso = now.toISOString();

    // Busca até `limit` schedules vencidos aprovados.
    const q = await admin
      .from("marketing_schedule")
      .select(
        "id, company_id, content_id, channel, scheduled_at, created_at, status, created_by, marketing_contents!inner(id, status, format, channel, campaign_id, ai_prompt)",
      )
      .in("status", ["planned"])
      .lte("scheduled_at", nowIso)
      // Ordem estável: a conferência de repetição depende de todos os
      // processos verem os agendamentos na mesma sequência.
      .order("scheduled_at", { ascending: true })
      .order("created_at", { ascending: true })
      .order("id", { ascending: true })
      .limit(limit);

    const rows = (q.data ?? []) as Array<{
      id: string;
      company_id: string;
      content_id: string;
      channel: string;
      scheduled_at: string;
      created_at: string;
      status: string;
      created_by: string | null;
      marketing_contents: {
        id: string;
        status: string;
        format: string;
        channel: string;
        campaign_id: string | null;
        ai_prompt: unknown;
      };
    }>;

    let created = 0;
    for (const s of rows) {
      const contentOk = s.marketing_contents?.status === "approved";
      const channelOk = SUPPORTED_CHANNELS.has(s.channel);
      // Carrossel só entra na fila com a publicação de carrossel ligada.
      const mappedFormat: PublicationFormat | null =
        s.marketing_contents?.format === "carousel"
          ? isCarouselPublishEnabled(s.company_id)
            ? "carousel"
            : null
          : (FORMAT_MAP[s.marketing_contents?.format ?? ""] ?? null);

      if (!contentOk || !channelOk || !mappedFormat) {
        // Não materializa. Deixa o schedule como está (Marketing IA/UX
        // continua responsável). Marca como failed apenas se o motivo é
        // "canal não suportado" — assim o usuário vê no calendário.
        if (channelOk && contentOk && !mappedFormat) {
          // Sem publicação criada não há onde gravar o erro: o motivo fica no log.
          console.warn("[marketing-publisher] schedule_rejected", {
            schedule_id: s.id,
            company_id: s.company_id,
            content_id: s.content_id,
            channel: s.channel,
            format: s.marketing_contents?.format ?? null,
            reason: scheduleRejectionReason(s.marketing_contents?.format),
          });
          await admin
            .from("marketing_schedule")
            .update({ status: "failed" })
            .eq("id", s.id);
        }
        continue;
      }

      // Formatos escolhidos na campanha (ai_prompt.formats). Campanha antiga
      // sem `formats` → fallback legado (feed+story), registrado no log.
      const formats = resolveCampaignFormats(s.marketing_contents?.ai_prompt);
      const role = roleFromContentFormat(s.marketing_contents?.format);
      if (role && !formats.roles.includes(role)) {
        // eslint-disable-next-line no-console
        console.info(
          formatsTelemetry("campaign_format_publish_skipped", {
            campaign_id: s.marketing_contents?.campaign_id ?? null,
            company_id: s.company_id,
            role,
            formats: formats.selection,
            source: formats.source,
            reason: "format_not_selected",
          }),
        );
        await admin
          .from("marketing_schedule")
          .update({ status: "cancelled" })
          .eq("id", s.id)
          .eq("status", "planned");
        continue;
      }
      // eslint-disable-next-line no-console
      console.info(
        formatsTelemetry("campaign_format_publish_requested", {
          campaign_id: s.marketing_contents?.campaign_id ?? null,
          company_id: s.company_id,
          role,
          formats: formats.selection,
          source: formats.source,
        }),
      );

      // Clique repetido / pedidos simultâneos: o mesmo conteúdo, no mesmo
      // canal, quase no mesmo horário, vira UMA publicação.
      const duplicateOf = await this.findDuplicate(s);
      if (duplicateOf) {
        // eslint-disable-next-line no-console
        console.info("[marketing-publisher] duplicate_schedule_cancelled", {
          schedule_id: s.id,
          duplicate_of: duplicateOf.id,
          company_id: s.company_id,
          channel: s.channel,
        });
        await admin.from("marketing_schedule").update({ status: "cancelled" }).eq("id", s.id).eq("company_id", s.company_id).eq("status", "planned");
        continue;
      }

      const row = await this.repo.materialize({
        companyId: s.company_id,
        scheduleId: s.id,
        contentId: s.content_id,
        channel: s.channel as PublicationChannel,
        format: mappedFormat,
        availableAt: new Date(),
        createdBy: s.created_by,
      });
      if (row) {
        // Avança o schedule para 'queued' (rastreabilidade no calendário).
        await admin
          .from("marketing_schedule")
          .update({ status: "queued" })
          .eq("id", s.id)
          .eq("status", "planned");
        created += 1;
      }
    }
    return created;
  }

  /** Outro agendamento do mesmo conteúdo e canal (da mesma empresa) que torna este uma repetição. */
  private async findDuplicate(s: { id: string; company_id: string; content_id: string; channel: string; scheduled_at: string; created_at: string }): Promise<ScheduleSibling | null> {
    const admin = supabaseAdmin as unknown as { from: (t: string) => any };
    const q = await admin
      .from("marketing_schedule")
      .select("id, status, scheduled_at, created_at")
      .eq("company_id", s.company_id)
      .eq("content_id", s.content_id)
      .eq("channel", s.channel)
      .in("status", ["planned", "queued", "published"])
      .neq("id", s.id);
    return findDuplicateSchedule(s, (q.data ?? []) as ScheduleSibling[], { mode: "materialize" });
  }
}
