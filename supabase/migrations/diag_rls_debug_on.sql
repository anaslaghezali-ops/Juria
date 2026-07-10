-- DEBUG RLS (temporaire, réversible) — instrumente folders_insert pour
-- journaliser ce que la policy voit réellement lors d'un INSERT via l'app.
-- À retirer avec diag_rls_debug_off.sql après capture.

CREATE TABLE IF NOT EXISTS public.zz_rls_debug (
  ts         timestamptz NOT NULL DEFAULT now(),
  tbl        text,
  uid        uuid,
  jwt_claims text,
  org        uuid,
  role_seen  text,
  orgs_seen  uuid[],
  created_by uuid,
  parent_id  uuid,
  verdict    boolean
);
-- Pas de RLS : table de debug jetable, écrite par la fonction definer.

CREATE OR REPLACE FUNCTION public.fn_debug_folders_insert(p_org uuid, p_created_by uuid, p_parent uuid)
RETURNS boolean
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_ok boolean;
BEGIN
  v_ok := p_org IN (SELECT public.fn_user_organization_ids())
      AND public.fn_user_role(p_org) IN ('owner','admin','lawyer','member')
      AND p_created_by = auth.uid()
      AND (p_parent IS NULL OR public.fn_folder_access(p_parent) IN ('owner','editor'));

  INSERT INTO public.zz_rls_debug (tbl, uid, jwt_claims, org, role_seen, orgs_seen, created_by, parent_id, verdict)
  VALUES ('folders',
          auth.uid(),
          left(coalesce(current_setting('request.jwt.claims', true), 'ABSENT'), 500),
          p_org,
          public.fn_user_role(p_org),
          ARRAY(SELECT public.fn_user_organization_ids()),
          p_created_by, p_parent, v_ok);

  RETURN v_ok;
END $$;

DROP POLICY IF EXISTS folders_insert ON public.folders;
CREATE POLICY folders_insert ON public.folders
FOR INSERT WITH CHECK (public.fn_debug_folders_insert(organization_id, created_by, parent_id));

SELECT 'debug RLS activé sur folders_insert — refaire la création de dossier dans l''app' AS info;
