-- Crea el rol de aplicacion (pms_app) que la API usa para conectarse.
-- - El rol pms (creado por el contenedor postgres a partir de POSTGRES_USER) es el OWNER:
--   ejecuta migraciones y es propietario de las tablas. Tiene BYPASSRLS (es superuser).
-- - El rol pms_app es el que usa el API en runtime: NO es superuser, NO bypassea RLS.
--   Las politicas RLS aplican sobre el.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'pms_app') THEN
    CREATE ROLE pms_app LOGIN PASSWORD 'pms_app_dev_password';
  END IF;
END
$$;

GRANT CONNECT ON DATABASE pms TO pms_app;
GRANT USAGE ON SCHEMA public TO pms_app;

-- Privilegios sobre tablas/sequences se conceden al final de cada migracion
-- (la 00000000000000_init incluye los GRANTs explicitamente).
