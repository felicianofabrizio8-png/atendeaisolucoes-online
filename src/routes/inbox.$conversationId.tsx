// Critical route config (validateSearch). Component lives in
// inbox.$conversationId.lazy.tsx and is code-split — only baixado quando a rota é acessada.
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/inbox/$conversationId")({
  validateSearch: (search: Record<string, unknown>): { quote?: string } => {
    if (typeof search.quote === "string") return { quote: search.quote };
    return {};
  },
});
