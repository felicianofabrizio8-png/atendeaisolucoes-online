import { createFileRoute } from "@tanstack/react-router";
import { useAuth } from "@/auth/AuthContext";
import { useDashboardData } from "@/components/dashboard/useDashboardData";
import { DashboardView } from "@/components/dashboard/DashboardView";
import { LandingPage } from "@/components/landing/LandingPage";
export const Route = createFileRoute("/")({
  component: Index,
  head: () => ({
    title: "Lume — Vendas que não esperam",
    meta: [
      {
        name: "description",
        content:
          "Atendimento e vendas com IA: organize conversas, priorize leads e avance cada oportunidade.",
      },
      { property: "og:title", content: "Lume — Vendas que não esperam" },
      {
        property: "og:description",
        content:
          "Atendimento e vendas com IA para organizar conversas, priorizar leads e avançar oportunidades.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
});

function Index() {
  const { user } = useAuth();
  const demo =
    typeof window !== "undefined" && window.localStorage.getItem("atendeai.demo") === "1";
  return user || demo ? <Dashboard /> : <LandingPage />;
}
function Dashboard() {
  const { profile, company } = useAuth();
  const data = useDashboardData();
  return (
    <DashboardView data={data} displayName={profile?.display_name} companyName={company?.name} />
  );
}
