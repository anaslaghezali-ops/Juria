-- 19_fk_indexes.sql — Indexe les clés étrangères restées sans index.
--
-- Détectées par diag_index_audit : sans index sur la colonne FK, toute
-- suppression du parent (dossier, document, contrepartie, risque…) force un
-- seq scan de la table enfant, et les jointures/RLS qui filtrent sur ces
-- colonnes ne sont pas accélérées. Négligeable à petite échelle, coûteux au
-- volume. Idempotente.

-- Les 4 utiles au produit (RLS des tâches + cascades de suppression)
CREATE INDEX IF NOT EXISTS idx_tasks_document ON public.tasks (document_id);
CREATE INDEX IF NOT EXISTS idx_tasks_folder   ON public.tasks (folder_id);
CREATE INDEX IF NOT EXISTS idx_tasks_risk     ON public.tasks (risk_id);
CREATE INDEX IF NOT EXISTS idx_documents_counterparty ON public.documents (counterparty_id);

-- Les 2 restantes (cascades de purge org / suppression de compte)
CREATE INDEX IF NOT EXISTS idx_document_summaries_org ON public.document_summaries (organization_id);
CREATE INDEX IF NOT EXISTS idx_notifications_org       ON public.notifications (organization_id);
