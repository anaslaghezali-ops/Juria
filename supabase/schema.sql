-- ═══════════════════════════════════════════════════════════════════════════
-- JURIA DATABASE SCHEMA
-- Run this in Supabase SQL Editor to initialize the database
-- ═══════════════════════════════════════════════════════════════════════════

-- ── USER PROFILES TABLE ────────────────────────────────────────────────────
-- Stores user subscription data and quota
CREATE TABLE IF NOT EXISTS user_profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  plan TEXT DEFAULT 'trial' CHECK (plan IN ('trial', 'essential', 'pro', 'cabinet')),
  questions_used INT DEFAULT 0,
  questions_limit INT DEFAULT 20,
  trial_ends_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Enable RLS
ALTER TABLE user_profiles ENABLE ROW LEVEL SECURITY;

-- Policy: Users can read their own profile
CREATE POLICY "Users can read own profile"
  ON user_profiles FOR SELECT
  USING (auth.uid() = id);

-- Policy: Users can update their own profile
CREATE POLICY "Users can update own profile"
  ON user_profiles FOR UPDATE
  USING (auth.uid() = id);

-- Policy: Service role can read/write all
CREATE POLICY "Service role can manage all profiles"
  ON user_profiles FOR ALL
  USING (auth.jwt() ->> 'role' = 'service_role');


-- ── DOCUMENTS TABLE ────────────────────────────────────────────────────────
-- Stores uploaded documents for RAG mode
CREATE TABLE IF NOT EXISTS documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  file_type TEXT,
  file_size INT,
  content TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Enable RLS
ALTER TABLE documents ENABLE ROW LEVEL SECURITY;

-- Policy: Users can read their own documents
CREATE POLICY "Users can read own documents"
  ON documents FOR SELECT
  USING (auth.uid() = user_id);

-- Policy: Users can insert their own documents
CREATE POLICY "Users can insert own documents"
  ON documents FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- Policy: Users can update their own documents
CREATE POLICY "Users can update own documents"
  ON documents FOR UPDATE
  USING (auth.uid() = user_id);

-- Policy: Users can delete their own documents
CREATE POLICY "Users can delete own documents"
  ON documents FOR DELETE
  USING (auth.uid() = user_id);


-- ── DOCUMENT CHUNKS TABLE ─────────────────────────────────────────────────
-- Stores document chunks for vector search with embedding status
CREATE TABLE IF NOT EXISTS document_chunks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id UUID NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  chunk_index INT NOT NULL,
  chunk_version INT DEFAULT 1,
  content TEXT NOT NULL,
  page_number INT,
  embedding vector(1536),
  indexing_status TEXT DEFAULT 'pending' CHECK (indexing_status IN ('pending', 'done', 'failed')),
  indexed_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Enable RLS
ALTER TABLE document_chunks ENABLE ROW LEVEL SECURITY;

-- Policy: Users can read chunks of their own documents
CREATE POLICY "Users can read chunks of own documents"
  ON document_chunks FOR SELECT
  USING (
    document_id IN (
      SELECT id FROM documents WHERE auth.uid() = user_id
    )
  );

-- Policy: Users can insert chunks for their own documents
CREATE POLICY "Users can insert chunks for own documents"
  ON document_chunks FOR INSERT
  WITH CHECK (
    document_id IN (
      SELECT id FROM documents WHERE auth.uid() = user_id
    )
  );

-- Policy: Service role can manage all chunks
CREATE POLICY "Service role can manage all chunks"
  ON document_chunks FOR ALL
  USING (auth.jwt() ->> 'role' = 'service_role');


-- ── ARTICLES TABLE ────────────────────────────────────────────────────────
-- Stores legal articles with embeddings
CREATE TABLE IF NOT EXISTS articles_juridiques (
  id BIGINT PRIMARY KEY,
  code TEXT,
  numero_article TEXT NOT NULL,
  title TEXT,
  contenu TEXT,
  book TEXT,
  chapter TEXT,
  mots_cles TEXT,
  keywords_enriched TEXT,
  embedding vector(1536),
  search_vector tsvector GENERATED ALWAYS AS (
    to_tsvector('french', COALESCE(numero_article, '') || ' ' || COALESCE(contenu, '') || ' ' || COALESCE(mots_cles, ''))
  ) STORED,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create indices for performance
CREATE INDEX IF NOT EXISTS idx_articles_embedding ON articles_juridiques USING ivfflat (embedding vector_cosine_ops);
CREATE INDEX IF NOT EXISTS idx_articles_search_vector ON articles_juridiques USING GIN (search_vector);
CREATE INDEX IF NOT EXISTS idx_articles_code ON articles_juridiques (code);


-- ── INITIALIZE FIRST USER PROFILE ─────────────────────────────────────────
-- This trigger automatically creates a profile for new users
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.user_profiles (id, plan, questions_used, questions_limit, trial_ends_at)
  VALUES (
    NEW.id,
    'trial',
    0,
    20,
    NOW() + INTERVAL '7 days'
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Drop trigger if exists to avoid conflicts
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;

-- Create trigger
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();
