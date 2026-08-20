BEGIN;

-- 1. Consolidar mensagens de CONVERSAS duplicadas (mesmo lead, mesmo canal)
WITH conv_mapping AS (
  SELECT 
    c.id as duplicate_id,
    first_value(c.id) OVER (PARTITION BY c.company_id, c.lead_id, c.channel ORDER BY c.created_at ASC) as original_id
  FROM public.conversations c
)
UPDATE public.messages
SET conversation_id = m.original_id
FROM conv_mapping m
WHERE messages.conversation_id = m.duplicate_id
  AND m.duplicate_id <> m.original_id;

-- 2. Deletar conversas duplicadas vazias
DELETE FROM public.conversations
WHERE id IN (
  SELECT c.id 
  FROM public.conversations c
  JOIN (
    SELECT company_id, lead_id, channel, MIN(created_at) as min_created
    FROM public.conversations
    GROUP BY company_id, lead_id, channel
    HAVING COUNT(*) > 1
  ) dups ON c.company_id = dups.company_id AND c.lead_id = dups.lead_id AND c.channel = dups.channel
  WHERE c.created_at > dups.min_created
);

-- 3. Consolidar mensagens de LEADS duplicados (mesmo telefone)
WITH lead_mapping AS (
  SELECT 
    l.id as duplicate_id,
    first_value(l.id) OVER (PARTITION BY l.company_id, l.phone ORDER BY l.created_at ASC) as original_id
  FROM public.leads l
  WHERE l.phone IS NOT NULL AND l.phone <> ''
),
target_conversations AS (
  SELECT 
    m.original_id,
    c.id as original_conv_id,
    m.duplicate_id
  FROM lead_mapping m
  JOIN public.conversations c ON c.lead_id = m.original_id
  WHERE m.duplicate_id <> m.original_id
)
UPDATE public.messages
SET conversation_id = tc.original_conv_id
FROM target_conversations tc
JOIN public.conversations dc ON dc.lead_id = tc.duplicate_id
WHERE messages.conversation_id = dc.id;

-- 4. Deletar leads duplicados residuais
DELETE FROM public.leads
WHERE id IN (
  SELECT l.id 
  FROM public.leads l
  JOIN (
    SELECT company_id, phone, MIN(created_at) as min_created
    FROM public.leads
    WHERE phone IS NOT NULL AND phone <> ''
    GROUP BY company_id, phone
    HAVING COUNT(*) > 1
  ) dups ON l.company_id = dups.company_id AND l.phone = dups.phone
  WHERE l.created_at > dups.min_created
);

-- 5. Aplicar as Constraints de Unicidade Finais
ALTER TABLE public.leads ADD CONSTRAINT leads_company_phone_key UNIQUE (company_id, phone);
ALTER TABLE public.leads ADD CONSTRAINT leads_company_external_id_key UNIQUE (company_id, external_id);
ALTER TABLE public.conversations ADD CONSTRAINT conversations_company_lead_channel_key UNIQUE (company_id, lead_id, channel);

COMMIT;
