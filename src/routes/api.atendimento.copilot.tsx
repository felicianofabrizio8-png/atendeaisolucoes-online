import { createFileRoute } from "@tanstack/react-router";
import { handleCopilotChat } from "@/lib/atendimento/copilot-chat.server";

export const Route = createFileRoute("/api/atendimento/copilot")({
  server: { handlers: { POST: ({ request }) => handleCopilotChat(request) } },
});
