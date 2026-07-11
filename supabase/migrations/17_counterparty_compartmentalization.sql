-- 17_counterparty_compartmentalization.sql — Contreparties cloisonnées (modèle b).
--
-- Avant : counterparties_select = org-scopé → tous les membres voyaient TOUTES
-- les contreparties de l'organisation, même sans aucun partage.
-- Après : workspaces indépendants. Une contrepartie n'est visible à U que si
--   1) U l'a créée (created_by), ou
--   2) U a accès à au moins un dossier rattaché à cette contrepartie
--      (= un dossier de cette contrepartie lui a été partagé), ou
--   3) U est admin/propriétaire de l'organisation (supervision).
--
-- Le cas 1 lit created_by DIRECTEMENT sur la ligne (pas de relecture de la
-- table) : indispensable pour que `.insert().select()` d'une contrepartie
-- fraîchement créée par son auteur passe la relecture (cf. bug corrigé en 16).
--
-- Idempotente : ADD COLUMN IF NOT EXISTS / DROP POLICY IF EXISTS / CREATE.

-- ── 1) Propriétaire de la contrepartie ───────────────────────────────
ALTER TABLE public.counterparties ADD COLUMN IF NOT EXISTS created_by uuid;

-- Backfill : l'auteur des dossiers de la contrepartie (le plus ancien),
-- sinon le propriétaire de l'organisation. (Sans enjeu ici : données de test.)
UPDATE public.counterparties c
SET created_by = sub.owner
FROM (
  SELECT DISTINCT ON (f.counterparty_id) f.counterparty_id, f.created_by AS owner
  FROM public.folders f
  WHERE f.counterparty_id IS NOT NULL
  ORDER BY f.counterparty_id, f.created_at ASC
) sub
WHERE c.id = sub.counterparty_id AND c.created_by IS NULL;

UPDATE public.counterparties c
SET created_by = ou.user_id
FROM public.organization_users ou
WHERE c.created_by IS NULL
  AND ou.organization_id = c.organization_id
  AND ou.role = 'owner'
  AND ou.is_active = true;

-- Index au service de la condition 2 (EXISTS sur les dossiers d'une CP).
CREATE INDEX IF NOT EXISTS idx_folders_counterparty
  ON public.folders (counterparty_id);

-- ── 2) SELECT cloisonné ──────────────────────────────────────────────
DROP POLICY IF EXISTS counterparties_select ON public.counterparties;
CREATE POLICY counterparties_select ON public.counterparties
FOR SELECT USING (
  organization_id IN (SELECT public.fn_user_organization_ids())
  AND (
    created_by = auth.uid()
    OR public.fn_is_org_admin(organization_id)
    OR EXISTS (
      SELECT 1 FROM public.folders f
      WHERE f.counterparty_id = counterparties.id
        AND public.fn_folder_access(f.id) IS NOT NULL
    )
  )
);

-- ── 3) Écritures : le créateur gère sa contrepartie, l'admin garde la main ─
DROP POLICY IF EXISTS counterparties_insert ON public.counterparties;
CREATE POLICY counterparties_insert ON public.counterparties
FOR INSERT WITH CHECK (
  organization_id IN (SELECT public.fn_user_organization_ids())
  AND public.fn_user_role(organization_id) IN ('owner','admin','lawyer','member')
  AND created_by = auth.uid()
);

DROP POLICY IF EXISTS counterparties_update ON public.counterparties;
CREATE POLICY counterparties_update ON public.counterparties
FOR UPDATE
USING  (created_by = auth.uid() OR public.fn_is_org_admin(organization_id))
WITH CHECK (created_by = auth.uid() OR public.fn_is_org_admin(organization_id));

DROP POLICY IF EXISTS counterparties_delete ON public.counterparties;
CREATE POLICY counterparties_delete ON public.counterparties
FOR DELETE USING (created_by = auth.uid() OR public.fn_is_org_admin(organization_id));
