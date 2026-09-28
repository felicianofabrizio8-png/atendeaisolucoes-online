# Módulo Follow-up

Núcleo consolidado do sistema de continuidade de atendimento (WhatsApp).
Consolidado na **Fase A** do Plano Diretor da Arquitetura 2.0.

> Consumidores novos devem importar **exclusivamente** de:
> ```ts
> import { runFollowupTickForCompany, canSendFollowupNow } from "@/lib/followup";
>
> Visão completa (ciclos de negociação): `FOLLOWUP_ARCHITECTURE.md`.
> ```
> Os arquivos `src/lib/ai-followup.server.ts`, `src/lib/ai-followup-v2.server.ts`
> e `src/lib/manual-followup.functions.ts` permanecem apenas como **fachadas
> legadas** e serão removidos em fase futura. Não adicione lógica neles.

## Responsabilidade

Detectar, avaliar e enviar mensagens de follow-up automáticas e manuais
respeitando: janela de 24h do WhatsApp Cloud API, horário comercial,
handoff humano, limite diário (warmup), taxa de resposta mínima e regras
de spam.

## Estrutura

| Arquivo             | Papel                                                                   |
| ------------------- | ----------------------------------------------------------------------- |
| `index.ts`          | Barrel oficial (única superfície pública).                              |
| `types.ts`          | Tipos compartilhados (Candidate, TickResult, Settings, etc.).           |
| `defaults.ts`       | Templates padrão + helpers puros (`firstName`, `renderTemplate`, `isWithinBusinessHours`). |
| `settings.ts`       | Leitura de `getFollowupSettings` / `getFollowupV2Settings`.             |
| `candidates.ts`     | Negociações sem resposta (abrem ciclo) e pendências de atendimento.     |
| `cycles.ts`         | Ciclo de negociação: abrir, agendar, aplicar resultado, encerrar.       |
| `next-contact.ts`   | Quando retornar: prazo do cliente, sugestão validada, política.         |
| `calendar.ts`       | Fuso, dias úteis, feriados e próximo horário útil da empresa.           |
| `dispatch.ts`       | Motor único de envio (revalida, texto/template, persiste).              |
| `safety.ts`         | Janela de 24h do WhatsApp.                                              |
| `gates.ts`          | `canSendFollowupNow` + `warmupCapacity` (fail-closed).                  |
| `humanizer.ts`      | `humanizeTemplate` (determinístico) e `jitterDelayMs`.                  |
| `message.ts`        | `buildMessage` — monta texto final (com humanização opcional).          |
| `tick.ts`           | `runFollowupTickForCompany` / `runFollowupTickAll` — loop principal.    |
| `reconcile.ts`      | `reconcileResponses` — marca follow-ups respondidos/recuperados.        |
| `reactivation.ts`   | `runReactivation` — campanhas de reativação em lote.                    |
| `manual.ts`         | `runManualFollowup` — disparo manual via UI.                            |
| `scoring.ts`        | `computeLeadScoreFromDb` + `getLeadTemperatureSummary`.                 |
| `analytics.ts`      | `getAdvancedAnalytics` — métricas agregadas.                            |
| `integration.ts`    | `getWhatsappIntegrationStatus` — status do canal.                       |

## Convenções

- Todo I/O usa `supabaseAdmin` (`client.server.ts`); nenhum acesso direto no navegador.
- Funções puras (`humanizer`, `defaults`, `gates.warmupCapacity`) não têm dependências externas — cobertas por testes unitários em `__tests__/`.
- Nomenclatura: `computeLeadScoreFromDb` (async, consulta banco) é distinto de `computeLeadScore` em `@/lib/ai-qualifier.server` (síncrono, cálculo puro).
  O alias `computeLeadScore` continua exposto pelo barrel apenas por retrocompatibilidade com a fachada v2 legada (`@deprecated`).

## Ver também

- [`FOLLOWUP_ARCHITECTURE.md`](../../../FOLLOWUP_ARCHITECTURE.md) — fluxo completo, diagrama e dependências.
