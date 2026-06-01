## Plano: Evolução do módulo Follow-up Automático

Implementação em **camada isolada**, sem tocar inbox, meta-send, meta-webhook ou integrações existentes. Tudo novo é feature-flagged e falha de forma segura.

---

### 1. Banco de dados (migration única)

**Novos campos em `company_settings`** (todos com default seguro / desligado):
- `ai_followup_humanize` boolean default true — ativa variações automáticas de texto
- `ai_followup_delay_jitter_minutes` int default 35 — janela randômica ± minutos
- `ai_followup_daily_limit` int default 50 — teto diário anti-ban
- `ai_followup_min_response_rate` numeric default 0.05 — pausa se cair abaixo
- `ai_followup_warmup_enabled` boolean default true — aquecimento gradual
- `ai_followup_reactivation_enabled` boolean default false
- `ai_followup_reactivation_days` int default 30
- `ai_followup_reactivation_daily_max` int default 10
- `ai_followup_reactivation_hours_start` time default '09:00'
- `ai_followup_reactivation_hours_end` time default '18:00'
- `ai_followup_reactivation_template` text default 'Oi {{nome}}, faz um tempinho que não nos falamos. Posso te ajudar com algo hoje?'

**Novos campos em `leads`**:
- `lead_score` int default 0
- `lead_temperature_cached` text — 'hot' | 'warm' | 'cold'
- `last_score_at` timestamptz
- `reactivated_at` timestamptz

**Novos campos em `follow_ups`**:
- `cancel_reason` text — 'client_replied' | 'human_takeover' | 'daily_limit' | 'no_integration' | 'outside_hours'
- `cancelled_at` timestamptz
- `trigger_reason` text — texto humano explicando porque a IA disparou
- `variant_seed` int — para rastrear variação usada
- `scheduled_for` timestamptz — quando foi agendado (vs `sent_at`)

**Nova tabela `ai_followup_daily_stats`** (uma linha por empresa por dia) para o painel de analytics:
- company_id, day, sent, responded, recovered, failed, response_rate

GRANTs + RLS por `current_company_id()` em tudo novo.

---

### 2. Backend — `src/lib/ai-followup.server.ts` (extensão)

Adicionar funções **novas** (não substituir as existentes):
- `humanizeTemplate(text, attemptNumber, seed)` — aplica variações: saudação, emoji, CTA, micro-mudanças
- `computeLeadScore(leadId)` — calcula 0-100 baseado em msgs, tempo resposta, orçamento, follow-up respondido, recência → mapeia para hot/warm/cold
- `getWhatsAppIntegrationStatus(companyId)` — retorna `{ connected, hasUnmapped, unmappedCount, tokenValid, error }`
- `canSendFollowupNow(companyId)` — gate central: integração ativa + janela 24h + limite diário + horário + taxa resposta + warmup
- `scheduleWithJitter(baseHours, jitterMin)` — calcula `scheduled_for` randômico
- `cancelPendingFollowups(conversationId, reason)` — chamado quando cliente responde (via gatilho leve)
- `reactivateOldLeads(companyId)` — varre leads parados há N dias, respeita limite diário e horário
- `getAdvancedAnalytics(companyId)` — agrega métricas avançadas

**Tick** (`runFollowupTickForCompany`) passa a:
1. Chamar `canSendFollowupNow` antes de qualquer envio
2. Humanizar template via `humanizeTemplate`
3. Registrar `trigger_reason` e `variant_seed` no insert
4. Logar tudo em `ai_flow_events`

---

### 3. APIs (rotas TanStack — novas, não tocam as existentes)

- `GET /api/ai/followup-status` — retorna status WhatsApp + score summary + alertas
- `GET /api/ai/followup-analytics` — métricas avançadas (recuperados, valor, melhor horário, taxa por categoria, série diária)
- `POST /api/ai/followup-cancel` — cancela follow-ups pendentes de uma conversa (uso manual)
- `POST /api/ai/followup-reactivate` — dispara reativação manual

Endpoint `/api/ai/followup-config` existente: estender PUT para aceitar os novos campos.

---

### 4. Cancelamento automático ao responder

**Sem mexer no meta-webhook**. Adicionar trigger Postgres em `messages` que:
- Quando `role='lead'` (mensagem recebida do cliente)
- Marca `follow_ups` pendentes (`status='sent'` sem `responded_at`) da mesma conversa como `responded` + atualiza `lead_score`
- Insere evento `ai_flow_events` com tipo `followup_auto_cancelled`

Trigger SECURITY DEFINER, isolado, com EXCEPTION WHEN OTHERS RETURN NEW — nunca quebra insert.

---

### 5. Frontend — `src/components/AIFollowupPanel.tsx`

Estender o painel atual (não substituir):

**Topo**:
- Banner de status WhatsApp (verde/amarelo/vermelho)
- Alerta se `whatsapp_unmapped_events` tem registros recentes
- Score summary (X quentes / Y mornos / Z frios)

**Nova aba "Inteligência"**:
- Toggle humanização
- Slider delay jitter
- Limite diário
- Pausa automática se taxa cair
- Warmup gradual

**Nova aba "Reativação"**:
- Toggle ativar
- Dias de inatividade
- Limite diário
- Janela de horário
- Template editável

**Nova aba "Analytics"** (substitui apenas o card de métricas atual):
- Leads recuperados / valor recuperado
- Melhor template e melhor horário
- Taxa por regra
- Gráfico de série diária (envios + respostas)
- Taxa de recuperação

**Timeline enriquecida**:
- Badges adicionais: "cancelado (cliente respondeu)", "lead recuperado", `trigger_reason` em hover
- Score badge por linha (🔥/🟡/⚪)

---

### 6. Proteção anti-ban (centralizada em `canSendFollowupNow`)

- Limite diário por empresa
- Pausa se taxa de resposta dos últimos 7 dias < `min_response_rate`
- Warmup: dia 1 = 10% do limite, dia 2 = 25%, dia 3 = 50%, dia 7+ = 100%
- Jitter randômico entre cada envio na fila (sleep aleatório)
- Bloqueio rígido fora do horário comercial (já existente, reforçado)

---

### Detalhes técnicos

- Migration única, idempotente (ADD COLUMN IF NOT EXISTS)
- Todas as novas funções com try/catch + fallback silencioso
- Feature flags: `ai_followup_humanize`, `ai_followup_reactivation_enabled`, `ai_followup_warmup_enabled` — desligar volta ao comportamento atual
- `routeTree.gen.ts` auto-regenerado pelo Vite plugin
- Zero alteração em: `meta-send`, `meta-webhook`, `inbox.*`, `api.whatsapp.send`, `integrations` (tabela), client.ts

### Não muda

- Inbox, envio manual, webhook Meta, RLS de tabelas existentes, autenticação, rotas existentes (apenas estende `/api/ai/followup-config`).
