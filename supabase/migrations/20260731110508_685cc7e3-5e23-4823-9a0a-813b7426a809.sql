-- Fase 4.2 — Hardening de grants das RPCs de feedback do Coach.
-- Não destrutivo: nenhuma linha de dados é tocada.

-- v1 (LEGADA / DEPRECATED): remove qualquer execute implícito e anônimo.
REVOKE ALL ON FUNCTION public.submit_coach_suggestion_feedback(uuid, text, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.submit_coach_suggestion_feedback(uuid, text, uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.submit_coach_suggestion_feedback(uuid, text, uuid) TO authenticated;

COMMENT ON FUNCTION public.submit_coach_suggestion_feedback(uuid, text, uuid) IS
  'DEPRECATED (Sprint 4 / Fase 4.2). Contrato oficial: submit_coach_suggestion_feedback_v2(uuid,text,text). Mantida apenas para compatibilidade com clientes antigos; sem acesso anon. Não usar em código novo.';

-- v2 (OFICIAL): reafirma grants mínimos de forma idempotente.
REVOKE ALL ON FUNCTION public.submit_coach_suggestion_feedback_v2(uuid, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.submit_coach_suggestion_feedback_v2(uuid, text, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.submit_coach_suggestion_feedback_v2(uuid, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.submit_coach_suggestion_feedback_v2(uuid, text, text) TO service_role;

COMMENT ON FUNCTION public.submit_coach_suggestion_feedback_v2(uuid, text, text) IS
  'Contrato oficial de avaliação de sugestões do Coach (positive/negative/cleared). SECURITY DEFINER, search_path=public, company_id derivado de auth.uid(). Grants: authenticated, service_role.';