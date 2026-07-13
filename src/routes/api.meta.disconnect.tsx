// ============================================================================
// POST /api/meta/disconnect
// Admin-only. Bearer obrigatório. companyId derivado do JWT (nunca do body).
// Body: { integrationId: uuid, mode: "dry-run" | "disconnect" }
// ============================================================================

import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { MetaDisconnectAgent } from "@/lib/meta-disconnect/MetaDisconnectAgent.server";

const BodySchema = z
  .object({
    integrationId: z.string().uuid(),
    mode: z.enum(["dry-run", "disconnect"]).default("dry-run"),
  })
  .strict();

const METHOD_NOT_ALLOWED = new Response("Method Not Allowed", {
  status: 405,
  headers: { Allow: "POST" },
});

function bearer(request: Request): string | null {
  const h = request.headers.get("authorization") ?? "";
  return h.startsWith("Bearer ") ? h.slice("Bearer ".length) : null;
}

export const Route = createFileRoute("/api/meta/disconnect")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const token = bearer(request);
        if (!token) return Response.json({ error: "não autenticado" }, { status: 401 });

        let parsed: z.infer<typeof BodySchema>;
        try {
          const json = (await request.json()) as unknown;
          parsed = BodySchema.parse(json);
        } catch (e) {
          return Response.json(
            { error: "payload inválido", detail: e instanceof Error ? e.message : "unknown" },
            { status: 400 },
          );
        }

        const agent = new MetaDisconnectAgent();
        const result = await agent.run({
          bearerToken: token,
          integrationId: parsed.integrationId,
          mode: parsed.mode,
        });

        if (!result.ok) {
          return Response.json({ error: result.error }, { status: result.status });
        }
        return Response.json(result);
      },
      GET: () => METHOD_NOT_ALLOWED,
      PUT: () => METHOD_NOT_ALLOWED,
      PATCH: () => METHOD_NOT_ALLOWED,
      DELETE: () => METHOD_NOT_ALLOWED,
    },
  },
});
