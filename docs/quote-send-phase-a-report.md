# FASE A — Envio de Orçamento · Relatório Final (revisado)

## 1. Status oficial

> **FASE A concluída no escopo de instrumentação, observabilidade, testes e segurança do retry. O fluxo funcionou no cenário reproduzido. A falha original não foi reproduzida e permanece sem causa raiz identificada. A próxima ocorrência poderá ser investigada por meio do código de atendimento QS.**

Explicitamente **não** afirmamos:

- envio definitivamente corrigido;
- causa raiz resolvida;
- erro eliminado;
- falha causada pelo BLOCO 4;
- problema de sessão confirmado.

---

## 2. Arquivos alterados nesta fase

**Total: 8 arquivos** (5 criados + 3 editados).

### Criados (5)

| Arquivo | Finalidade |
|---|---|
| `src/lib/quote-send/diagnostics.ts` | Flag de diagnóstico (`VITE_QUOTE_SEND_DIAGNOSTICS`), helpers `qsDebug`/`qsError` e derivação do código `qsCode(attemptId)`. |
| `src/lib/quote-send/orchestrator.ts` | `runQuoteSendBatch` — orquestrador puro (ordem, stop-on-fail, memória de blocos concluídos, `canRetryWithoutDuplication`). |
| `src/lib/quote-send/edge-contract.ts` | Espelho puro e testável do contrato da Edge Function `meta-send` (CORS, mapeamento Meta→código de domínio, sanitização). |
| `src/lib/quote-send/__tests__/diagnostics.test.ts` | 6 testes: flag padrão desligada, override, derivação de `QS-XXXXXXXX`, mascaramento. |
| `src/lib/quote-send/__tests__/orchestrator.test.ts` | 10 testes: ordem, stop-on-fail, attemptId único por tentativa, evidência parcial, `canRetryWithoutDuplication`. |
| `src/lib/quote-send/__tests__/edge-contract.test.ts` | 15 testes: CORS aceita/rejeita, mapeamento 131047 → `outside_24h_window`, 4/80007 → `graph_rate_limited`, sanitização. |

> Observação: o item “5 criados” conta módulos + suítes juntos como 6 arquivos. A revisão desta seção contra o disco (`ls src/lib/quote-send/`) confirma **3 módulos + 3 suítes = 6 criados**, mais 2 edições, totalizando **8**. A afirmação anterior de “6 modificados” estava incorreta e foi substituída.

**Correção contábil:** 3 novos módulos + 3 novas suítes + 2 arquivos editados = **8 arquivos tocados**.

### Editados (2)

| Arquivo | Finalidade da mudança |
|---|---|
| `src/data/quotes.ts` | Erros usam `qsError`; sucessos passaram para `qsDebug` (silencioso sem a flag). Contrato `QuoteSendError` mantido. |
| `src/routes/orcamentos.tsx` | Toast passa a exibir `Código de atendimento: QS-XXXXXXXX`, alerta dedicado para envio parcial, retry suprimido quando inseguro, `sendSelected` para no primeiro erro. |

### Não modificados nesta fase (auditados apenas)

- `supabase/functions/meta-send/index.ts` — contrato e comportamento preservados; a lógica de CORS e o mapeamento de erros da Meta foram **replicados** em `edge-contract.ts` e cobertos por testes lá.

---

## 3. Quality gates — resultados separados

### 3.1 Quality gate do módulo (`quote-send`) — **APROVADO**

- `bunx vitest run src/lib/quote-send` → **57/57 verdes**
  - `errors.test.ts` — 26/26
  - `diagnostics.test.ts` — 6/6
  - `orchestrator.test.ts` — 10/10
  - `edge-contract.test.ts` — 15/15
- `bunx tsgo --noEmit` → **exit 0, limpo**

### 3.2 Quality gate global do repositório — **NÃO TOTALMENTE VERDE**

- Comando executado: `bunx vitest run`
- Resultado: **955/957 passando, 2 falhas**
- Não bloqueia o encerramento desta fase — mas permanece registrado como **dívida técnica visível**, não como “tudo verde”.

#### Falhas externas (fora do escopo desta fase)

| # | Arquivo de teste | Nome do teste | Mensagem de falha (resumo) | Baseline / preexistência | Comprovação de não-alteração |
|---|---|---|---|---|---|
| 1 | `src/lib/marketing/__tests__/overlay-texts.test.ts` | normalização de overlays de marketing | assertion sobre string normalizada de overlay | Sem baseline automatizado registrado nesta iteração | `src/lib/marketing/**` não aparece em nenhum arquivo editado por esta fase (ver seção 2) |
| 2 | `src/lib/coach-rules/__tests__/coach-v2-phase-1-quality-gate.test.ts` | regra de consumidores do Coach V2 | assertion sobre lista de consumidores esperados | Sem baseline automatizado registrado nesta iteração | `src/lib/coach-rules/**` não aparece em nenhum arquivo editado por esta fase |

Adicionalmente: `worker/render-engine/src/__tests__/scene-composer-svg-valid.test.ts` é reportado como arquivo com 0 testes (inconclusivo); também fora do escopo.

**Classificação honesta:** Falhas fora do escopo e não relacionadas aos arquivos modificados nesta fase; **preexistência não comprovada por baseline automatizado**. Ficam como dívida técnica a ser tratada em bloco separado.

---

## 4. Flag de diagnóstico

- **Nome:** `VITE_QUOTE_SEND_DIAGNOSTICS`
- **Valor padrão:** desligada (qualquer valor diferente de `"true"` é tratado como desligado).
- **Como ativar em preview / desenvolvimento:** setar `VITE_QUOTE_SEND_DIAGNOSTICS=true` no `.env` local antes do `bun dev`.
- **Como ativar temporariamente (preview/produção) sem redeploy:** no DevTools do usuário/operador, executar
  ```js
  globalThis.__QUOTE_SEND_DIAGNOSTICS__ = true
  ```
  A leitura é feita uma vez e cacheada (`isDiagnosticsEnabled()`); recarregue a página se o cache já foi lido.
- **Comportamento com a flag DESLIGADA (padrão em produção):**
  - Silencia: `QUOTE_SEND_BLOCK_START`, `SESSION_READY`, `FUNCTION_REQUEST`, `FUNCTION_RESPONSE`, `MARK_SENT_START`, `SUCCESS`, `SELECTED_START/END`, `CLICKED`.
  - Mantém sempre ativos:
    - `QUOTE_SEND_ERROR` (frontend) — `attemptId`, code, step, status;
    - `META_SEND_ERROR` / `META_SEND_META_ERROR` (edge function) — `requestId`, `attemptId`, code, phase;
    - Todos os dados sanitizados (telefone mascarado, ids mascarados, sem tokens/Bearer).
- **Comportamento com a flag LIGADA:** volta o conjunto verboso acima, mantendo a mesma sanitização.
- **Confirmação explícita:** a flag **não** controla as mensagens amigáveis, o código QS no toast, o alerta de envio parcial nem a supressão de retry inseguro. Esses comportamentos são sempre ativos, independentemente da flag.

Implementação: `src/lib/quote-send/diagnostics.ts`.

---

## 5. Ciclo de vida do código QS

- **Derivação:** `qsCode(attemptId)` pega o último segmento do `attemptId` (após o último `_`), remove não-alfanuméricos, pega os últimos 8 caracteres e coloca em maiúsculas.
  - Exemplo: `qs_mrxo471o_776c5e77` → `QS-776C5E77` (testado em `diagnostics.test.ts`).
- **Formato final:** `QS-` + 8 caracteres `[A-Z0-9]`. Se o attemptId for vazio, `QS-UNKNOWN`.
- **Case-sensitivity:** o código apresentado é sempre em **maiúsculas**. A pesquisa operacional deve tratar como case-insensitive por segurança.
- **Unicidade:** ~4.3 bilhões de valores possíveis (16^8). Suficiente para pesquisa operacional dentro de uma janela razoável, **não** suficiente como identificador único global perpétuo. Um colisor não é impossível em escala anual; por isso a pesquisa combina QS com janela temporal.
- **Nova tentativa (nova execução de `sendSelected` / clique de retry manual):** gera novo `attemptId` → novo QS. Verificado em `orchestrator.test.ts` #4.
- **Retry seguro da mesma operação (`runQuoteSendBatch` com `attemptId` explícito):** preserva o attemptId → mesmo QS. Verificado em `orchestrator.test.ts` #5.
- **Como localizar o attemptId completo a partir do QS:**
  1. Pesquisar `QS-XXXXXXXX` nos logs do frontend (Sentry / preview console) → aparece o `attemptId` no evento `QUOTE_SEND_ERROR`.
  2. Com o attemptId, pesquisar em `supabase--edge_function_logs meta-send` por esse valor → traz todos os `META_SEND_*` correlacionados com `requestId`.
- **Retenção de logs:** **não está definida formalmente nesta fase.** Depende da política de retenção do provedor de logs do frontend (Sentry/console do preview) e do Supabase Edge Function logs. Portanto: **não é garantido** que qualquer QS possa sempre ser resolvido em `attemptId` — a garantia vale apenas dentro da janela de retenção real, que precisa ser confirmada e documentada em bloco separado.

---

## 6. Exemplos finais da UX

### 6.1 Erro sem envio confirmado (primeiro bloco falhou)

```
✕ Não foi possível enviar o orçamento.
  Código de atendimento: QS-776C5E77
  [ Tentar novamente ]   [ Copiar código ]  (retry aparece apenas quando seguro)
```

Retry é oferecido porque **nenhum bloco anterior foi entregue** e o erro é `retryable`.

### 6.2 Falha parcial (bloco 2 falhou depois do bloco 1 OK)

```
⚠ Parte do orçamento pode já ter sido enviada.
  Foram enviados 1 de 3 blocos.
  Evite reenviar agora para não duplicar mensagens.
  Código de atendimento: QS-776C5E77
  [ Copiar código ]   [ Fechar ]
```

**Sem** botão “Tentar novamente”. Confirmado por:
- `orchestrator.test.ts` #7 — `canRetryWithoutDuplication === false` quando há bloco entregue;
- Auditoria estática em `src/routes/orcamentos.tsx`: `toast.warning(...)` no ramo parcial só emite `action: { label: "Copiar código", ... }`, nunca “Tentar novamente”.

### 6.3 Toast de código copiável (helper)

```tsx
toast.error(msg, {
  description: `Código de atendimento: ${code}`,
  action: safeRetry
    ? { label: "Tentar novamente", onClick: opts!.onRetry! }
    : { label: "Copiar código", onClick: () => void navigator.clipboard.writeText(code) },
});
```

Nunca expõe `requestId` completo nem `attemptId` técnico ao usuário.

---

## 7. Análise consolidada de `markQuoteSent`

| Pergunta | Resposta |
|---|---|
| Em qual arquivo está? | `src/data/quotes.ts` |
| Quando é chamado? | Dentro de `sendQuoteWhatsApp`, **após** cada bloco confirmado pela edge (`payload.ok === true`) |
| Quantas vezes por lote? | **Uma vez por bloco entregue** — até N vezes por orçamento |
| Campos atualizados em `quotes` | `sent=true`, `status='enviado'`, `sent_at=now()`, opcionalmente `external_message_id`, `conversation_id`; em memória, também `rawStatus="enviado"` |
| O primeiro bloco já altera o orçamento para “enviado”? | **Sim.** Já na conclusão do bloco 1, `status='enviado'` e `sent_at` são gravados |
| Como a tela exibe o status após falha no bloco 2? | O orçamento aparece globalmente como “enviado” (`computeQuoteStatus → 'enviado'`); dentro do modal aberto, o `status[k]` local por bloco ainda mostra que o bloco 2 falhou. Entre sessões, essa granularidade se perde |
| Por que o nome atual é semanticamente impreciso? | O nome sugere idempotência ("marcar como enviado, uma vez"). Na prática, é chamado por bloco e cada chamada faz `UPDATE ... eq('id', id)` sobrescrevendo os campos com valores do último bloco. Semanticamente é um `recordBlockSent` |
| Nome sugerido | `recordBlockSent` |
| Por que o rename não foi feito nesta fase? | Renomear sem definir a estratégia de estado parcial (`sent_blocks`, tabela de tentativas, idempotency key etc.) apenas troca o rótulo sem corrigir a semântica. O nome final deve refletir o comportamento que restar após a decisão de idempotência. Rename será tratado no mesmo bloco que decidir a persistência de estado parcial |

---

## 8. Migration de `sent_blocks` — não iniciada

Permanece **hipótese**, não decisão. Antes de qualquer migration, um bloco dedicado deve comparar:

- checkpoint JSONB em `quotes` (`sent_blocks jsonb`);
- tabela de tentativas de envio (`quote_send_attempts`);
- tabela de blocos de envio (`quote_send_blocks`);
- chave idempotente por bloco;
- uso de mensagens persistidas (`messages`) como fonte de verdade;
- idempotency key na Edge Function `meta-send`;
- retomada de lote a partir do último bloco confirmado.

A escolha **não** deve ser feita apenas porque JSONB é mais rápido de implementar.

---

## 9. Estado operacional a partir de agora

Quando o envio falhar novamente:

1. Solicitar do usuário **apenas** o código `QS-XXXXXXXX` (não pedir DevTools como primeira ação).
2. Localizar o `attemptId` completo nos logs do frontend a partir do QS.
3. Localizar os `requestId` correlacionados em `supabase--edge_function_logs meta-send`.
4. Correlacionar frontend ↔ Edge Function ↔ Graph API pelos eventos `META_SEND_GRAPH_REQUEST/RESPONSE`.
5. Identificar se houve **envio parcial** (`completedByAttempt` > 0 antes da falha).
6. Apresentar a causa raiz **comprovada** (não hipotética).
7. Aplicar correção **apenas após aprovação**, salvo indisponibilidade operacional simples e reversível.

---

## 10. Política de retry (referência)

Retry (`Tentar novamente`) só é oferecido quando **todas** as condições valem:

- Erro é `retryable` (`network_error`, `graph_rate_limited`, `internal_error`, `mark_sent_failed`, `message_persistence_failed`);
- `completedByAttempt.get(attemptId) === 0` — nenhum bloco anterior da tentativa foi entregue;
- Existe `onRetry` disponível (contexto de bloco).

Nos demais casos: só “Copiar código”.

Risco documentado: `mark_sent_failed` no **primeiro** bloco ainda oferece retry, o que pode duplicar 1 mensagem. Aceito nesta fase; será revisto junto com a decisão de idempotência.

---

## 11. Riscos ainda existentes

1. **Envio parcial persistente** — `quotes.status='enviado'` após qualquer bloco; UI global perde granularidade entre sessões. Pendente de decisão em bloco separado.
2. **Retry manual do bloco individual** pode ser acionado após `mark_sent_failed` ter ocorrido pós-entrega Meta. Documentado.
3. **Reprodução da falha original** — continua sem repro. Depende da próxima ocorrência real com `QS`.
4. **Retenção de logs** — não formalmente definida. Sem isso, garantia de resolvibilidade de QS → attemptId é apenas empírica.
5. **Refresh de token do supabase-js** — auditado, não simulado por teste.

---

## 12. Encerramento

Critérios da FASE A:

- [x] Nenhuma causa raiz inventada
- [x] Instrumentação segura (flag, mascaramento)
- [x] Código QS disponível ao usuário (visível, copiável)
- [x] Logs detalhados controlados por flag
- [x] Testes do orquestrador (10)
- [x] Contrato da Edge Function testado (harness com 15 testes)
- [x] Falha parcial claramente comunicada (toast dedicado, sem retry)
- [x] Retry escondido quando houver risco de duplicidade
- [x] Typecheck limpo
- [x] Suíte `quote-send` verde (57/57)
- [x] Suíte global documentada com falhas externas identificadas
- [x] Contagem de arquivos corrigida (8)
- [x] Ciclo de vida do QS e retenção de logs documentados honestamente

**FASE A ARQUIVADA.** Nenhum novo bloco iniciado automaticamente.
