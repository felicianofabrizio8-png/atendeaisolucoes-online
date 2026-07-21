# Rollback — Coach V2 Fase 1 + Fase 1.1

> Documento **manual e explícito**. Não existe migration destrutiva automática
> para produção. Toda remoção deve ser executada por um operador com acesso
> `service_role` / `postgres` e sob janela de manutenção.

## Migrations envolvidas

| # | Arquivo | Escopo |
|---|---|---|
| M1 | `supabase/migrations/20260721105324_*.sql` | Fundação da Fase 1: tabelas, enums, RPCs, RLS, triggers |
| M2 | Migration da Fase 1.1 (aditiva, criada em 2026-07-21) | ACL, FKs compostas, trigger de imutabilidade de `company_id`, COMMENTs |

## Pré-condições

- Backup completo do schema `public` (pelo menos `pg_dump --schema-only` + snapshot lógico das 4 tabelas `coach_*`).
- Verificação de que **nenhum agente/serviço** está consumindo `coach_rules` (por design da Fase 1, a integração com o agente NÃO foi feita — a busca abaixo deve retornar vazio):
  ```sql
  -- Nenhum consumidor em produção deve aparecer.
  SELECT tablename FROM pg_stat_user_tables WHERE relname LIKE 'coach_%';
  ```
- Confirmação em código: `git grep -n "coach_rules\|coach_rule_versions" src/` só deve retornar
  `src/lib/coach-rules/coach-rules.repository.ts` e `src/routes/configuracoes_.regras-coach.tsx`.

## Consultas de validação (antes)

```sql
SELECT COUNT(*) AS rules      FROM public.coach_rules;
SELECT COUNT(*) AS versions   FROM public.coach_rule_versions;
SELECT COUNT(*) AS conflicts  FROM public.coach_rule_conflicts;
SELECT COUNT(*) AS events     FROM public.coach_rule_events;
```

Se houver dados a preservar, exportar via
`\copy public.coach_rules TO 'coach_rules.csv' CSV HEADER` (repetir para cada tabela).

## Estratégia recomendada

### Opção A — Desabilitar apenas a UI (mantém schema intacto)

Menor risco. Recomendado quando quiser pausar a Fase 1 sem apagar histórico.

1. Remover a rota `src/routes/configuracoes_.regras-coach.tsx`.
2. Remover imports órfãos do repositório em `src/lib/coach-rules/`.
3. Deploy. Schema, RPCs, RLS e dados permanecem preservados no banco.

### Opção B — Rollback completo do schema (destrutivo)

Ordem obrigatória — **não usar `DROP ... CASCADE`** (mascara dependências inesperadas).

```sql
BEGIN;

-- 1. Revogar privilégios (Fase 1.1)
REVOKE ALL ON FUNCTION public.create_coach_rule_draft(
  public.coach_rule_category, public.coach_rule_type, text, text, smallint,
  public.coach_rule_scope_kind, jsonb, timestamptz, timestamptz) FROM authenticated;
REVOKE ALL ON FUNCTION public.create_coach_rule_version(
  uuid, public.coach_rule_type, text, text, smallint,
  public.coach_rule_scope_kind, jsonb, uuid) FROM authenticated;
REVOKE ALL ON FUNCTION public.submit_coach_rule_version(uuid) FROM authenticated;
REVOKE ALL ON FUNCTION public.approve_coach_rule_version(uuid, boolean) FROM authenticated;
REVOKE ALL ON FUNCTION public.reject_coach_rule_version(uuid, text) FROM authenticated;
REVOKE ALL ON FUNCTION public.activate_coach_rule_version(uuid) FROM authenticated;
REVOKE ALL ON FUNCTION public.pause_coach_rule(uuid) FROM authenticated;
REVOKE ALL ON FUNCTION public.archive_coach_rule(uuid) FROM authenticated;
REVOKE ALL ON FUNCTION public.replace_coach_rule(uuid, uuid) FROM authenticated;
REVOKE ALL ON FUNCTION public.coach_validate_scope_ref(
  public.coach_rule_scope_kind, jsonb) FROM authenticated;

-- 2. Triggers (Fase 1.1)
DROP TRIGGER IF EXISTS trg_coach_rules_company_immutable          ON public.coach_rules;
DROP TRIGGER IF EXISTS trg_coach_rule_versions_company_immutable  ON public.coach_rule_versions;
DROP TRIGGER IF EXISTS trg_coach_rule_conflicts_company_immutable ON public.coach_rule_conflicts;

-- 3. FKs / uniques compostas (Fase 1.1)
ALTER TABLE public.coach_rules         DROP CONSTRAINT IF EXISTS coach_rules_active_version_composite_fk;
ALTER TABLE public.coach_rule_versions DROP CONSTRAINT IF EXISTS coach_rule_versions_rule_company_fk;
ALTER TABLE public.coach_rule_versions DROP CONSTRAINT IF EXISTS coach_rule_versions_id_rule_company_uniq;
ALTER TABLE public.coach_rules         DROP CONSTRAINT IF EXISTS coach_rules_id_company_uniq;

-- 4. Triggers da Fase 1
DROP TRIGGER IF EXISTS trg_coach_rules_updated              ON public.coach_rules;
DROP TRIGGER IF EXISTS trg_coach_rule_versions_updated      ON public.coach_rule_versions;
DROP TRIGGER IF EXISTS trg_coach_rule_versions_immutable    ON public.coach_rule_versions;
DROP TRIGGER IF EXISTS trg_coach_rule_events_no_update      ON public.coach_rule_events;
DROP TRIGGER IF EXISTS trg_coach_rule_events_no_delete      ON public.coach_rule_events;

-- 5. RPCs administrativas (usar assinaturas completas)
DROP FUNCTION IF EXISTS public.create_coach_rule_draft(
  public.coach_rule_category, public.coach_rule_type, text, text, smallint,
  public.coach_rule_scope_kind, jsonb, timestamptz, timestamptz);
DROP FUNCTION IF EXISTS public.create_coach_rule_version(
  uuid, public.coach_rule_type, text, text, smallint,
  public.coach_rule_scope_kind, jsonb, uuid);
DROP FUNCTION IF EXISTS public.submit_coach_rule_version(uuid);
DROP FUNCTION IF EXISTS public.approve_coach_rule_version(uuid, boolean);
DROP FUNCTION IF EXISTS public.reject_coach_rule_version(uuid, text);
DROP FUNCTION IF EXISTS public.activate_coach_rule_version(uuid);
DROP FUNCTION IF EXISTS public.pause_coach_rule(uuid);
DROP FUNCTION IF EXISTS public.archive_coach_rule(uuid);
DROP FUNCTION IF EXISTS public.replace_coach_rule(uuid, uuid);

-- 6. Funções auxiliares e trigger functions
DROP FUNCTION IF EXISTS public.coach_prevent_company_change();
DROP FUNCTION IF EXISTS public.coach_rule_events_append_only();
DROP FUNCTION IF EXISTS public.coach_rule_versions_immutable_guard();
DROP FUNCTION IF EXISTS public.coach_assert_admin(uuid);
DROP FUNCTION IF EXISTS public.coach_content_hash(
  public.coach_rule_category, public.coach_rule_type, smallint,
  public.coach_rule_scope_kind, jsonb, text, text);
DROP FUNCTION IF EXISTS public.coach_is_critical_category(public.coach_rule_category);
DROP FUNCTION IF EXISTS public.coach_validate_scope_ref(
  public.coach_rule_scope_kind, jsonb);

-- 7. Tabelas — ordem: dependentes primeiro
DROP TABLE IF EXISTS public.coach_rule_events;
DROP TABLE IF EXISTS public.coach_rule_conflicts;
DROP TABLE IF EXISTS public.coach_rule_versions;
DROP TABLE IF EXISTS public.coach_rules;

-- 8. Enums
DROP TYPE IF EXISTS public.coach_rule_event_type;
DROP TYPE IF EXISTS public.coach_rule_version_status;
DROP TYPE IF EXISTS public.coach_rule_status;
DROP TYPE IF EXISTS public.coach_rule_scope_kind;
DROP TYPE IF EXISTS public.coach_rule_type;
DROP TYPE IF EXISTS public.coach_rule_category;

COMMIT;
```

## Consultas de validação (depois)

```sql
SELECT COUNT(*) FROM information_schema.tables  WHERE table_schema='public' AND table_name LIKE 'coach_%';  -- 0
SELECT COUNT(*) FROM pg_type WHERE typname LIKE 'coach_rule_%';                                            -- 0
SELECT COUNT(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
 WHERE n.nspname='public' AND p.proname LIKE 'coach\_%' ESCAPE '\';                                        -- 0
```

## Restauração a partir de backup

Após rollback destrutivo, restaurar apenas as tabelas `coach_*` a partir do
snapshot lógico:

```bash
pg_restore --data-only --table=public.coach_rules \
           --table=public.coach_rule_versions \
           --table=public.coach_rule_conflicts \
           --table=public.coach_rule_events \
           <arquivo-de-backup>
```

Aplicar novamente **M1** e **M2** antes do restore (o schema precisa existir).

## Notas

- **Não** existe cron/worker consumindo `coach_rules` na Fase 1 — nada de
  jobs/timers precisa ser pausado antes do rollback.
- A tabela `coach_rule_conflicts` é reservada — nenhum detector automático a
  popula. Ela pode ser removida junto com as demais sem impacto operacional.
- A integração com o agente (`src/lib/ai-agent.server.ts`) **não** foi feita
  na Fase 1/1.1. Nenhum prompt precisa ser revertido.
