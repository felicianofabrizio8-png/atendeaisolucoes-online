import { createMiddleware } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { can, type Permission } from "./permissions";
import { readTeamAccess } from "./access";

export const teamRequestMiddleware = createMiddleware({ type: "request" }).server(
  async ({ request, next }) => {
    const { authorizeTeamRequest } = await import("./api-access.server");
    const rejection = await authorizeTeamRequest(request);
    return rejection ?? next();
  },
);

export function requireTeamPermission(permission: Permission | "admin" | "member") {
  return createMiddleware({ type: "function" })
    .middleware([requireSupabaseAuth])
    .server(async ({ context, next }) => {
      const data = await readTeamAccess(
        context.supabase as unknown as Parameters<typeof readTeamAccess>[0],
        context.userId,
      );
      if (
        !data?.active ||
        (permission !== "member" &&
          (permission === "admin" ? data.role !== "admin" : !can(data, permission)))
      )
        throw new Error("Acesso negado: permissão necessária.");
      return next();
    });
}
