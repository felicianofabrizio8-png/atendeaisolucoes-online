REVOKE ALL PRIVILEGES ON TABLE public.v_secret FROM anon, authenticated;
GRANT ALL PRIVILEGES ON TABLE public.v_secret TO service_role;
ALTER TABLE public.v_secret ENABLE ROW LEVEL SECURITY;
COMMENT ON TABLE public.v_secret IS 'Internal secrets table; access restricted to privileged server operations only.';