-- Executando a consolidação controlada em uma única migração para garantir atomicidade.
-- O agente Lovable tem permissão para executar DML em transações via read_query se não estiver em modo readonly, 
-- mas como a ferramenta read_query falhou com erro de readonly anteriormente, 
-- usaremos a ferramenta de migração que é o caminho canônico para alterações estruturais e de dados em massa que exigem atomicidade.

-- 1. MAIKON / MAICON
-- Lead Canônico: 813d150d-f247-4bf4-bb98-c27985a7c94f
-- Lead Duplicado: 59a0f7ad-4b50-4e8c-a9f1-7343e44e9818
UPDATE public.messages SET conversation_id = '8bf8512b-89ff-4900-bd58-07dd4639caee' WHERE conversation_id = '0fbfb299-f554-40dd-a5f8-61226b29c25b';
UPDATE public.quotes SET lead_id = '813d150d-f247-4bf4-bb98-c27985a7c94f' WHERE lead_id = '59a0f7ad-4b50-4e8c-a9f1-7343e44e9818';
DELETE FROM public.conversations WHERE id = '0fbfb299-f554-40dd-a5f8-61226b29c25b';
DELETE FROM public.leads WHERE id = '59a0f7ad-4b50-4e8c-a9f1-7343e44e9818';

-- 2. Grupo 5511967110363
-- Canônico: c656d90f-9778-4419-a0ab-55ab982a5747
-- Duplicado: c41bf424-ceaa-42d0-a80b-d90abd1c8591
UPDATE public.messages SET conversation_id = '8887c2c1-07cf-4374-af42-c3b182456477' WHERE conversation_id = '18d96750-0e09-4f1e-bb7c-add150ab0347';
UPDATE public.quotes SET lead_id = 'c656d90f-9778-4419-a0ab-55ab982a5747' WHERE lead_id = 'c41bf424-ceaa-42d0-a80b-d90abd1c8591';
DELETE FROM public.conversations WHERE id = '18d96750-0e09-4f1e-bb7c-add150ab0347';
DELETE FROM public.leads WHERE id = 'c41bf424-ceaa-42d0-a80b-d90abd1c8591';

-- 3. Grupo 5515974049037
-- Canônico: e3f04ee3-4a9e-4ac6-a0a2-f2156b3ee564
-- Duplicado: 3fdc4c57-32d4-4a74-a854-6180afd5e6c2
UPDATE public.messages SET conversation_id = '2e02c97b-ebdf-463b-af2b-83729d269efb' WHERE conversation_id = '52855d3e-98e5-48ed-ab85-2cc943d44453';
UPDATE public.quotes SET lead_id = 'e3f04ee3-4a9e-4ac6-a0a2-f2156b3ee564' WHERE lead_id = '3fdc4c57-32d4-4a74-a854-6180afd5e6c2';
DELETE FROM public.conversations WHERE id = '52855d3e-98e5-48ed-ab85-2cc943d44453';
DELETE FROM public.leads WHERE id = '3fdc4c57-32d4-4a74-a854-6180afd5e6c2';

-- 4. Grupo 5515981225550
-- Canônico: 23eaefe4-5102-43a8-a205-659343026c1f
-- Duplicado: 0cf0513c-b180-430d-b2d6-8bb3fbf65d5b
UPDATE public.messages SET conversation_id = 'f057f74a-b75a-491a-a402-73714a92b879' WHERE conversation_id = 'ccc4a992-ffea-4abd-a9b6-fad33fd0b93e';
UPDATE public.quotes SET lead_id = '23eaefe4-5102-43a8-a205-659343026c1f' WHERE lead_id = '0cf0513c-b180-430d-b2d6-8bb3fbf65d5b';
DELETE FROM public.conversations WHERE id = 'ccc4a992-ffea-4abd-a9b6-fad33fd0b93e';
DELETE FROM public.leads WHERE id = '0cf0513c-b180-430d-b2d6-8bb3fbf65d5b';

-- 5. Grupo 5515991863775
-- Canônico: fbfe517c-677a-4a5c-9c72-ff1b83a701dc
-- Duplicado: 0b2b9d9f-71bb-42d5-b07c-b575e04a1cea
UPDATE public.messages SET conversation_id = '8edbcb94-2cfd-475a-be40-1581d73cb965' WHERE conversation_id = '9bf21652-7ab4-4c3d-999f-9192c9f534ea';
UPDATE public.quotes SET lead_id = 'fbfe517c-677a-4a5c-9c72-ff1b83a701dc' WHERE lead_id = '0b2b9d9f-71bb-42d5-b07c-b575e04a1cea';
DELETE FROM public.conversations WHERE id = '9bf21652-7ab4-4c3d-999f-9192c9f534ea';
DELETE FROM public.leads WHERE id = '0b2b9d9f-71bb-42d5-b07c-b575e04a1cea';

-- 6. Grupo 5515996863697
-- Canônico: 5feece8b-a537-4bd7-ac58-f6dd91ff7e1e
-- Duplicado: 40e0de62-ec34-48ce-8242-f22a66fe8fc1
UPDATE public.messages SET conversation_id = '69c65bf9-6f08-4fde-ad2b-ee3241001824' WHERE conversation_id = '5d862e27-c91a-47c8-8dc1-00b5d1e9fafe';
UPDATE public.quotes SET lead_id = '5feece8b-a537-4bd7-ac58-f6dd91ff7e1e' WHERE lead_id = '40e0de62-ec34-48ce-8242-f22a66fe8fc1';
DELETE FROM public.conversations WHERE id = '5d862e27-c91a-47c8-8dc1-00b5d1e9fafe';
DELETE FROM public.leads WHERE id = '40e0de62-ec34-48ce-8242-f22a66fe8fc1';

-- 7. Grupo 5515997619288
-- Canônico: 9145d512-d1ee-4996-8d90-1cf0f96fb7a3
-- Duplicado: e6ac9db2-9f79-47ca-b8fc-88ca05812596
UPDATE public.messages SET conversation_id = 'a8e3e438-1ef1-4cc9-a192-7b4fb1cf4766' WHERE conversation_id = 'c89664b5-5794-40b8-9e3b-43e6e17a6b15';
UPDATE public.quotes SET lead_id = '9145d512-d1ee-4996-8d90-1cf0f96fb7a3' WHERE lead_id = 'e6ac9db2-9f79-47ca-b8fc-88ca05812596';
DELETE FROM public.conversations WHERE id = 'c89664b5-5794-40b8-9e3b-43e6e17a6b15';
DELETE FROM public.leads WHERE id = 'e6ac9db2-9f79-47ca-b8fc-88ca05812596';

-- 8. Grupo 5515997647977
-- Canônico: b6497c03-6ef0-4838-8d9d-cad891818789
-- Duplicado: 8ad22e2b-1d2b-465d-9670-65f2e3dc74dc
UPDATE public.messages SET conversation_id = 'f3b11579-d073-4874-afd8-429218e34146' WHERE conversation_id = '0034a4cd-b984-4b81-be22-828d9f1ec419';
UPDATE public.quotes SET lead_id = 'b6497c03-6ef0-4838-8d9d-cad891818789' WHERE lead_id = '8ad22e2b-1d2b-465d-9670-65f2e3dc74dc';
DELETE FROM public.conversations WHERE id = '0034a4cd-b984-4b81-be22-828d9f1ec419';
DELETE FROM public.leads WHERE id = '8ad22e2b-1d2b-465d-9670-65f2e3dc74dc';

-- Recalcular last_message_at para todas as conversas canônicas afetadas
UPDATE public.conversations c
SET last_message_at = (SELECT max(created_at) FROM public.messages m WHERE m.conversation_id = c.id)
WHERE c.id IN (
    '8bf8512b-89ff-4900-bd58-07dd4639caee',
    '8887c2c1-07cf-4374-af42-c3b182456477',
    '2e02c97b-ebdf-463b-af2b-83729d269efb',
    'f057f74a-b75a-491a-a402-73714a92b879',
    '8edbcb94-2cfd-475a-be40-1581d73cb965',
    '69c65bf9-6f08-4fde-ad2b-ee3241001824',
    'a8e3e438-1ef1-4cc9-a192-7b4fb1cf4766',
    'f3b11579-d073-4874-afd8-429218e34146'
);
