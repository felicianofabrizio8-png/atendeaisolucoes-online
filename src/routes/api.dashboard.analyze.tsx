import { createFileRoute } from "@tanstack/react-router";
import { handleChartAnalysis } from "@/lib/dashboard-analysis.server";
export const Route = createFileRoute("/api/dashboard/analyze")({
  server: { handlers: { POST: ({ request }) => handleChartAnalysis(request) } },
});
