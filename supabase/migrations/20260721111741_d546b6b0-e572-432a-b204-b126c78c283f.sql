
-- =====================================================================
-- COACH V2 — FASE 1.1 HARDENING (aditiva)
-- =====================================================================

-- ---------------------------------------------------------------------
-- 0) VALIDAÇÃO DEFENSIVA — aborta se dados existentes forem inconsistentes
-- ---------------------------------------------------------------------
DO $$
DECLARE
  v_bad_versions int;
  v_bad_active   int;
BEGIN
  SELECT COUNT(*) INTO v_bad_versions
    FROM public.coach_rule_versions v
    JOIN public.coach_rules r ON r.id = v.rule_id
   WHERE r.company_id <> v.company_id;
  IF v_bad_versions > 0 THEN
    RAISE EXCEPTION 'coach_hardening_abort: % versão(ões) com company_id divergente da regra. Corrija manualmente antes de aplicar.', v_bad_versions;
  END IF;

  SELECT COUNT(*) INTO v_bad_active
    FROM public.coach_rules r
   WHERE r.active_version_id IS NOT NULL
     AND NOT EXISTS (
       SELECT 1 FROM public.coach_rule_versions v
        WHERE v.id = r.active_version_id
          AND v.rule_id = r.id
          AND v.company_id = r.company_id
     );
  IF v_bad_active > 0 THEN
    RAISE EXCEPTION 'coach_hardening_abort: % regra(s) com active_version_id inconsistente. Corrija manualmente antes de aplicar.', v_bad_active;
  END IF;
END $$;

-- ---------------------------------------------------------------------
-- 1) ACL — RPCs administrativas: REVOKE PUBLIC/anon, GRANT authenticated
-- ---------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.create_coach_rule_draft(
  public.coach_rule_category, public.coach_rule_type, text, text,
  smallint, public.coach_rule_scope_kind, jsonb, timestamptz, timestamptz
) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.create_coach_rule_draft(
  public.coach_rule_category, public.coach_rule_type, text, text,
  smallint, public.coach_rule_scope_kind, jsonb, timestamptz, timestamptz
) FROM anon;
GRANT EXECUTE ON FUNCTION public.create_coach_rule_draft(
  public.coach_rule_category, public.coach_rule_type, text, text,
  smallint, public.coach_rule_scope_kind, jsonb, timestamptz, timestamptz
) TO authenticated;

REVOKE ALL ON FUNCTION public.create_coach_rule_version(
  uuid, public.coach_rule_type, text, text, smallint,
  public.coach_rule_scope_kind, jsonb, uuid
) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.create_coach_rule_version(
  uuid, public.coach_rule_type, text, text, smallint,
  public.coach_rule_scope_kind, jsonb, uuid
) FROM anon;
GRANT EXECUTE ON FUNCTION public.create_coach_rule_version(
  uuid, public.coach_rule_type, text, text, smallint,
  public.coach_rule_scope_kind, jsonb, uuid
) TO authenticated;

REVOKE ALL ON FUNCTION public.submit_coach_rule_version(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.submit_coach_rule_version(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.submit_coach_rule_version(uuid) TO authenticated;

REVOKE ALL ON FUNCTION public.approve_coach_rule_version(uuid, boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.approve_coach_rule_version(uuid, boolean) FROM anon;
GRANT EXECUTE ON FUNCTION public.approve_coach_rule_version(uuid, boolean) TO authenticated;

REVOKE ALL ON FUNCTION public.reject_coach_rule_version(uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.reject_coach_rule_version(uuid, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.reject_coach_rule_version(uuid, text) TO authenticated;

REVOKE ALL ON FUNCTION public.activate_coach_rule_version(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.activate_coach_rule_version(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.activate_coach_rule_version(uuid) TO authenticated;

REVOKE ALL ON FUNCTION public.pause_coach_rule(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.pause_coach_rule(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.pause_coach_rule(uuid) TO authenticated;

REVOKE ALL ON FUNCTION public.archive_coach_rule(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.archive_coach_rule(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.archive_coach_rule(uuid) TO authenticated;

REVOKE ALL ON FUNCTION public.replace_coach_rule(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.replace_coach_rule(uuid, uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.replace_coach_rule(uuid, uuid) TO authenticated;

-- ---------------------------------------------------------------------
-- 2) ACL — Funções auxiliares internas (não devem ser chamadas por cliente)
--    * coach_validate_scope_ref: usada em CHECK constraints — mantém EXECUTE
--      para authenticated (necessário quando o próprio usuário fizer INSERT
--      privilegiado via RPC; o CHECK é avaliado no contexto do owner nas
--      RPCs SECURITY DEFINER, mas manter authenticated evita quebra caso
--      alguma leitura futura o invoque).
--    * coach_content_hash / coach_is_critical_category / coach_assert_admin:
--      usadas apenas por RPCs SECURITY DEFINER — sem necessidade de exposição.
-- ---------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.coach_content_hash(
  public.coach_rule_category, public.coach_rule_type, smallint,
  public.coach_rule_scope_kind, jsonb, text, text
) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.coach_content_hash(
  public.coach_rule_category, public.coach_rule_type, smallint,
  public.coach_rule_scope_kind, jsonb, text, text
) FROM anon;
REVOKE ALL ON FUNCTION public.coach_content_hash(
  public.coach_rule_category, public.coach_rule_type, smallint,
  public.coach_rule_scope_kind, jsonb, text, text
) FROM authenticated;

REVOKE ALL ON FUNCTION public.coach_is_critical_category(public.coach_rule_category) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.coach_is_critical_category(public.coach_rule_category) FROM anon;
REVOKE ALL ON FUNCTION public.coach_is_critical_category(public.coach_rule_category) FROM authenticated;

REVOKE ALL ON FUNCTION public.coach_assert_admin(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.coach_assert_admin(uuid) FROM anon;
REVOKE ALL ON FUNCTION public.coach_assert_admin(uuid) FROM authenticated;

-- coach_validate_scope_ref permanece acessível (referenciado em CHECK constraints).
REVOKE ALL ON FUNCTION public.coach_validate_scope_ref(
  public.coach_rule_scope_kind, jsonb
) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.coach_validate_scope_ref(
  public.coach_rule_scope_kind, jsonb
) FROM anon;
GRANT EXECUTE ON FUNCTION public.coach_validate_scope_ref(
  public.coach_rule_scope_kind, jsonb
) TO authenticated;

-- Trigger functions — só devem ser executadas pelo próprio Postgres via trigger.
REVOKE ALL ON FUNCTION public.coach_rule_versions_immutable_guard() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.coach_rule_versions_immutable_guard() FROM anon;
REVOKE ALL ON FUNCTION public.coach_rule_versions_immutable_guard() FROM authenticated;

REVOKE ALL ON FUNCTION public.coach_rule_events_append_only() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.coach_rule_events_append_only() FROM anon;
REVOKE ALL ON FUNCTION public.coach_rule_events_append_only() FROM authenticated;

-- ---------------------------------------------------------------------
-- 3) INTEGRIDADE COMPOSTA — regra × versão × active_version_id
-- ---------------------------------------------------------------------

-- 3.1 Chaves únicas exigidas para as FKs compostas.
ALTER TABLE public.coach_rules
  ADD CONSTRAINT coach_rules_id_company_uniq UNIQUE (id, company_id);

ALTER TABLE public.coach_rule_versions
  ADD CONSTRAINT coach_rule_versions_id_rule_company_uniq
  UNIQUE (id, rule_id, company_id);

-- 3.2 Substitui FK simples rule_id → coach_rules(id) por composta (rule_id, company_id).
--     A FK original foi criada implicitamente via REFERENCES na coluna. Nome padrão:
--     coach_rule_versions_rule_id_fkey.
ALTER TABLE public.coach_rule_versions
  DROP CONSTRAINT IF EXISTS coach_rule_versions_rule_id_fkey;

ALTER TABLE public.coach_rule_versions
  ADD CONSTRAINT coach_rule_versions_rule_company_fk
  FOREIGN KEY (rule_id, company_id)
  REFERENCES public.coach_rules(id, company_id)
  ON DELETE CASCADE;

-- 3.3 Substitui FK de active_version_id por composta que garante mesma regra e empresa.
ALTER TABLE public.coach_rules
  DROP CONSTRAINT IF EXISTS coach_rules_active_version_fk;

ALTER TABLE public.coach_rules
  ADD CONSTRAINT coach_rules_active_version_composite_fk
  FOREIGN KEY (active_version_id, id, company_id)
  REFERENCES public.coach_rule_versions(id, rule_id, company_id)
  ON DELETE SET NULL
  DEFERRABLE INITIALLY IMMEDIATE;
  -- MATCH SIMPLE (default): quando active_version_id é NULL, a FK é ignorada.

-- ---------------------------------------------------------------------
-- 4) IMUTABILIDADE DE company_id — trigger de proteção
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.coach_prevent_company_change()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.company_id IS DISTINCT FROM OLD.company_id THEN
    RAISE EXCEPTION 'coach_company_id_immutable' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.coach_prevent_company_change() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.coach_prevent_company_change() FROM anon;
REVOKE ALL ON FUNCTION public.coach_prevent_company_change() FROM authenticated;

CREATE TRIGGER trg_coach_rules_company_immutable
  BEFORE UPDATE OF company_id ON public.coach_rules
  FOR EACH ROW EXECUTE FUNCTION public.coach_prevent_company_change();

CREATE TRIGGER trg_coach_rule_versions_company_immutable
  BEFORE UPDATE OF company_id ON public.coach_rule_versions
  FOR EACH ROW EXECUTE FUNCTION public.coach_prevent_company_change();

CREATE TRIGGER trg_coach_rule_conflicts_company_immutable
  BEFORE UPDATE OF company_id ON public.coach_rule_conflicts
  FOR EACH ROW EXECUTE FUNCTION public.coach_prevent_company_change();

-- coach_rule_events já bloqueia todo UPDATE (append-only) — nenhum trigger extra.

-- ---------------------------------------------------------------------
-- 5) DOCUMENTAÇÃO (COMMENTs)
-- ---------------------------------------------------------------------
COMMENT ON TABLE public.coach_rules IS
  'Coach V2 · Identidade estável de uma regra por empresa. Ciclo: draft→active→(paused|archived|replaced). Escrita apenas via RPC SECURITY DEFINER.';
COMMENT ON COLUMN public.coach_rules.active_version_id IS
  'Aponta para coach_rule_versions da MESMA regra e MESMA empresa (FK composta). NULL enquanto nenhuma versão está ativa.';
COMMENT ON COLUMN public.coach_rules.company_id IS
  'Imutável após INSERT (trigger coach_prevent_company_change).';

COMMENT ON TABLE public.coach_rule_versions IS
  'Coach V2 · Conteúdo versionado de uma regra. Imutável a partir de approved/rejected/archived (trigger coach_rule_versions_immutable_guard).';
COMMENT ON COLUMN public.coach_rule_versions.company_id IS
  'Deve coincidir com coach_rules.company_id (FK composta). Imutável após INSERT.';
COMMENT ON COLUMN public.coach_rule_versions.content_hash IS
  'SHA-256 determinístico calculado por coach_content_hash — permite deduplicar e detectar mudanças.';

COMMENT ON TABLE public.coach_rule_conflicts IS
  'Coach V2 · RESERVADA. Fase 1.1 NÃO implementa detector automático de conflitos. Estrutura preservada para uso futuro (Fase 2+).';

COMMENT ON TABLE public.coach_rule_events IS
  'Coach V2 · Trilha de auditoria append-only. UPDATE e DELETE são bloqueados por trigger; INSERT é permitido apenas via RPC SECURITY DEFINER.';

COMMENT ON CONSTRAINT coach_rule_versions_rule_company_fk ON public.coach_rule_versions IS
  'Garante que uma versão só existe se a regra referenciada pertencer à mesma empresa.';
COMMENT ON CONSTRAINT coach_rules_active_version_composite_fk ON public.coach_rules IS
  'Garante que active_version_id pertence à mesma regra e à mesma empresa.';
