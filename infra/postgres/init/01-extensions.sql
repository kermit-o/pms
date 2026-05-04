-- PostgreSQL extensions used by the PMS.
-- Executed on first container start by the postgres image.

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";    -- uuid_generate_v4()
CREATE EXTENSION IF NOT EXISTS "pgcrypto";     -- gen_random_uuid(), digest(), etc.
CREATE EXTENSION IF NOT EXISTS "citext";       -- case-insensitive text (emails)
CREATE EXTENSION IF NOT EXISTS "btree_gist";   -- exclusion constraints for date ranges (overlap)
