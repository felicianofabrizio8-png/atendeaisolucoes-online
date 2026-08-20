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
        <h1 className="text-4xl font-bold tracking-tight sm:text-6xl text-left">
          Existe ainda um problema funcional na Inbox do Atende Aí:
        </h1>
        <div className="text-left text-muted-foreground space-y-4">
          <p className="text-xl font-bold text-foreground">
            ALGUMAS CONVERSAS QUE DEVERIAM APARECER NA INBOX NÃO ESTÃO SENDO EXIBIDAS.
          </p>
          <p>
            As correções anteriores de duplicação e normalização de telefone já foram implementadas.
          </p>
          <p>
            Agora quero que você encontre TODAS as conversas existentes que deveriam estar visíveis na Inbox, mas não estão aparecendo, determine a causa e corrija o problema sem perda de histórico.
          </p>

          <h2 className="text-xl font-semibold text-foreground mt-6">ETAPA 1 — NÃO CORRIJA IMEDIATAMENTE</h2>
          <p>Primeiro faça uma reconciliação entre:</p>
          <p className="font-bold">BANCO DE DADOS versus CONVERSAS CARREGADAS/EXIBIDAS NA INBOX.</p>
          <p>Quero identificar objetivamente quais registros estão faltando.</p>
          <p>Considere principalmente conversas com mensagens existentes.</p>
          <p>Para cada conversa ausente, levante: conversation_id; lead_id; nome do cliente; telefone; external_id / wa_id; company_id; channel; status; assigned_to/responsável; created_at; updated_at; last_message_at; quantidade de mensagens; data/hora da última mensagem; motivo pelo qual não está aparecendo.</p>

          <h2 className="text-xl font-semibold text-foreground mt-6">ETAPA 2 — PROCURAR CONVERSAS ÓRFÃS OU FRAGMENTADAS</h2>
          <p>Procure especificamente por: mensagens existentes cujo conversation_id aponta para uma conversa que não aparece; conversas válidas que não estão entrando no leadRepo; conversas sem lead válido; leads com mensagens mas sem conversa visível; conversas antigas associadas a leads duplicados; leads históricos com telefone sem 55; leads equivalentes com telefone normalizado; conversas que ficaram no lead antigo após a normalização; mensagens divididas entre dois leads equivalentes; conversas cujo status foi alterado incorretamente; conversas arquivadas/fechadas sem intenção; conversas removidas por algum filtro; conversas sem last_message_at válido; registros que existem no banco mas são descartados no frontend.</p>

          <h2 className="text-xl font-semibold text-foreground mt-6">ETAPA 3 — AUDITAR A QUERY REAL DA INBOX</h2>
          <p>Localize exatamente como a Inbox decide quais conversas carregar. Analise: query inicial; filtros; company_id; channel; status; assigned_to; paginação; LIMIT; ORDER BY; last_message_at; joins; RLS; subscriptions Realtime; leadRepo; useSyncExternalStore; qualquer deduplicação frontend.</p>

          <h2 className="text-xl font-semibold text-foreground mt-6">ETAPA 4 — COMPARAÇÃO AUTOMÁTICA</h2>
          <p>Faça uma consulta somente leitura no banco obtendo as conversas que possuem mensagens. Depois compare esse conjunto com o conjunto efetivamente retornado/carregado pela Inbox.</p>
          <p className="font-bold">BANCO: X conversas relevantes | INBOX: Y conversas carregadas | AUSENTES: Z conversas</p>

          <h2 className="text-xl font-semibold text-foreground mt-6">ETAPA 5 — VERIFICAR IMPACTO DAS CORREÇÕES ANTERIORES</h2>
          <p>Audite se as alterações anteriores de: UNIQUE constraints; upsert; consolidação de duplicatas; normalizePhone; busca de contingência; confirmedTextKey; deixaram registros históricos que agora não correspondem à estrutura esperada pela Inbox.</p>

          <h2 className="text-xl font-semibold text-foreground mt-6">ETAPA 6 — CORREÇÃO</h2>
          <p>Depois de identificar a causa raiz, implemente a menor correção segura necessária. Pode corrigir código quando comprovadamente necessário. Se existirem registros históricos fragmentados, consolide SOMENTE quando houver correspondência determinística e segura entre os registros.</p>

          <h2 className="text-xl font-semibold text-foreground mt-6">ETAPA 7 — VERIFICAR CONVERSAS RECENTES</h2>
          <p>Dê atenção especial às conversas recentes. Procure clientes que enviaram mensagens e cujo evento foi recebido pelo sistema, mas cuja conversa não aparece atualmente na Inbox.</p>

          <h2 className="text-xl font-semibold text-foreground mt-6">ETAPA 8 — TESTE APÓS CORREÇÃO</h2>
          <p>Depois da correção: carregue a Inbox; compare novamente banco e Inbox; confirme que as conversas anteriormente ausentes agora aparecem; confirme que não foram criadas duplicatas; confirme que mensagens antigas continuam no histórico; confirme que uma nova mensagem entra na conversa correta; confirme que atualizar a página não faz a conversa desaparecer novamente.</p>

          <h2 className="text-xl font-semibold text-foreground mt-6 underline">RELATÓRIO OBRIGATÓRIO</h2>
          <p>Ao terminar, informe: conversas relevantes no banco; conversas aparecendo antes; conversas ausentes; causa encontrada; arquivos modificados; registros alterados; históricos reconciliados; conversas finais; confirmação de integridade de mensagens.</p>
        </div>
      </div>
    </div>
  );
}