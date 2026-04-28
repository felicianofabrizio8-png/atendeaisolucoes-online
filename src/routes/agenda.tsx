import { createFileRoute, Link } from "@tanstack/react-router";

export const Route = createFileRoute("/agenda")({
  component: AgendaPage,
});

function AgendaPage() {
  return <Soon title="Agenda de visitas" desc="Agendamentos de clientes (em construção)." />;
}

function Soon({ title, desc }: { title: string; desc: string }) {
  return (
    <div className="flex-1 p-4 md:p-8">
      <h1 className="text-xl md:text-2xl font-semibold">{title}</h1>
      <p className="mt-2 text-sm text-muted-foreground">{desc}</p>
      <Link to="/inbox" className="mt-6 inline-block text-sm text-primary hover:underline">
        ← Voltar para a caixa de atendimento
      </Link>
    </div>
  );
}
