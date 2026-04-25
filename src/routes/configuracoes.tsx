import { createFileRoute, Link } from "@tanstack/react-router";

export const Route = createFileRoute("/configuracoes")({
  component: () => (
    <div className="flex-1 p-8">
      <h1 className="text-2xl font-semibold">Configurações</h1>
      <p className="mt-2 text-muted-foreground">SLA, integrações (WhatsApp, Instagram, Facebook), motivos de perda.</p>
      <Link to="/inbox" className="mt-6 inline-block text-sm text-primary hover:underline">
        ← Voltar
      </Link>
    </div>
  ),
});
