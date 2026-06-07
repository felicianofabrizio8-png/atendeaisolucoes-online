
-- Composite index for pagination + latest-per-conversation lookup
CREATE INDEX IF NOT EXISTS idx_messages_company_conv_at_id_desc
  ON public.messages (company_id, conversation_id, at DESC, id DESC);

-- RPC: latest message per conversation for a given company.
-- Used by the inbox list to show preview text without loading full history.
CREATE OR REPLACE FUNCTION public.latest_messages_per_conversation(_company_id uuid)
RETURNS TABLE (
  conversation_id uuid,
  id uuid,
  role message_role,
  text text,
  at timestamptz,
  source_subtype text,
  source_metadata jsonb,
  delivery_status text,
  status_updated_at timestamptz,
  edited_at timestamptz,
  deleted_at timestamptz,
  deleted_for text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT DISTINCT ON (m.conversation_id)
    m.conversation_id,
    m.id,
    m.role,
    m.text,
    m.at,
    m.source_subtype,
    m.source_metadata,
    m.delivery_status,
    m.status_updated_at,
    m.edited_at,
    m.deleted_at,
    m.deleted_for
  FROM public.messages m
  WHERE m.company_id = _company_id
    AND _company_id = private.current_company_id()
  ORDER BY m.conversation_id, m.at DESC, m.id DESC
$$;

GRANT EXECUTE ON FUNCTION public.latest_messages_per_conversation(uuid) TO authenticated;
