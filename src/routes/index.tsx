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
        Preciso aplicar uma migration no banco atual do Atende Aí.

Confirme:

1. se este projeto usa o Supabase ref ubnlvxkjemzhvmulowhj;

2. se o backend é Lovable Cloud ou Supabase integrado;

3. se existem ambientes Test e Live;

4. qual é a forma segura de executar uma migration SQL neste projeto.

Não altere nem aplique nada ainda.
      </div>
    </div>
  );
}