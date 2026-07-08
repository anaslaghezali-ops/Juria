-- Applied 2026-07-08 via Supabase MCP (apply_migration: synthesis_memo_foundation)
-- Fondations de la note de synthèse (cf. docs/NOTE_DE_SYNTHESE_DESIGN.md §5)
--
-- Principe : enrichir les modèles existants, zéro nouvelle table.

-- 1. La synthèse est un run d'analyse d'un genre différent.
--    document_analyses possède déjà tout le nécessaire : versioning,
--    chunk_version_at_analysis, model_used, prompt_version, tokens_used,
--    analysis_duration_ms, raw_result jsonb.
ALTER TABLE document_analyses
  ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'audit';

ALTER TABLE document_analyses
  DROP CONSTRAINT IF EXISTS document_analyses_kind_check;
ALTER TABLE document_analyses
  ADD CONSTRAINT document_analyses_kind_check CHECK (kind IN ('audit','synthesis'));

CREATE INDEX IF NOT EXISTS idx_analyses_doc_kind
  ON document_analyses (document_id, kind, created_at DESC);

-- 2. Cache MAP invalidable par version de document.
--    La contrainte unique (document_id, section_index) existante est
--    conservée volontairement : le cache ne garde que la dernière version
--    du document (les extraits d'anciennes versions sont sans valeur) et
--    chunk_version sert de témoin de fraîcheur — un mismatch déclenche la
--    ré-extraction de la section, l'upsert écrase l'ancienne ligne.
ALTER TABLE document_summaries
  ADD COLUMN IF NOT EXISTS chunk_version integer NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS extract jsonb,
  ADD COLUMN IF NOT EXISTS organization_id uuid REFERENCES organizations(id);
