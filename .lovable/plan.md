
# Fase 1 — Agente automático de pré-atendimento

Camada nova, **sem tocar** em `meta-send`, `meta-webhook`, inbox, ou no fluxo do vendedor. A IA assistida (`/api/ai/suggest`) continua igual.

## 1. Banco de dados (1 migração)

### 1.1 Novas colunas em `conversations`
- `ai_handling boolean default false` — IA está cuidando agora
- `ai_status text` — `pre_atendido_ia` | `aguardando_humano` | `assumido_humano` | `null`
- `human_takeover_at timestamptz` — quando humano assumiu
- `last_auto_reply_at timestamptz` — anti-loop/anti-spam
- `auto_reply_count int default 0` — limite por conversa
- `detected_city text`, `detected_pool_size text`, `detected_intent text` — slots extraídos

### 1.2 Novas colunas em `company_settings` (config do painel)
- `ai_auto_reply_enabled boolean default false`
- `ai_after_hours_only boolean default true`
- `ai_initial_message text` (com fallback default)
- `ai_max_auto_replies int default 5`
- `ai_handoff_timeout_minutes int default 30`
- `ai_agent_name text default 'Fabrizio'`

### 1.3 Nova tabela `ai_flow_events` (logs estruturados)
Colunas: `id, company_id, conversation_id, lead_id, event_type, payload jsonb, created_at`.
`event_type` ∈ `auto_reply_sent | handoff_human | detected_city | detected_pool_size | detected_intent | ai_flow_step | safety_block | skipped_business_hours | skipped_human_active`.
RLS por `company_id` (igual padrão existente).

### 1.4 Realtime
Habilitar realtime em `conversations` para o badge "⚠️ Atendimento humano necessário" atualizar ao vivo no inbox.

## 2. Backend — engine desacoplada

### 2.1 `src/lib/ai-agent.server.ts` (server-only)
Funções puras, sem rotas, fáceis de testar:
- `isWithinBusinessHours(settings, now)` — usa `business_hours_start/end`
- `shouldAutoReply(conversation, settings, now)` — todas as guardas (enabled, after-hours, sem humano ativo, lead novo, dentro do limite, debounce de 30s)
- `buildAgentContext(companyId)` — carrega `ai_profiles`, `products` (com fotos/medidas/litragem), `ai_knowledge_proposals(approved)`, `company_settings`
- `detectHandoffNeeded(text)` — detecta gatilhos: `desconto`, `parcelar`, `negocia`, `prazo`, `fechar`, `instalar quando`, etc → regex + heurística leve
- `runAgentTurn({conversation, lead, history, context})` — chama Lovable AI Gateway com **tool calls estruturados**:
  - tool `respond_to_customer`: `{ message, detected_city?, detected_pool_size?, detected_intent?, suggest_products: string[] }`
  - tool `request_human_handoff`: `{ reason }`
  - retorna decisão tipada (não texto livre)
- `runSafetyLayer(decision, context)` — bloqueia se mensagem contém: `R$`, `%`, `desconto`, `garanto`, `prometo`, prazos numéricos não presentes no catálogo. Se bloquear → força handoff.

### 2.2 Prompt baseado em dados (não hardcoded)
System prompt composto a partir de:
- `ai_profiles` (tom, descrição, pagamento, prazo, horário, região, diferenciais)
- até 10 produtos com `name, price, description, images[0], notes` (inclusos/inclusos do produto)
- KB aprovada (já existe)
- Regras de segurança fixas curtas (não negociar, não inventar, não prometer)

### 2.3 Rota interna `POST /api/ai/agent-tick` (server route, auth Bearer admin)
Dispara um turno do agente para `{conversationId}`. Usada pelo webhook handler e pelo cron de fallback. Encapsula:
1. Lock leve via `update conversations set ai_handling=true where id=? and ai_handling=false` (anti-corrida).
2. Carrega histórico (últimas 20 messages do DB — não confia em body).
3. `runAgentTurn` → `runSafetyLayer`.
4. Se handoff → `ai_status=aguardando_humano`, log `handoff_human`, **não envia mensagem**.
5. Se reply → envia via `meta-send` existente (reutilizando, sem alterar) e grava em `messages` (role=`agent`, `source='ai_agent'`).
6. Atualiza counters, slots detectados, `last_auto_reply_at`.
7. Log `auto_reply_sent` + slots detectados em `ai_flow_events`.
8. Libera lock (`ai_handling=false`).

### 2.4 Gatilho a partir do webhook (sem alterar `meta-webhook`)
Criar **trigger Postgres** em `messages` `AFTER INSERT WHEN role='lead'`:
```sql
perform net.http_post(url:='…/api/public/hooks/agent-trigger',
  headers:='{...apikey...}', body:=jsonb_build_object('conversation_id', NEW.conversation_id));
```
Rota pública `src/routes/api/public/hooks/agent-trigger.ts` aplica as guardas (`shouldAutoReply`) e, se passar, chama o tick. Assim o webhook Meta não é tocado — o gatilho está no banco.

### 2.5 Cron de checagem (fallback / scheduler)
Habilitar `pg_cron` + `pg_net`. Job a cada 5 min:
- Reverte locks travados (`ai_handling=true` há > 2min).
- Conversas `aguardando_humano` há > `ai_handoff_timeout_minutes` → marca alerta urgente em `ai_flow_events`.
- Garante que nenhuma resposta automática é enviada se `auto_reply_count >= ai_max_auto_replies`.

## 3. Frontend

### 3.1 Nova aba **Automação** em `/ia`
Controles ligados a `company_settings`:
- toggle ativar/desativar pré-atendimento
- toggle "somente fora do horário"
- inputs horário comercial (já existem na tabela)
- textarea mensagem inicial (com placeholder do exemplo do Fabrizio)
- número máximo de mensagens automáticas
- timeout de handoff (min)
- nome do agente
- preview do fluxo + lista de últimos `ai_flow_events`

### 3.2 Badge no inbox
Em `inbox.$conversationId.tsx` (mudança mínima, sem alterar lógica):
- Se `ai_status === 'aguardando_humano'` → banner topo "⚠️ Atendimento humano necessário" + botão "Assumir conversa" (seta `assumido_humano`).
- Se `ai_status === 'pre_atendido_ia'` → chip "🤖 Pré-atendido pela IA".

## 4. Segurança / guard-rails
- Safety layer pós-LLM com regex (lado servidor) que **vence** o LLM.
- Histórico vem do DB, não do cliente.
- Lock por linha contra corrida.
- Debounce 30s entre auto-replies na mesma conversa.
- Hard cap `ai_max_auto_replies`.
- Validação Zod no body do `agent-trigger` e `agent-tick`.

## 5. Arquivos a criar / editar

**Criar**
- `supabase/migrations/<timestamp>_ai_agent_phase1.sql`
- `src/lib/ai-agent.server.ts`
- `src/routes/api.ai.agent-tick.tsx`
- `src/routes/api/public/hooks/agent-trigger.tsx`
- Cron + trigger via `supabase--insert` (não migração, dados específicos do projeto)

**Editar (cirúrgico)**
- `src/routes/ia.tsx` — adicionar aba "Automação"
- `src/routes/inbox.$conversationId.tsx` — adicionar banner/badge (sem mexer no resto)
- `src/integrations/supabase/types.ts` — atualizado automaticamente

**Não tocar:** `meta-send`, `meta-webhook`, `whatsapp-evolution-incoming`, `api.ai.suggest.tsx`, `api.ai.suggest-product.tsx`.

## 6. Fora do escopo (próximas fases)
- Treinamento contínuo / fine-tuning
- RAG com embeddings
- Templates de campanha
- Auto-classificação de leads existentes
- Multi-agente / escalonamento por habilidade

---

**Próximo passo:** se aprovado, começo pela migração (passo 1), aguardo confirmação, depois implemento engine + rotas + UI numa segunda leva.
