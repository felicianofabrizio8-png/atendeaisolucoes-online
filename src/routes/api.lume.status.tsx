import { createFileRoute } from "@tanstack/react-router";
import { handleLumeStatus } from "@/lib/lume/http.server";

export const Route = createFileRoute("/api/lume/status")({
  server: { handlers: { GET: ({ request }) => handleLumeStatus(request) } },
});
