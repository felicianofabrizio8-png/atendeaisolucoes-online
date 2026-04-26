-- ============================================================
-- ENUMS
-- ============================================================
CREATE TYPE public.channel AS ENUM ('whatsapp', 'instagram', 'facebook');
CREATE TYPE public.lead_status AS ENUM ('novo', 'aguardando', 'quente', 'morno', 'frio', 'fechado', 'perdido');
CREATE TYPE public.message_role AS ENUM ('lead', 'agent', 'system');
CREATE TYPE public.quote_status AS ENUM ('rascunho', 'enviado', 'aceito', 'recusado', 'expirado');
CREATE TYPE public.visit_status AS ENUM ('agendada', 'concluida', 'cancelada', 'remarcada');

-- ============================================================
-- COMPANIES
-- ============================================================
CREATE TABLE public.companies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  slug text UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.companies ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- PROFILES (1 user => 1 company for now)
-- ============================================================
CREATE TABLE public.profiles (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  display_name text,
  email text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
CREATE INDEX idx_profiles_company ON public.profiles(company_id);

-- ============================================================
-- Helper: get current user's company_id (SECURITY DEFINER, no recursion)
-- ============================================================
CREATE OR REPLACE FUNCTION public.current_company_id()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT company_id FROM public.profiles WHERE id = auth.uid()
$$;

-- ============================================================
-- LEADS
-- ============================================================
CREATE TABLE public.leads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  name text NOT NULL,
  phone text,
  handle text,
  channel public.channel NOT NULL,
  status public.lead_status NOT NULL DEFAULT 'novo',
  tags text[] NOT NULL DEFAULT '{}',
  estimated_value numeric(12,2),
  product text,
  next_action_label text,
  next_action_due_at timestamptz,
  assigned_to uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  loss_reason text,
  lost_at timestamptz,
  closed_value numeric(12,2),
  closed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.leads ENABLE ROW LEVEL SECURITY;
CREATE INDEX idx_leads_company ON public.leads(company_id);
CREATE INDEX idx_leads_status ON public.leads(company_id, status);

-- ============================================================
-- CONVERSATIONS
-- ============================================================
CREATE TABLE public.conversations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  lead_id uuid NOT NULL REFERENCES public.leads(id) ON DELETE CASCADE,
  channel public.channel NOT NULL,
  last_message_at timestamptz NOT NULL DEFAULT now(),
  unread int NOT NULL DEFAULT 0,
  awaiting_reply boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.conversations ENABLE ROW LEVEL SECURITY;
CREATE INDEX idx_conversations_company ON public.conversations(company_id);
CREATE INDEX idx_conversations_lead ON public.conversations(lead_id);

-- ============================================================
-- MESSAGES
-- ============================================================
CREATE TABLE public.messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  conversation_id uuid NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE,
  role public.message_role NOT NULL,
  text text NOT NULL,
  at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;
CREATE INDEX idx_messages_conversation ON public.messages(conversation_id, at);
CREATE INDEX idx_messages_company ON public.messages(company_id);

-- ============================================================
-- PRODUCTS
-- ============================================================
CREATE TABLE public.products (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  name text NOT NULL,
  description text,
  price numeric(12,2),
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.products ENABLE ROW LEVEL SECURITY;
CREATE INDEX idx_products_company ON public.products(company_id);

-- ============================================================
-- QUOTES
-- ============================================================
CREATE TABLE public.quotes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  lead_id uuid REFERENCES public.leads(id) ON DELETE SET NULL,
  items jsonb NOT NULL DEFAULT '[]'::jsonb,
  total numeric(12,2) NOT NULL DEFAULT 0,
  status public.quote_status NOT NULL DEFAULT 'rascunho',
  valid_until date,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.quotes ENABLE ROW LEVEL SECURITY;
CREATE INDEX idx_quotes_company ON public.quotes(company_id);

-- ============================================================
-- COMPANY SETTINGS (1:1 with company)
-- ============================================================
CREATE TABLE public.company_settings (
  company_id uuid PRIMARY KEY REFERENCES public.companies(id) ON DELETE CASCADE,
  sla_minutes int NOT NULL DEFAULT 30,
  business_hours_start time NOT NULL DEFAULT '09:00',
  business_hours_end time NOT NULL DEFAULT '18:00',
  greeting_message text,
  signature text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.company_settings ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- LOSS REASONS
-- ============================================================
CREATE TABLE public.loss_reasons (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  label text NOT NULL,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.loss_reasons ENABLE ROW LEVEL SECURITY;
CREATE INDEX idx_loss_reasons_company ON public.loss_reasons(company_id);

-- ============================================================
-- VISITS / SCHEDULED APPOINTMENTS
-- ============================================================
CREATE TABLE public.visits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  lead_id uuid REFERENCES public.leads(id) ON DELETE SET NULL,
  title text NOT NULL,
  address text,
  scheduled_at timestamptz NOT NULL,
  status public.visit_status NOT NULL DEFAULT 'agendada',
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.visits ENABLE ROW LEVEL SECURITY;
CREATE INDEX idx_visits_company ON public.visits(company_id);
CREATE INDEX idx_visits_scheduled ON public.visits(company_id, scheduled_at);

-- ============================================================
-- updated_at trigger
-- ============================================================
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_companies_updated BEFORE UPDATE ON public.companies FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER trg_profiles_updated BEFORE UPDATE ON public.profiles FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER trg_leads_updated BEFORE UPDATE ON public.leads FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER trg_conversations_updated BEFORE UPDATE ON public.conversations FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER trg_products_updated BEFORE UPDATE ON public.products FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER trg_quotes_updated BEFORE UPDATE ON public.quotes FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER trg_company_settings_updated BEFORE UPDATE ON public.company_settings FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER trg_visits_updated BEFORE UPDATE ON public.visits FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ============================================================
-- RLS POLICIES (company isolation)
-- ============================================================

-- companies: user can read their own company; updates allowed to members
CREATE POLICY "members read company" ON public.companies FOR SELECT TO authenticated USING (id = public.current_company_id());
CREATE POLICY "members update company" ON public.companies FOR UPDATE TO authenticated USING (id = public.current_company_id());

-- profiles: user can read profiles of their company; manage only own row
CREATE POLICY "read company profiles" ON public.profiles FOR SELECT TO authenticated USING (company_id = public.current_company_id());
CREATE POLICY "update own profile" ON public.profiles FOR UPDATE TO authenticated USING (id = auth.uid());

-- Generic helper macro: same 4 policies per table
-- LEADS
CREATE POLICY "company select leads" ON public.leads FOR SELECT TO authenticated USING (company_id = public.current_company_id());
CREATE POLICY "company insert leads" ON public.leads FOR INSERT TO authenticated WITH CHECK (company_id = public.current_company_id());
CREATE POLICY "company update leads" ON public.leads FOR UPDATE TO authenticated USING (company_id = public.current_company_id());
CREATE POLICY "company delete leads" ON public.leads FOR DELETE TO authenticated USING (company_id = public.current_company_id());

-- CONVERSATIONS
CREATE POLICY "company select conv" ON public.conversations FOR SELECT TO authenticated USING (company_id = public.current_company_id());
CREATE POLICY "company insert conv" ON public.conversations FOR INSERT TO authenticated WITH CHECK (company_id = public.current_company_id());
CREATE POLICY "company update conv" ON public.conversations FOR UPDATE TO authenticated USING (company_id = public.current_company_id());
CREATE POLICY "company delete conv" ON public.conversations FOR DELETE TO authenticated USING (company_id = public.current_company_id());

-- MESSAGES
CREATE POLICY "company select msg" ON public.messages FOR SELECT TO authenticated USING (company_id = public.current_company_id());
CREATE POLICY "company insert msg" ON public.messages FOR INSERT TO authenticated WITH CHECK (company_id = public.current_company_id());
CREATE POLICY "company update msg" ON public.messages FOR UPDATE TO authenticated USING (company_id = public.current_company_id());
CREATE POLICY "company delete msg" ON public.messages FOR DELETE TO authenticated USING (company_id = public.current_company_id());

-- PRODUCTS
CREATE POLICY "company select products" ON public.products FOR SELECT TO authenticated USING (company_id = public.current_company_id());
CREATE POLICY "company insert products" ON public.products FOR INSERT TO authenticated WITH CHECK (company_id = public.current_company_id());
CREATE POLICY "company update products" ON public.products FOR UPDATE TO authenticated USING (company_id = public.current_company_id());
CREATE POLICY "company delete products" ON public.products FOR DELETE TO authenticated USING (company_id = public.current_company_id());

-- QUOTES
CREATE POLICY "company select quotes" ON public.quotes FOR SELECT TO authenticated USING (company_id = public.current_company_id());
CREATE POLICY "company insert quotes" ON public.quotes FOR INSERT TO authenticated WITH CHECK (company_id = public.current_company_id());
CREATE POLICY "company update quotes" ON public.quotes FOR UPDATE TO authenticated USING (company_id = public.current_company_id());
CREATE POLICY "company delete quotes" ON public.quotes FOR DELETE TO authenticated USING (company_id = public.current_company_id());

-- COMPANY SETTINGS
CREATE POLICY "company select settings" ON public.company_settings FOR SELECT TO authenticated USING (company_id = public.current_company_id());
CREATE POLICY "company insert settings" ON public.company_settings FOR INSERT TO authenticated WITH CHECK (company_id = public.current_company_id());
CREATE POLICY "company update settings" ON public.company_settings FOR UPDATE TO authenticated USING (company_id = public.current_company_id());

-- LOSS REASONS
CREATE POLICY "company select reasons" ON public.loss_reasons FOR SELECT TO authenticated USING (company_id = public.current_company_id());
CREATE POLICY "company insert reasons" ON public.loss_reasons FOR INSERT TO authenticated WITH CHECK (company_id = public.current_company_id());
CREATE POLICY "company update reasons" ON public.loss_reasons FOR UPDATE TO authenticated USING (company_id = public.current_company_id());
CREATE POLICY "company delete reasons" ON public.loss_reasons FOR DELETE TO authenticated USING (company_id = public.current_company_id());

-- VISITS
CREATE POLICY "company select visits" ON public.visits FOR SELECT TO authenticated USING (company_id = public.current_company_id());
CREATE POLICY "company insert visits" ON public.visits FOR INSERT TO authenticated WITH CHECK (company_id = public.current_company_id());
CREATE POLICY "company update visits" ON public.visits FOR UPDATE TO authenticated USING (company_id = public.current_company_id());
CREATE POLICY "company delete visits" ON public.visits FOR DELETE TO authenticated USING (company_id = public.current_company_id());

-- ============================================================
-- AUTO-PROVISION ON SIGNUP: company + profile + settings + default loss reasons
-- ============================================================
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  new_company_id uuid;
  v_company_name text;
BEGIN
  v_company_name := COALESCE(NEW.raw_user_meta_data->>'company_name', 'Minha Empresa');

  INSERT INTO public.companies (name) VALUES (v_company_name) RETURNING id INTO new_company_id;

  INSERT INTO public.profiles (id, company_id, display_name, email)
  VALUES (
    NEW.id,
    new_company_id,
    COALESCE(NEW.raw_user_meta_data->>'display_name', split_part(NEW.email, '@', 1)),
    NEW.email
  );

  INSERT INTO public.company_settings (company_id) VALUES (new_company_id);

  INSERT INTO public.loss_reasons (company_id, label) VALUES
    (new_company_id, 'Preço acima do orçamento'),
    (new_company_id, 'Comprou do concorrente'),
    (new_company_id, 'Sem retorno do cliente'),
    (new_company_id, 'Não era o cliente ideal'),
    (new_company_id, 'Problema de prazo');

  RETURN NEW;
END;
$$;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();