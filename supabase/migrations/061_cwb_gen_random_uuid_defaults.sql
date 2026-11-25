-- CWB: databases first created from an older 001_initial_schema.sql still have column defaults
-- that call uuid_generate_v4() (uuid-ossp). Upstream's schema check refuses those, and current
-- migrations use gen_random_uuid(). Both produce random v4 UUIDs, so this changes no data and no
-- behaviour; it only rewrites the DEFAULT expression. Safe to run on a database that has none.
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT table_schema, table_name, column_name
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND column_default LIKE '%uuid_generate_v%'
  LOOP
    EXECUTE format(
      'ALTER TABLE %I.%I ALTER COLUMN %I SET DEFAULT gen_random_uuid()',
      r.table_schema, r.table_name, r.column_name
    );
  END LOOP;
END
$$;
