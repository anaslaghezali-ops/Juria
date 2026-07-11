-- 13_folder_sharing.sql — Partage de dossiers, Phase 1 : modèle + RLS.
--
-- Passage du modèle « tout membre voit tout » à « accès par dossier » :
--   - folders.visibility : 'private' (créateur seul) ou 'org' (toute l'org).
--     L'état « partagé » de l'UI est DÉRIVÉ (private + invitations) : pas de
--     3e valeur à désynchroniser.
--   - folder_members : invitations nominatives (viewer | editor) posées par
--     le propriétaire sur le dossier RACINE uniquement — les sous-dossiers,
--     documents, risques, échéances, analyses, contenus, chunks RAG et
--     commentaires héritent tous de l'accès de la racine.
--   - Le propriétaire d'un dossier = folders.created_by (colonne existante).
--   - Les admin/owner d'organisation gardent un accès total (vue de
--     supervision assumée et affichée côté UI).
--
-- MIGRATION SANS CASSE :
--   - Dossiers existants → visibility = 'org' : personne ne perd l'accès à
--     rien le jour J. Les dossiers 'org' donnent 'editor' aux rôles écrivains
--     (owner/admin/lawyer/member) et 'viewer' au rôle reader — soit très
--     exactement les droits qu'avaient tous les membres avant cette migration.
--   - Nouveaux dossiers → 'private' par défaut.
--   - Documents SANS dossier : leur importateur en devient propriétaire ;
--     ceux dont uploaded_by est NULL (historique) restent accessibles à toute
--     l'org en écriture (compat), la lecture seule pour le rôle reader.
--
-- SÉCURITÉ :
--   - Tout le filtrage est en RLS (le front ne fait que refléter). Les helpers
--     sont SECURITY DEFINER + search_path épinglé (pattern des migrations
--     01-03, pas de récursion de policy possible).
--   - Deux vieilles policies permissives redondantes sont supprimées
--     (document_chunks « Users can access chunks of their org documents »,
--     document_summaries « Users can access their org summaries ») : étant
--     PERMISSIVE, elles auraient court-circuité le partage par OR.
--   - Le pipeline serveur (process-chunks, quotas, purge superadmin) passe
--     par le service role : non affecté.
--
-- Idempotente : IF NOT EXISTS / OR REPLACE / DROP POLICY IF EXISTS partout.

-- ═══════════════════════════════════════════════════════════════════
-- 1) SCHÉMA
-- ═══════════════════════════════════════════════════════════════════

-- folders.visibility — ordre critique pour le backfill : colonne nullable
-- d'abord, backfill des existants à 'org', PUIS default 'private' + NOT NULL.
ALTER TABLE public.folders ADD COLUMN IF NOT EXISTS visibility text;
UPDATE public.folders SET visibility = 'org' WHERE visibility IS NULL;
ALTER TABLE public.folders ALTER COLUMN visibility SET DEFAULT 'private';
ALTER TABLE public.folders ALTER COLUMN visibility SET NOT NULL;
DO $$ BEGIN
  ALTER TABLE public.folders
    ADD CONSTRAINT folders_visibility_check CHECK (visibility IN ('private','org'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- FIX échéances (découvert en écrivant les tests d'accès) : la table
-- document_obligations PRÉEXISTAIT à la migration 12 avec analysis_id
-- NOT NULL — chaque INSERT d'échéance (extraite comme manuelle) violait la
-- contrainte et échouait silencieusement. Une échéance manuelle n'a pas
-- d'analyse : la contrainte saute. (No-op si la colonne n'existe pas.)
DO $$ BEGIN
  ALTER TABLE public.document_obligations ALTER COLUMN analysis_id DROP NOT NULL;
EXCEPTION WHEN undefined_column THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS public.folder_members (
  folder_id  uuid NOT NULL REFERENCES public.folders(id) ON DELETE CASCADE,
  user_id    uuid NOT NULL,
  role       text NOT NULL CHECK (role IN ('viewer','editor')),
  granted_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (folder_id, user_id)
);

-- Grants explicites (ne pas dépendre des default privileges du projet) :
-- l'accès réel est gouverné par les policies RLS ci-dessous.
GRANT SELECT, INSERT, UPDATE, DELETE ON public.folder_members TO authenticated;
GRANT SELECT ON public.folder_members TO anon;

-- Indexes au service des nouveaux chemins d'accès.
CREATE INDEX IF NOT EXISTS idx_folder_members_user ON public.folder_members (user_id);
CREATE INDEX IF NOT EXISTS idx_folders_parent      ON public.folders (parent_id);
CREATE INDEX IF NOT EXISTS idx_documents_folder    ON public.documents (folder_id);

-- ═══════════════════════════════════════════════════════════════════
-- 2) HELPERS (SECURITY DEFINER, search_path épinglé)
-- ═══════════════════════════════════════════════════════════════════

-- Racine d'un dossier (l'unité de partage). Garde-fou anti-cycle : 10 niveaux.
CREATE OR REPLACE FUNCTION public.fn_folder_root_id(p_folder_id uuid)
RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  WITH RECURSIVE up AS (
    SELECT id, parent_id, 1 AS depth FROM folders WHERE id = p_folder_id
    UNION ALL
    SELECT f.id, f.parent_id, up.depth + 1
    FROM folders f JOIN up ON f.id = up.parent_id
    WHERE up.depth < 10
  )
  SELECT id FROM up WHERE parent_id IS NULL LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.fn_is_org_admin(p_org_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT COALESCE(fn_user_role(p_org_id) IN ('owner','admin'), false);
$$;

-- Niveau d'accès de l'utilisateur courant sur un dossier :
-- 'owner' | 'editor' | 'viewer' | NULL (aucun accès).
-- Résout toujours la RACINE : un sous-dossier hérite intégralement.
CREATE OR REPLACE FUNCTION public.fn_folder_access(p_folder_id uuid)
RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT CASE
    WHEN ou.role IS NULL THEN NULL                     -- pas membre actif de l'org
    WHEN ou.role IN ('owner','admin') THEN 'owner'     -- supervision admin
    WHEN r.created_by = auth.uid() THEN 'owner'        -- créateur = propriétaire
    WHEN fm.role IS NOT NULL THEN fm.role              -- invitation explicite
    WHEN r.visibility = 'org' AND ou.role IN ('lawyer','member') THEN 'editor'
    WHEN r.visibility = 'org' THEN 'viewer'            -- rôle reader
    ELSE NULL
  END
  FROM folders r
  LEFT JOIN organization_users ou
    ON ou.organization_id = r.organization_id
   AND ou.user_id = auth.uid()
   AND ou.is_active = true
  LEFT JOIN folder_members fm
    ON fm.folder_id = r.id AND fm.user_id = auth.uid()
  WHERE r.id = public.fn_folder_root_id(p_folder_id);
$$;

-- Niveau d'accès sur un document. Document en dossier → accès du dossier ;
-- sans dossier → propriété de l'importateur (compat : uploaded_by NULL reste
-- modifiable par les rôles écrivains de l'org, comme avant la migration).
CREATE OR REPLACE FUNCTION public.fn_document_access(p_document_id uuid)
RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT CASE
    WHEN x.org_role IS NULL THEN NULL
    WHEN x.org_role IN ('owner','admin') THEN 'owner'
    WHEN d.folder_id IS NOT NULL THEN public.fn_folder_access(d.folder_id)
    WHEN d.uploaded_by = auth.uid() THEN
      CASE WHEN x.org_role = 'reader' THEN 'viewer' ELSE 'owner' END
    WHEN d.uploaded_by IS NULL THEN
      CASE WHEN x.org_role = 'reader' THEN 'viewer' ELSE 'editor' END
    ELSE NULL
  END
  FROM documents d
  CROSS JOIN LATERAL (SELECT public.fn_user_role(d.organization_id) AS org_role) x
  WHERE d.id = p_document_id;
$$;

-- Document porteur d'un risque (pour risk_comments et tasks liés à un risque).
CREATE OR REPLACE FUNCTION public.fn_risk_document_id(p_risk_id uuid)
RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT document_id FROM document_risks WHERE id = p_risk_id;
$$;

-- Le partage : propriétaire uniquement, dossier RACINE uniquement, vers un
-- membre ACTIF de la même organisation uniquement.
CREATE OR REPLACE FUNCTION public.fn_can_share_folder(p_folder_id uuid, p_target_user uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT public.fn_folder_access(p_folder_id) = 'owner'
     AND (SELECT parent_id FROM folders WHERE id = p_folder_id) IS NULL
     AND EXISTS (
       SELECT 1
       FROM organization_users ou
       JOIN folders f ON f.organization_id = ou.organization_id
       WHERE f.id = p_folder_id
         AND ou.user_id = p_target_user
         AND ou.is_active = true
     );
$$;

-- ═══════════════════════════════════════════════════════════════════
-- 3) GARDE-FOU : colonnes sensibles de folders réservées au propriétaire
--    (la policy UPDATE autorise l'éditeur à renommer/réorganiser, mais
--    visibilité, propriétaire et rattachement racine ne bougent que par
--    le propriétaire — le service role, auth.uid() NULL, n'est pas gêné).
-- ═══════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.fn_folders_protect_sensitive()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN RETURN NEW; END IF;
  IF (NEW.visibility IS DISTINCT FROM OLD.visibility
      OR NEW.created_by IS DISTINCT FROM OLD.created_by
      OR NEW.parent_id  IS DISTINCT FROM OLD.parent_id)
     AND COALESCE(public.fn_folder_access(OLD.id), '') <> 'owner' THEN
    RAISE EXCEPTION 'Seul le propriétaire du dossier peut modifier sa visibilité ou sa hiérarchie';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_folders_protect_sensitive ON public.folders;
CREATE TRIGGER trg_folders_protect_sensitive
BEFORE UPDATE ON public.folders
FOR EACH ROW EXECUTE FUNCTION public.fn_folders_protect_sensitive();

-- ═══════════════════════════════════════════════════════════════════
-- 4) POLICIES — folders
-- ═══════════════════════════════════════════════════════════════════

DROP POLICY IF EXISTS folders_select ON public.folders;
DROP POLICY IF EXISTS folders_insert ON public.folders;
DROP POLICY IF EXISTS folders_update ON public.folders;
DROP POLICY IF EXISTS folders_delete ON public.folders;

CREATE POLICY folders_select ON public.folders
FOR SELECT USING (public.fn_folder_access(id) IS NOT NULL);

-- Créer : membre écrivain ; on ne crée un sous-dossier que là où l'on édite ;
-- created_by ne peut pas être usurpé.
CREATE POLICY folders_insert ON public.folders
FOR INSERT WITH CHECK (
  organization_id IN (SELECT public.fn_user_organization_ids())
  AND public.fn_user_role(organization_id) IN ('owner','admin','lawyer','member')
  AND created_by = auth.uid()
  AND (parent_id IS NULL OR public.fn_folder_access(parent_id) IN ('owner','editor'))
);

CREATE POLICY folders_update ON public.folders
FOR UPDATE
USING  (public.fn_folder_access(id) IN ('owner','editor'))
WITH CHECK (public.fn_folder_access(id) IN ('owner','editor'));

CREATE POLICY folders_delete ON public.folders
FOR DELETE USING (public.fn_folder_access(id) = 'owner');

-- ═══════════════════════════════════════════════════════════════════
-- 5) POLICIES — folder_members
-- ═══════════════════════════════════════════════════════════════════

ALTER TABLE public.folder_members ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS folder_members_select ON public.folder_members;
DROP POLICY IF EXISTS folder_members_insert ON public.folder_members;
DROP POLICY IF EXISTS folder_members_update ON public.folder_members;
DROP POLICY IF EXISTS folder_members_delete ON public.folder_members;

-- Un invité voit ses propres accès (« Partagés avec moi ») ; le propriétaire
-- voit la liste complète (modal de partage).
CREATE POLICY folder_members_select ON public.folder_members
FOR SELECT USING (
  user_id = auth.uid() OR public.fn_folder_access(folder_id) = 'owner'
);

CREATE POLICY folder_members_insert ON public.folder_members
FOR INSERT WITH CHECK (
  public.fn_can_share_folder(folder_id, user_id)
  AND granted_by = auth.uid()
  AND user_id <> auth.uid()
);

CREATE POLICY folder_members_update ON public.folder_members
FOR UPDATE
USING  (public.fn_folder_access(folder_id) = 'owner')
WITH CHECK (public.fn_can_share_folder(folder_id, user_id));

-- Le propriétaire révoque ; un invité peut se retirer lui-même.
CREATE POLICY folder_members_delete ON public.folder_members
FOR DELETE USING (
  public.fn_folder_access(folder_id) = 'owner' OR user_id = auth.uid()
);

-- ═══════════════════════════════════════════════════════════════════
-- 6) POLICIES — documents
-- ═══════════════════════════════════════════════════════════════════

DROP POLICY IF EXISTS documents_select ON public.documents;
DROP POLICY IF EXISTS documents_insert ON public.documents;
DROP POLICY IF EXISTS documents_update ON public.documents;
DROP POLICY IF EXISTS documents_delete ON public.documents;

CREATE POLICY documents_select ON public.documents
FOR SELECT USING (public.fn_document_access(id) IS NOT NULL);

CREATE POLICY documents_insert ON public.documents
FOR INSERT WITH CHECK (
  organization_id IN (SELECT public.fn_user_organization_ids())
  AND public.fn_user_role(organization_id) IN ('owner','admin','lawyer','member')
  AND (folder_id IS NULL OR public.fn_folder_access(folder_id) IN ('owner','editor'))
);

-- Le WITH CHECK re-valide le dossier CIBLE : déplacer un document vers un
-- dossier exige d'y être éditeur.
CREATE POLICY documents_update ON public.documents
FOR UPDATE
USING (public.fn_document_access(id) IN ('owner','editor'))
WITH CHECK (
  public.fn_document_access(id) IN ('owner','editor')
  AND (folder_id IS NULL OR public.fn_folder_access(folder_id) IN ('owner','editor'))
);

CREATE POLICY documents_delete ON public.documents
FOR DELETE USING (public.fn_document_access(id) = 'owner');

-- ═══════════════════════════════════════════════════════════════════
-- 7) POLICIES — tables enfants des documents
-- ═══════════════════════════════════════════════════════════════════

-- document_risks ------------------------------------------------------
DROP POLICY IF EXISTS risks_select ON public.document_risks;
DROP POLICY IF EXISTS risks_insert ON public.document_risks;
DROP POLICY IF EXISTS risks_update ON public.document_risks;
DROP POLICY IF EXISTS risks_delete ON public.document_risks;

CREATE POLICY risks_select ON public.document_risks
FOR SELECT USING (public.fn_document_access(document_id) IS NOT NULL);

CREATE POLICY risks_insert ON public.document_risks
FOR INSERT WITH CHECK (
  organization_id IN (SELECT public.fn_user_organization_ids())
  AND public.fn_document_access(document_id) IN ('owner','editor')
);

CREATE POLICY risks_update ON public.document_risks
FOR UPDATE
USING  (public.fn_document_access(document_id) IN ('owner','editor'))
WITH CHECK (public.fn_document_access(document_id) IN ('owner','editor'));

CREATE POLICY risks_delete ON public.document_risks
FOR DELETE USING (
  public.fn_is_org_admin(organization_id)
  OR public.fn_document_access(document_id) = 'owner'
);

-- document_obligations (document_id nullable : échéance manuelle libre,
-- qui reste visible à toute l'org comme aujourd'hui) ------------------
DROP POLICY IF EXISTS obligations_select ON public.document_obligations;
DROP POLICY IF EXISTS obligations_insert ON public.document_obligations;
DROP POLICY IF EXISTS obligations_update ON public.document_obligations;
DROP POLICY IF EXISTS obligations_delete ON public.document_obligations;

CREATE POLICY obligations_select ON public.document_obligations
FOR SELECT USING (
  organization_id IN (SELECT public.fn_user_organization_ids())
  AND (document_id IS NULL OR public.fn_document_access(document_id) IS NOT NULL)
);

CREATE POLICY obligations_insert ON public.document_obligations
FOR INSERT WITH CHECK (
  organization_id IN (SELECT public.fn_user_organization_ids())
  AND public.fn_user_role(organization_id) IN ('owner','admin','lawyer','member')
  AND (document_id IS NULL OR public.fn_document_access(document_id) IN ('owner','editor'))
);

CREATE POLICY obligations_update ON public.document_obligations
FOR UPDATE
USING (
  public.fn_user_role(organization_id) IN ('owner','admin','lawyer','member')
  AND (document_id IS NULL OR public.fn_document_access(document_id) IN ('owner','editor'))
)
WITH CHECK (
  public.fn_user_role(organization_id) IN ('owner','admin','lawyer','member')
  AND (document_id IS NULL OR public.fn_document_access(document_id) IN ('owner','editor'))
);

CREATE POLICY obligations_delete ON public.document_obligations
FOR DELETE USING (
  public.fn_user_role(organization_id) IN ('owner','admin','lawyer','member')
  AND (document_id IS NULL OR public.fn_document_access(document_id) IN ('owner','editor'))
);

-- document_analyses ---------------------------------------------------
DROP POLICY IF EXISTS analyses_select ON public.document_analyses;
DROP POLICY IF EXISTS analyses_insert ON public.document_analyses;
DROP POLICY IF EXISTS analyses_delete ON public.document_analyses;

CREATE POLICY analyses_select ON public.document_analyses
FOR SELECT USING (public.fn_document_access(document_id) IS NOT NULL);

CREATE POLICY analyses_insert ON public.document_analyses
FOR INSERT WITH CHECK (
  organization_id IN (SELECT public.fn_user_organization_ids())
  AND public.fn_document_access(document_id) IN ('owner','editor')
);

CREATE POLICY analyses_delete ON public.document_analyses
FOR DELETE USING (
  public.fn_is_org_admin(organization_id)
  OR public.fn_document_access(document_id) = 'owner'
);

-- document_content ----------------------------------------------------
DROP POLICY IF EXISTS doc_content_select ON public.document_content;
DROP POLICY IF EXISTS doc_content_insert ON public.document_content;
DROP POLICY IF EXISTS doc_content_update ON public.document_content;
DROP POLICY IF EXISTS doc_content_delete ON public.document_content;

CREATE POLICY doc_content_select ON public.document_content
FOR SELECT USING (public.fn_document_access(document_id) IS NOT NULL);

CREATE POLICY doc_content_insert ON public.document_content
FOR INSERT WITH CHECK (public.fn_document_access(document_id) IN ('owner','editor'));

CREATE POLICY doc_content_update ON public.document_content
FOR UPDATE
USING  (public.fn_document_access(document_id) IN ('owner','editor'))
WITH CHECK (public.fn_document_access(document_id) IN ('owner','editor'));

CREATE POLICY doc_content_delete ON public.document_content
FOR DELETE USING (public.fn_document_access(document_id) = 'owner');

-- document_chunks (RAG) — suppression de la vieille policy permissive
-- qui ouvrait les chunks à toute l'org et aurait annulé le partage.
DROP POLICY IF EXISTS "Users can access chunks of their org documents" ON public.document_chunks;
DROP POLICY IF EXISTS chunks_select ON public.document_chunks;
DROP POLICY IF EXISTS chunks_insert ON public.document_chunks;
DROP POLICY IF EXISTS chunks_update ON public.document_chunks;
DROP POLICY IF EXISTS chunks_delete ON public.document_chunks;

CREATE POLICY chunks_select ON public.document_chunks
FOR SELECT USING (public.fn_document_access(document_id) IS NOT NULL);

CREATE POLICY chunks_insert ON public.document_chunks
FOR INSERT WITH CHECK (
  organization_id IN (SELECT public.fn_user_organization_ids())
  AND public.fn_document_access(document_id) IN ('owner','editor')
);

CREATE POLICY chunks_update ON public.document_chunks
FOR UPDATE
USING  (public.fn_document_access(document_id) IN ('owner','editor'))
WITH CHECK (public.fn_document_access(document_id) IN ('owner','editor'));

CREATE POLICY chunks_delete ON public.document_chunks
FOR DELETE USING (public.fn_document_access(document_id) IN ('owner','editor'));

-- document_summaries — même nettoyage de la policy héritée.
DROP POLICY IF EXISTS "Users can access their org summaries" ON public.document_summaries;
DROP POLICY IF EXISTS summaries_select ON public.document_summaries;
DROP POLICY IF EXISTS summaries_insert ON public.document_summaries;
DROP POLICY IF EXISTS summaries_update ON public.document_summaries;
DROP POLICY IF EXISTS summaries_delete ON public.document_summaries;

CREATE POLICY summaries_select ON public.document_summaries
FOR SELECT USING (public.fn_document_access(document_id) IS NOT NULL);

CREATE POLICY summaries_insert ON public.document_summaries
FOR INSERT WITH CHECK (public.fn_document_access(document_id) IN ('owner','editor'));

CREATE POLICY summaries_update ON public.document_summaries
FOR UPDATE
USING  (public.fn_document_access(document_id) IN ('owner','editor'))
WITH CHECK (public.fn_document_access(document_id) IN ('owner','editor'));

CREATE POLICY summaries_delete ON public.document_summaries
FOR DELETE USING (public.fn_document_access(document_id) IN ('owner','editor'));

-- risk_comments — suit le document du risque commenté.
DROP POLICY IF EXISTS risk_comments_org_access ON public.risk_comments;
DROP POLICY IF EXISTS risk_comments_select ON public.risk_comments;
DROP POLICY IF EXISTS risk_comments_insert ON public.risk_comments;
DROP POLICY IF EXISTS risk_comments_update ON public.risk_comments;
DROP POLICY IF EXISTS risk_comments_delete ON public.risk_comments;

CREATE POLICY risk_comments_select ON public.risk_comments
FOR SELECT USING (
  organization_id IN (SELECT public.fn_user_organization_ids())
  AND public.fn_document_access(public.fn_risk_document_id(risk_id)) IS NOT NULL
);

CREATE POLICY risk_comments_insert ON public.risk_comments
FOR INSERT WITH CHECK (
  organization_id IN (SELECT public.fn_user_organization_ids())
  AND public.fn_document_access(public.fn_risk_document_id(risk_id)) IN ('owner','editor')
);

CREATE POLICY risk_comments_update ON public.risk_comments
FOR UPDATE
USING  (public.fn_document_access(public.fn_risk_document_id(risk_id)) IN ('owner','editor'))
WITH CHECK (public.fn_document_access(public.fn_risk_document_id(risk_id)) IN ('owner','editor'));

CREATE POLICY risk_comments_delete ON public.risk_comments
FOR DELETE USING (
  public.fn_is_org_admin(organization_id)
  OR public.fn_document_access(public.fn_risk_document_id(risk_id)) IN ('owner','editor')
);

-- ═══════════════════════════════════════════════════════════════════
-- 8) POLICIES — tasks (rattachées à dossier, document ou risque ;
--    l'assigné et le créateur voient toujours leurs tâches ; une tâche
--    libre reste org-visible comme aujourd'hui)
-- ═══════════════════════════════════════════════════════════════════

DROP POLICY IF EXISTS tasks_select ON public.tasks;
DROP POLICY IF EXISTS tasks_insert ON public.tasks;
DROP POLICY IF EXISTS tasks_update ON public.tasks;
DROP POLICY IF EXISTS tasks_delete ON public.tasks;

CREATE POLICY tasks_select ON public.tasks
FOR SELECT USING (
  organization_id IN (SELECT public.fn_user_organization_ids())
  AND (
    public.fn_is_org_admin(organization_id)
    OR assigned_to = auth.uid()
    OR created_by  = auth.uid()
    OR (folder_id   IS NOT NULL AND public.fn_folder_access(folder_id) IS NOT NULL)
    OR (document_id IS NOT NULL AND public.fn_document_access(document_id) IS NOT NULL)
    OR (risk_id     IS NOT NULL AND public.fn_document_access(public.fn_risk_document_id(risk_id)) IS NOT NULL)
    OR (folder_id IS NULL AND document_id IS NULL AND risk_id IS NULL)
  )
);

CREATE POLICY tasks_insert ON public.tasks
FOR INSERT WITH CHECK (
  organization_id IN (SELECT public.fn_user_organization_ids())
  AND public.fn_user_role(organization_id) IN ('owner','admin','lawyer','member')
  AND (folder_id   IS NULL OR public.fn_folder_access(folder_id) IN ('owner','editor'))
  AND (document_id IS NULL OR public.fn_document_access(document_id) IN ('owner','editor'))
  AND (risk_id     IS NULL OR public.fn_document_access(public.fn_risk_document_id(risk_id)) IN ('owner','editor'))
);

CREATE POLICY tasks_update ON public.tasks
FOR UPDATE
USING (
  organization_id IN (SELECT public.fn_user_organization_ids())
  AND public.fn_user_role(organization_id) IN ('owner','admin','lawyer','member')
  AND (
    public.fn_is_org_admin(organization_id)
    OR assigned_to = auth.uid()
    OR created_by  = auth.uid()
    OR (folder_id   IS NOT NULL AND public.fn_folder_access(folder_id) IN ('owner','editor'))
    OR (document_id IS NOT NULL AND public.fn_document_access(document_id) IN ('owner','editor'))
    OR (risk_id     IS NOT NULL AND public.fn_document_access(public.fn_risk_document_id(risk_id)) IN ('owner','editor'))
    OR (folder_id IS NULL AND document_id IS NULL AND risk_id IS NULL)
  )
)
WITH CHECK (
  organization_id IN (SELECT public.fn_user_organization_ids())
  AND public.fn_user_role(organization_id) IN ('owner','admin','lawyer','member')
  AND (folder_id   IS NULL OR public.fn_folder_access(folder_id) IN ('owner','editor'))
  AND (document_id IS NULL OR public.fn_document_access(document_id) IN ('owner','editor'))
  AND (risk_id     IS NULL OR public.fn_document_access(public.fn_risk_document_id(risk_id)) IN ('owner','editor'))
);

CREATE POLICY tasks_delete ON public.tasks
FOR DELETE USING (
  public.fn_is_org_admin(organization_id) OR created_by = auth.uid()
);
