
# Fase Estabilidade Operacional & Preparação Multiempresa

Escopo grande demais para uma única execução. Proponho dividir em **4 sub-fases entregáveis**, cada uma com migração + UI mínima, validável isoladamente, sem tocar inbox/WhatsApp/webhooks/Meta OAuth/IA/lazy loading.

---

## Sub-fase A — Observabilidade (base de tudo)

**Por que primeiro:** sem logs não dá pra validar nada das fases seguintes.

**Migração:**
- Tabela `audit_log` (id, company_id, user_id, action, entity, entity_id, before jsonb, after jsonb, created_at, ip, user_agent)
- Tabela `error_log` (id, company_id, source: ia|upload|meta|storage|supabase, severity, message, context jsonb, created_at)
- Índices: `(company_id, created_at desc)` em ambas
- RLS: SELECT por company_id + admin role; INSERT via service_role apenas
- Helper SQL `log_audit(action, entity, entity_id, before, after)` SECURITY DEFINER

**Código:**
- `src/lib/audit.ts` — helper cliente que chama serverFn `logAudit`
- ServerFn `logAudit` / `logError`
- Instrumentar: delete campanha, delete produto, delete lead, delete criativo, update company_settings, update integrations (Meta tokens), insert/delete user_roles

**Sem UI nova nesta sub-fase** (visualização vem em D).

---

## Sub-fase B — Gestão de Usuários & Papéis

**Migração:**
- Tabela `company_invites` (id, company_id, email, role app_role, token, expires_at, accepted_at, invited_by)
- Adicionar `last_seen_at` em `profiles`
- Policies: admin gerencia invites e user_roles da própria empresa
- INSERT/UPDATE/DELETE em `user_roles` liberado para admin via policy nova

**Código:**
- Rota `/configuracoes/usuarios` (somente admin)
  - listar membros (profiles + role)
  - convidar (cria invite + envia email via serverFn — usa SMTP existente ou apenas gera link copiável nesta fase)
  - alterar role (com audit_log)
  - remover usuário (delete user_roles, audit_log)
- ServerFn `acceptInvite(token)` — usado no signup
- Hook `useLastSeen()` — pinga `profiles.last_seen_at` a cada 60s
- Helper `useHasRole('admin'|'atendente'|'financeiro')`

---

## Sub-fase C — Billing/Plans + Quotas Estendidas

**Migração:**
- Enum `plan_type` ('free','pro','premium')
- Adicionar em `companies`: `plan_type` default 'free', `feature_flags jsonb`, `limits_json jsonb`
- Seed defaults por plano:
  - free: storage 500MB, 1k msgs/mês, 1 user, 3 campanhas
  - pro: 5GB, 50k msgs, 10 users, ilimitado campanhas
  - premium: 50GB, ilimitado
- Função `check_plan_limit(company_id, feature, requested)` SECURITY DEFINER
- Estender `check_storage_quota` para ler `limits_json->>'storage_mb'` com fallback para `storage_quota_mb`

**Código:**
- `src/lib/plan.ts` — `getCurrentPlan()`, `canUseFeature(flag)`, `getLimit(key)`
- Sem cobrança. Sem UI de upgrade. Apenas leitura + enforcement nas mutações existentes.

---

## Sub-fase D — Painel Operacional + Hardening Meta + Performance

**D1 — Painel `/configuracoes/operacao` (admin):**
- Cards simples (sem charts): storage usado, msgs mês, campanhas ativas, uso IA mês, uploads mês
- Lista últimos 20 `error_log` da empresa
- Lista últimos 50 `audit_log` da empresa
- Status integrações (verde/amarelo/vermelho baseado em `token_expires_at` e `last_error`)

**D2 — Hardening Meta/WhatsApp (sem tocar webhook):**
- ServerFn `checkIntegrationHealth(id)` — valida token, atualiza `last_error` e `token_expires_at`
- Cron leve via rota `/api/public/hooks/integration-health-tick` (apenas marca status; não envia mensagem)
- UI em `/whatsapp` — badge de status + botão "Revalidar token"
- Circuit breaker em `src/lib/wa-send.ts` (novo wrapper): se 3 falhas consecutivas em 5min → bloqueia envios por 2min e loga em `error_log`. **NÃO modifica `api.whatsapp.send.tsx` existente** — apenas oferece helper opt-in.

**D3 — Performance:**
- Auditar queries em `/inbox`, `/campanhas`, `/produtos`, `/leads`
- Adicionar `.range(from, to)` + UI de paginação onde lista pode passar de 100
- Índices: `messages(conversation_id, at desc)`, `leads(company_id, updated_at desc)`, `campaigns(company_id, created_at desc)` — verificar se já existem antes de criar

---

## Teste multiempresa (executado por você, manualmente)

Não vou criar empresas/usuários automaticamente — isso requer signup real via Supabase Auth (que envia emails). Em vez disso, ao final de cada sub-fase entrego um **checklist de validação manual** para você executar com 3 contas de teste reais (ex: `admin@teste1.com`, `atendente@teste1.com`, etc.) e reportar inconsistências.

---

## Não será alterado

Inbox, webhooks Meta/WhatsApp, Meta OAuth, código das campanhas existentes, pipeline da IA, lazy loading, SmartImage, RLS atual (apenas **adições**, sem remoção/relax), `supabase/functions/*`.

---

## Ordem de execução proposta

1. **Sub-fase A** (audit/error log) — 1 migração + ~4 arquivos
2. **Sub-fase B** (usuários/papéis) — 1 migração + 1 rota nova + helpers
3. **Sub-fase C** (plans/limits) — 1 migração + helper lib
4. **Sub-fase D** (painel + meta health + perf) — 1 migração + 1 rota + ajustes pontuais

Cada sub-fase = **um turno de implementação**, com relatório curto ao final. Ao terminar D, gero o **relatório final consolidado** com readiness SaaS/multiempresa/produção.

---

**Confirma este plano?** Se sim, começo pela **Sub-fase A (Observabilidade)** no próximo turno.
Se quiser ajustar ordem, cortar algum item, ou unir sub-fases, me diz antes.
