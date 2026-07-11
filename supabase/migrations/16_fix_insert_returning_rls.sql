-- 16_fix_insert_returning_rls.sql — Corrige le 42501 sur toute création.
--
-- SYMPTÔME : depuis la migration 13, TOUT `.insert().select()` (folders,
-- documents — donc création de dossier ET upload) échouait en 403 /
-- « new row violates row-level security policy », alors que l'insertion
-- seule (sans relecture) réussissait.
--
-- CAUSE : supabase-js `.insert().select()` génère
--   WITH x AS (INSERT ... RETURNING *) SELECT * FROM x
-- Le SELECT externe applique la policy SELECT à la ligne renvoyée. Or les
-- policies SELECT posées en 13 étaient `fn_folder_access(id) IS NOT NULL`
-- et `fn_document_access(id) IS NOT NULL` : ces fonctions RE-LISENT la table
-- cible (folders / documents) pour retrouver la ligne. Règle PostgreSQL :
-- une ligne insérée dans une CTE data-modifying n'est PAS visible à une
-- relecture de la même table dans la même requête. La fonction ne trouve
-- donc pas la ligne fraîche → renvoie NULL → USING faux → 403.
-- (Les policies d'AVANT la 13 lisaient organization_id directement sur la
-- ligne, sans relecture — d'où « ça marchait avant le partage ».)
--
-- CORRECTIF : juger la ligne à partir de SES PROPRES colonnes (created_by /
-- uploaded_by / visibility / organization_id), sans relecture, pour les cas
-- courants ; fn_folder_access / fn_document_access ne sert plus qu'aux cas
-- hérités (sous-dossier, invitation), où la ligne parente existe déjà et est
-- donc lisible. Le modèle de partage est inchangé : un créateur voit
-- toujours sa ligne (il en est propriétaire), l'admin aussi, l'org pour les
-- dossiers 'org', les invités via la fonction.
--
-- Les tables ENFANTS (document_risks, document_content, chunks, etc.) ne
-- sont PAS concernées : leur policy SELECT relit `documents` (le parent, qui
-- existe déjà), pas leur propre ligne fraîche.
--
-- Idempotente : DROP POLICY IF EXISTS + CREATE.

-- folders : le créateur / l'org (dossier 'org') / l'admin sans relecture,
-- puis la fonction pour les sous-dossiers et les dossiers partagés.
DROP POLICY IF EXISTS folders_select ON public.folders;
CREATE POLICY folders_select ON public.folders
FOR SELECT USING (
  created_by = auth.uid()
  OR (visibility = 'org' AND organization_id IN (SELECT public.fn_user_organization_ids()))
  OR public.fn_is_org_admin(organization_id)
  OR public.fn_folder_access(id) IS NOT NULL
);

-- documents : l'importateur / l'admin sans relecture, puis la fonction pour
-- les documents accessibles via le dossier (partage, org).
DROP POLICY IF EXISTS documents_select ON public.documents;
CREATE POLICY documents_select ON public.documents
FOR SELECT USING (
  uploaded_by = auth.uid()
  OR public.fn_is_org_admin(organization_id)
  OR public.fn_document_access(id) IS NOT NULL
);
