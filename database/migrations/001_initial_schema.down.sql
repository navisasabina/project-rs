-- Migration: 001_initial_schema.sql (DOWN)
-- Description: Drop initial schema for RS Awal Bros IT Support Knowledge Base

DROP TRIGGER IF EXISTS trg_guides_search_update ON guides;
DROP FUNCTION IF EXISTS update_guide_search_vector();

DROP TABLE IF EXISTS audit_logs CASCADE;
DROP TABLE IF EXISTS guide_steps CASCADE;
DROP TABLE IF EXISTS guides CASCADE;
DROP TABLE IF EXISTS categories CASCADE;
DROP TABLE IF EXISTS users CASCADE;

DROP TYPE IF EXISTS guide_status;
DROP TYPE IF EXISTS user_role;
