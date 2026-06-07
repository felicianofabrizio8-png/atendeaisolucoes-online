import { createFileRoute } from "@tanstack/react-router";
import { useAuth } from "@/auth/AuthContext";
import { CreativeGenerator } from "@/components/campaigns/CreativeGenerator";
import { SavedCreatives } from "@/components/campaigns/SavedCreatives";

export const Route = createFileRoute("/criativos")({
  component: CriativosPage,
});

function CriativosPage() {
  const { profile } = useAuth();
  const companyId = profile?.company_id;
  if (!companyId) return null;
  return (
    <div className="p-4 md:p-6 max-w-6xl mx-auto space-y-6">
      <CreativeGenerator companyId={companyId} />
      <section className="rounded-xl border bg-card p-4">
        <h3 className="font-semibold text-sm mb-3">Biblioteca de criativos</h3>
        <SavedCreatives companyId={companyId} onReuse={() => { /* no-op */ }} />
      </section>
    </div>
  );
}
