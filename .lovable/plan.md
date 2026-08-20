# Plano de Reconciliação e Consolidação da Inbox

Identificamos que a fragmentação de leads devido à normalização de telefones é a causa principal das conversas "sumidas". Este plano visa unificar o histórico sem perda de dados.

## Etapa 1: Consolidação de Dados (Merge Determinístico)
- Executar migração SQL para mover mensagens e orçamentos de leads "antigos" (sem prefixo 55) para leads "normalizados" (com prefixo 55).
- Reatribuir `lead_id` em `conversations` para apontar para o lead normalizado.
- Remover leads duplicados que ficaram órfãos após a migração.

## Etapa 2: Refinamento do leadRepo
- Ajustar a carga inicial da Inbox para garantir que, caso um lead ainda não tenha sido normalizado, a interface mostre o nome correto.
- Garantir que o `company_id` seja respeitado em todos os níveis do merge.

## Etapa 3: Validação e Testes
- Comparar totais do banco vs Inbox após o merge.
- Testar envio de nova mensagem para garantir que ela caia no registro consolidado.

## Detalhes Técnicos
- **Migração:** SQL com `UPDATE messages SET conversation_id = ...` e `UPDATE leads SET status = 'deletado' ...`.
- **Segurança:** Uso de `supabaseAdmin` para operações de escrita em massa via server functions ou migração direta.
