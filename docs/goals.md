# Ativar as Metas

1. **Banco**: aplicar, nesta ordem, `20261015120000_agenda_lume_foundation.sql`,
   `20261016120000_agenda_team_hierarchy.sql` e `20261017120000_goals.sql`
   (SQL Editor do Supabase ou `npx supabase db push`). Todos são reexecutáveis.
2. **Segredo da rotina diária**: definir `GOALS_TICK_SECRET` no servidor (ou
   `goals_tick_secret` no cofre de segredos dos ganchos).
3. **Agendamento** (SQL Editor, uma vez):

   ```sql
   select cron.schedule('goals-tick-daily', '15 3 * * *', $$
     select net.http_post(
       url := 'https://SEU-DOMINIO/api/public/hooks/goals-tick',
       headers := jsonb_build_object('x-goals-tick-secret', 'O-SEGREDO', 'content-type', 'application/json'),
       body := '{}'::jsonb);
   $$);
   ```

   03:15 UTC = 00:15 em São Paulo.
4. **IA**: usa a mesma chave da Lume (`LUME_AI_*` ou, na falta, `SALES_AGENT_LLM_*`).
   Sem chave, a aba funciona e o cartão da Lume avisa o que falta.
5. **Permissões**: todos recebem "Ver metas"; dê "Gerenciar metas" em
   Configurações → Usuários e Permissões a quem vai criar metas.
