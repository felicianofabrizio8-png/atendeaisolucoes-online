import { createFileRoute, Link } from "@tanstack/react-router";

export const Route = createFileRoute("/orcamentos")({
  component: () => (
    <div className="flex-1 p-8">
      <h1 className="text-2xl font-semibold">Orçamentos</h1>
      <p className="mt-2 text-muted-foreground">Crie orçamentos com produto, valor, desconto, parcelas e validade.</p>
      <Link to="/inbox" className="mt-6 inline-block text-sm text-primary hover:underline">
        ← Voltar
      </Link>
    </div>
  ),
});
