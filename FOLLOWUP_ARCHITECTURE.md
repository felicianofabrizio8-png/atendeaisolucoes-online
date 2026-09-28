# Follow-up — Arquitetura Oficial (v2.0)

> Documento canônico do módulo `src/lib/followup/`.
> v2.0 (setembro/2026): follow-up por **ciclo de negociação**.

---

## 1. Visão Geral

Follow-up é **retomar uma mensagem nossa que ficou sem resposta** — texto,
orçamento enviado ou visita realizada. Cliente esperando resposta NÃO é
follow-up: é **pendência de atendimento** (contada à parte no tick).

Cada negociação sem resposta vira um **ciclo** (`followup_cycles`) com
motivo, referência, tentativas, próxima data e estado. O ciclo encerra quando
o cliente responde, a venda é fechada/perdida, um humano assume, o cliente
perde o interesse, as tentativas acabam ou os envios falham repetidamente.
Uma nova negociação abre outro ciclo para o mesmo lead — não existe limite
vitalício por lead.

`dispatch.ts` é o **único motor de envio** (tick, "Follow-up agora" e
reativação).

---

## 2. Responsabilidades por Camada

| Sub-módulo            | Responsabilidade                                                          |
| --------------------- | ------------------------------------------------------------------------- |
| `types.ts`            | Tipos e contratos públicos.                                               |
| `defaults.ts`         | Templates padrão, render, primeiro nome, horário comercial.               |
| `settings.ts`         | Configuração (v1/v2) em `company_settings`, incluindo fuso e dias úteis.  |
| `calendar.ts`         | Puro: fuso, dias úteis, feriados nacionais, próximo horário útil.         |
| `next-contact.ts`     | Puro: prazo do cliente, validação de sugestão, política de intervalos.    |
| `next-contact-ai.ts`  | IA sugere data de retorno (só quando o cliente fala de tempo).            |
| `candidates.ts`       | Detecta negociações sem resposta (e pendências de atendimento).           |
| `cycles.ts`           | Ciclo: abrir, agendar, reancorar, aplicar resultado, encerrar.            |
| `dispatch.ts`         | Motor único: revalida, escolhe canal, envia, persiste a tentativa.        |
| `resume.ts`           | Contexto da conversa + frase de retomada (`{{1}}`) via LLMGateway.        |
| `resume-phrase.ts`    | Puro: prompt, validação e fallback da frase de retomada.                  |
| `safety.ts`           | Janela de 24h do WhatsApp.                                                |
| `gates.ts`            | Gate global: limite diário, warmup, taxa de resposta. Falha fechada.      |
| `message.ts`          | Texto para dentro da janela (humanização opcional).                       |
| `tick.ts`             | Loop do cron: abre ciclos, processa os vencidos.                          |
| `manual.ts`           | "Follow-up agora": antecipa a próxima tentativa do ciclo.                 |
| `reactivation.ts`     | Reativação opt-in de leads antigos (separada dos ciclos).                 |
| `reconcile.ts`        | Marca envios como `responded` / `recovered`.                              |
| `scoring.ts`, `analytics.ts`, `integration.ts`, `humanizer.ts` | Score, painel, status da integração, variação de texto. |
| `index.ts`            | Barrel oficial.                                                           |

---

## 3. Ciclo de negociação

### Abertura (`candidates.ts` → `cycles.openCycle`)

A cada tick, conversas paradas há ≥ 1h e ≤ 30 dias são classificadas:

| Situação                                                           | Resultado                              |
| ------------------------------------------------------------------ | -------------------------------------- |
| Última mensagem é do cliente                                       | pendência de atendimento               |
| Venda fechada/perdida, humano assumiu, desinteresse                | nada                                   |
| Orçamento `enviado`/`visualizado` depois da última fala do cliente | ciclo `quote_no_reply` (`quote:<id>`)  |
| Visita `concluida` depois da última fala do cliente                | ciclo `visit_no_return` (`visit:<id>`) |
| Nossa mensagem sem resposta, lead quente                           | ciclo `hot_lead_idle` (`msg:<id>`)     |
| Nossa mensagem sem resposta                                        | ciclo `lead_silent` (`msg:<id>`)       |

- Orçamento/visita têm prioridade e só valem por 30 dias (sem elegibilidade eterna).
- Nossa mensagem sem resposta só abre ciclo automático até 7 dias; conversa
  parada há mais tempo é caso de reativação (o "Follow-up agora" não tem esse
  limite).
- Um ciclo ativo por conversa; a mesma referência nunca reabre (índices únicos).
- Novo ciclo só para referência **posterior ao fim do anterior** — os nossos
  próprios follow-ups nunca reabrem a negociação; uma nova conversa, orçamento
  ou visita, sim.
- Orçamento/visita novos numa negociação em curso encerram o ciclo antigo
  como `superseded` e abrem outro.

### Quando é a próxima tentativa (`next-contact.ts`)

Precedência, só para a 1ª tentativa do ciclo:

1. **Prazo explícito do cliente** (parser determinístico): "amanhã", "depois
   de amanhã", "semana que vem", "mês que vem", "fim do mês", "na sexta",
   "a partir de segunda", "daqui a 3 dias", "em duas semanas", "no dia 15",
   "depois do dia 20". Prazo que já passou = próximo horário útil.
2. **Sugestão da IA** — só se o cliente falou de tempo e o parser não
   resolveu ("depois que o salário cair"). Vale apenas se a evidência aparece
   literalmente numa mensagem do cliente e a data está entre hoje e 60 dias.
3. **Política** por motivo e tentativa (horas; a 1ª usa o atraso configurado
   da empresa, as seguintes respeitam o intervalo mínimo como piso):

| Motivo            | 1ª (config.) | 2ª  | 3ª  | 4ª  | 5ª  |
| ----------------- | ------------ | --- | --- | --- | --- |
| `hot_lead_idle`   | 4            | 24  | 72  | 168 | 240 |
| `quote_no_reply`  | 24           | 72  | 168 | 240 | 336 |
| `visit_no_return` | 24           | 72  | 168 | 240 | 336 |
| `lead_silent`     | 48           | 120 | 240 | 336 | 480 |

Tentativas por ciclo = `ai_followup_max_per_lead` (1–5). Toda data cai num
horário útil da empresa — fuso (`ai_followup_timezone`, padrão
`America/Sao_Paulo`), dias úteis (`ai_followup_business_days`, padrão seg–sex),
feriados nacionais e expediente — com espalhamento determinístico de até
`ai_followup_delay_jitter_minutes`.

### Processamento (`tick.ts`)

```text
runFollowupTickForCompany
  ├─ follow-up ligado? prontidão da IA ativa/piloto?
  ├─ scanFollowupOpportunities → openCycle   (a qualquer hora; não envia)
  ├─ horário útil da empresa? gate global (fail-closed)?
  └─ dueCycles (next_followup_at ≤ agora, até 25 e até o limite do dia)
       ├─ equipe falou de novo depois do último contato → reagenda (sem zerar tentativas)
       ├─ buildMessage
       ├─ dispatchFollowup (revalida → texto na janela / template fora dela)
       └─ applyDispatchOutcome
```

### Resultado do envio (`cycles.applyDispatchOutcome`)

| Resultado do dispatch                                                                      | Ciclo                                                       |
| ------------------------------------------------------------------------------------------ | ----------------------------------------------------------- |
| `sent` / `simulated`                                                                       | tentativa +1; agenda a próxima ou encerra `max_attempts`    |
| `skipped` (cliente respondeu, venda fechada/perdida, humano, desinteresse, conversa sumiu) | encerra com o motivo                                        |
| `skipped` (IA processando)                                                                 | adia 15 min                                                 |
| `failed`                                                                                   | +1 falha, tenta em 1h útil; 3 falhas → `send_failed`        |
| `blocked` (sem template aprovado)                                                          | +1 falha, tenta no dia útil seguinte; 3 → `template_missing` |

Resposta do cliente também encerra o ciclo direto no banco: o trigger
`cancel_pending_followups_on_reply` (em `messages`) fecha o ciclo ativo como
`client_replied` e marca os envios como `responded`. A conversa segue com o
fluxo normal da IA.

---

## 4. Motor de envio (`dispatch.ts`)

1. `revalidateFollowup` antes do trabalho caro e de novo imediatamente antes
   do envio — devolve um código (`client_replied`, `sale_closed`,
   `sale_lost`, `human_takeover`, `disinterest`, `conversation_missing`,
   `ai_busy`) que o ciclo usa para encerrar ou adiar.
2. Dentro da janela 24h: texto (`sendWhatsappText`).
3. Fora da janela: `chamar_novamente` (propósito `followup_resume`, Marketing
   ou Utility) com `{{1}}` = retomada contextual gerada pela IA a partir da
   conversa real — nunca o nome do cliente, valores, quebra de linha ou
   placeholder; IA indisponível ou frase reprovada → fallback contextual
   determinístico (orçamento → objeção → produto). Empresa sem
   `chamar_novamente` aprovado usa o template legado do propósito.
4. Persiste a tentativa em `follow_ups` (com `cycle_id`) e o evento em
   `ai_flow_events`.

---

## 5. "Follow-up agora" (`manual.ts`)

Admin antecipa a próxima tentativa: usa o ciclo ativo da conversa ou abre um
pelas mesmas regras de detecção (sem a carência de 1h), envia **já** pelo
`dispatch` e o resultado reagenda/encerra o ciclo normalmente. Cliente
esperando resposta → bloqueado (é atendimento pendente). Mantém o anti-spam
de 30s e a auditoria (`audit_log`). Não espera horário comercial nem gate
diário: é ação explícita do admin.

---

## 6. Reativação (`reactivation.ts`)

Opt-in, acionada pelo painel `/ia`, separada dos ciclos. Leads não
fechados/perdidos, sem `reactivated_at`, parados há `reactivation_days`,
sem ciclo ativo. Envia pelo `dispatch` (fora da janela → template aprovado,
nunca texto livre). "Máximo por dia" é contado no dia (fuso da empresa), não
por clique. Horário próprio no fuso e dias úteis da empresa. Grava
`trigger_reason = 'reactivation'`; `reactivated_at` só em envio real.

---

## 7. Gates globais (`gates.ts`)

Falha **fechada**: erro de consulta, integração indisponível ou configuração
ilegível bloqueiam o envio.

- Integração WhatsApp conectada.
- Limite diário contado da meia-noite no fuso da empresa, só com envios
  entregues (`sent`/`responded`/`recovered`).
- Warmup progressivo (10% → 25% → 50% → 100% em 7 dias); começa a contar no
  primeiro uso (`ai_followup_warmup_started_at` é gravado automaticamente).
- Pausa automática se a taxa de resposta dos últimos 7 dias (≥ 20 envios
  entregues) ficar abaixo de `ai_followup_min_response_rate`.

---

## 8. Banco de Dados

- `followup_cycles` — ciclos (RLS: leitura pela empresa; escrita só servidor).
- `follow_ups` — tentativas (`cycle_id`; status `sent`, `responded`,
  `recovered`, `ignored`, `failed`, `blocked`, `simulated`, `cancelled`).
- `company_settings` — `ai_followup_*`, incluindo `ai_followup_timezone` e
  `ai_followup_business_days`.
- `ai_flow_events` — `followup_sent`, `followup_simulated`, `followup_failed`,
  `template_missing`, `followup_responded`, `lead_recovered`,
  `followup_auto_cancelled`.
- `audit_log` — "Follow-up agora".

Migrations: `20260928120000_allow_followup_flow_events.sql`,
`20260928130000_followup_cycles.sql`.

---

## 9. Pontos de Integração

| Contexto            | Arquivo                                         | Uso                                        |
| ------------------- | ----------------------------------------------- | ------------------------------------------ |
| Cron externo        | `src/routes/api.public.hooks.followup-tick.tsx` | `runFollowupTickAll`, `reconcileResponses` |
| Painel `/ia`        | `src/routes/api.ai.followup-*.tsx`              | settings, status, analytics, reativação    |
| Inbox / Atendimento | `src/lib/manual-followup.functions.ts`          | `runManualFollowup`                        |

Toda consulta é escopada por `company_id`.
