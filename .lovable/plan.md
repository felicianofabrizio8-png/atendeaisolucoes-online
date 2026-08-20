# Plano de Correção: Duplicação de Conversas e Leads na Inbox

## Causa Raiz
A investigação via `psql` e análise de código em `src/routes/api.public.whatsapp.webhook.tsx` revelou que a duplicação ocorre devido à falta de **atomicidade e chaves de unicidade** robustas no banco de dados.

1.  **Race Condition no Webhook:** Quando múltiplas mensagens chegam simultaneamente (ex: 3 mensagens em 5 segundos para o mesmo número), o `findOrCreateLead` e `findOrCreateConversation` realizam um `SELECT` seguido de um `INSERT`. Em alta concorrência, ambos os processos podem ler "não existe" e realizar dois inserts paralelos.
2.  **Chave de Unicidade Ausente:** Não existem constraints `UNIQUE` compostas no banco de dados para impedir que o mesmo `phone` ou `external_id` seja inserido múltiplas vezes para a mesma `company_id`.
3.  **Inconsistência de Normalização:** O campo `phone` é populado diretamente com o `wa_id` da Meta (ex: `5515997...`), mas não há garantia de que outras partes do sistema não usem formatos diferentes.

## Ações Propostas

### 1. Banco de Dados (Remoto)
Implementar constraints de unicidade para garantir integridade no nível do motor SQL, permitindo o uso de `ON CONFLICT` (upsert).

- **Leads:** Adicionar `UNIQUE(company_id, phone)` e `UNIQUE(company_id, external_id)`.
- **Conversations:** Adicionar `UNIQUE(company_id, lead_id, channel)`.

### 2. Backend (Código)
Refatorar `src/routes/api.public.whatsapp.webhook.tsx` para usar estratégias atômicas:
- Substituir o fluxo "Select then Insert" por um único `upsert` com `onConflict`.
- Garantir que `findOrCreateLead` e `findOrCreateConversation` sejam idempotentes e resilientes a race conditions.

### 3. Consolidação de Dados (Manual/Script)
Existem atualmente duplicatas (ex: 5 leads para o telefone `5515997548186`).
- **Plano de Fusão:** Mover todas as `messages` para a conversa/lead mais antigo e deletar os órfãos. *Esta ação será proposta detalhadamente após a correção estrutural.*

---

## Detalhamento Técnico das Alterações

### Migração SQL
```sql
-- Leads: Garante que um telefone é único por empresa
ALTER TABLE public.leads ADD CONSTRAINT leads_company_phone_key UNIQUE (company_id, phone);

-- Leads: Garante que um external_id (wa_id) é único por empresa
ALTER TABLE public.leads ADD CONSTRAINT leads_company_external_id_key UNIQUE (company_id, external_id);

-- Conversations: Garante uma única conversa por lead/canal/empresa
ALTER TABLE public.conversations ADD CONSTRAINT conversations_company_lead_channel_key UNIQUE (company_id, lead_id, channel);
```

### Refatoração de Código
Ajustar `findOrCreateLead` para usar a lógica de `upsert` do Supabase/PostgreSQL que resolve o conflito atomicamente.

---

## Validação
O sucesso será confirmado ao enviar mensagens rápidas sequenciais e verificar que apenas UM lead e UMA conversa existem no banco, com todas as mensagens vinculadas corretamente.
