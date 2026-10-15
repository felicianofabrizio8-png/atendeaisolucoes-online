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
