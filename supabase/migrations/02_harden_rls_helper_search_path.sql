-- Applied 2026-07-08 via Supabase MCP (apply_migration: harden_rls_helper_search_path)
--
-- Pin search_path on the security-critical SECURITY DEFINER RLS helpers so
-- they cannot be influenced by a caller-controlled search_path. Behavior is
-- unchanged; only the `SET search_path = public` setting is added. Clears the
-- "function_search_path_mutable" advisor warning for these two functions.

CREATE OR REPLACE FUNCTION public.fn_user_organization_ids()
RETURNS SETOF uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $function$
  SELECT organization_id
  FROM organization_users
  WHERE user_id = auth.uid();
$function$;

CREATE OR REPLACE FUNCTION public.fn_user_role(p_org_id uuid)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $function$
  SELECT role
  FROM organization_users
  WHERE user_id = auth.uid()
    AND organization_id = p_org_id
  LIMIT 1;
$function$;
