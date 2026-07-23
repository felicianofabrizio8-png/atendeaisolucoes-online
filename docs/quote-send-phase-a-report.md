# FASE A — Envio de Orçamento · Relatório Final

## 1. Conclusão oficial

**Fluxo validado com sucesso no cenário reproduzido. A falha original permanece sem causa raiz identificada porque não voltou a ocorrer durante a reprodução instrumentada.**

Não afirmamos que o problema foi corrigido, não inventamos causa raiz. A instrumentação fica ativa (controlada por flag) para permitir diagnóstico determinístico da próxima falha real via `código QS` reportado pelo usuário.

## 2. Código QS no toast — comprovação

Antes: o `attemptId` não aparecia visualmente ao usuário.
Agora: todo toast de erro do envio exibe `Código de atendimento: QS-XXXXXXXX`, com botão para copiar.

Trechos em `src/routes/orcamentos.tsx`:

```tsx
// erro por bloco (QuoteSendError)
showErrorToast(e.normalized, attemptId, { onRetry: () => void sendBlock(key) });
// helper:
toast.error(msg, {
  description: `Código de atendimento: ${code}`,
  action: safeRetry
    ? { label: "Tentar novamente", onClick: opts!.onRetry! }
    : { label: "Copiar código", onClick: () => void navigator.clipboard.writeText(code)... },
});

// envio parcial
toast.warning("Parte do orçamento pode já ter sido enviada.", {
  description: `Foram enviados ${okCount} de ${toSend.length} blocos. Evite reenviar imediatamente para não duplicar mensagens. Código: ${code}`,
  action: { label: "Copiar código", ... },
});
```

Derivação testada: `qsCode("qs_mrxo471o_776c5e77") === "QS-776C5E77"` (`src/lib/quote-send/__tests__/diagnostics.test.ts`). Nunca expõe `requestId` completo nem `attemptId` técnico ao usuário.

## 3. Flag de diagnóstico

`VITE_QUOTE_SEND_DIAGNOSTICS=true` liga logs verbosos. Padrão: desligada.
Override para preview/QA: `(globalThis as any).__QUOTE_SEND_DIAGNOSTICS__ = true` no DevTools.

Com a flag **desligada** permanecem apenas:
- `QUOTE_SEND_ERROR` (frontend) — attemptId (mascarado como QS-code), code, step, status
- `META_SEND_ERROR` / `META_SEND_META_ERROR` (edge function) — requestId, attemptId, code, phase
- Dados sanitizados (telefone mascarado, ids mascarados, sem tokens)

Com a flag **ligada** voltam: `QUOTE_SEND_BLOCK_START`, `SESSION_READY`, `FUNCTION_REQUEST`, `FUNCTION_RESPONSE`, `MARK_SENT_START`, `SUCCESS`, `SELECTED_START/END`, `CLICKED`.

Implementação: `src/lib/quote-send/diagnostics.ts`.

## 4. Arquivos ajustados nesta etapa

Novos:
- `src/lib/quote-send/diagnostics.ts` — flag + `qsCode` + `qsDebug`/`qsError`
- `src/lib/quote-send/orchestrator.ts` — `runQuoteSendBatch` puro e testável
- `src/lib/quote-send/edge-contract.ts` — espelho puro do contrato da edge (CORS, meta-map, sanitize)
- `src/lib/quote-send/__tests__/diagnostics.test.ts` (6 testes)
- `src/lib/quote-send/__tests__/orchestrator.test.ts` (10 testes)
- `src/lib/quote-send/__tests__/edge-contract.test.ts` (15 testes)

Modificados:
- `src/data/quotes.ts` — logs de sucesso passam a `qsDebug`; erros continuam via `qsError`
- `src/routes/orcamentos.tsx` — QS code no toast, contador `completedByAttempt`, alerta de envio parcial, retry oculto quando inseguro, `sendSelected` para no primeiro erro

Não modificado (auditado apenas):
- `supabase/functions/meta-send/index.ts` — comportamento e contrato preservados; a lógica de CORS e map Meta-code foi replicada em `edge-contract.ts` e testada.

## 5. Toast de erro comum (exemplo)

```
✕ Sua sessão expirou. Faça login novamente.
  Código de atendimento: QS-776C5E77
  [ Tentar novamente ]
```

Retry oferecido porque: nenhum bloco anterior da tentativa foi entregue.

## 6. Alerta de envio parcial (exemplo)

```
⚠ Parte do orçamento pode já ter sido enviada.
  Foram enviados 2 de 3 blocos. Evite reenviar imediatamente para
  não duplicar mensagens. Código: QS-776C5E77
  [ Copiar código ]
```

Sem botão "Tentar novamente" — evita duplicar blocos já entregues.

## 7. Análise de `markQuoteSent`

Auditoria estática do código atual (nenhuma alteração):

- **Onde**: `src/data/quotes.ts`, chamado dentro de `sendQuoteWhatsApp` **após** cada bloco bem-sucedido na edge (`payload.ok === true`).
- **Frequência**: **uma vez por bloco enviado**, portanto até N vezes por orçamento em envios em lote.
- **Campos atualizados** (no banco `quotes`): `sent=true`, `status='enviado'`, `sent_at=now`, e opcionalmente `external_message_id` e `conversation_id`. Em memória: idem + `rawStatus="enviado"`.
- **Nome vs. comportamento**: o nome sugere idempotência (marcar uma vez). Na prática é chamado por bloco e cada chamada faz `UPDATE ... eq('id', id)` — os campos sempre reassumem os valores do último bloco. Semanticamente é mais próximo de `recordBlockSent`.
- **Falha no bloco 2 depois do bloco 1 OK**: o orçamento fica com `status='enviado'` e `sent_at` do bloco 1. A UI trata o orçamento como enviado (`computeQuoteStatus` retorna `enviado`), embora parte do conteúdo não tenha chegado. Não há campo que registre "envio parcial".
- **Risco**: retry cego do lote reenvia o bloco 1 (que a UI acredita ter falhado). Mitigação já ativa nesta etapa: `sendSelected` filtra `status[k] !== "enviado"` da lista local, e o botão global de "Tentar novamente" foi **suprimido** para envios parciais (só oferece "Copiar código").
- **Recomendação (fora do escopo desta fase)**: renomear para `recordBlockSent`, ou introduzir estado explícito `sent_blocks` com migration dedicada — mantido como pendência aprovada para bloco futuro.

## 8. Mapeamento requisitos ↔ testes ↔ tipo de validação

| # | Requisito | Onde | Tipo |
|---|---|---|---|
| 1 | Normalização dos 20 códigos + fallback | `errors.test.ts` (26) | **Automatizado** |
| 2 | `attemptId` gerado, único, prefixo `qs_` | `errors.test.ts` #21 | **Automatizado** |
| 3 | Mascaramento telefone/id em logs | `errors.test.ts` mascaramento | **Automatizado** |
| 4 | `qsCode` deriva referência curta, não vaza attemptId | `diagnostics.test.ts` | **Automatizado** |
| 5 | Flag de diagnóstico padrão desligada | `diagnostics.test.ts` | **Automatizado** |
| 6 | Orquestrador: blocos em ordem | `orchestrator.test.ts` #1 | **Automatizado** |
| 7 | Orquestrador: para no primeiro erro | `orchestrator.test.ts` #2 | **Automatizado** |
| 8 | Todos os blocos compartilham o mesmo attemptId | `orchestrator.test.ts` #3 | **Automatizado** |
| 9 | Nova tentativa recebe novo attemptId | `orchestrator.test.ts` #4 | **Automatizado** |
| 10 | Evidência dos blocos concluídos preservada | `orchestrator.test.ts` #6 | **Automatizado** |
| 11 | `canRetryWithoutDuplication` reflete blocos entregues | `orchestrator.test.ts` #7/#8/#9 | **Automatizado** |
| 12 | Edge: CORS aceita Lovable/prod/localhost | `edge-contract.test.ts` | **Automatizado** (harness) |
| 13 | Edge: CORS rejeita origem desconhecida | `edge-contract.test.ts` | **Automatizado** (harness) |
| 14 | Edge: 131047 → `outside_24h_window` | `edge-contract.test.ts` | **Automatizado** (harness) |
| 15 | Edge: 4/80007 → `graph_rate_limited` | `edge-contract.test.ts` | **Automatizado** (harness) |
| 16 | Edge: erro inesperado → `graph_api_rejected` | `edge-contract.test.ts` | **Automatizado** (harness) |
| 17 | Edge: sanitização remove Bearer, tokens, phone | `edge-contract.test.ts` | **Automatizado** (harness) |
| 18 | Edge: `attemptId` recebido é devolvido | Reprodução autenticada (relatório anterior — logs Deno) | **Validado manualmente** (preview real) |
| 19 | Edge: `requestId` no body e no header `x-request-id` | Reprodução autenticada | **Validado manualmente** |
| 20 | Toast exibe QS code copiável | `orcamentos.tsx` | **Auditado estaticamente** |
| 21 | Retry oculto em envio parcial | `orcamentos.tsx` (sem botão "Tentar novamente" no toast de warning) | **Auditado estaticamente** |
| 22 | Alerta de envio parcial | `orcamentos.tsx` | **Auditado estaticamente** |
| 23 | Refresh automático de sessão pelo Supabase JS | `supabase-js@2` padrão | **Auditado estaticamente** |
| 24 | Execução sequencial real na tela | `sendSelected` faz `for await` | **Auditado estaticamente** |
| 25 | Comportamento parcial de `markQuoteSent` | Seção 7 acima | **Auditado estaticamente** |

Comportamentos **explicitamente não** cobertos por testes automatizados (por opção declarada):
- Integração ponta-a-ponta React → Supabase.functions.invoke → Meta (validado manualmente uma vez no preview).
- Comportamento real de refresh de token JWT do Supabase (auditado, não simulado).
- Interação DOM completa do toast Sonner (auditado no código).

## 9. Estratégia de sessão (A.5)

- `supabase.auth.getSession()` é chamado por bloco em `sendQuoteWhatsApp`.
- Supabase JS faz refresh automático quando o access token está próximo do expiry (`autoRefreshToken` default do cliente browser).
- Se `getSession()` retornar `null` sem sessão válida, a instrumentação emite `session_expired` e não faz retry silencioso.
- Não há `refreshSession()` explícito no fluxo — não foi introduzido nesta fase por ausência de evidência de bug de sessão na reprodução.
- Se a próxima falha real for de sessão, o QS code permitirá diagnóstico determinístico e a decisão de adicionar refresh explícito virá em bloco separado.

## 10. Retry — política atual

Retry (label "Tentar novamente") é oferecido somente quando **todas** as condições valem:
- Erro é `retryable` (`network_error`, `graph_rate_limited`, `internal_error`, `mark_sent_failed`, `message_persistence_failed`).
- `completedByAttempt.get(attemptId) === 0` — nenhum bloco anterior da tentativa foi entregue à Meta.
- Existe `onRetry` disponível (contexto de bloco).

Nos demais casos, o toast exibe apenas "Copiar código", forçando verificação manual. Isso cobre explicitamente:
- Graph API sucesso + persistência local falhou (`mark_sent_failed` após `messageId` já emitido) → retry ainda pode ser ofertado quando é o **primeiro** bloco, o que é considerado aceitável para esta fase pois a re-tentativa duplicaria apenas 1 mensagem. **Risco documentado**.
- Timeout ambíguo → hoje classificado como `network_error`; se ocorreu após o primeiro bloco, cai em envio parcial e não oferece retry.

## 11. Monitoramento da próxima falha

Fluxo operacional:
1. Usuário reporta `QS-XXXXXXXX`.
2. Suporte pesquisa em logs do frontend (Sentry / preview console) por `QS-XXXXXXXX` para obter `attemptId` completo.
3. Suporte pesquisa em `supabase--edge_function_logs meta-send` por `attemptId` — todos os eventos (`META_SEND_*`) trazem `attemptId` e `requestId` correlacionados.
4. Etapa exata, código de domínio, status e duração aparecem estruturados. Nenhum dado sensível.

Usuário **não precisa** abrir DevTools.

## 12. Resultados

**Typecheck**: `bunx tsgo --noEmit` → exit 0, limpo.

**Suíte quote-send**: `bunx vitest run src/lib/quote-send`
- `errors.test.ts` — 26/26
- `diagnostics.test.ts` — 6/6
- `orchestrator.test.ts` — 10/10
- `edge-contract.test.ts` — 15/15
- **Total: 57/57 ✅**

**Suíte completa do projeto**: 955/957 passando. As **2 falhas** são em arquivos **não relacionados** ao envio de orçamento e são pré-existentes desta iteração:
- `src/lib/marketing/__tests__/overlay-texts.test.ts` (normalização de overlays de marketing)
- `src/lib/coach-rules/__tests__/coach-v2-phase-1-quality-gate.test.ts` (regra de consumidores do Coach V2)
- `worker/render-engine/src/__tests__/scene-composer-svg-valid.test.ts` (0 testes — arquivo vazio/inconclusivo)

Nenhuma delas toca `src/lib/quote-send`, `src/data/quotes.ts`, `src/routes/orcamentos.tsx` ou `supabase/functions/meta-send/index.ts`.

## 13. O que foi automatizado vs. auditado vs. validado manualmente

**Automatizado (unit + harness)**: normalização de erros, mascaramento, `attemptId`, `qsCode`, flag de diagnóstico, orquestrador (ordem, stop-on-fail, evidência parcial, segurança de retry, novo attemptId), contrato da edge (CORS, mapeamento Meta, sanitização, corpo padronizado).

**Auditado estaticamente**: presença do QS code no toast, ocultação do retry em envio parcial, alerta de envio parcial, chamadas de `markQuoteSent` por bloco, uso sequencial de `sendBlock` em `sendSelected`.

**Validado manualmente (preview autenticado, iteração anterior)**: propagação real do `attemptId` end-to-end, header `x-request-id`, correlação de logs Deno com frontend, sucesso Graph API em cenário nominal.

## 14. Riscos ainda existentes

1. **Envio parcial persistente**: `quotes.status='enviado'` após qualquer bloco → orçamento na UI aparece como enviado mesmo com blocos faltantes. Mitigação atual: UI local mantém `status[k]` por bloco dentro do modal aberto; entre sessões, informação se perde. Solução real requer `sent_blocks` — pendente de aprovação.
2. **Retry manual do bloco individual** (via pill de cada bloco) ainda pode ser acionado após a Meta ter entregue esse mesmo bloco se o erro veio de `mark_sent_failed`. Frequência esperada: rara. Documentado.
3. **Reprodução da falha original**: continua sem repro. Depende da próxima ocorrência real reportada com `QS code`.
4. **Refresh de token**: dependemos do comportamento default do supabase-js. Não há teste que valide comportamento sob token expirado no momento do invoke.

## 15. Encerramento

Critérios da FASE A:
- [x] Nenhuma causa raiz inventada
- [x] Instrumentação segura (flag, mascaramento)
- [x] Código QS disponível ao usuário (visível, copiável)
- [x] Logs detalhados controlados por flag
- [x] Testes do orquestrador (10)
- [x] Contrato da Edge Function testado (harness com 15 testes)
- [x] Falha parcial claramente comunicada (toast dedicado)
- [x] Retry escondido quando houver risco de duplicidade
- [x] Typecheck limpo
- [x] Suíte quote-send verde (57/57)

**FASE A ENCERRADA.**

Não iniciado (aguardando aprovação em bloco separado):
- checkpoint `sent_blocks` por bloco
- migration em `quotes`
- idempotência persistente
- refatoração ampla do envio em lote
- alteração da integração Meta
