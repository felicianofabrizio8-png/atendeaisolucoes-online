// ============================================================================
// Serviço — orquestra dry-run e disconnect real de forma resiliente.
// Nunca lança para o handler; devolve um DisconnectReport estruturado.
// ============================================================================

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { HttpAudit } from "@/lib/audit/HttpAudit.server";
import { assertOutbound, type GuardDeps } from "@/lib/environment/EnvironmentGuard.server";
import {
  MetaDisconnectRepository,
  type LocalIntegrationRow,
  type LocalMetaPageRow,
} from "./MetaDisconnectRepository.server";
import { MetaDisconnectGraph } from "./MetaDisconnectGraph.server";
import type {
  DisconnectPlan,
  DisconnectReport,
  DisconnectStep,
  DryRunReport,
} from "./MetaDisconnectTypes";

export interface DisconnectContext {
  companyId: string;
  userId: string;
  integrationId: string;
  /** Injeção do EnvironmentGuard para testes. */
  guardDeps?: GuardDeps;
}

export class MetaDisconnectService {
  private readonly repo: MetaDisconnectRepository;
  private readonly graph: MetaDisconnectGraph;
  private readonly audit: HttpAudit;

  constructor(admin: SupabaseClient<Database>) {
    this.repo = new MetaDisconnectRepository(admin);
    this.graph = new MetaDisconnectGraph();
    this.audit = new HttpAudit(admin);
  }

  private buildPlan(
    integration: LocalIntegrationRow,
    pages: LocalMetaPageRow[],
  ): DisconnectPlan {
    const asset = this.repo.toAssetSummary(integration);
    const pageAssets = pages.map((p) => this.repo.toPageAssetSummary(p));
    const actions: string[] = [];
    if (pages.length > 0) actions.push("Remover subscribed_apps das páginas conectadas");
    if (integration.has_access_token && integration.channel !== "whatsapp") {
      actions.push("Revogar permissões OAuth do usuário Meta");
    }
    if (integration.channel === "whatsapp") {
      actions.push("Marcar WABA como manual_action_required (sem revoke automático)");
    }
    actions.push("Zerar credenciais locais (access_token, webhook_secret, verify_token)");
    actions.push("Marcar integração como inativa e registrar disconnected_at");

    const risks: string[] = [];
    if (asset.active) risks.push("Novos webhooks deixarão de ser roteados imediatamente");
    if (pages.length > 0) risks.push(`${pages.length} página(s) local(is) serão desassociadas`);

    return {
      integrationId: integration.id,
      companyId: integration.company_id,
      asset,
      metaPages: pageAssets,
      actions,
      risks,
      sharedDependencies: [],
    };
  }

  async dryRun(ctx: DisconnectContext): Promise<
    { ok: true; report: DryRunReport } | { ok: false; status: number; error: string }
  > {
    const integration = await this.repo.loadIntegration(ctx.integrationId, ctx.companyId);
    if (!integration) return { ok: false, status: 404, error: "integração não encontrada" };
    const pages = await this.repo.loadMetaPages(ctx.integrationId, ctx.companyId);
    const plan = this.buildPlan(integration, pages);
    return {
      ok: true,
      report: {
        integrationId: integration.id,
        plan: { ...plan, companyId: "[redacted]" },
        wouldExecute: plan.actions,
        writeAttempted: false,
      },
    };
  }

  async disconnect(ctx: DisconnectContext): Promise<
    { ok: true; report: DisconnectReport } | { ok: false; status: number; error: string }
  > {
    const startedAt = new Date();
    const integration = await this.repo.loadIntegration(ctx.integrationId, ctx.companyId);
    if (!integration) return { ok: false, status: 404, error: "integração não encontrada" };

    const meta = (integration.account_metadata ?? {}) as Record<string, unknown>;
    const already =
      integration.active === false && meta.disconnect_status === "disconnected";
    if (already) {
      const finishedAt = new Date();
      return {
        ok: true,
        report: {
          integrationId: integration.id,
          status: "already_disconnected",
          alreadyDisconnected: true,
          steps: [{ step: "noop", status: "skipped", detail: "already disconnected" }],
          manualActionsRequired: [],
          startedAt: startedAt.toISOString(),
          finishedAt: finishedAt.toISOString(),
          durationMs: finishedAt.getTime() - startedAt.getTime(),
        },
      };
    }

    const steps: DisconnectStep[] = [];
    const manuals: string[] = [];

    // 1) marca disconnecting (idempotente)
    try {
      await this.repo.markDisconnecting(ctx.integrationId, ctx.companyId);
      steps.push({ step: "local.mark_disconnecting", status: "ok" });
    } catch (e) {
      steps.push({
        step: "local.mark_disconnecting",
        status: "failed",
        detail: e instanceof Error ? e.message : "unknown",
      });
    }

    // 2) unsubscribe páginas (Facebook / Instagram)
    const pages = await this.repo.loadMetaPages(ctx.integrationId, ctx.companyId);
    for (const p of pages) {
      if (!p.page_access_token || !p.page_id) {
        steps.push({ step: "graph.page.unsubscribe", status: "skipped", code: "no_token" });
        continue;
      }
      const step = await this.graph.unsubscribePage(p.page_id, p.page_access_token);
      steps.push(step);
    }

    // 3) revoga permissões OAuth (apenas quando temos user token — não WhatsApp)
    if (integration.channel !== "whatsapp" && integration.access_token) {
      const externalUserId =
        (meta.user_id as string | undefined) ?? (meta.fb_user_id as string | undefined) ?? null;
      if (externalUserId) {
        const step = await this.graph.revokeUserPermissions(
          externalUserId,
          integration.access_token,
        );
        steps.push(step);
      } else {
        steps.push({
          step: "graph.user.revoke_permissions",
          status: "skipped",
          code: "no_user_id",
          detail: "account_metadata.user_id ausente — pulei revoke",
        });
      }
    }

    // 4) WhatsApp — nota manual
    if (integration.channel === "whatsapp") {
      const s = this.graph.wabaManualNotice();
      steps.push(s);
      if (s.detail) manuals.push(s.detail);
    }

    // 5) desassocia páginas locais
    try {
      const n = await this.repo.detachMetaPages(ctx.integrationId, ctx.companyId);
      steps.push({
        step: "local.detach_meta_pages",
        status: "ok",
        detail: `pages=${n}`,
      });
    } catch (e) {
      steps.push({
        step: "local.detach_meta_pages",
        status: "failed",
        detail: e instanceof Error ? e.message : "unknown",
      });
    }

    // 6) status final agregado
    const graphSteps = steps.filter((s) => s.step.startsWith("graph."));
    const anyGraphFailed = graphSteps.some((s) => s.status === "failed");
    const localFailed = steps.some(
      (s) => s.step.startsWith("local.") && s.status === "failed",
    );

    let finalStatus: "disconnected" | "partial_disconnect" | "disconnect_failed";
    if (localFailed) finalStatus = "disconnect_failed";
    else if (anyGraphFailed) finalStatus = "partial_disconnect";
    else finalStatus = "disconnected";

    try {
      await this.repo.finalize(
        ctx.integrationId,
        ctx.companyId,
        finalStatus,
        anyGraphFailed ? "graph_partial_failure" : "user_requested",
      );
      steps.push({ step: "local.finalize", status: "ok", detail: finalStatus });
    } catch (e) {
      steps.push({
        step: "local.finalize",
        status: "failed",
        detail: e instanceof Error ? e.message : "unknown",
      });
      finalStatus = "disconnect_failed";
    }

    const finishedAt = new Date();
    const report: DisconnectReport = {
      integrationId: integration.id,
      status: finalStatus,
      alreadyDisconnected: false,
      steps,
      manualActionsRequired: manuals,
      startedAt: startedAt.toISOString(),
      finishedAt: finishedAt.toISOString(),
      durationMs: finishedAt.getTime() - startedAt.getTime(),
    };

    // audit sanitizado (sem tokens, sem IDs externos)
    await this.audit.record({
      companyId: ctx.companyId,
      userId: ctx.userId,
      method: "POST",
      path: "/api/meta/disconnect",
      status: finalStatus === "disconnect_failed" ? 500 : 200,
      durationMs: report.durationMs,
      outcome: finalStatus,
      error: finalStatus === "disconnected" ? null : `channel=${integration.channel}`,
    });

    return { ok: true, report };
  }
}
