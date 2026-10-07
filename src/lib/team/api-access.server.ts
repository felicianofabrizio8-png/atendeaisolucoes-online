import { createClient } from "@supabase/supabase-js";
import { apiPermission, can } from "./permissions";
import { readTeamAccess } from "./access";

export async function authorizeTeamRequest(request: Request): Promise<Response | null> {
  const url = new URL(request.url);
  if (
    !url.pathname.startsWith("/api/") ||
    url.pathname.startsWith("/api/public/") ||
    request.method === "OPTIONS"
  )
    return null;
  const authorization = request.headers.get("authorization") ?? "";
  if (!authorization.startsWith("Bearer "))
    return Response.json({ error: "Entre na sua conta." }, { status: 401 });
  const client = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_PUBLISHABLE_KEY!, {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: identity, error: identityError } = await client.auth.getUser(
    authorization.slice(7),
  );
  if (identityError || !identity.user)
    return Response.json({ error: "Sessão inválida." }, { status: 401 });
  let access;
  try {
    access = await readTeamAccess(client, identity.user.id);
  } catch {
    return Response.json(
      { error: "Não foi possível verificar as permissões da equipe." },
      { status: 503 },
    );
  }
  const permission = apiPermission(url.pathname);
  const allowed =
    permission === "admin" ? access.active && access.role === "admin" : can(access, permission);
  if (!allowed)
    return Response.json(
      { error: "Seu perfil não tem permissão para esta ação." },
      { status: 403 },
    );
  const scoped =
    permission === "conversations.reply" ||
    url.pathname === "/api/atendimento/followup" ||
    url.pathname === "/api/ai/followup-status";
  if (!scoped || access.schemaReady === false) return null;
  let payload: Record<string, unknown> = Object.fromEntries(url.searchParams);
  if (!["GET", "HEAD"].includes(request.method)) {
    try {
      if (request.headers.get("content-type")?.includes("multipart/form-data")) {
        const form = await request.clone().formData();
        payload = {
          ...payload,
          ...Object.fromEntries(
            [...form.entries()].filter(
              (entry): entry is [string, string] => typeof entry[1] === "string",
            ),
          ),
        };
      } else {
        payload = { ...payload, ...(await request.clone().json()) };
      }
    } catch {
      return Response.json({ error: "Dados inválidos." }, { status: 400 });
    }
  }
  const { data: scope, error: scopeError } = await client.rpc("team_authorize_interaction", {
    _payload: payload,
    _write: !["GET", "HEAD"].includes(request.method),
  });
  if (scopeError || scope !== true)
    return Response.json(
      {
        error:
          "Este atendimento está com outro usuário ou fora do seu acesso. Solicite uma transferência.",
      },
      { status: 403 },
    );
  return null;
}
