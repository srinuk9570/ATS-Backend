-- Run this once in psql or pgAdmin to set up the database
-- Command: psql -U postgres -d ats_db -f schema.sql

-- Create database if it doesn't exist (run separately as superuser)
-- CREATE DATABASE ats_db;

-- Users table (matches auth.js column names exactly)
CREATE TABLE IF NOT EXISTS users (
  id            SERIAL PRIMARY KEY,
  email         VARCHAR(255) UNIQUE NOT NULL,
  password_hash VARCHAR(255) NOT NULL,          -- 'OAUTH_GOOGLE' etc for OAuth users
  full_name     VARCHAR(255) NOT NULL,
  role          VARCHAR(50)  NOT NULL DEFAULT 'user',
  company       VARCHAR(255),
  created_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- Index for fast email lookups
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);

-- Auto-update updated_at on row changes
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS users_updated_at ON users;
CREATE TRIGGER users_updated_at
  BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- Verify
SELECT 'users table ready ✅' AS status;