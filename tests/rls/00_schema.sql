-- Schéma de référence pour les TESTS RLS (isolation multi-tenant) en CI.
-- Reproduit le socle Supabase hors migrations : rôles authenticated/anon,
-- schéma auth + auth.uid() (lit request.jwt.claims), structures des tables
-- métier, et les helpers des migrations 01-03 appliquées à la main en prod.
--
-- La CI charge CE fichier PUIS applique supabase/migrations/12..21 : la
-- combinaison reproduit fidèlement les politiques RLS de production (vérifié :
-- 60/60 définitions de politiques identiques au schéma prod, hors table
-- héritée `comments` dont la politique n'est pas encore versionnée).
-- ⚠️ À garder aligné quand une migration ajoute/modifie une table tenant.

DO $$ BEGIN CREATE ROLE authenticated NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE ROLE anon NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE SCHEMA auth;
GRANT USAGE ON SCHEMA auth TO authenticated, anon;

CREATE TABLE auth.users (
  instance_id uuid,
  id uuid PRIMARY KEY,
  aud text, role text, email text,
  encrypted_password text,
  email_confirmed_at timestamptz,
  created_at timestamptz, updated_at timestamptz,
  confirmation_token text, recovery_token text,
  email_change text, email_change_token_new text,
  raw_app_meta_data jsonb, raw_user_meta_data jsonb
);

CREATE FUNCTION auth.uid() RETURNS uuid
LANGUAGE sql STABLE AS $$
  SELECT (coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb->>'sub')::uuid
$$;

-- ── Tables métier (colonnes réelles utiles au test) ──────────────────
CREATE TABLE public.organizations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  slug text UNIQUE,
  monthly_quota integer DEFAULT 1000,
  max_storage_mb integer DEFAULT 500
);

CREATE TABLE public.organization_users (
  id uuid DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role text NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  PRIMARY KEY (organization_id, user_id)
);

CREATE TABLE public.counterparties (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  name text NOT NULL
);

CREATE TABLE public.folders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  name text NOT NULL,
  description text,
  color text NOT NULL DEFAULT '#6b7280',
  icon text NOT NULL DEFAULT 'folder',
  parent_id uuid REFERENCES public.folders(id) ON DELETE CASCADE,
  counterparty_id uuid,
  created_by uuid NOT NULL,
  documents_count integer NOT NULL DEFAULT 0,
  position integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  folder_id uuid REFERENCES public.folders(id) ON DELETE SET NULL,
  uploaded_by uuid,
  name text NOT NULL,
  file_type text, file_size bigint, storage_path text, storage_bucket text,
  page_count integer, language text, content_hash text, chunk_version integer DEFAULT 1,
  document_type text, title text, reference text, governing_law text,
  amount numeric, currency text, status text DEFAULT 'importé',
  compliance_score numeric, risk_level text,
  executive_summary text, latest_analysis_id uuid,
  is_starred boolean DEFAULT false, is_archived boolean DEFAULT false,
  tags text[], notes text, counterparty_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.document_risks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id uuid NOT NULL REFERENCES public.documents(id) ON DELETE CASCADE,
  organization_id uuid NOT NULL,
  clause_name text, clause_ref text, problem text, suggestion text,
  severity text, category text, legal_reference text,
  is_resolved boolean DEFAULT false, resolved_note text,
  status text DEFAULT 'open', assignee text, extract text,
  updated_at timestamptz, updated_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.document_obligations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id uuid REFERENCES public.documents(id) ON DELETE CASCADE,
  organization_id uuid REFERENCES public.organizations(id) ON DELETE CASCADE,
  description text NOT NULL,
  due_date date,
  is_critical boolean NOT NULL DEFAULT false,
  source text NOT NULL DEFAULT 'analysis',
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.document_analyses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id uuid NOT NULL REFERENCES public.documents(id) ON DELETE CASCADE,
  organization_id uuid,
  kind text NOT NULL DEFAULT 'audit',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.document_content (
  document_id uuid PRIMARY KEY REFERENCES public.documents(id) ON DELETE CASCADE,
  extracted_text text,
  updated_at timestamptz
);

CREATE TABLE public.document_chunks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id uuid NOT NULL REFERENCES public.documents(id) ON DELETE CASCADE,
  organization_id uuid,
  chunk_index integer, content text,
  indexing_status text DEFAULT 'pending'
);

CREATE TABLE public.document_summaries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id uuid NOT NULL REFERENCES public.documents(id) ON DELETE CASCADE,
  organization_id uuid,
  section_index integer,
  chunk_version integer NOT NULL DEFAULT 1,
  extract jsonb
);

CREATE TABLE public.risk_comments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  risk_id uuid NOT NULL REFERENCES public.document_risks(id) ON DELETE CASCADE,
  organization_id uuid NOT NULL,
  content text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.tasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  title text NOT NULL,
  status text DEFAULT 'todo', priority text DEFAULT 'medium',
  assigned_to uuid, created_by uuid,
  folder_id uuid REFERENCES public.folders(id) ON DELETE SET NULL,
  document_id uuid REFERENCES public.documents(id) ON DELETE CASCADE,
  risk_id uuid REFERENCES public.document_risks(id) ON DELETE SET NULL,
  due_date timestamptz,
  created_at timestamptz DEFAULT now()
);

-- ── RLS activée comme en prod ─────────────────────────────────────────
ALTER TABLE public.organizations        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.organization_users   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.counterparties       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.folders              ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.documents            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.document_risks       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.document_obligations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.document_analyses    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.document_content     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.document_chunks      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.document_summaries   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.risk_comments        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tasks                ENABLE ROW LEVEL SECURITY;

-- ── Helpers des migrations 01-03 ──────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_user_organization_ids()
RETURNS SETOF uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT organization_id FROM organization_users
  WHERE user_id = auth.uid() AND is_active = true;
$$;

CREATE OR REPLACE FUNCTION public.fn_user_role(p_org_id uuid)
RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT role FROM organization_users
  WHERE user_id = auth.uid() AND organization_id = p_org_id AND is_active = true
  LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.fn_document_org_id(p_document_id uuid)
RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT organization_id FROM documents WHERE id = p_document_id;
$$;

-- Policies de base sur organization_users (migration 01, version minimale :
-- lecture via le helper SECURITY DEFINER — pas de récursion)
CREATE POLICY org_users_select ON public.organization_users
FOR SELECT USING (
  user_id = auth.uid()
  OR organization_id IN (SELECT public.fn_user_organization_ids())
);

-- ── Grants façon Supabase ─────────────────────────────────────────────
GRANT USAGE ON SCHEMA public TO authenticated, anon;
GRANT ALL ON ALL TABLES IN SCHEMA public TO authenticated;
-- Comme chez Supabase : le rôle anon a le droit SELECT au niveau table, c'est
-- la RLS (et non l'absence de grant) qui doit le bloquer. On teste donc la RLS.
GRANT SELECT ON ALL TABLES IN SCHEMA public TO anon;
GRANT SELECT ON auth.users TO authenticated;

