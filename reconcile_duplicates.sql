# Consolidação Controlada de Histórico Fragmentado

## Objetivo
Unificar deterministicamente leads e conversas duplicados por inconsistência de formato de telefone, preservando 100% do histórico (mensagens, orçamentos, metadados).

## Plano de Execução

### 1. Preparação e Segurança
- **Backup de Estado:** Antes de cada grupo, capturar snapshot dos IDs e contagens.
- **Transações Atômicas:** Cada grupo será processado em uma transação SQL única.
- **Validação Cruzada:** Contagem de mensagens e orçamentos `antes == depois`.

### 2. Algoritmo de Consolidação (Por Grupo)
1. **Identificar Canônico:** Lead com telefone E.164 (55...) é o destino.
2. **Reatribuir Orçamentos:** `UPDATE quotes SET lead_id = canonical_id WHERE lead_id = old_id`.
3. **Consolidar Conversas:**
   - Se existirem duas conversas para o mesmo canal:
     - Mover mensagens: `UPDATE messages SET conversation_id = canonical_conv_id WHERE conversation_id = old_conv_id`.
     - Recalcular `last_message_at` e `unread_count` na conversa canônica.
     - Remover conversa antiga vazia.
4. **Merge de Atributos:** Preservar o dado mais completo (nome longo, responsável atribuído, tags).
5. **Limpeza:** Deletar lead duplicado somente após zerar todas as FKs.

### 3. Execução Técnica (SQL)
```sql
BEGIN;
-- Exemplo para o grupo Maikon/Maicon
-- 1. Mover mensagens da conversa antiga para a nova
UPDATE public.messages 
SET conversation_id = '8bf8512b-89ff-4900-bd58-07dd4639caee' 
WHERE conversation_id = '0fbfb299-f554-40dd-a5f8-61226b29c25b';

-- 2. Mover orçamentos para o lead canônico
UPDATE public.quotes 
SET lead_id = '813d150d-f247-4bf4-bb98-c27985a7c94f' 
WHERE lead_id = '59a0f7ad-4b50-4e8c-a9f1-7343e44e9818';

-- 3. Deletar registros órfãos
DELETE FROM public.conversations WHERE id = '0fbfb299-f554-40dd-a5f8-61226b29c25b';
DELETE FROM public.leads WHERE id = '59a0f7ad-4b50-4e8c-a9f1-7343e44e9818';

COMMIT;
```

### 4. Validação Pós-Merge
- Verificar se a Inbox exibe a conversa unificada com 35 mensagens para Maicon Oliveira.
- Confirmar que ambos os orçamentos aparecem no perfil do lead único.
- Repetir para os outros 7 grupos identificados.
