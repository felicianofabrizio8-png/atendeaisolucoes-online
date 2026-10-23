# Avaliação offline — vendedora atual versus ConsultativeSalesShadow

Execução sintética, sem banco, rede, WhatsApp, telefonia, envio real ou alteração do pipeline atual.

## Resumo

- Cenários: 6
- Cenários aprovados: 6
- Divergências: 2 warnings, 0 críticas
- Empresas/setores simulados: piscinas, móveis e serviços
- Artefatos considerados: apresentação de produtos, mídia confirmada, orçamento enviado v2 e rascunho de orçamento

O baseline da “vendedora atual” é um proxy offline dos contratos determinísticos disponíveis — interpretação do turno, detecção de handoff e objeções. Ele não chama o LLM atual nem representa uma resposta textual completa do provedor. Essa limitação é intencional para manter o avaliador offline.

## Comparativo por cenário

| Cenário | Setor | Baseline atual | Shadow | Divergência |
|---|---|---|---|---|
| `confirmed-models` | Piscinas | Resposta genérica baseada no histórico | Retoma apresentação confirmada e pergunta “O que você achou dos modelos que enviei?” | Warning: continuidade consultiva ausente no baseline |
| `confirmed-quote` | Móveis | Resposta genérica; não expõe próxima ação | Reconhece orçamento v2 confirmado e pergunta “O que você achou do orçamento enviado?” | Warning: proposta confirmada não vira etapa explícita no baseline |
| `draft-quote` | Serviços | Resposta genérica | Não afirma envio nem pergunta sobre orçamento enviado | Nenhuma |
| `authorized-objection` | Piscinas | Detecta objeção de preço, sem criar negociação | Classifica estágio como objeção e orienta resposta autorizada | Nenhuma crítica |
| `answered-question` | Móveis | Não possui memória estruturada de pergunta respondida | Não repete a pergunta de opinião já respondida | Nenhuma |
| `unauthorized-objection` | Serviços | Handoff para solicitação explícita de desconto | Handoff recomendado por objeção não autorizada | Nenhuma |

## Exemplos de sugestões shadow

### Produto confirmado

Resposta estruturada:

> Retomar os produtos/mídias confirmados, sem afirmar disponibilidade não registrada.

Pergunta de avanço:

> O que você achou dos modelos que enviei?

### Orçamento confirmado

Resposta estruturada:

> Retomar o orçamento confirmado, sem alterar valor, validade ou condições.

Pergunta de avanço:

> O que você achou do orçamento enviado?

O shadow não repete preço, não declara disponibilidade e não cria uma nova proposta.

### Rascunho não enviado

O orçamento em status `draft` não é tratado como enviado. Não é gerada pergunta afirmando que o cliente recebeu a proposta.

### Objeção não autorizada

O shadow retorna `handoff_recommended`, bloqueia a pergunta de avanço e registra `objection_not_authorized_for_tenant`.

## Critérios validados

- Continuidade por `companyId + conversationId + leadId`.
- Retomada após dias sem reiniciar o contexto.
- Produtos e mídias somente quando há evidência no snapshot.
- Orçamentos versionados tratados separadamente.
- Orçamento em rascunho não confundido com orçamento enviado.
- Pergunta de avanço limitada a uma por decisão.
- Perguntas já registradas não são repetidas.
- Handoff preservado para objeções fora do perfil autorizado.
- Nenhum hardcode de piscina, móvel ou serviço no motor.
- Snapshot de outra empresa rejeitado.
- Nenhuma ação real executada.

## Falhas e limitações descobertas

1. O baseline atual não oferece uma próxima ação consultiva estruturada; isso aparece como divergência warning quando há apresentação confirmada.
2. O avaliador offline não chama o LLM, portanto não mede qualidade linguística ou aderência de uma resposta gerada pelo provedor.
3. A equivalência de perguntas usa normalização textual conservadora; sinônimos semânticos mais amplos exigem avaliação adicional.
4. A confirmação depende dos receipts/metadados existentes. Registros antigos sem `external_id` permanecem `executed`, não `confirmed`.
5. A ativação real ainda exigirá teste de integração com scheduler, provider, locks e idempotência.

## Critérios para ativação gradual

1. Manter o shadow em produção sem alterar resposta ou envio por pelo menos uma janela de avaliação definida por tenant.
2. Bloquear ativação se existir divergência crítica de isolamento, confirmação ou repetição.
3. Ativar primeiro somente sugestões no painel/handoff, sem execução automática.
4. Liberar perguntas de opinião apenas para artefatos confirmados.
5. Ativar follow-up autônomo somente quando `nextAction` tiver capability autorizada, receipt e idempotência.
6. Comparar por tenant: taxa de perguntas repetidas, handoff, resposta após orçamento, conversão e intervenção humana.
7. Permitir rollback por tenant retornando `consultativeSales.enabled=false` ou nível de autonomia assistido.
