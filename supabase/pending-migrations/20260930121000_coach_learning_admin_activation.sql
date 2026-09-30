-- =============================================================================
-- PENDENTE (não aplicada automaticamente) — Vendedora IA · Fase 0
--
-- Invariante: aprendizado operacional só entra no grounding da Vendedora
-- (coach_learnings.status = 'active') depois de aprovação explícita de admin.
--
-- Hoje a RLS de coach_learnings permite INSERT/UPDATE a qualquer usuário
-- autenticado da empresa, e as RPCs SECURITY DEFINER (create/update/restore)
-- não checam papel — um usuário comum consegue ativar ou reescrever uma regra
-- ativa direto pelo PostgREST. A checagem de admin existia só na camada de
-- aplicação.
--
-- Este guard roda em BEFORE INSERT/UPDATE, portanto cobre escrita direta e
-- todas as RPCs, para qualquer usuário autenticado que NÃO seja admin da
-- empresa da linha:
--   - INSERT com status 'active' → gravado como 'paused' (aguarda aprovação);
--   - UPDATE que ativa (status → 'active') → erro 42501;
--   - UPDATE que altera conteúdo de uma regra ativa → erro 42501.
-- Contadores de uso/feedback em regras ativas continuam liberados.
-- service_role (auth.uid() nulo: jobs e servidor) não é afetado.
--
-- IMPACTO DE PRODUTO: o "Ensinar a IA" (teach mode) feito por não-admin passa
-- a criar o aprendizado pausado, visível para o admin aprovar, em vez de ativo
-- imediatamente. Confirmar com o time antes de aplicar.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.guard_coach_learning_admin_activation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN
    RETURN NEW;
  END IF;
  IF public.has_role(v_uid, NEW.company_id, 'admin') THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF NEW.status = 'active' THEN
      NEW.status := 'paused';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.status = 'active' AND OLD.status IS DISTINCT FROM 'active' THEN
    RAISE EXCEPTION 'coach_learning_activation_requires_admin' USING ERRCODE = '42501';
  END IF;

  IF OLD.status = 'active' AND NEW.status = 'active' AND (
       NEW.title IS DISTINCT FROM OLD.title
    OR NEW.description IS DISTINCT FROM OLD.description
    OR NEW.rule_structured IS DISTINCT FROM OLD.rule_structured
    OR NEW.positive_example IS DISTINCT FROM OLD.positive_example
    OR NEW.negative_example IS DISTINCT FROM OLD.negative_example
    OR NEW.category IS DISTINCT FROM OLD.category
    OR NEW.product_ref IS DISTINCT FROM OLD.product_ref
    OR NEW.priority IS DISTINCT FROM OLD.priority
    OR NEW.company_id IS DISTINCT FROM OLD.company_id
  ) THEN
    RAISE EXCEPTION 'coach_learning_active_edit_requires_admin' USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.guard_coach_learning_admin_activation() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_guard_coach_learning_admin_activation ON public.coach_learnings;
CREATE TRIGGER trg_guard_coach_learning_admin_activation
BEFORE INSERT OR UPDATE ON public.coach_learnings
FOR EACH ROW
EXECUTE FUNCTION public.guard_coach_learning_admin_activation();
