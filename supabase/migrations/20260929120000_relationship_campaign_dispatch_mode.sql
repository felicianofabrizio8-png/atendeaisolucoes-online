-- Modo de envio e automação por campanha de relacionamento.
-- Campanhas existentes ficam em manual com a automação desligada; ativar é
-- sempre uma ação explícita (UI "Ativar automação"). O envio real continua
-- dependendo do kill switch de servidor RELATIONSHIP_CAMPAIGN_ENABLE_REAL_SEND.
BEGIN;

ALTER TABLE public.relationship_campaigns
  ADD COLUMN IF NOT EXISTS dispatch_mode text NOT NULL DEFAULT 'manual',
  ADD COLUMN IF NOT EXISTS automatic_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS automation_changed_at timestamptz,
  ADD COLUMN IF NOT EXISTS automation_changed_by uuid;

ALTER TABLE public.relationship_campaigns
  DROP CONSTRAINT IF EXISTS relationship_campaigns_dispatch_mode_check;
ALTER TABLE public.relationship_campaigns
  ADD CONSTRAINT relationship_campaigns_dispatch_mode_check
  CHECK (dispatch_mode IN ('manual', 'assisted', 'automatic'));

-- Automação ligada só existe no modo automático.
ALTER TABLE public.relationship_campaigns
  DROP CONSTRAINT IF EXISTS relationship_campaigns_automation_requires_mode;
ALTER TABLE public.relationship_campaigns
  ADD CONSTRAINT relationship_campaigns_automation_requires_mode
  CHECK (NOT automatic_enabled OR dispatch_mode = 'automatic');

-- Varredura do runtime-tick: só campanhas automáticas ativadas.
CREATE INDEX IF NOT EXISTS relationship_campaigns_automation_idx
  ON public.relationship_campaigns(company_id, status)
  WHERE automatic_enabled AND dispatch_mode = 'automatic';

COMMIT;
