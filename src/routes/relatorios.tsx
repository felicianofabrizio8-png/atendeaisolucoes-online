import { createFileRoute, Link } from "@tanstack/react-router";

export const Route = createFileRoute("/relatorios")({
  component: () => (
    <div className="flex-1 p-8">
      <h1 className="text-2xl font-semibold">Relatórios</h1>
      <p className="mt-2 text-muted-foreground">Tempo de resposta, conversão, vendas, motivos de perda.</p>
      <Link to="/inbox" className="mt-6 inline-block text-sm text-primary hover:underline">
        ← Voltar
      </Link>
    </div>
  ),
});
