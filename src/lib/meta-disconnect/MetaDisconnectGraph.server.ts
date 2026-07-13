// ============================================================================
// Graph — chamadas oficiais Meta para revogação.
// Todas as falhas são capturadas e devolvidas como StepStatus (nunca lançam).
// ============================================================================

import type { DisconnectStep } from "./MetaDisconnectTypes";

const GRAPH = "https://graph.facebook.com/v25.0";

interface GraphErr {
  error?: { message?: string; code?: number; type?: string };
}

async function safeJson(r: Response): Promise<GraphErr & Record<string, unknown>> {
  try {
    return (await r.json()) as GraphErr & Record<string, unknown>;
  } catch {
    return {};
  }
}

function sanitize(msg: string | undefined | null): string {
  if (!msg) return "unknown";
  // Nunca deixar token vazar em audit — só código/mensagem curta.
  return msg.replace(/EAA[A-Za-z0-9]+/g, "[token]").slice(0, 200);
}

export class MetaDisconnectGraph {
  /** DELETE /{page-id}/subscribed_apps — remove webhooks daquela página. */
  async unsubscribePage(pageId: string, pageAccessToken: string): Promise<DisconnectStep> {
    try {
      const r = await fetch(
        `${GRAPH}/${encodeURIComponent(pageId)}/subscribed_apps?access_token=${encodeURIComponent(pageAccessToken)}`,
        { method: "DELETE" },
      );
      const body = await safeJson(r);
      if (!r.ok) {
        return {
          step: "graph.page.unsubscribe",
          status: "failed",
          code: `http_${r.status}`,
          detail: sanitize(body.error?.message),
        };
      }
      return { step: "graph.page.unsubscribe", status: "ok" };
    } catch (e) {
      return {
        step: "graph.page.unsubscribe",
        status: "failed",
        code: "network_error",
        detail: sanitize(e instanceof Error ? e.message : String(e)),
      };
    }
  }

  /** DELETE /{user-id}/permissions — revoga todas as permissões OAuth do user. */
  async revokeUserPermissions(userId: string, userToken: string): Promise<DisconnectStep> {
    try {
      const r = await fetch(
        `${GRAPH}/${encodeURIComponent(userId)}/permissions?access_token=${encodeURIComponent(userToken)}`,
        { method: "DELETE" },
      );
      const body = await safeJson(r);
      if (!r.ok) {
        return {
          step: "graph.user.revoke_permissions",
          status: "failed",
          code: `http_${r.status}`,
          detail: sanitize(body.error?.message),
        };
      }
      return { step: "graph.user.revoke_permissions", status: "ok" };
    } catch (e) {
      return {
        step: "graph.user.revoke_permissions",
        status: "failed",
        code: "network_error",
        detail: sanitize(e instanceof Error ? e.message : String(e)),
      };
    }
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
