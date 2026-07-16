// ============================================================================
// Graph — chamadas oficiais Meta para revogação.
//
// Toda saída de rede passa OBRIGATORIAMENTE por `deleteGraph` (MetaOutbound),
// que aplica EnvironmentGuard: em staging/unknown a chamada é simulada e
// NENHUM fetch é executado. Em legacy/production o comportamento é idêntico
// ao caminho anterior (mesma URL, método e ausência de body).
//
// Todas as falhas são capturadas e devolvidas como StepStatus (nunca lançam).
// ============================================================================

import { deleteGraph } from "@/lib/outbound/MetaOutbound.server";
import type { GuardDeps } from "@/lib/environment/EnvironmentGuard.server";
import type { OutboundResult } from "@/lib/outbound/MetaOutboundContract";
import { isSimulation, isFailure } from "@/lib/outbound/MetaOutboundContract";
import type { DisconnectStep } from "./MetaDisconnectTypes";

const GRAPH = "https://graph.facebook.com/v25.0";

function sanitize(msg: string | undefined | null): string {
  if (!msg) return "unknown";
  // Nunca deixar token vazar em audit — só código/mensagem curta.
  return msg.replace(/EAA[A-Za-z0-9]+/g, "[token]").slice(0, 200);
}

function toStep(
  step: string,
  r: OutboundResult,
): DisconnectStep {
  if (isSimulation(r)) {
    return {
      step,
      status: "skipped",
      code: "simulated_environment_guard",
      detail: `env=${r.environment}`,
    };
  }
  if (isFailure(r)) {
    const status = typeof r.status === "number" ? r.status : undefined;
    const code = r.externalRequestSent
      ? `http_${status ?? "err"}`
      : "network_error";
    return { step, status: "failed", code, detail: sanitize(r.error) };
  }
  return { step, status: "ok" };
}

export interface MetaDisconnectGraphCallCtx {
  companyId: string;
  userId?: string | null;
  guardDeps?: GuardDeps;
  fetchImpl?: typeof fetch;
}

export class MetaDisconnectGraph {
  /** DELETE /{page-id}/subscribed_apps — remove webhooks daquela página. */
  async unsubscribePage(
    ctx: MetaDisconnectGraphCallCtx,
    pageId: string,
    pageAccessToken: string,
  ): Promise<DisconnectStep> {
    const url = `${GRAPH}/${encodeURIComponent(pageId)}/subscribed_apps?access_token=${encodeURIComponent(pageAccessToken)}`;
    const r = await deleteGraph({
      companyId: ctx.companyId,
      userId: ctx.userId ?? null,
      agentId: "meta-disconnect",
      action: "meta.disconnect.page.unsubscribe",
      url,
      // logicalPayload sanitizado: sem token, apenas metadado.
      logicalPayload: { pageId: `${pageId.slice(0, 4)}…` },
      guardDeps: ctx.guardDeps,
    });
    return toStep("graph.page.unsubscribe", r);
  }

  /**
   * DELETE /{user-id}/permissions — revoga todas as permissões OAuth do user.
   *
   * ATENÇÃO: esta chamada é GLOBAL do lado da Meta. Se o mesmo usuário Meta
   * autorizou OUTRAS integrações (do próprio Atende Aí ou de outros apps
   * conectados ao mesmo app_id), TODAS perderão as permissões concedidas
   * por esse usuário. Não há como escopar por integração/tenant nesta rota
   * do Graph API — é o comportamento oficial documentado.
   */
  async revokeUserPermissions(
    ctx: MetaDisconnectGraphCallCtx,
    externalUserId: string,
    userToken: string,
  ): Promise<DisconnectStep> {
    const url = `${GRAPH}/${encodeURIComponent(externalUserId)}/permissions?access_token=${encodeURIComponent(userToken)}`;
    const r = await deleteGraph({
      companyId: ctx.companyId,
      userId: ctx.userId ?? null,
      agentId: "meta-disconnect",
      action: "meta.disconnect.user.revoke_permissions",
      url,
      logicalPayload: { externalUserId: `${externalUserId.slice(0, 4)}…` },
      guardDeps: ctx.guardDeps,
    });
    return toStep("graph.user.revoke_permissions", r);
  }

  /**
   * WhatsApp Cloud API — não há endpoint oficial para "revogar" um token de
   * app associado a um WABA sem tocar em System Users. Marcar como manual.
   */
  wabaManualNotice(): DisconnectStep {
    return {
      step: "graph.waba.revoke",
      status: "manual_action_required",
      code: "manual_only",
      detail:
        "WhatsApp Business Account: revogue o token do System User em business.facebook.com se desejar invalidar completamente.",
    };
  }
}
