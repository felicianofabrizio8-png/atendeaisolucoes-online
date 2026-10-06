-- Botão mestre da Vendedora IA por empresa (vale para empresa que usa a Vendedora).
-- Desligado, nenhuma mensagem recebida chama a Vendedora nem gera sugestão dela, e ninguém
-- responde automaticamente no lugar dela: o atendimento fica com a equipe. Coach e
-- ferramentas manuais seguem funcionando.
-- Padrão ligado: nada muda para as empresas existentes. O modo (sales_agent_v2_mode) e o
-- automático por conversa (conversations.sales_agent_auto_reply) não são alterados ao
-- desligar, então voltam a valer como estavam ao religar.
ALTER TABLE public.company_settings
  ADD COLUMN IF NOT EXISTS sales_agent_master_enabled boolean NOT NULL DEFAULT true;

COMMENT ON COLUMN public.company_settings.sales_agent_master_enabled IS
  'Botão mestre da Vendedora IA da empresa; false impede qualquer chamada à Vendedora sem alterar modo nem outras IAs.';
