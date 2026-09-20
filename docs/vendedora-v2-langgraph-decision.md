# Decisão sobre LangGraph.js na Vendedora 2.0

## Status

Decisão concluída: LangGraph.js não será adotado nesta etapa.

## Contexto

A Vendedora 2.0 possui um pipeline explícito centralizado no contrato `runAgentTurn`, com interpretação, estado persistente, catálogo validado, ferramentas comerciais, modos de execução, aprovação humana e auditoria.

A Fase 5 avaliou se LangGraph.js acrescentaria checkpointing, retries ou observabilidade que o pipeline atual não oferece com menor complexidade.

## Avaliação

### Estado e continuidade

O estado comercial da conversa já é persistido e recuperado pelo pipeline atual. A continuidade usa dados sanitizados, catálogo validado e isolamento por `company_id`.

### Observabilidade

Decisões, bloqueios, ferramentas, modos, falhas, latência e disponibilidade de tokens já possuem auditoria persistente e consulta somente leitura.

### Execução segura

Os modos `silent`, `assisted` e `automatic` possuem autorização explícita. Handoff humano continua dominante, e o modo assisted exige aprovação antes de qualquer envio.

### Retentativas

O envio de mensagens não possui retry automático por decisão de segurança. Uma falha é registrada como ação não entregue, sem fabricar `external_id`, sem contar como envio real e sem repetir uma mensagem potencialmente já processada pelo provedor.

Adicionar retry genérico por meio de um grafo aumentaria o risco de duplicidade. Qualquer retry futuro deve nascer com chave de idempotência, confirmação do provedor e política específica por tipo de ação.

### Complexidade

Adotar LangGraph.js agora adicionaria dependência, abstrações e manutenção sem substituir uma deficiência comprovada do pipeline atual.

## Decisão

Manter o pipeline explícito atual.

O contrato `runAgentTurn` permanece como fronteira principal. Nenhuma dependência de LangGraph.js ou LangChain será adicionada.

## Quando reavaliar

A decisão deve ser revista se surgir pelo menos uma destas necessidades:

1. fluxos longos que precisem continuar após interrupção do processo;
2. checkpoints com retomada exata entre várias etapas externas;
3. múltiplos agentes ou ferramentas com ramificações difíceis de manter;
4. retries por etapa acompanhados de idempotência comprovada;
5. necessidade de inspeção visual do grafo que a auditoria atual não consiga atender.

Se LangGraph.js for adotado no futuro, deverá permanecer encapsulado atrás do contrato `runAgentTurn`, sem alterar os consumidores atuais.