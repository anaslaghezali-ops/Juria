-- DEBUG — fonction RPC appelable depuis le navigateur pour voir ce que la
-- policy folders_insert calcule réellement sous le jeton de l'utilisateur.
-- SECURITY INVOKER : s'exécute avec le rôle/JWT de l'appelant, donc dans le
-- même contexte que le WITH CHECK. À retirer ensuite.

CREATE OR REPLACE FUNCTION public.zz_debug_insert_check(p_org uuid, p_created_by uuid)
RETURNS jsonb
LANGUAGE sql
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT jsonb_build_object(
    'auth_uid',        auth.uid(),
    'p_created_by',    p_created_by,
    'created_by_ok',   p_created_by = auth.uid(),
    'my_orgs',         ARRAY(SELECT public.fn_user_organization_ids()),
    'org_in_my_orgs',  p_org IN (SELECT public.fn_user_organization_ids()),
    'my_role_in_org',  public.fn_user_role(p_org),
    'role_ok',         public.fn_user_role(p_org) IN ('owner','admin','lawyer','member'),
    'jwt_role',        current_setting('request.jwt.claims', true)::jsonb ->> 'role',
    'jwt_sub',         current_setting('request.jwt.claims', true)::jsonb ->> 'sub'
  );
$$;

GRANT EXECUTE ON FUNCTION public.zz_debug_insert_check(uuid, uuid) TO authenticated, anon;

-- Dump des définitions de policy actuellement en vigueur
SELECT 'policy' AS bloc, tablename, policyname, cmd,
       regexp_replace(coalesce(with_check, qual), '\s+', ' ', 'g') AS expr
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename IN ('folders', 'documents')
  AND cmd = 'INSERT'
ORDER BY tablename;
