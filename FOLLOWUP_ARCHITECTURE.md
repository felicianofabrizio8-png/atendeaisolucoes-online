# Follow-up — Arquitetura Oficial (v1.0)

> Documento canônico do módulo `src/lib/followup/`.
> Consolidado na Fase A do Plano Diretor Arquitetura 2.0.
> Última revisão: Julho/2026.

---

## 1. Visão Geral

O módulo Follow-up é responsável por **manter o relacionamento vivo com leads**
sem intervenção humana, garantindo três coisas simultaneamente:

1. **Continuidade comercial** — reengajar leads silenciosos, orçamentos sem
   resposta, visitas sem retorno, clientes antigos que voltaram a falar.
2. **Segurança de conta WhatsApp** — respeitar janela de 24h, warmup diário,
   limites, taxa de resposta mínima, horário comercial e handoff humano.
3. **Auditabilidade** — cada envio gera linhas em `follow_ups`,
   `ai_flow_events` e, no caso do disparo manual, `audit_log`.

O módulo NÃO altera Runtime, Event Bus, `ai-agent`, `meta-webhook` nem
`Evolution`. Ele apenas **lê** o estado atual e **envia** mensagens
reutilizando `sendWhatsappText` / `sendWhatsappTemplate`.

---

## 2. Responsabilidades por Camada

| Sub-módulo             | Responsabilidade                                                        |
| ---------------------- | ----------------------------------------------------------------------- |
| `types.ts`             | Tipos e contratos públicos.                                             |
| `defaults.ts`          | Templates padrão, helpers puros (nome, horário comercial, render).      |
| `settings.ts`          | Leitura de configuração (v1 e v2) em `company_settings`.                |
| `humanizer.ts`         | Variação linguística determinística das mensagens (v2 opt-in).          |
| `candidates.ts`        | Descoberta de conversas elegíveis por regra.                            |
| `safety.ts`            | Regras de bloqueio: handoff, spam, limite, intervalo, janela 24h.       |
| `message.ts`           | Renderização final da mensagem (com/sem humanização).                   |
| `tick.ts`              | Loop principal e agregador multi-empresa (cron).                        |
| `reconcile.ts`         | Marca respostas / recuperações em `follow_ups`.                         |
| `integration.ts`       | Status WhatsApp / eventos não mapeados.                                 |
| `scoring.ts`           | Cálculo de score de lead e resumo de temperatura.                       |
| `gates.ts`             | Limite diário + warmup + taxa mínima de resposta (v2).                  |
| `analytics.ts`         | Analytics avançado do painel `/ia`.                                     |
| `reactivation.ts`      | Reativação opt-in de leads antigos.                                     |
| `manual.ts`            | Núcleo do disparo manual (chamado pela server function).                |
| `index.ts`             | Barrel oficial. Único ponto público novo.                               |

---

## 3. Fluxo Completo

```text
                          ┌────────────────────────────────┐
   cron pg_cron  ────────▶│ /api/public/hooks/followup-tick│
                          └─────────────┬──────────────────┘
                                        ▼
                                runFollowupTickAll()
                                        │
                            ┌───────────┴────────────┐
                            ▼                        ▼
                 runFollowupTickForCompany     reconcileResponses
                            │
              ┌─────────────┼───────────────┐
              ▼             ▼               ▼
         readiness      businessHours    canSendFollowupNow  ← gates v2
              │             │               │
              └────────┬────┴───────────────┘
                       ▼
                 findCandidates()
                       │
                       ▼   (por candidato)
                 canSend() ──── skip → follow_ups(blocked)
                       │
                       ▼
                 buildMessage()  (humanize?)
                       │
        ┌──────────────┴──────────────┐
        ▼ dentro da janela 24h        ▼ fora da janela 24h
   sendWhatsappText            findApprovedTemplateForPurpose
        │                              │
        │                              ▼
        │                       sendWhatsappTemplate
        └──────────────┬──────────────┘
                       ▼
              INSERT follow_ups
              INSERT ai_flow_events
```

Fluxo do **disparo manual** (painel Inbox):

```text
UI (inbox) → runFollowupNowForConversation (server fn, admin only)
           → runManualFollowup()        [src/lib/followup/manual.ts]
             ├─ guards mínimos (handoff, desinteresse, spam 30s)
             ├─ humanize opt-in
             ├─ envio (texto ou template)
             └─ INSERT follow_ups + audit_log
```

Fluxo de **reativação** (opt-in, chamado sob demanda):

```text
runReactivation(companyId)
  ├─ canSendFollowupNow (gate v2)
  ├─ withinTimeWindow (horário v2)
  ├─ leads inativos ≥ N dias
  └─ humanize + sendWhatsappText + INSERT follow_ups
```

---

## 4. Funções Públicas (`import { … } from "@/lib/followup"`)

### Configuração
- `getFollowupSettings(companyId)`
- `getFollowupV2Settings(companyId)`

### Execução (cron / painel)
- `runFollowupTickForCompany(companyId): Promise<TickResult>`
- `runFollowupTickAll(): Promise<TickResult[]>`
- `reconcileResponses(companyId): Promise<number>`
- `runReactivation(companyId): Promise<ReactivationResult>`
- `runManualFollowup(params): Promise<ManualFollowupResult>` (usado pela server fn)

### Detecção
- `findCandidates(companyId, settings, limit?): Promise<Candidate[]>`

### Segurança e limites
- `canSendFollowupNow(companyId): Promise<SendGateResult>`

### Métricas e leitura
- `getWhatsappIntegrationStatus(companyId): Promise<WhatsappIntegrationStatus>`
- `getLeadTemperatureSummary(companyId): Promise<{hot,warm,cold}>`
- `computeLeadScore(leadId): Promise<LeadScoreResult>`
- `getAdvancedAnalytics(companyId): Promise<AdvancedAnalytics>`

### Utilidades puras
- `humanizeTemplate(rawTemplate, attempt, seed, vars)`
- `jitterDelayMs(baseMs, jitterMinutes)`

---

## 5. Funções Internas (não exportadas pelo barrel)

- `defaults.ts` → `renderTemplate`, `firstName`, `isWithinBusinessHours`, `DEFAULT_TEMPLATES`.
- `safety.ts` → `canSend` (checagem por candidato).
- `message.ts` → `buildMessage`.
- `gates.ts` → `warmupCapacity`.
- `reactivation.ts` → `withinTimeWindow`.
- `humanizer.ts` → `pickSeeded`, listas `GREETINGS/EMOJIS/CTAS`.

---

## 6. Dependências

Externas:
- `@/integrations/supabase/client.server` → `supabaseAdmin` (leitura/escrita).
- `@/lib/ai-agent.server` → `sendWhatsappText`.
- `@/lib/ai-readiness.server` → `getReadiness` (guard do piloto).
- `@/lib/wa-templates.server` → `sendWhatsappTemplate`, `findApprovedTemplateForPurpose`, `TemplatePurpose`.

Internas (grafo, sem ciclos):

```text
types.ts        ← (nenhuma)
defaults.ts     ← types
humanizer.ts    ← (nenhuma)
settings.ts     ← types, defaults
integration.ts  ← (nenhuma)
scoring.ts     ← types
gates.ts        ← settings, integration
analytics.ts    ← settings, gates (warmupCapacity via re-import interno)
candidates.ts   ← types, settings, defaults
safety.ts       ← types, settings
message.ts      ← types, settings, defaults, humanizer
tick.ts         ← types, settings, defaults, candidates, safety, message,
                  gates, ai-readiness, ai-agent, wa-templates
reconcile.ts    ← (supabaseAdmin apenas)
reactivation.ts ← settings, gates, humanizer, ai-agent (dyn)
manual.ts       ← settings, defaults, humanizer, ai-agent, wa-templates
index.ts        ← re-export de todos os acima
```

---

## 7. Exports Oficiais (barrel `@/lib/followup`)

Definidos em `src/lib/followup/index.ts`. Toda nova consumidora **deve**
importar do barrel. Arquivos legados (`ai-followup.server.ts`,
`ai-followup-v2.server.ts`) permanecem como **façanas de retrocompatibilidade**
até auditoria posterior — não devem receber novo código.

---

## 8. Pontos de Integração

| Contexto             | Arquivo                                             | Uso                                                              |
| -------------------- | --------------------------------------------------- | ---------------------------------------------------------------- |
| Cron externo         | `src/routes/api.public.hooks.followup-tick.tsx`     | `runFollowupTickAll`, `reconcileResponses`                       |
| Painel `/ia`         | `src/routes/api.ai.followup-config.tsx`             | settings + tick + analytics                                      |
| Painel `/ia` status  | `src/routes/api.ai.followup-status.tsx`             | integração + gates + analytics                                   |
| Painel `/ia`         | `src/routes/api.ai.followup-reactivate.tsx`         | `runReactivation`                                                |
| Inbox                | `src/routes/inbox.$conversationId.lazy.tsx`         | `runFollowupNowForConversation`                                  |
| Server fn manual     | `src/lib/manual-followup.functions.ts`              | delega para `runManualFollowup` (novo core)                      |

---

## 9. Cron

- **Job**: `ai-followup-tick` (pg_cron)
- **Endpoint**: `POST /api/public/hooks/followup-tick`
- **Header**: `x-cron-secret: $CRON_SECRET`
- **Ciclo**: dispara `runFollowupTickAll()` e, na sequência,
  `reconcileResponses()` para cada empresa habilitada.

---

## 10. Banco de Dados

Tabelas lidas/escritas:

- `company_settings` — colunas `ai_followup_*`, `business_hours_*`, `ai_agent_name`, `ai_initial_message`.
- `conversations` — leitura de estado (ai_status, ai_handling, human_takeover_at, last_message_at, lead_temperature, lead_ready_to_close).
- `messages` — leitura por role e janela temporal.
- `leads` — leitura (name, product, status, closed/lost/reactivated), atualização (`lead_score`, `lead_temperature_cached`, `last_score_at`, `reactivated_at`).
- `quotes` — leitura de orçamentos enviados.
- `visits` — leitura de visitas concluídas.
- `follow_ups` — **escrita canônica** de tentativas (status: sent, failed, blocked, responded, recovered).
- `ai_flow_events` — trilha operacional (followup_sent, followup_failed, followup_responded, lead_recovered, template_missing).
- `audit_log` — trilha admin apenas no fluxo manual.
- `integrations` / `whatsapp_unmapped_events` — status da conexão.

Nenhuma migration nova é introduzida na Fase A.

---

## 11. Sequência de Execução (Tick)

1. `runFollowupTickAll` seleciona `company_settings.ai_followup_enabled = true`.
2. Para cada empresa, `runFollowupTickForCompany`:
   1. Lê settings v1. Se `!enabled`, retorna vazio.
   2. `getReadiness` — status precisa ser `ativa` ou `piloto`.
   3. `isWithinBusinessHours` — respeita janela configurada.
   4. `canSendFollowupNow` (v2) — limite diário + warmup + taxa mínima.
   5. `findCandidates` — coleta e prioriza regras (hot > quote > visit > returning > silent).
   6. Loop: para cada candidato:
      - `canSend` (handoff/spam/intervalo/max) → skip com motivo.
      - `buildMessage` (humanize se v2.humanize).
      - Detecta janela 24h.
      - Envia (texto direto **ou** template Utility aprovado).
      - Insere `follow_ups` + `ai_flow_events`.
3. Ao final, `reconcileResponses` marca respostas do lead posteriores ao envio,
   promovendo para `responded` ou `recovered` (se lead virou venda).

---

## 12. Regras de Extensão

Toda nova regra de follow-up deve:
1. Ser adicionada como caso em `FollowupRule` (`types.ts`).
2. Ganhar template padrão em `DEFAULT_TEMPLATES` (`defaults.ts`).
3. Ganhar detector em `findCandidates` (`candidates.ts`).
4. Manter prioridade explícita no `priority` map de `candidates.ts`.
5. Ter cobertura na tabela `follow_ups.rule_type` (já livre-texto).

Nenhuma dessas alterações deve mexer em endpoints existentes.
