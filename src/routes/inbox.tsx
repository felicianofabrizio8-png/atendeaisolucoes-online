import { createFileRoute, Link, Outlet } from "@tanstack/react-router";

export const Route = createFileRoute("/inbox")({
  component: () => <Outlet />,
  notFoundComponent: () => (
    <div className="flex-1 p-8">
      <p>Conversa não encontrada.</p>
      <Link to="/inbox" className="text-primary hover:underline">Voltar à caixa</Link>
    </div>
  ),
});
