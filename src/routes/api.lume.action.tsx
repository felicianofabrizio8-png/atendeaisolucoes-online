import { createFileRoute } from "@tanstack/react-router";
import { handleLumeAction } from "@/lib/lume/http.server";

export const Route = createFileRoute("/api/lume/action")({
  server: { handlers: { POST: ({ request }) => handleLumeAction(request) } },
});
