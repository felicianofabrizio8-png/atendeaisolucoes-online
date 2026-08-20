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
        <h1 className="text-4xl font-bold tracking-tight sm:text-6xl">
          Implemente uma correção definitiva para a inconsistência de identidade de clientes causada por números de telefone armazenados em formatos diferentes.
        </h1>
        <div className="text-left text-muted-foreground space-y-4">
          <p>A auditoria confirmou que números como:</p>
          <p className="font-mono bg-muted p-2 rounded">15988002521 e 5515988002521</p>
          <p>estão sendo tratados como clientes diferentes, apesar de representarem a mesma pessoa.</p>
          
          <h2 className="text-xl font-semibold text-foreground mt-6">OBJETIVO</h2>
          <p>Garantir que todo telefone usado para identificar leads e conversas seja normalizado para um formato canônico antes de: criar lead, procurar lead, executar upsert, criar conversa, procurar conversa, comparar contatos, atualizar cache local.</p>

          <h2 className="text-xl font-semibold text-foreground mt-6">PADRÃO CANÔNICO</h2>
          <p>Para WhatsApp no Brasil, normalize os números para formato E.164 sem caracteres especiais. Exemplo: (15) 98800-2521, 15988002521, +55 15 98800-2521, 5515988002521 devem convergir para: 5515988002521.</p>

          <h2 className="text-xl font-semibold text-foreground mt-6">IMPLEMENTAÇÃO</h2>
          <ul className="list-disc ml-6 space-y-2">
            <li>Crie uma função central reutilizável de normalização de telefone.</li>
            <li>No webhook WhatsApp, normalize waId/phone antes de lookups/upserts.</li>
            <li>Aplique a mesma normalização em todos os pontos de criação manual de leads.</li>
            <li>Implemente busca de contingência para localizar registros antigos equivalentes.</li>
          </ul>

          <h2 className="text-xl font-semibold text-foreground mt-6">RELATÓRIO FINAL</h2>
          <p>Informe a função criada, arquivos modificados, pontos de aplicação e resultado dos testes.</p>
          <p className="font-bold text-foreground">NÃO execute merge automático em massa nem delete dados nesta etapa.</p>
        </div>
      </div>
    </div>
  );
}