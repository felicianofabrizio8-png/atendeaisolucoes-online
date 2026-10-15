// Mutations run in transactional PostgreSQL RPCs with the caller's JWT.
import { teamRpc } from "@/lib/team/client";
import type { Permission, TeamRole } from "@/lib/team/permissions";
export interface TeamUser {
  id: string;
  displayName: string | null;
  email: string | null;
  createdAt: string;
  lastSeenAt: string | null;
  role: TeamRole | null;
  active: boolean;
  permissions: Permission[];
  approvalPending?: boolean;
}
export interface TeamInvite {
  id: string;
  email: string;
  role: TeamRole;
  token: string;
  expires_at: string;
  accepted_at: string | null;
  cancelled_at: string | null;
  created_at: string;
}
export async function listCompanyUsers() {
  return { users: await teamRpc<TeamUser[]>("team_list_users") };
}
export async function listCompanyInvites() {
  return { invites: await teamRpc<TeamInvite[]>("team_list_invites") };
}
export async function inviteUser({ data }: { data: { email: string; role: TeamRole } }) {
  return {
    invite: await teamRpc<TeamInvite>("team_create_invite", {
      _email: data.email,
      _role: data.role,
    }),
  };
}
export async function cancelInvite({ data }: { data: { inviteId: string } }) {
  await teamRpc("team_cancel_invite", { _invite: data.inviteId });
}
export async function updateTeamMember(
  data: Pick<TeamUser, "id" | "role" | "active" | "permissions">,
) {
  await teamRpc("team_update_member", {
    _user: data.id,
    _role: data.role ?? "atendente",
    _active: data.active,
    _permissions: data.permissions,
  });
}
export interface InviteLink {
  id: string;
  token: string;
  label: string | null;
  role: TeamRole;
  permissions: Permission[];
  requires_approval: boolean;
  expires_at: string | null;
  max_uses: number | null;
  uses: number;
  revoked_at: string | null;
  created_at: string;
}
export function inviteLinkUrl(
  token: string,
  origin = typeof window === "undefined" ? "" : window.location.origin,
) {
  return `${origin}/convite?link=${encodeURIComponent(token)}`;
}
export async function listInviteLinks() {
  return teamRpc<InviteLink[]>("team_list_invite_links");
}
export async function createInviteLink(input: {
  role: TeamRole;
  permissions: Permission[];
  requiresApproval: boolean;
  expiresInDays: number | null;
  maxUses: number | null;
  label: string;
}) {
  return teamRpc<InviteLink>("team_create_invite_link", {
    _role: input.role,
    _permissions: input.permissions,
    _requires_approval: input.requiresApproval,
    _expires_in_days: input.expiresInDays,
    _max_uses: input.maxUses,
    _label: input.label,
  });
}
export async function revokeInviteLink(id: string) {
  await teamRpc("team_revoke_invite_link", { _link: id });
}
export async function approveMember(userId: string) {
  await teamRpc("team_approve_member", { _user: userId });
}
export async function rejectMember(userId: string) {
  await teamRpc("team_reject_member", { _user: userId });
}
export async function renameTeam(name: string) {
  await teamRpc("team_rename_company", { _name: name });
}
