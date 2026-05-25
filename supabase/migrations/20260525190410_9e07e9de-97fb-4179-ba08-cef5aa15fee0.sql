
ALTER TABLE public.conversations
  ADD COLUMN IF NOT EXISTS interaction_type text NOT NULL DEFAULT 'direct_message';

ALTER TABLE public.conversations
  DROP CONSTRAINT IF EXISTS conversations_interaction_type_check;

ALTER TABLE public.conversations
  ADD CONSTRAINT conversations_interaction_type_check
  CHECK (interaction_type IN ('direct_message','comment'));

CREATE INDEX IF NOT EXISTS conversations_lead_interaction_idx
  ON public.conversations (lead_id, interaction_type);
