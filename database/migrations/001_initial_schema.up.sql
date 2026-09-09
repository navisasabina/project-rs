-- Migration: 001_initial_schema.sql (UP)
-- Description: Create initial schema for RS Awal Bros IT Support Knowledge Base

-- 1. Create ENUM types
CREATE TYPE user_role AS ENUM ('ADMIN', 'IT_SUPPORT', 'IT_MANAGER');
CREATE TYPE guide_status AS ENUM ('DRAFT', 'PUBLISHED', 'ARCHIVED');

-- 2. Users Table
CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    full_name VARCHAR(100) NOT NULL,
    username VARCHAR(50) UNIQUE NOT NULL,
    email VARCHAR(100) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    role user_role NOT NULL DEFAULT 'IT_SUPPORT',
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- 3. Categories Table
CREATE TABLE IF NOT EXISTS categories (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(100) NOT NULL,
    slug VARCHAR(100) UNIQUE NOT NULL,
    icon VARCHAR(50) NOT NULL DEFAULT 'devices',
    description TEXT,
    display_order INT NOT NULL DEFAULT 0,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- 4. Guides Table
CREATE TABLE IF NOT EXISTS guides (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    category_id UUID NOT NULL REFERENCES categories(id) ON DELETE RESTRICT,
    author_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    key_code VARCHAR(50) UNIQUE NOT NULL,
    title VARCHAR(200) NOT NULL,
    location_scope VARCHAR(150) NOT NULL,
    image_url VARCHAR(500) NOT NULL,
    estimated_time VARCHAR(50) DEFAULT '2 - 4 Menit',
    user_description TEXT,
    symptoms JSONB NOT NULL DEFAULT '[]'::jsonb,
    possible_causes TEXT,
    security_note TEXT NOT NULL,
    prompt_shortcut VARCHAR(255),
    status guide_status NOT NULL DEFAULT 'DRAFT',
    keywords TEXT,
    search_vector TSVECTOR,
    published_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- 5. Guide Steps Table
CREATE TABLE IF NOT EXISTS guide_steps (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    guide_id UUID NOT NULL REFERENCES guides(id) ON DELETE CASCADE,
    step_number INT NOT NULL,
    title VARCHAR(200) NOT NULL,
    instruction TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT unique_guide_step UNIQUE (guide_id, step_number)
);

-- 6. Audit Logs Table
CREATE TABLE IF NOT EXISTS audit_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    action VARCHAR(50) NOT NULL,
    entity_name VARCHAR(50) NOT NULL,
    entity_id UUID NOT NULL,
    changes JSONB,
    ip_address VARCHAR(45),
    user_agent TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- 7. Indexes
CREATE INDEX IF NOT EXISTS idx_guides_category ON guides(category_id);
CREATE INDEX IF NOT EXISTS idx_guides_status ON guides(status);
CREATE INDEX IF NOT EXISTS idx_guides_search_vector ON guides USING GIN(search_vector);
CREATE INDEX IF NOT EXISTS idx_guide_steps_guide ON guide_steps(guide_id, step_number);

-- 8. Trigger function for Search Vector update
CREATE OR REPLACE FUNCTION update_guide_search_vector() RETURNS trigger AS $$
BEGIN
    NEW.search_vector :=
        setweight(to_tsvector('indonesian', coalesce(NEW.title, '')), 'A') ||
        setweight(to_tsvector('indonesian', coalesce(NEW.location_scope, '')), 'B') ||
        setweight(to_tsvector('indonesian', coalesce(NEW.keywords, '')), 'B') ||
        setweight(to_tsvector('indonesian', coalesce(NEW.possible_causes, '')), 'C');
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_guides_search_update ON guides;
CREATE TRIGGER trg_guides_search_update
BEFORE INSERT OR UPDATE ON guides
FOR EACH ROW EXECUTE FUNCTION update_guide_search_vector();
