CREATE OR REPLACE FUNCTION public.record_whatsapp_message(
  _integration_id uuid,
  _conversation_id uuid,
  _external_id text,
  _text text,
  _at timestamptz,
  _source_subtype text DEFAULT 'text',
  _source_metadata jsonb DEFAULT '{}'::jsonb
)
RETURNS TABLE(message_id uuid, inserted boolean)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_company_id uuid;
  v_message_id uuid;
BEGIN
  IF NULLIF(trim(_external_id), '') IS NULL THEN
    RAISE EXCEPTION 'whatsapp_external_message_id_required';
  END IF;

  SELECT c.company_id INTO v_company_id
    FROM public.conversations c
    JOIN public.integrations i
      ON i.id = _integration_id
     AND i.company_id = c.company_id
     AND i.channel = 'whatsapp'
   WHERE c.id = _conversation_id;

  IF v_company_id IS NULL THEN
    RAISE EXCEPTION 'whatsapp_conversation_integration_mismatch';
  END IF;

  INSERT INTO public.messages (
    company_id, conversation_id, role, text, at, external_id,
    integration_id, source, source_subtype, source_metadata
  ) VALUES (
    v_company_id, _conversation_id, 'lead', COALESCE(_text, ''), COALESCE(_at, now()),
    _external_id, _integration_id, 'whatsapp', _source_subtype,
    COALESCE(_source_metadata, '{}'::jsonb)
  )
  ON CONFLICT (integration_id, external_id) WHERE external_id IS NOT NULL DO NOTHING
  RETURNING id INTO v_message_id;

  IF v_message_id IS NOT NULL THEN
    UPDATE public.conversations
       SET last_message_at = GREATEST(last_message_at, COALESCE(_at, now())),
           awaiting_reply = true,
           unread = unread + 1
     WHERE id = _conversation_id;

    UPDATE public.leads AS l
       SET status = 'novo'
      FROM public.conversations AS c
     WHERE c.id = _conversation_id
       AND c.company_id = v_company_id
       AND l.id = c.lead_id
       AND l.company_id = v_company_id
       AND l.status = 'perdido';

    RETURN QUERY SELECT v_message_id, true;
  ELSE
    SELECT m.id INTO v_message_id
      FROM public.messages m
     WHERE m.integration_id = _integration_id
       AND m.external_id = _external_id;

    RETURN QUERY SELECT v_message_id, false;
  END IF;
END;
$$;
