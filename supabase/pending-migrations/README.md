# Migrations pendentes (não aplicadas)

Arquivos aqui **não** são lidos pelo Supabase CLI nem pelo Lovable: só
`supabase/migrations/` é aplicado. Eles ficam preparados para revisão e
aplicação manual e controlada em produção.

Para aplicar: revisar contra o banco vivo, mover o arquivo para
`supabase/migrations/` (mantendo o timestamp ou gerando um novo) e aplicar
pelo fluxo normal.

| Arquivo | O que faz | Pré-requisito |
|---|---|---|
| `20260930120000_sales_agent_trigger_secret.sql` | Versiona `get_hook_secret`; trigger do agente envia `x-agent-trigger-secret`, lê URL/segredo do Vault, remove o debounce de 30s e ignora `aguardando_humano`. | Criar `agent_trigger_url` e `agent_trigger_secret` no Vault; comparar com a função viva. |
| `20260930121000_coach_learning_admin_activation.sql` | Só admin ativa/edita aprendizado ativo do Coach; criação por não-admin vira `paused`. | Decisão de produto sobre o teach mode de não-admin. |

Ainda não versionado (depende de dump do banco vivo): `resolve_whatsapp_thread`
(chamada pelo `meta-webhook`) e o agendamento pg_cron do follow-up.
