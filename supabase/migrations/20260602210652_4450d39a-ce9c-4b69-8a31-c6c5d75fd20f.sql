
-- 1. Add last_seen_at to profiles
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS last_seen_at timestamptz;

-- 2. Company invites table
CREATE TABLE IF NOT EXISTS public.company_invites (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL,
  email text NOT NULL,
  role app_role NOT NULL,
  token text NOT NULL UNIQUE DEFAULT encode(gen_random_bytes(24), 'hex'),
  invited_by uuid,
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '7 days'),
  accepted_at timestamptz,
  accepted_by uuid,
  cancelled_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_company_invites_company ON public.company_invites(company_id);
CREATE INDEX IF NOT EXISTS idx_company_invites_email ON public.company_invites(lower(email));
CREATE INDEX IF NOT EXISTS idx_company_invites_token ON public.company_invites(token);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.company_invites TO authenticated;
GRANT ALL ON public.company_invites TO service_role;

ALTER TABLE public.company_invites ENABLE ROW LEVEL SECURITY;

-- Admin can read invites of own company
CREATE POLICY "admin select company_invites"
  ON public.company_invites FOR SELECT
  TO authenticated
  USING (company_id = private.current_company_id() AND has_role(auth.uid(), 'admin'::app_role));

-- Admin can create invites
CREATE POLICY "admin insert company_invites"
  ON public.company_invites FOR INSERT
  TO authenticated
  WITH CHECK (company_id = private.current_company_id() AND has_role(auth.uid(), 'admin'::app_role));

-- Admin can update (cancel) invites
CREATE POLICY "admin update company_invites"
  ON public.company_invites FOR UPDATE
  TO authenticated
  USING (company_id = private.current_company_id() AND has_role(auth.uid(), 'admin'::app_role));

-- 3. Admin policies on user_roles (currently only SELECT exists)
CREATE POLICY "admin insert user_roles"
  ON public.user_roles FOR INSERT
  TO authenticated
  WITH CHECK (company_id = private.current_company_id() AND has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "admin update user_roles"
  ON public.user_roles FOR UPDATE
  TO authenticated
  USING (company_id = private.current_company_id() AND has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "admin delete user_roles"
  ON public.user_roles FOR DELETE
  TO authenticated
  USING (company_id = private.current_company_id() AND has_role(auth.uid(), 'admin'::app_role));

-- 4. Helper: count admins in a company (for last-admin protection)
CREATE OR REPLACE FUNCTION public.count_company_admins(_company_id uuid)
RETURNS integer
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COUNT(*)::int FROM public.user_roles
  WHERE company_id = _company_id AND role = 'admin'::app_role;
$$;

-- 5. Touch last_seen_at helper (called by client)
CREATE OR REPLACE FUNCTION public.touch_last_seen()
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE public.profiles SET last_seen_at = now() WHERE id = auth.uid();
$$;

GRANT EXECUTE ON FUNCTION public.touch_last_seen() TO authenticated;
GRANT EXECUTE ON FUNCTION public.count_company_admins(uuid) TO authenticated;
