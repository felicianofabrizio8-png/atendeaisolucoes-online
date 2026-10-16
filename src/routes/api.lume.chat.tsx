import { createFileRoute } from "@tanstack/react-router";
import { handleLumeChat } from "@/lib/lume/http.server";

export const Route = createFileRoute("/api/lume/chat")({
  server: { handlers: { POST: ({ request }) => handleLumeChat(request) } },
});
