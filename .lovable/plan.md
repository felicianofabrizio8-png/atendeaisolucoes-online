# Módulo IA de Atendimento — Plano

## Princípio de isolamento

Tudo novo. **Não tocar** em: `meta-send`, `meta-webhook`, `whatsapp-evolution-incoming`, `send-whatsapp-message`, estrutura de `messages/conversations/leads`. A IA permanece **modo assistente** (sugere, humano envia).

O que **já existe** e será reaproveitado:
- `src/routes/api.ai.suggest.tsx` → endpoint server-fn de sugestão (Gemini via Lovable AI Gateway, retorna `classification/intent/objection/nextAction/suggestedReply`).
- `src/routes/inbox.$conversationId.tsx` → botão "gerar sugestão", caixa editável, enviar/regenerar.

O que **falta** e será construído nas fases abaixo.

---

## Fase 1 — Enriquecer o assistente atual (sem novas telas)

Objetivo: a IA passa a usar o perfil da empresa e registra cada geração.

1. **Migration** (nova, não destrutiva):
   - `ai_profiles` (1:1 com `companies`): `company_name, description, products, payment_methods, avg_lead_time, faq jsonb, business_hours, region, differentials, tone enum('comercial','amigavel','premium','tecnico','informal')`. RLS por `company_id`, GRANTs explícitos.
   - `ai_suggestions_log`: `id, company_id, user_id, conversation_id, lead_id, model, prompt_tokens, completion_tokens, generated_text, classification, was_sent boolean default false, was_edited boolean default false, created_at`. RLS por `company_id`.
   - `ai_usage_counters`: `company_id, month date, count int, limit int default 1000`. RLS por `company_id`.

2. **`api.ai.suggest.tsx`**:
   - Carregar `ai_profiles` + últimas 5 perguntas aprovadas da base de conhecimento (Fase 2 — usa default vazio agora) e injetar no system prompt (tom, FAQs, diferenciais, horário, formas de pagamento).
   - Checar limite mensal (`ai_usage_counters`); retornar 429 amigável se estourar.
   - Inserir registro em `ai_suggestions_log` (+1 no contador).
   - Sinalizar `low_confidence: true` no retorno quando o modelo não conseguir produzir resposta segura (faltam dados → instrução para sugerir atendimento humano).

3. **Inbox** (`inbox.$conversationId.tsx`):
   - Banner "✋ Atendimento humano recomendado" quando `low_confidence`.
   - Ao enviar uma sugestão: PATCH no `ai_suggestions_log` marcando `was_sent`/`was_edited` (compara texto original vs enviado).

---

## Fase 2 — Tela de configuração + base de conhecimento aprovada

1. **Nova rota** `src/routes/configuracoes.ia.tsx` (sub-rota da tela atual de configurações, navegação por aba):
   - Form do `ai_profiles` (todos os campos da especificação, incluindo seletor de tom).
   - Lista de FAQs (CRUD manual) — entra direto na base aprovada.

2. **"Aprendizados da IA"** — nova tabela `ai_knowledge_proposals`:
   - `id, company_id, type enum('faq','objection','recurring_reply','sales_pattern'), question text, answer text, status enum('pending','approved','rejected'), source_conversation_id, created_at, reviewed_by, reviewed_at`. RLS por `company_id`.
   - Server-fn `api.ai.propose-knowledge.tsx`: roda sob demanda (botão "Analisar conversas") com Gemini agregando últimas N conversas e gerando propostas → todas entram como `pending`.
   - UI em `configuracoes.ia.tsx` aba "Aprendizados" para **aprovar / editar / rejeitar**.
   - Apenas registros `approved` são lidos pelo prompt em Fase 1.

3. **Salvaguarda**: prompts da IA recebem instrução explícita "**nunca alterar preços, criar condições comerciais ou enviar mensagem sozinha**". A IA é estritamente sugestiva.

---

## Fase 3 — Limites, logs e observabilidade

1. **Tela "Uso da IA"** em `configuracoes.ia.tsx`:
   - Contador mensal, limite configurável, últimas 50 gerações (texto, usuário, conversa, se foi enviada/editada).
   - Botão exportar logs.

2. **Server-fn `api.ai.logs.tsx`**: lista paginada do `ai_suggestions_log` por empresa.

3. **Fallback seguro**: timeout 15s no gateway; em erro 5xx/429/402 retorna mensagem amigável + flag `low_confidence`.

---

## Fora de escopo (preparado, não implementado)

- Resposta automática / follow-up / classificação automática de leads / treino por empresa. Estrutura (`ai_profiles`, `ai_suggestions_log`, `ai_knowledge_proposals`) já comporta essas evoluções sem migração destrutiva.

---

## Detalhes técnicos

- Modelo: `google/gemini-2.5-flash` (já em uso) via `LOVABLE_API_KEY`, sempre server-side.
- Stack: TanStack `createServerFn` / server routes existentes (`src/routes/api.ai.*.tsx`). **Zero edge functions novas.**
- Isolamento por `company_id` via `private.current_company_id()` em RLS, igual ao restante do app.
- Sem alteração em `meta-send`, `meta-webhook`, Evolution, inbox storage, schemas existentes.

---

## Pergunta antes de começar

Quer que eu execute **apenas a Fase 1** agora (assistente enriquecido + logs/limites mínimos) e depois Fases 2 e 3 em iterações separadas? Ou aplico **as 3 fases em sequência** nesta passada?
