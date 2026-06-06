CREATE OR REPLACE FUNCTION public.prevent_page_token_in_meta_integrations()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_token_type text;
  v_scopes jsonb;
BEGIN
  IF NEW.channel::text IN ('instagram', 'facebook')
     AND NEW.access_token IS NOT NULL
     AND (TG_OP = 'INSERT' OR NEW.access_token IS DISTINCT FROM OLD.access_token) THEN
    v_token_type := NEW.account_metadata->>'token_type';
    v_scopes := COALESCE(NEW.account_metadata->'granted_scopes', NEW.account_metadata->'scopes', '[]'::jsonb);

    IF v_token_type IS NULL OR v_token_type NOT IN ('USER', 'SYSTEM_USER') THEN
      INSERT INTO public.error_log (source, severity, message, company_id, context)
      VALUES (
        'meta',
        'warning',
        'meta_token_rejected: database guard blocked integrations.access_token write',
        NEW.company_id,
        jsonb_build_object(
          'stage', 'database_guard',
          'endpoint', 'integrations_trigger',
          'token_type', v_token_type,
          'target_column', 'integrations.access_token',
          'rejected_reason', 'missing_or_invalid_account_metadata_token_type',
          'scopes', v_scopes,
          'has_ads_read', v_scopes ? 'ads_read',
          'has_ads_management', v_scopes ? 'ads_management',
          'integration_id', NEW.id,
          'channel', NEW.channel::text,
          'external_account_id', NEW.external_account_id
        )
      );
      RAISE EXCEPTION 'integrations.access_token for Meta Ads only accepts USER or SYSTEM_USER token metadata';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS prevent_page_token_in_meta_integrations_trigger ON public.integrations;
CREATE TRIGGER prevent_page_token_in_meta_integrations_trigger
BEFORE INSERT OR UPDATE OF access_token ON public.integrations
FOR EACH ROW
EXECUTE FUNCTION public.prevent_page_token_in_meta_integrations();