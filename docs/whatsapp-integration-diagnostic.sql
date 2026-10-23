-- Diagnostico administrativo read-only de integracoes WhatsApp.
--
-- Este arquivo contem somente SELECTs. Nao execute contra producao sem seguir
-- docs/whatsapp-integration-diagnostic.md.
--
-- Para limitar a uma empresa, substitua NULL::uuid abaixo pelo UUID conhecido.
-- O diagnostico nunca usa leads.phone como chave de associacao.

-- 1) Inventario das integracoes WhatsApp por tenant.
WITH params AS (SELECT NULL::uuid AS company_id_filter)
SELECT
  i.company_id,
  i.id AS integration_id,
  i.active,
  i.external_account_id AS phone_number_id,
  i.account_metadata ->> 'waba_id' AS waba_id,
  i.display_name,
  i.last_synced_at,
  i.last_error
FROM public.integrations AS i
CROSS JOIN params AS p
WHERE i.channel = 'whatsapp'
  AND (p.company_id_filter IS NULL OR i.company_id = p.company_id_filter)
ORDER BY i.company_id, i.active DESC, i.external_account_id, i.id;

-- 2) Leads WhatsApp sem integration_id, com o impacto em conversas/mensagens.
-- A coluna candidate_* e evidencia historica, nao uma associacao aplicada.
WITH params AS (SELECT NULL::uuid AS company_id_filter),
lead_evidence AS (
  SELECT
    l.company_id,
    l.id AS lead_id,
    COUNT(DISTINCT c.id) AS affected_conversations,
    COUNT(DISTINCT m.id) AS affected_messages,
    COUNT(DISTINCT i.external_account_id) FILTER (
      WHERE i.id IS NOT NULL AND i.company_id = l.company_id
    ) AS evidence_phone_number_count,
    ARRAY_AGG(DISTINCT i.external_account_id) FILTER (
      WHERE i.id IS NOT NULL
        AND i.company_id = l.company_id
        AND i.channel = 'whatsapp'
        AND i.external_account_id IS NOT NULL
    ) AS evidence_phone_number_ids
  FROM public.leads AS l
  LEFT JOIN public.conversations AS c
    ON c.company_id = l.company_id AND c.lead_id = l.id
  LEFT JOIN public.messages AS m
    ON m.company_id = l.company_id AND m.conversation_id = c.id
  LEFT JOIN public.integrations AS i
    ON i.company_id = l.company_id
   AND i.id = m.integration_id
   AND i.channel = 'whatsapp'
  CROSS JOIN params AS p
  WHERE l.channel = 'whatsapp'
    AND l.integration_id IS NULL
    AND (p.company_id_filter IS NULL OR l.company_id = p.company_id_filter)
  GROUP BY l.company_id, l.id
)
SELECT
  company_id,
  lead_id,
  affected_conversations,
  affected_messages,
  evidence_phone_number_count,
  evidence_phone_number_ids,
  CASE
    WHEN evidence_phone_number_count = 1
      THEN 'deterministic_candidate_from_existing_message_integration'
    WHEN evidence_phone_number_count > 1
      THEN 'ambiguous_multiple_meta_phone_number_ids'
    ELSE 'not_determinable_without_meta_phone_number_id'
  END AS candidate_status,
  'NAO usar leads.phone para decidir' AS safety_rule
FROM lead_evidence
ORDER BY company_id, affected_messages DESC, lead_id;

-- 3) Conversas WhatsApp afetadas por lead sem integration_id.
WITH params AS (SELECT NULL::uuid AS company_id_filter)
SELECT
  c.company_id,
  c.id AS conversation_id,
  c.lead_id,
  c.last_message_at,
  COUNT(m.id) AS message_count,
  COUNT(m.id) FILTER (WHERE m.integration_id IS NULL) AS messages_without_integration,
  ARRAY_AGG(DISTINCT i.external_account_id) FILTER (
    WHERE i.id IS NOT NULL AND i.company_id = c.company_id
  ) AS message_evidence_phone_number_ids
FROM public.conversations AS c
JOIN public.leads AS l
  ON l.company_id = c.company_id AND l.id = c.lead_id
LEFT JOIN public.messages AS m
  ON m.company_id = c.company_id AND m.conversation_id = c.id
LEFT JOIN public.integrations AS i
  ON i.company_id = c.company_id
 AND i.id = m.integration_id
 AND i.channel = 'whatsapp'
CROSS JOIN params AS p
WHERE c.channel = 'whatsapp'
  AND l.channel = 'whatsapp'
  AND l.integration_id IS NULL
  AND (p.company_id_filter IS NULL OR c.company_id = p.company_id_filter)
GROUP BY c.company_id, c.id, c.lead_id, c.last_message_at
ORDER BY c.company_id, c.last_message_at DESC, c.id;

-- 4) Mensagens WhatsApp sem integration_id.
-- Sem phone_number_id persistido no registro da mensagem, o resultado e
-- intencionalmente "sem candidato"; nao se tenta resolver por telefone.
WITH params AS (SELECT NULL::uuid AS company_id_filter)
SELECT
  m.company_id,
  m.id AS message_id,
  m.conversation_id,
  c.lead_id,
  m.role,
  m.at,
  CASE
    WHEN l.integration_id IS NULL THEN 'lead_without_integration_id'
    ELSE 'message_without_integration_id'
  END AS finding,
  'not_determinable_without_message_phone_number_id' AS candidate_status
FROM public.messages AS m
JOIN public.conversations AS c
  ON c.company_id = m.company_id AND c.id = m.conversation_id
JOIN public.leads AS l
  ON l.company_id = c.company_id AND l.id = c.lead_id
CROSS JOIN params AS p
WHERE m.integration_id IS NULL
  AND m.company_id = c.company_id
  AND c.channel = 'whatsapp'
  AND l.channel = 'whatsapp'
  AND (p.company_id_filter IS NULL OR m.company_id = p.company_id_filter)
ORDER BY m.company_id, m.at, m.id;

-- 5) Eventos recebidos pela Meta sem integracao correspondente.
-- O evento so e considerado associado quando phone_number_id bate exatamente
-- com integrations.external_account_id no mesmo tenant. Como a tabela de
-- eventos nao possui company_id, colisao entre tenants tambem e reportada.
WITH phone_owners AS (
  SELECT
    external_account_id AS phone_number_id,
    COUNT(DISTINCT company_id) AS owner_company_count,
    ARRAY_AGG(DISTINCT company_id) AS owner_company_ids
  FROM public.integrations
  WHERE channel = 'whatsapp' AND external_account_id IS NOT NULL
  GROUP BY external_account_id
)
SELECT
  e.id AS unmapped_event_id,
  e.phone_number_id,
  e.waba_id,
  e.created_at,
  p.owner_company_count,
  p.owner_company_ids,
  CASE
    WHEN p.owner_company_count IS NULL THEN 'no_company_has_this_phone_number_id'
    WHEN p.owner_company_count > 1 THEN 'tenant_collision_same_phone_number_id'
    ELSE 'phone_number_id_owned_by_one_tenant_but_event_was_unmapped'
  END AS finding
FROM public.whatsapp_unmapped_events AS e
LEFT JOIN phone_owners AS p ON p.phone_number_id = e.phone_number_id
ORDER BY e.created_at DESC, e.id;

-- 6) Verificacoes de isolamento: cada linha retornada e uma violacao.
-- O resultado esperado de cada bloco e zero linhas.
SELECT 'lead_integration_company_mismatch' AS check_name,
       l.id AS record_id, l.company_id, l.integration_id, i.company_id AS integration_company_id
FROM public.leads AS l
JOIN public.integrations AS i ON i.id = l.integration_id
WHERE l.integration_id IS NOT NULL AND l.company_id <> i.company_id
UNION ALL
SELECT 'message_integration_company_mismatch', m.id, m.company_id, m.integration_id, i.company_id
FROM public.messages AS m
JOIN public.integrations AS i ON i.id = m.integration_id
WHERE m.integration_id IS NOT NULL AND m.company_id <> i.company_id
UNION ALL
SELECT 'conversation_lead_company_mismatch', c.id, c.company_id, c.lead_id, l.company_id
FROM public.conversations AS c
JOIN public.leads AS l ON l.id = c.lead_id
WHERE c.company_id <> l.company_id
UNION ALL
SELECT 'message_conversation_company_mismatch', m.id, m.company_id, m.conversation_id, c.company_id
FROM public.messages AS m
JOIN public.conversations AS c ON c.id = m.conversation_id
WHERE m.company_id <> c.company_id
ORDER BY check_name, record_id;

-- 7) O mesmo phone_number_id da Meta pertencendo a mais de um tenant.
-- O resultado esperado e zero linhas. Nao corrigir automaticamente.
SELECT
  external_account_id AS phone_number_id,
  COUNT(DISTINCT company_id) AS company_count,
  ARRAY_AGG(DISTINCT company_id) AS company_ids,
  ARRAY_AGG(id ORDER BY company_id, id) AS integration_ids
FROM public.integrations
WHERE channel = 'whatsapp' AND external_account_id IS NOT NULL
GROUP BY external_account_id
HAVING COUNT(DISTINCT company_id) > 1
ORDER BY phone_number_id;

-- 8) Integracoes WhatsApp duplicadas no mesmo tenant para o mesmo phone_number_id.
-- A constraint atual deveria impedir linhas; esta consulta documenta a defesa.
SELECT
  company_id,
  external_account_id AS phone_number_id,
  COUNT(*) AS integration_count,
  ARRAY_AGG(id ORDER BY id) AS integration_ids
FROM public.integrations
WHERE channel = 'whatsapp' AND external_account_id IS NOT NULL
GROUP BY company_id, external_account_id
HAVING COUNT(*) > 1
ORDER BY company_id, phone_number_id;

