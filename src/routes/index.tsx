import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/")({
  component: Index,
  head: () => ({
    title: "Atende Aí | Inbox Inteligente",
    meta: [
      {
        name: "description",
        content: "Gerencie suas conversas de WhatsApp e redes sociais em um único lugar.",
      },
    ],
  }),
});

function Index() {
  return (
    <div className="min-h-screen bg-background flex flex-col items-center justify-center p-4">
      <div className="max-w-2xl w-full space-y-8 text-center">
        <h1 className="text-4xl font-bold tracking-tight sm:text-6xl">
          ATENÇÃO: ISTO NÃO É UMA SOLICITAÇÃO DE ALTERAÇÃO, SUBSTITUIÇÃO OU EDIÇÃO DE TEXTO.
        </h1>
        <p className="text-xl text-muted-foreground">
          Existe um BUG FUNCIONAL na Inbox do WhatsApp do Atende Aí...
        </p>
      </div>
    </div>
  );
}