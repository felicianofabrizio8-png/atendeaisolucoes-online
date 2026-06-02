
-- ============================================================================
-- Sub-fase A — Observabilidade: audit_log + error_log
-- ============================================================================

-- 1) audit_log: registra ações importantes por empresa/usuário
CREATE TABLE public.audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL,
  user_id uuid,
  action text NOT NULL,
  entity text NOT NULL,
  entity_id text,
  before jsonb,
  after jsonb,
  ip text,
  user_agent text,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.audit_log TO authenticated;
GRANT ALL ON public.audit_log TO service_role;

ALTER TABLE public.audit_log ENABLE ROW LEVEL SECURITY;

-- Apenas admins da própria empresa leem
CREATE POLICY "admin select audit_log"
  ON public.audit_log FOR SELECT TO authenticated
  USING (
    company_id = private.current_company_id()
    AND public.has_role(auth.uid(), 'admin'::app_role)
  );

-- INSERT só via service_role (server functions)
-- Sem policy de UPDATE/DELETE: imutável

CREATE INDEX idx_audit_log_company_created
  ON public.audit_log (company_id, created_at DESC);
CREATE INDEX idx_audit_log_entity
  ON public.audit_log (company_id, entity, entity_id);

-- 2) error_log: erros operacionais (ia/upload/meta/storage/supabase)
CREATE TABLE public.error_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid,
  user_id uuid,
  source text NOT NULL CHECK (source IN ('ia','upload','meta','whatsapp','storage','supabase','client','other')),
  severity text NOT NULL DEFAULT 'error' CHECK (severity IN ('info','warning','error','critical')),
  message text NOT NULL,
  context jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.error_log TO authenticated;
GRANT ALL ON public.error_log TO service_role;

ALTER TABLE public.error_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "admin select error_log"
  ON public.error_log FOR SELECT TO authenticated
  USING (
    company_id = private.current_company_id()
    AND public.has_role(auth.uid(), 'admin'::app_role)
  );

CREATE INDEX idx_error_log_company_created
  ON public.error_log (company_id, created_at DESC);
CREATE INDEX idx_error_log_source
  ON public.error_log (company_id, source, created_at DESC);

-- 3) Helper SECURITY DEFINER para audit interno (uso futuro por triggers/funções)
CREATE OR REPLACE FUNCTION public.log_audit(
  _company_id uuid,
  _user_id uuid,
  _action text,
  _entity text,
  _entity_id text,
  _before jsonb,
  _after jsonb
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id uuid;
BEGIN
  INSERT INTO public.audit_log (company_id, user_id, action, entity, entity_id, before, after)
  VALUES (_company_id, _user_id, _action, _entity, _entity_id, _before, _after)
  RETURNING id INTO v_id;
  RETURN v_id;
EXCEPTION WHEN OTHERS THEN
  RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION public.log_audit(uuid, uuid, text, text, text, jsonb, jsonb) FROM public;
GRANT EXECUTE ON FUNCTION public.log_audit(uuid, uuid, text, text, text, jsonb, jsonb) TO service_role;
