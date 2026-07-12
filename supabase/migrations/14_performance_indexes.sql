-- 14_performance_indexes.sql — Indexes de performance (audit scalabilité).
--
-- Avant cette migration, les requêtes structurantes de l'app faisaient des
-- full table scans : chaque chargement de page lisait documents,
-- document_risks, tasks… filtrés par organization_id SANS index. Négligeable
-- à 50 documents, bloquant à 10 000.
--
-- Déjà posés ailleurs : folder_members(user_id), folders(parent_id),
-- documents(folder_id) (migration 13) ; document_obligations(org, due_date)
-- (migration 12) ; document_analyses(document_id, kind, created_at) (05).
--
-- Idempotente : IF NOT EXISTS partout.

-- ── Tier 1 — chemins critiques (chargement de chaque page) ───────────
-- bootstrap : documents par org triés par date (+ filtre is_archived)
CREATE INDEX IF NOT EXISTS idx_documents_org_created
  ON public.documents (organization_id, created_at DESC);
-- Couvre aussi le SUM(file_size) par org du trigger de quota stockage.

CREATE INDEX IF NOT EXISTS idx_document_risks_org_created
  ON public.document_risks (organization_id, created_at DESC);

-- RLS fn_document_access + jointures risques→documents
CREATE INDEX IF NOT EXISTS idx_document_risks_document
  ON public.document_risks (document_id);

-- ── Tier 2 — helpers RLS et listes secondaires ───────────────────────
-- fn_user_organization_ids / fn_user_role : appelées par CHAQUE policy
CREATE INDEX IF NOT EXISTS idx_organization_users_user_active
  ON public.organization_users (user_id, is_active);

CREATE INDEX IF NOT EXISTS idx_folders_org
  ON public.folders (organization_id);

CREATE INDEX IF NOT EXISTS idx_counterparties_org_name
  ON public.counterparties (organization_id, name);

CREATE INDEX IF NOT EXISTS idx_tasks_org_created
  ON public.tasks (organization_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_document_obligations_document
  ON public.document_obligations (document_id);

CREATE INDEX IF NOT EXISTS idx_document_analyses_org
  ON public.document_analyses (organization_id);

CREATE INDEX IF NOT EXISTS idx_risk_comments_org
  ON public.risk_comments (organization_id);

CREATE INDEX IF NOT EXISTS idx_risk_comments_risk
  ON public.risk_comments (risk_id);

-- Chunks RAG : lookup par document (match_document_chunks, invalidation)
CREATE INDEX IF NOT EXISTS idx_document_chunks_document
  ON public.document_chunks (document_id);
