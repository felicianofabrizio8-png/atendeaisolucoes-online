-- Harness efêmero: schema mínimo real para exercitar a RPC v2 de feedback.
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE SCHEMA IF NOT EXISTS auth;
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid
LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('test.uid', true), '')::uuid $$;

CREATE TABLE public.profiles (
  id uuid PRIMARY KEY,
  company_id uuid NOT NULL
);

CREATE TABLE public.coach_suggestions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL,
  learning_ids_used uuid[] NOT NULL DEFAULT '{}'::uuid[],
  feedback_status text,
  feedback_user_id uuid,
  feedback_created_at timestamptz
);

CREATE TABLE public.coach_learnings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL,
  category text NOT NULL DEFAULT 'geral',
  title text NOT NULL DEFAULT 't',
  description text NOT NULL DEFAULT 'd',
  rule_structured text NOT NULL DEFAULT 'r',
  status text NOT NULL DEFAULT 'active',
  confidence numeric NOT NULL DEFAULT 0.700,
  success_rate numeric NOT NULL DEFAULT 0.5000,
  positive_feedback_count int NOT NULL DEFAULT 0,
  negative_feedback_count int NOT NULL DEFAULT 0,
  feedback_sample_count int NOT NULL DEFAULT 0,
  positive_feedback_weight numeric NOT NULL DEFAULT 0,
  negative_feedback_weight numeric NOT NULL DEFAULT 0,
  last_feedback_at timestamptz,
  last_positive_feedback_at timestamptz,
  last_negative_feedback_at timestamptz
);

CREATE TABLE public.coach_learning_retrievals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL,
  learning_id uuid NOT NULL,
  version_number int NOT NULL DEFAULT 1,
  generation_ref text NOT NULL,
  rank smallint,
  final_score numeric,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.coach_learning_feedback_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL,
  learning_id uuid NOT NULL,
  suggestion_id uuid NOT NULL,
  actor_user_id uuid,
  previous_feedback text,
  new_feedback text,
  transition text NOT NULL,
  event_weight numeric NOT NULL DEFAULT 1,
  rank smallint,
  final_score numeric,
  confidence_before numeric,
  confidence_after numeric,
  success_rate_before numeric,
  success_rate_after numeric,
  source text NOT NULL DEFAULT 'coach_panel',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE OR REPLACE FUNCTION public.coach_feedback_event_weight(_rank smallint, _final_score numeric)
 RETURNS numeric LANGUAGE sql IMMUTABLE SET search_path TO 'public'
AS $function$
  SELECT round(
    GREATEST(0.50, LEAST(1.25,
      GREATEST(0.60, 1.00 - 0.08 * (GREATEST(1, COALESCE(_rank, 3)) - 1))
      *
      (0.80 + 0.40 * (LEAST(100, GREATEST(0, COALESCE(_final_score, 50))) / 100.0))
    )), 4)::numeric;
$function$;

CREATE OR REPLACE FUNCTION public.coach_feedback_success_rate(_pos_weight numeric, _neg_weight numeric)
 RETURNS numeric LANGUAGE sql IMMUTABLE SET search_path TO 'public'
AS $function$
  SELECT round(
    (GREATEST(0, COALESCE(_pos_weight,0)) + 2.0)
    / NULLIF(GREATEST(0, COALESCE(_pos_weight,0)) + GREATEST(0, COALESCE(_neg_weight,0)) + 4.0, 0)
  , 4)::numeric;
$function$;

CREATE OR REPLACE FUNCTION public.coach_feedback_confidence(_success_rate numeric, _sample_count integer)
 RETURNS numeric LANGUAGE sql IMMUTABLE SET search_path TO 'public'
AS $function$
  SELECT round(
    GREATEST(0.150, LEAST(0.950,
      0.700 + (COALESCE(_success_rate, 0.5) - 0.5) * 0.900
              * (GREATEST(0, COALESCE(_sample_count,0))::numeric
                 / (GREATEST(0, COALESCE(_sample_count,0)) + 5.0))
    )), 3)::numeric;
$function$;
