import type { TeamAccess } from "./permissions";
type RpcClient = {
  rpc: (
    name: string,
    args?: Record<string, unknown>,
  ) => PromiseLike<{ data: unknown; error: { code?: string; message: string } | null }>;
};
/** During rollout only an already verified legacy admin retains access before the migration. */
export async function readTeamAccess(client: RpcClient, userId: string): Promise<TeamAccess> {
  const { data, error } = await client.rpc("team_my_access");
  if (!error) return { ...(data as TeamAccess), schemaReady: true };
  if (error.code !== "PGRST202" && error.code !== "42883") throw new Error(error.message);
  const { data: company, error: companyError } = await client.rpc("current_company_id");
  if (companyError || typeof company !== "string")
    return { schemaReady: false, role: null, active: false, permissions: [] };
  const { data: admin, error: roleError } = await client.rpc("has_role", {
    _user_id: userId,
    _company_id: company,
    _role: "admin",
  });
  return {
    schemaReady: false,
    role: !roleError && admin === true ? "admin" : null,
    active: !roleError && admin === true,
    permissions: [],
  };
}
