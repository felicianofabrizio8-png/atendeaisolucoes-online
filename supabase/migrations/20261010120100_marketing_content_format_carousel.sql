-- Novo formato de conteúdo: carrossel (várias imagens em um post).
-- Em arquivo próprio: um valor novo de enum não pode ser usado na mesma
-- transação em que é criado.
ALTER TYPE public.marketing_content_format ADD VALUE IF NOT EXISTS 'carousel';
