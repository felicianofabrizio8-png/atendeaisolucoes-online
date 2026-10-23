# Política pura de permissões da Bruna

`src/lib/bruna-permission-policy.ts` é uma resolução somente em memória. Ela
compõe `sales-agent-mode.ts` e `ai-reply-control.ts`, sem alterar agente,
senders, rotas, migrations, banco ou produção.

## Precedência preservada

| Situação                                             | Decisão atual                                                                            |
| ---------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| `sales_agent_master_enabled = false`                 | bloqueia a resposta da Bruna; o modo V2 não é chamado                                    |
| V2 `automatic`                                       | resposta automática permitida, salvo takeover                                            |
| V2 `assisted`                                        | bloqueada até `sales_agent_auto_reply = true`                                            |
| V2 `silent`                                          | nunca envia resposta                                                                     |
| V2 ausente/desligado                                 | usa `ai_auto_reply_enabled` legado                                                       |
| takeover (`ai_status` humano ou `human_takeover_at`) | bloqueia efeitos automáticos                                                             |
| follow-up                                            | permanece no gate legado; só a trava de takeover é refletida                             |
| handoff                                              | é permitido como decisão enquanto não houver takeover; envio/efeito fica para o chamador |

## Divergências deliberadamente não resolvidas

Quando flags expressam intenções diferentes, a política expõe
`divergences` para observabilidade e não inventa uma nova semântica:

- mestre desligado + legado ligado: o mestre continua vencendo para Bruna;
- `silent` + auto reply da conversa ligado: `silent` continua vencendo;
- modo V2 ativo + flag legada: a flag legada é ignorada, conforme o contrato V2;
- qualquer integração futura de follow-up com modo/mestre ainda está bloqueada:
  o comportamento atual do follow-up não deve ser alterado implicitamente.

Esses pontos têm testes de divergência e permanecem como decisões de integração
futura, sem alterar os chamadores existentes.
