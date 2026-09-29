BEGIN;

CREATE TABLE public.relationship_campaign_settings (
  company_id uuid PRIMARY KEY REFERENCES public.companies(id) ON DELETE CASCADE,
  mode text NOT NULL DEFAULT 'manual'
    CHECK (mode IN ('manual', 'assisted', 'automatic')),
  automatic_enabled boolean NOT NULL DEFAULT false,
  daily_limit integer NOT NULL DEFAULT 50 CHECK (daily_limit BETWEEN 0 AND 10000),
  hourly_limit integer NOT NULL DEFAULT 10 CHECK (hourly_limit BETWEEN 0 AND 1000),
  business_hours_start time NOT NULL DEFAULT '09:00',
  business_hours_end time NOT NULL DEFAULT '18:00',
  timezone text NOT NULL DEFAULT 'America/Sao_Paulo',
  retry_max integer NOT NULL DEFAULT 3 CHECK (retry_max BETWEEN 0 AND 10),
  retry_backoff_seconds integer NOT NULL DEFAULT 300 CHECK (retry_backoff_seconds BETWEEN 30 AND 86400),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.relationship_campaign_recipients
  ADD COLUMN IF NOT EXISTS attempts integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS next_attempt_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_attempt_at timestamptz,
  ADD COLUMN IF NOT EXISTS external_message_id text,
  ADD COLUMN IF NOT EXISTS dispatch_key text,
  ADD COLUMN IF NOT EXISTS locked_until timestamptz;

ALTER TABLE public.relationship_campaign_recipients
  DROP CONSTRAINT IF EXISTS relationship_campaign_recipients_status_check;
ALTER TABLE public.relationship_campaign_recipients
  ADD CONSTRAINT relationship_campaign_recipients_status_check
  CHECK (status IN (
    'pending', 'sending', 'ineligible', 'sent', 'delivered', 'failed',
    'replied', 'converted', 'suppressed'
  ));

CREATE UNIQUE INDEX IF NOT EXISTS relationship_recipient_dispatch_key_idx
  ON public.relationship_campaign_recipients(company_id, dispatch_key)
  WHERE dispatch_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS relationship_recipients_due_idx
  ON public.relationship_campaign_recipients(company_id, status, next_attempt_at, created_at);
CREATE INDEX IF NOT EXISTS relationship_recipients_sent_at_idx
  ON public.relationship_campaign_recipients(company_id, sent_at);
CREATE INDEX IF NOT EXISTS relationship_recipients_locked_idx
  ON public.relationship_campaign_recipients(company_id, locked_until)
  WHERE status = 'sending';

CREATE TABLE public.relationship_campaign_suppressions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  lead_id uuid,
  phone text,
  reason text NOT NULL DEFAULT 'opt_out',
  source text NOT NULL DEFAULT 'manual',
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT relationship_suppressions_lead_fk
    FOREIGN KEY (company_id, lead_id)
    REFERENCES public.leads(company_id, id) ON DELETE CASCADE,
  CONSTRAINT relationship_suppressions_target_check
    CHECK (lead_id IS NOT NULL OR phone IS NOT NULL)
);

CREATE UNIQUE INDEX relationship_suppressions_company_lead_idx
  ON public.relationship_campaign_suppressions(company_id, lead_id)
  WHERE lead_id IS NOT NULL;
CREATE UNIQUE INDEX relationship_suppressions_company_phone_idx
  ON public.relationship_campaign_suppressions(company_id, phone)
  WHERE phone IS NOT NULL;
CREATE INDEX relationship_suppressions_active_idx
  ON public.relationship_campaign_suppressions(company_id, active);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.relationship_campaign_settings TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.relationship_campaign_suppressions TO authenticated;
GRANT ALL ON public.relationship_campaign_settings TO service_role;
GRANT ALL ON public.relationship_campaign_suppressions TO service_role;

ALTER TABLE public.relationship_campaign_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.relationship_campaign_suppressions ENABLE ROW LEVEL SECURITY;

CREATE POLICY relationship_campaign_settings_company_policy
  ON public.relationship_campaign_settings FOR ALL TO authenticated
  USING (company_id = public.current_company_id())
  WITH CHECK (company_id = public.current_company_id());
CREATE POLICY relationship_suppressions_company_policy
  ON public.relationship_campaign_suppressions FOR ALL TO authenticated
  USING (company_id = public.current_company_id())
  WITH CHECK (company_id = public.current_company_id());

CREATE OR REPLACE FUNCTION public.mark_relationship_recipient_reply()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.role = 'lead' THEN
    UPDATE public.relationship_campaign_recipients
       SET status = CASE WHEN status IN ('sent','delivered') THEN 'replied' ELSE status END,
           replied_at = COALESCE(replied_at, NEW.at),
           metadata = metadata || jsonb_build_object(
             'reply_message_id', NEW.id,
             'reply_at', NEW.at
           ),
           updated_at = now()
     WHERE company_id = NEW.company_id
       AND conversation_id = NEW.conversation_id
       AND status IN ('sent','delivered');
  END IF;
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS relationship_recipient_reply_trigger ON public.messages;
CREATE TRIGGER relationship_recipient_reply_trigger
  AFTER INSERT ON public.messages
  FOR EACH ROW EXECUTE FUNCTION public.mark_relationship_recipient_reply();

CREATE OR REPLACE FUNCTION public.mark_relationship_recipient_conversion()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.status = 'fechado' OR NEW.closed_at IS NOT NULL THEN
    UPDATE public.relationship_campaign_recipients r
       SET status = 'converted',
           metadata = r.metadata || jsonb_build_object(
             'converted_at', COALESCE(NEW.closed_at, now()),
             'conversion_lead_id', NEW.id
           ),
           updated_at = now()
     WHERE r.company_id = NEW.company_id
       AND r.lead_id = NEW.id
       AND r.status IN ('sent','delivered','replied');
  END IF;
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS relationship_recipient_conversion_trigger ON public.leads;
CREATE TRIGGER relationship_recipient_conversion_trigger
  AFTER INSERT OR UPDATE OF status, closed_at ON public.leads
  FOR EACH ROW EXECUTE FUNCTION public.mark_relationship_recipient_conversion();

CREATE OR REPLACE FUNCTION public.annotate_relationship_followup_cycle()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  campaign_ids jsonb;
BEGIN
  SELECT COALESCE(jsonb_agg(DISTINCT jsonb_build_object(
    'campaign_id', relationship_campaign_id,
    'recipient_id', id
  )), '[]'::jsonb)
    INTO campaign_ids
    FROM public.relationship_campaign_recipients
   WHERE company_id = NEW.company_id
     AND conversation_id = NEW.conversation_id
     AND status IN ('replied','sent','delivered');
  IF jsonb_array_length(campaign_ids) > 0 THEN
    UPDATE public.followup_cycles
       SET metadata = metadata || jsonb_build_object(
         'relationship_campaigns', campaign_ids
       ),
           updated_at = now()
     WHERE id = NEW.id
       AND company_id = NEW.company_id;
  END IF;
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS relationship_followup_cycle_annotation_trigger ON public.followup_cycles;
CREATE TRIGGER relationship_followup_cycle_annotation_trigger
  AFTER INSERT ON public.followup_cycles
  FOR EACH ROW EXECUTE FUNCTION public.annotate_relationship_followup_cycle();

COMMIT;


ALTER TABLE public.relationship_campaign_suppressions
  ADD COLUMN IF NOT EXISTS target_key text GENERATED ALWAYS AS (
    CASE WHEN lead_id IS NOT NULL THEN 'lead:' || lead_id::text ELSE 'phone:' || phone END
  ) STORED;
CREATE UNIQUE INDEX IF NOT EXISTS relationship_suppressions_target_key_idx
  ON public.relationship_campaign_suppressions(company_id, target_key);
