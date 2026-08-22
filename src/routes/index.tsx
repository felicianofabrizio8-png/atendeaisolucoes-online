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
      <div className="max-w-2xl w-full space-y-8 text-center whitespace-pre-wrap">
        Desfaça apenas a última alteração visual que colocou meu texto no Dashboard. Não altere mais nada.
      </div>
    </div>
  );
}