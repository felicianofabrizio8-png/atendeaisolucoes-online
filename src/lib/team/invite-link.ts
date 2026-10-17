import { supabase } from "@/integrations/supabase/client";
import { teamRpc } from "./client";

/**
 * Convite por link. Quem não tem conta cria a conta normalmente; o token fica guardado
 * no navegador e, depois do login, o popup pergunta se a pessoa quer entrar na equipe.
 */

const KEY = "lume.pendingInvite";

export interface LinkInfo {
  valid: boolean;
  company: string | null;
  requiresApproval: boolean;
  currentTeam?: string | null;
  alreadyMember?: boolean;
  canSwitch?: boolean;
  currentTeamHasData?: boolean;
}

export type PendingJoin = { state: "waiting"; company: string } | null;

export function savePendingInvite(token: string) {
  try {
    localStorage.setItem(KEY, token);
  } catch {
    /* navegação privada: o popup só aparece nesta visita */
  }
}

export function readPendingInvite(): string | null {
  try {
    return localStorage.getItem(KEY);
  } catch {
    return null;
  }
}

export function clearPendingInvite() {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* navegação privada */
  }
}

/** Funciona sem login (só nome da equipe e validade) e com login (equipe atual, troca). */
export async function linkInfo(token: string): Promise<LinkInfo> {
  const client = supabase as unknown as {
    rpc: (
      name: string,
      args: Record<string, unknown>,
    ) => Promise<{ data: LinkInfo | null; error: { message: string } | null }>;
  };
  const { data, error } = await client.rpc("team_invite_link_info", { _token: token });
  if (error) throw new Error(error.message);
  return data ?? { valid: false, company: null, requiresApproval: false };
}

export function myPendingJoin() {
  return teamRpc<PendingJoin>("team_my_pending_join");
}

export async function joinViaLink(token: string) {
  const result = await teamRpc<{ status: "joined" | "pending_approval" | "already_member" }>(
    "team_join_via_link",
    { _token: token },
  );
  return result.status;
}

/** Desiste do pedido aguardando aprovação: a conta volta para uma equipe própria. */
export async function cancelJoinRequest() {
  await teamRpc("team_cancel_join_request");
}
