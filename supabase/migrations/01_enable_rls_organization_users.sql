-- Applied 2026-07-08 via Supabase MCP (apply_migration: enable_rls_organization_users)
--
-- Recursion-safe RLS for organization_users.
--
-- IMPORTANT: A naive policy that queries organization_users from within a
-- policy ON organization_users causes "infinite recursion detected in policy".
-- We avoid that by reusing the existing SECURITY DEFINER helpers
-- (fn_user_organization_ids, fn_user_role) which run as the function owner
-- and therefore bypass RLS inside the policy evaluation.

DROP POLICY IF EXISTS org_users_select ON organization_users;
DROP POLICY IF EXISTS org_users_insert ON organization_users;
DROP POLICY IF EXISTS org_users_update ON organization_users;
DROP POLICY IF EXISTS org_users_delete ON organization_users;

-- SELECT: see members of any organization you belong to
CREATE POLICY org_users_select ON organization_users
FOR SELECT
USING (organization_id IN (SELECT fn_user_organization_ids()));

-- INSERT: only owners/admins of the target org may add rows
-- (invitations go through the service-role edge function, which bypasses RLS)
CREATE POLICY org_users_insert ON organization_users
FOR INSERT
WITH CHECK (fn_user_role(organization_id) IN ('owner', 'admin'));

-- UPDATE: only owners/admins may modify rows
CREATE POLICY org_users_update ON organization_users
FOR UPDATE
USING (fn_user_role(organization_id) IN ('owner', 'admin'))
WITH CHECK (fn_user_role(organization_id) IN ('owner', 'admin'));

-- DELETE: only owners/admins may remove rows
CREATE POLICY org_users_delete ON organization_users
FOR DELETE
USING (fn_user_role(organization_id) IN ('owner', 'admin'));

-- Enable RLS. Service-role (edge functions) still bypasses it, so
-- invite-user / link-user-to-org keep working.
ALTER TABLE organization_users ENABLE ROW LEVEL SECURITY;
ALTER TABLE organizations ENABLE ROW LEVEL SECURITY;
