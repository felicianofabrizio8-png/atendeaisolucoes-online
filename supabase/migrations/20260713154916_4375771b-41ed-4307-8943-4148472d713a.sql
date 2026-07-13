-- Idempotent handle_new_user: reuse existing tenant if profile already exists.
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  new_company_id uuid;
  v_company_name text;
  v_existing_company uuid;
BEGIN
  -- Idempotência: se já existe profile para este auth user, reutiliza empresa.
  SELECT company_id INTO v_existing_company
    FROM public.profiles
   WHERE id = NEW.id;

  IF v_existing_company IS NOT NULL THEN
    -- Garante role admin (caso profile tenha sido criado sem role).
    INSERT INTO public.user_roles (company_id, user_id, role)
    VALUES (v_existing_company, NEW.id, 'admin')
    ON CONFLICT (company_id, user_id, role) DO NOTHING;
    RETURN NEW;
  END IF;

  v_company_name := COALESCE(NEW.raw_user_meta_data->>'company_name', 'Minha Empresa');

  INSERT INTO public.companies (name) VALUES (v_company_name) RETURNING id INTO new_company_id;

  INSERT INTO public.profiles (id, company_id, display_name, email)
  VALUES (
    NEW.id,
    new_company_id,
    COALESCE(NEW.raw_user_meta_data->>'display_name', split_part(NEW.email, '@', 1)),
    NEW.email
  )
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.company_settings (company_id) VALUES (new_company_id)
  ON CONFLICT (company_id) DO NOTHING;

  INSERT INTO public.loss_reasons (company_id, label) VALUES
    (new_company_id, 'Preço acima do orçamento'),
    (new_company_id, 'Comprou do concorrente'),
    (new_company_id, 'Sem retorno do cliente'),
    (new_company_id, 'Não era o cliente ideal'),
    (new_company_id, 'Problema de prazo')
  ON CONFLICT DO NOTHING;

  INSERT INTO public.user_roles (company_id, user_id, role)
  VALUES (new_company_id, NEW.id, 'admin')
  ON CONFLICT (company_id, user_id, role) DO NOTHING;

  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;