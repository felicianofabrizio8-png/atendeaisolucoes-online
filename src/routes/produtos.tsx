import { createFileRoute, Link } from "@tanstack/react-router";

export const Route = createFileRoute("/produtos")({
  component: () => (
    <div className="flex-1 p-8">
      <h1 className="text-2xl font-semibold">Catálogo de produtos</h1>
      <p className="mt-2 text-muted-foreground">Categorias, preços e tabela mensal ativa.</p>
      <Link to="/inbox" className="mt-6 inline-block text-sm text-primary hover:underline">
        ← Voltar
      </Link>
    </div>
  ),
});
