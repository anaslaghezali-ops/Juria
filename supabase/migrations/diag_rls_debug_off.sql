-- DEBUG RLS — lecture du journal puis retour à la policy nominale de la
-- migration 13 et nettoyage complet des artefacts de debug.

-- 1) Restaurer la policy d'origine (identique à 13_folder_sharing.sql)
DROP POLICY IF EXISTS folders_insert ON public.folders;
CREATE POLICY folders_insert ON public.folders
FOR INSERT WITH CHECK (
  organization_id IN (SELECT public.fn_user_organization_ids())
  AND public.fn_user_role(organization_id) IN ('owner','admin','lawyer','member')
  AND created_by = auth.uid()
  AND (parent_id IS NULL OR public.fn_folder_access(parent_id) IN ('owner','editor'))
);

DROP FUNCTION IF EXISTS public.fn_debug_folders_insert(uuid, uuid, uuid);

-- 2) Restituer les captures avant de jeter la table
SELECT ts, uid, org, role_seen, orgs_seen, created_by, parent_id, verdict, jwt_claims
FROM public.zz_rls_debug ORDER BY ts;
