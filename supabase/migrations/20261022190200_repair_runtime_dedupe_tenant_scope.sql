-- Repair compatibility for databases that applied an early runtime dedupe
-- migration with a global unique index under this same index name.
--
-- CREATE UNIQUE INDEX IF NOT EXISTS cannot repair that situation: PostgreSQL
-- sees the name and leaves the old definition untouched. Replacing only this
-- index preserves all rows and makes the tenant boundary explicit. If two
-- rows already collide within the same company, creation fails deliberately;
-- silently deleting or merging them would weaken isolation and idempotency.

DROP INDEX IF EXISTS public.runtime_dedupe_key_uidx;

CREATE UNIQUE INDEX runtime_dedupe_key_uidx
  ON public.runtime_dedupe (
    operation,
    resource_key,
    bucket,
    COALESCE(company_id, '00000000-0000-0000-0000-000000000000'::uuid)
  );
