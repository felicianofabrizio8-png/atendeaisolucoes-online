import { createFileRoute } from "@tanstack/react-router";
import { GoalsPage } from "@/components/goals/GoalsDashboard";

export const Route = createFileRoute("/metas")({
  component: GoalsPage,
  head: () => ({ meta: [{ title: "Metas · Lume" }] }),
});
