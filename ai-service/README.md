# ai-service — AI Control Plane do Atende Aí

Camada de IA em Python que trabalha **junto** com a aplicação TypeScript, não
no lugar dela.

```text
React / TanStack  →  Supabase (Auth, Postgres, RLS, Realtime)
                          │
                          ├── mensagens, leads, produtos
                          ├── conversation_sales_states
                          ├── agent_jobs, ai_flow_events
                          └── pgvector
                          │
                          ▼
                 ai-service (este projeto)
                 FastAPI · Pydantic AI · Tools · Memória
                 RAG híbrido · Policy Engine · LiteLLM · Langfuse
                          │
                          ▼
                 Decisão estruturada → Policy Engine
                          │
                 silent / assisted / automatic
                          │
                          ▼
              Supabase / CRM / WhatsApp / Meta
```

**Divisão de responsabilidade:** Python é o Control Plane (decide). TypeScript e
Supabase continuam sendo Data Plane e Integration Plane (guardam e executam).

Antes de mexer aqui, leia [`docs/python-ai-platform-architecture.md`](../docs/python-ai-platform-architecture.md)
— a auditoria da FASE 0, com o que existe hoje e o que este serviço muda.

---

## Estado atual

| Fase | Entrega | Situação |
| --- | --- | --- |
| 0 | Auditoria arquitetural | ✅ |
| 1 | Bootstrap FastAPI, config, healthcheck, lint, testes | ✅ |
| 2 | Postgres, repositories, tenant guard, testes cross-tenant | ✅ |
| 3 | Tools de leitura (catálogo, preço, conhecimento, lead) | ✅ |
| 4 | Working memory sobre `conversation_sales_states` | ✅ |
| 5 | pgvector, documentos, chunks, embeddings | ✅ migrations + código |
| 6 | Hybrid search (vetorial + FTS) | ✅ |
| 7 | Sales Agent com Pydantic AI | ✅ |
| 8 | Policy Engine + tools de escrita | ⚠️ engine pronto; escrita externa pendente |
| 9 | Worker de `agent_jobs` | ✅ |
| 10 | LiteLLM routing | ⚠️ embeddings e resumo; loop do agente na FASE 10 |
| 11 | Langfuse | ✅ |
| 12 | Evals | ⚠️ dataset e regras sem LLM; execução real pendente |
| 13 | Shadow mode | ⛔ tabela criada, integração pendente |
| 14–15 | Assisted / Automatic | ⛔ |

**Nada deste serviço está ligado à produção.** `ALLOW_EXTERNAL_ACTIONS=false` é
uma barreira física: nenhuma mensagem sai, nenhum orçamento é criado, nem que
todas as flags estejam ligadas.

---

## Rodando

Requer Python 3.12+ e [uv](https://docs.astral.sh/uv/).

```bash
cd ai-service
cp .env.example .env     # preencha SERVICE_AUTH_TOKEN e DATABASE_URL
uv sync --extra dev
uv run ruff check .
uv run pyright
uv run pytest
uv run uvicorn app.main:app --reload --port 8000
```

Healthcheck:

```bash
curl http://localhost:8000/health
```

Worker (processo separado):

```bash
uv run python -m app.workers.agent_jobs
```

Ou, sem processo dedicado, um cron externo chamando:

```bash
curl -X POST http://localhost:8000/v1/jobs/process \
  -H "x-ai-service-token: $SERVICE_AUTH_TOKEN" \
  -H "content-type: application/json" \
  -d '{"max_jobs": 5}'
```

---

## Migrations

Aplicar **nesta ordem**, com a CLI do Supabase ou psql:

1. `migrations/0001_pgvector_documents.sql` — extensão `vector`, `ai_documents`,
   `ai_document_chunks`, índices HNSW e GIN.
2. `migrations/0002_ai_memory.sql` — memória episódica, resumos, feature flags,
   shadow mode, chaves de idempotência.
3. `migrations/0003_ai_service_role.sql` — role `ai_service` com RLS ativa.
   **Exige criar a role antes** (instruções no cabeçalho do arquivo).

> **A dimensão do embedding entra no DDL.** `vector(1536)` casa com
> `text-embedding-3-small`. Trocar o modelo depois exige `ALTER TYPE` e
> reindexar tudo. Decida antes de indexar em produção.

---

## Multi-tenant

O ponto mais importante do projeto, e a razão de metade das decisões de
arquitetura aqui.

**O caminho server-side do Atende Aí não é protegido por RLS.** Ele usa service
role, que ignora RLS por definição; o isolamento hoje é um `.eq("company_id")`
escrito à mão em cada query. Um `WHERE` esquecido devolve dado de outra empresa
sem erro nenhum.

Três camadas, porque uma só não basta:

1. **Tipo.** `TenantScope` é obrigatório em todo repositório e toda tool. Não
   existe assinatura sem escopo.
2. **Banco.** `tenant_transaction()` faz `SET LOCAL app.company_id` por
   transação, e a migration `0003` dá ao serviço uma role com RLS ativa. Um
   filtro esquecido devolve zero linhas em vez de vazar.
3. **Teste.** `tests/multitenant/` prova que o código percebe quando o banco
   devolve linha da empresa errada.

Elas cobrem, respectivamente: erro de código, erro de configuração e regressão.

---

## Anti-alucinação

O modelo pode decidir que precisa de uma informação. Ele não pode fabricá-la.

```text
LLM: "preciso do preço"
      ↓
get_product_price()        ← única fonte de preço
      ↓
resultado validado
      ↓
LLM redige a resposta
```

Implementação:

- preço, catálogo, política e condição **só** vêm de tool tipada;
- `ProductPrice.price` é `Decimal | None` — ausente é ausente, não texto que o
  modelo possa reescrever;
- `policies/safety.py` barra percentual não registrado nos termos comerciais;
- `tool_calls_used` na decisão é a evidência que os evals medem.

---

## Estrutura

```text
app/
├── main.py              FastAPI + lifespan
├── config.py            settings (env, sem segredo em código)
├── api/                 rotas + auth service-to-service
├── agents/              Sales Agent (Pydantic AI)
├── workflows/           orquestração do turno
├── tools/               ferramentas tipadas + guardas
├── memory/              working · episódica · semântica
├── retrieval/           embeddings · hybrid search · reranker · indexer
├── llm/                 gateway LiteLLM + routing por classe
├── policies/            tenant · execution · actions · safety
├── schemas/             contratos Pydantic
├── database/            pool + repositories
├── observability/       tracing Langfuse
└── workers/             consumidor de agent_jobs
```

---

## Decisões que valem saber

**Pydantic Graph não está aqui.** O fluxo do turno é uma sequência reta, sem
ramificação nem retomada durável. Um grafo para uma lista de passos adiciona
indireção sem resolver problema. O momento de trazê-lo é a primeira ramificação
real — aí ele paga o custo. Ver `workflows/sales_turn.py`.

**A fila é a que já existe.** `agent_jobs` tem dequeue atômico, dedupe, dead
letter e contagem de tentativas. Sem Redis, sem Celery.

**O envio continua em TypeScript.** A integração Meta tem 657 linhas de
tratamento de mídia, token e janela de 24h. Reimplementar em Python criaria dois
caminhos de envio e duas contabilidades de janela. `tools/messaging.py` chama o
endpoint TS.

**`silent`/`assisted`/`automatic` são novos.** Não existiam no projeto — o que
existe é `ai_auto_reply_enabled` (liga/desliga) e `ai_pilot_mode` (que só muda
um rótulo na tela). O mapeamento está em `policies/execution.py`.

**Langfuse não substitui `ai_flow_events`.** Um é observabilidade de LLM, o
outro é trilha operacional do produto — e o produto não pode depender de um SaaS
externo para saber o que aconteceu numa conversa.
