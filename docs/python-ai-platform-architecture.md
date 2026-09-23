# FASE 0 — Auditoria arquitetural e desenho da plataforma de IA em Python

**Modo:** READ-ONLY. Nenhum código de produção foi alterado nesta fase.
**Escopo:** mapear o que existe hoje, corrigir premissas do briefing, definir os pontos exatos de integração do `ai-service/` e a ordem das fases.
**Fora de escopo deste documento:** implementação. Nenhuma linha de `ai-service/` foi escrita ainda.

Todas as afirmações abaixo têm referência a arquivo e linha. Onde o briefing divergiu do código real, a divergência está marcada como **[CORREÇÃO]**.

---

## 1. Correções ao briefing

O briefing pediu explicitamente para não presumir. Cinco premissas não se confirmaram no código.

### 1.1 `silent` / `assisted` / `automatic` não existem **[CORREÇÃO]**

O briefing trata esses três modos como "conceitos já existentes" a preservar. Eles **não existem no repositório**:

- `assisted`: zero ocorrências em `src/` e `supabase/`.
- `silent`: só aparece como `lead_silent` (regra de follow-up, `src/lib/followup/types.ts:10`) e `silentHours` (`src/lib/atendimento/copilot.ts:70`).
- `automatic`: só aparece dentro da palavra "automaticamente" em comentários em português.

O que existe de fato é um controle de execução com outro vocabulário, espalhado por dois níveis:

| Nível | Campo | Efeito | Ref |
| --- | --- | --- | --- |
| Empresa | `company_settings.ai_auto_reply_enabled` | liga/desliga o envio automático | `ai-agent.server.ts:164` |
| Empresa | `company_settings.ai_pilot_mode` | marca a empresa como "piloto" | migration `20260601034123` |
| Empresa | `ai_after_hours_only` + `business_hours_*` | janela de atuação | `ai-agent.server.ts:167-169` |
| Empresa | `ai_max_auto_replies` | teto de respostas por conversa | `ai-agent.server.ts:170-172` |
| Conversa | `ai_status = 'assumido_humano'` | humano assumiu | `ai-agent.server.ts:165` |
| Conversa | `human_takeover_at` | humano assumiu (timestamp) | `ai-agent.server.ts:166` |
| Conversa | `last_auto_reply_at` + `DEBOUNCE_MS` | anti-rajada | `ai-agent.server.ts:173-176` |

**Importante:** `ai_pilot_mode` **não** é um modo shadow nem assisted. Ele só muda o rótulo de status exibido (`ai-readiness.server.ts:112-113`) — de `"ativa"` para `"piloto"`. Não altera nenhum comportamento de envio. Quem decide envio é `ai_auto_reply_enabled` sozinho.

**Consequência para o projeto:** o trio `silent/assisted/automatic` será **criado**, não preservado. É uma mudança maior do que o briefing supõe, e precisa de um mapeamento explícito do estado atual para o novo (proposto em §7.3).

### 1.2 Não há `sales-agent-*` como diretório **[CORREÇÃO]**

São oito arquivos soltos em `src/lib/` (`sales-agent-core.ts`, `sales-agent-grounding.server.ts`, etc.), não um módulo. `sales-agent-core.ts` tem 1387 linhas e concentra prompt, tools, validação e fallback determinístico.

### 1.3 Não existe pgvector, embeddings ou RAG **[CORREÇÃO]**

Zero ocorrências de `vector`, `embedding`, `hnsw` ou `ivfflat` nas 158 migrations. O briefing trata RAG como evolução; na prática é construção do zero.

O que existe no lugar é **injeção integral de contexto no prompt**: `loadSalesAgentGrounding` carrega o catálogo inteiro da empresa, as 20 últimas FAQs aprovadas e as políticas comerciais, e despeja tudo no system prompt (`sales-agent-grounding.server.ts:895-935`).

### 1.4 Não existe tool-calling agêntico **[CORREÇÃO]**

Esta é a correção mais relevante para o objetivo do projeto.

O briefing descreve o alvo como "LLM pede preço → `get_product_price()` → resposta validada". Hoje o sistema **já usa a API de tools, mas para outra coisa**: as duas tools declaradas (`respond_to_customer` e `request_human_handoff`, `sales-agent-core.ts:1117-1200`) são um mecanismo de **saída estruturada de turno único**. O código lê `tool_calls?.[0]` (`sales-agent-core.ts:1274`) — **não existe loop**. O modelo não pode pedir dado; ele recebe tudo pronto e devolve uma decisão.

Ou seja: a premissa "não presuma que a IA atual é apenas uma chamada simples para LLM" está **meio correta**. Há muita engenharia em volta (grounding, validação, fallback determinístico), mas o miolo é de fato **uma única chamada**, sem ciclo de ferramentas.

### 1.5 Boa parte da infraestrutura citada é "dark" **[CORREÇÃO]**

Vários módulos citados no briefing existem, mas estão marcados no próprio código como sem consumidor operacional:

| Módulo | Situação | Evidência |
| --- | --- | --- |
| `llm-gateway` | construído, **não usado pelo agente de vendas** | `LLMProvider.ts:3` "Nenhum consumidor operacional na Fase 1" |
| `job-queue` | construído, sem produtor/consumidor | `JobQueueAgent.server.ts:3` "infra dark" |
| `scientific-memory` | construído, sem consumidor | `ScientificMemoryAgent.server.ts:4` |
| `runtime/` (55 arquivos, 7239 linhas) | registries e adapters; execução parcial via `runtime-tick` | `AgentAdapter.server.ts:30` |

O agente de vendas **não passa pelo LLM Gateway**. Ele faz `fetch()` direto no endpoint configurado (`ai-agent.server.ts:445`), com um único provider, sem fallback e sem routing por classe de modelo.

---

## 2. Fluxo real de produção hoje

```text
WhatsApp Cloud API
      |
      v
/api/public/whatsapp/webhook          (657 linhas)
      |
      v
INSERT em public.messages
      |
      v
TRIGGER postgres + pg_net             migration 20260601030834
      |  net.http_post(...)
      v
/api/public/hooks/agent-trigger       header x-agent-trigger-secret
      |  rate limit + dedupe 30s
      v
runAgentTick(conversationId)          ai-agent.server.ts:765
      |
      +-- shouldAutoReply()           gate pré-LLM (:160)
      +-- loadAgentContext()          catálogo + FAQ + políticas (:272)
      +-- runAgentTurn()              fetch único no LLM (:321, :445)
      +-- runSafetyLayer()            regex pós-LLM (:238)
      +-- qualifyAndPersist()         grava qualificação (:650)
      +-- sendWhatsappText()          envio (:511)
      |
      v
ai_flow_events                        logEvent() (:127)
```

Pontos estruturais deste fluxo:

1. **É síncrono e sem fila.** O trigger do Postgres chama HTTP e o handler roda o turno inteiro na requisição. `agent_jobs` não participa.
2. **O gate é pré-LLM.** `shouldAutoReply` decide antes de gastar token. Não existe etapa que rode o raciocínio e depois decida se envia — que é exatamente o que os modos `silent`/`assisted` exigem.
3. **A "policy" pós-decisão é regex.** `runSafetyLayer` (`:238-267`) bloqueia a mensagem se ela contiver percentual não registrado nos termos comerciais ou casar com `SAFETY_BLOCK_PATTERNS`, convertendo a decisão em handoff. É útil, mas é filtro de texto, não autorização de ação.
4. **Deploy é Cloudflare Workers** (`@cloudflare/vite-plugin`, `nitro` em `package.json:15,63`). Isso **impede** hospedar o processo Python no mesmo runtime — ver §6.

---

## 3. Inventário: o que preservar, reutilizar, substituir

### 3.1 Preservar intacto (não tocar)

| Ativo | Motivo |
| --- | --- |
| Webhook WhatsApp/Meta | 657 linhas de tratamento de mídia, tokens e dedupe. Sem motivo para refazer. |
| `sendWhatsappText` e afins | integração Meta funcionando, com resultado tipado (`ai-agent.server.ts:500`) |
| `ai_flow_events` + `logEvent()` | trilha operacional do produto. Langfuse **não** substitui. |
| Frontend / TanStack | fora de escopo |
| RLS e `current_company_id()` | base do isolamento no plano autenticado |
| Follow-up V2 (`src/lib/followup/`) | gates e safety próprios, já testados |

### 3.2 Reutilizar do banco (sem nova tabela)

| Tabela | Papel na nova arquitetura | Observação |
| --- | --- | --- |
| `agent_jobs` | **fila do worker Python** | pronta para uso: dequeue atômico com `FOR UPDATE SKIP LOCKED`, `dedupe_key` único parcial, `attempts`/`max_attempts`, `dead_letter`, `locked_by`. RPC `dequeue_agent_job(_worker_id, _job_types, _lock_seconds)` é `SECURITY DEFINER`. Migration `20260713151715`. **Não criar outra fila.** |
| `conversation_sales_states` | núcleo da working memory | `UNIQUE (company_id, scope_type, scope_id)`, `attributes jsonb`, `product_ids`, `last_valid_product_ids`, `intent`. Cobre parte do que o briefing pede. |
| `conversations.*` | resto da working memory | `detected_city`, `detected_state`, `detected_budget`, `purchase_timing`, `customer_stage`, `lead_temperature`, `detected_objections` (`ai-agent.server.ts:773`) |
| `coach_learnings` | fonte de memória semântica aprovada | tem `status IN ('active','paused','archived')`, `confidence`, `priority` |
| `ai_knowledge_proposals` | FAQ oficial | já filtrado por `status = 'approved'` (`sales-agent-grounding.server.ts:901`) |
| `marketing_knowledge_base` | políticas comerciais oficiais | pagamento, instalação, visita, frete, itens inclusos |
| `products` | catálogo | fonte única de preço |
| `ai_flow_events` | auditoria | correlacionar com `trace_id` |

**Atenção sobre working memory:** ela está **partida em dois lugares**. `conversation_sales_states` guarda produto/intenção; `conversations` guarda qualificação. O briefing pede um único conceito. Proposta: o Python **lê os dois e expõe um modelo unificado**, mas continua escrevendo em ambos, para não quebrar o agente TS. Unificar fisicamente fica para depois do shadow mode.

### 3.3 Substituir (o novo assume)

| Hoje | Depois | Risco |
| --- | --- | --- |
| Catálogo inteiro no prompt | `search_catalog` / `get_product_price` como tools | alto — muda a forma de aterrar fatos |
| `tool_calls[0]` sem loop | loop Pydantic AI | alto |
| `runSafetyLayer` (regex) | Policy Engine tipado | médio — manter o regex como camada extra, não remover |
| `fetch()` direto | LiteLLM com classes de modelo | baixo |

### 3.4 Construir do zero

pgvector, `ai_documents`/`ai_document_chunks`, embeddings, hybrid search, reranking, memória episódica, Langfuse, evals, feature flags por empresa, os três modos de execução, shadow mode.

---

## 4. Pontos exatos de integração

Há três opções para acoplar o Python. Recomendo a **B**.

### Opção A — trigger chama o Python direto
Trocar a URL em `net.http_post` da migration `20260601030834`.
**Contra:** mudança em produção logo de cara, sem rede de proteção, e perde o rate limit/dedupe já implementados em `agent-trigger`.

### Opção B — `agent-trigger` enfileira em `agent_jobs` (recomendada)
Manter `agent-trigger` como está e **acrescentar** um enfileiramento, atrás de feature flag:

```text
/api/public/hooks/agent-trigger
      |
      +-- runAgentTick()                  caminho atual, inalterado
      |
      +-- se python_ai_shadow_mode:       NOVO
             enqueue agent_jobs
             job_type = 'python_sales_turn'
             dedupe_key = conversation_id + ':' + message_id
      |
      v
Worker Python faz dequeue_agent_job()
      |
      v
decide, grava comparação, NÃO envia
```

**A favor:** produção intocada; shadow mode nasce de graça; usa a fila que já existe; dedupe garantido pelo índice único parcial.

### Opção C — Edge Function intermediária
Mais uma peça móvel sem ganho claro. Descartada.

### Endpoints do `ai-service`

```text
GET  /health                     sem auth
POST /v1/agents/sales/turn       auth service-to-service
POST /v1/retrieval/search        auth service-to-service
POST /v1/memory/index            auth service-to-service
POST /v1/jobs/process            auth service-to-service (tick manual)
```

Autenticação: mesmo padrão já usado no repo — segredo compartilhado com comparação timing-safe (`safeEqualSecret` em `runtime/HookSecurity.server.ts`). **`company_id` nunca vem do cliente**; é derivado do job ou da conversa, como `agent-trigger` já faz (comentário em `api.public.hooks.agent-trigger.tsx:11-12`).

---

## 5. Multi-tenant — o risco central

### O problema

O briefing assume que RLS protege. **No caminho server-side, não protege.** Todo o agente atual usa `supabaseAdmin`, que é service role e **ignora RLS por definição**. O isolamento hoje é convenção: um `.eq("company_id", companyId)` escrito à mão em cada query (`sales-agent-grounding.server.ts:902,922`).

O `ai-service` terá o mesmo poder. Se usar service role ou conexão Postgres direta, **RLS não será uma rede de proteção**. Um `WHERE` esquecido vaza dados entre empresas sem erro nenhum.

### Estratégia proposta

Três camadas, porque uma só não basta:

1. **Tipo que obriga escopo.** Nenhum repositório aceita query sem `TenantScope`. `company_id` não é parâmetro opcional; é a primeira posição de toda assinatura.
2. **`SET LOCAL app.company_id` por transação** + RLS aplicada também ao papel do serviço, onde for viável. Assim o banco vira a segunda barreira, não só o código.
3. **Testes de isolamento obrigatórios** em `tests/multitenant/`: para cada tool, uma empresa A pedindo dado que só existe na empresa B deve retornar vazio — nunca erro genérico, nunca dado.

Decisão em aberto para você: usar **service role via PostgREST** (simples, reaproveita `supabaseAdmin`) ou **conexão Postgres direta com role dedicada e RLS ativa** (mais seguro, mais trabalho). Recomendo a segunda para o Python, justamente porque o TS já demonstrou que a convenção manual é o único guarda-corpo hoje.

---

## 6. Deploy — restrição concreta

A aplicação roda em **Cloudflare Workers**. Workers não executam processo Python de longa duração. Portanto:

- `ai-service` é um **deployment separado** (container).
- O worker de jobs é um **processo próprio**, não um cron do Workers.
- A comunicação é HTTP + a fila `agent_jobs` no Postgres.
- Isso é uma dependência de infraestrutura nova que o briefing não menciona e **precisa de decisão sua** (onde hospedar: Fly.io, Railway, Cloud Run, VPS).

---

## 7. Plano de fases ancorado no código real

As fases do briefing estão boas. Ajustes onde o código real muda a ordem:

| Fase | Conteúdo | Ajuste vs. briefing |
| --- | --- | --- |
| 0 | Este documento | — |
| 1 | Bootstrap `ai-service` (FastAPI, uv, ruff, pyright, pytest, Dockerfile) | — |
| 2 | Conexão Postgres + repositories + `TenantScope` + testes cross-tenant | **antecipar** a decisão de §5 |
| 3 | Tools read-only primeiro (`search_catalog`, `get_product`, `get_product_price`, `search_company_knowledge`, `get_commercial_policy`) | **separar** read de write. Write (`create_quote`, `send_message`) só na fase 8, depois do Policy Engine existir. |
| 4 | Working memory unificando `conversation_sales_states` + `conversations` | ver §3.2 |
| 5 | pgvector + `ai_documents` + `ai_document_chunks` + embeddings | construção do zero |
| 6 | Hybrid search (pgvector + FTS português) | FTS precisa de `to_tsvector('portuguese', ...)` |
| 7 | Sales Agent Pydantic AI com loop de tools | — |
| 8 | Structured decision + Policy Engine + tools de escrita | — |
| 9 | Worker consumindo `agent_jobs` | reusar `dequeue_agent_job` |
| 10 | LiteLLM | — |
| 11 | Langfuse | correlacionar com `ai_flow_events` |
| 12 | Evals | dataset a partir de conversas reais |
| 13 | **Shadow mode** | porta de entrada obrigatória |
| 14 | Assisted | exige UI nova para aprovação |
| 15 | Automatic | — |

### 7.1 Ordem das tools (mudança que proponho)

O briefing lista todas as tools na fase 3. Recomendo dividir: **read-only na fase 3, write na fase 8**. Motivo: uma tool de escrita sem Policy Engine é uma ação externa sem autorização. Se a fase 3 já entregar `send_message` e `create_quote`, existe uma janela de cinco fases em que o agente pode agir sem guarda. Não vale o risco.

### 7.2 Evals antes do shadow mode

O briefing põe evals na 12 e shadow na 13 — concordo, e reforço: sem eval rodando, shadow mode gera divergências que ninguém sabe julgar.

### 7.3 Mapeamento dos modos (já que não existem)

Proposta de equivalência com o que existe hoje:

```text
ai_auto_reply_enabled = false           ->  silent
ai_auto_reply_enabled = true            ->  automatic  (comportamento atual)
(não existe)                            ->  assisted   (novo)
```

`assisted` é funcionalidade nova de ponta a ponta: precisa de tabela de sugestões pendentes, UI de aprovação na Caixa de Atendimento e ação de "aprovar e enviar". **Isso é trabalho de frontend**, que o briefing declarou fora de escopo ("não reescrever o frontend" — mas aqui não é reescrita, é tela nova). Vale confirmar se entra.

---

## 8. Riscos

| # | Risco | Gravidade | Mitigação |
| --- | --- | --- | --- |
| R1 | Vazamento cross-tenant: service role ignora RLS | **Crítico** | §5, três camadas + testes obrigatórios |
| R2 | Regressão de grounding: hoje o catálogo inteiro vai no prompt; com tools o modelo pode não buscar e responder vago | **Alto** | manter fallback determinístico (`buildValidatedCatalogReply`, `sales-agent-core.ts:390`); eval de "product correctness" |
| R3 | Latência: hoje é 1 chamada; loop de tools são N | **Alto** | teto de iterações; FAST_MODEL nas tools; medir p95 no shadow |
| R4 | Duplicidade de mensagem se shadow vazar para envio | **Alto** | worker shadow sem credencial de envio — barreira física, não flag |
| R5 | Custo: N chamadas + embeddings | Médio | cache; `ai_max_auto_replies` já existe |
| R6 | Divergência de verdade: dois agentes lendo/escrevendo o mesmo estado | Médio | no shadow, Python escreve só em tabelas de comparação |
| R7 | Infra nova para operar (§6) | Médio | decisão sua |
| R8 | Manutenção dobrada durante a transição | Médio | prazo curto para o shadow |

---

## 9. Segurança — achados desta auditoria

### 9.1 `.env` versionado — confirmado, severidade baixa

O arquivo está rastreado pelo git. Conforme instruído, **não reproduzo valores**. As variáveis são:

`SUPABASE_PROJECT_ID`, `SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_URL`, `VITE_META_APP_ID`, `VITE_SUPABASE_PROJECT_ID`, `VITE_SUPABASE_PUBLISHABLE_KEY`, `VITE_SUPABASE_URL`

**Avaliação:** todas são chaves publicáveis ou de cliente (`VITE_*` vai para o bundle por definição; `PUBLISHABLE_KEY` é a chave anônima). **Não há service role key, token Meta, token WhatsApp ou chave de provider de LLM neste arquivo.** A exposição real é baixa.

Rotação: não urgente para estas chaves. Se quiser rotacionar por higiene, a `SUPABASE_PUBLISHABLE_KEY` é a única com algum sentido — e ela depende de RLS estar correta, não de sigilo.

### 9.2 `.gitignore` sem regra de env — severidade média

Não há **nenhuma** regra `env` no `.gitignore`. Hoje o conteúdo é inofensivo, mas nada impede o próximo `.env.local` com service role de ser commitado. Correção recomendada:

```gitignore
.env
.env.*
!.env.example
```

Não apliquei: a fase 0 é read-only e uma alteração de `.gitignore` com `.env` já rastreado exige `git rm --cached`, que é uma mudança de verdade. Faço assim que você autorizar.

### 9.3 Segredos server-side — onde estão hoje

Ficam em `process.env` e num vault de segredos de hook (`runtime/HookSecretVault.server.ts`), com comparação timing-safe. O `ai-service` deve seguir o mesmo padrão e **nunca** usar `SUPABASE_PUBLISHABLE_KEY` como credencial privilegiada.

---

## 10. Decisões que preciso de você antes da Fase 1

1. **Hospedagem do `ai-service`** (§6) — Fly.io, Railway, Cloud Run, VPS?
2. **Acesso ao banco** (§5) — service role via PostgREST, ou role dedicada com RLS ativa? Recomendo a segunda.
3. **`assisted` inclui tela de aprovação?** (§7.3) — é frontend novo.
4. **Provider de embeddings** — define a dimensão da coluna `vector(N)` e é caro de trocar depois.
5. **Empresa-piloto para o shadow mode** — as migrations citam "Solário Piscinas" como piloto do Coach V2 (`20260721114720`). Mesma empresa?

---

## 11. Resumo executivo

O sistema atual **não** é "só uma chamada de LLM" — há grounding, validação, fallback determinístico e guardas de execução bem pensados. Mas o miolo **é** uma chamada única, com todo o contexto empurrado no prompt, e a maior parte da infraestrutura avançada citada no briefing (`llm-gateway`, `job-queue`, `scientific-memory`) está construída e **desligada**.

O trabalho real da plataforma Python é menor do que parece em alguns pontos (a fila `agent_jobs` está pronta e é boa; a saída estruturada já existe) e **maior** em outros (não há RAG, não há loop de tools, e os três modos de execução precisam ser criados, não preservados).

O risco dominante é isolamento multi-tenant, porque o plano server-side não é protegido por RLS hoje — e o Python herdará exatamente essa exposição se for construído do mesmo jeito.

**Próximo passo:** responder §10 e autorizar a Fase 1.
