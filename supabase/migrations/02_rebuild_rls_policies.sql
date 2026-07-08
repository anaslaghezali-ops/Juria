-- Rebuild RLS policies without custom functions
-- Use direct auth.uid() calls instead to avoid NULL serialization issues

-- Enable RLS on organization_users table
ALTER TABLE organization_users ENABLE ROW LEVEL SECURITY;

-- ============================================
-- POLICY 1: SELECT - Read organization members
-- ============================================
-- Users can see members of organizations they belong to
CREATE POLICY org_users_select ON organization_users
FOR SELECT
USING (
  organization_id IN (
    SELECT organization_id
    FROM organization_users
    WHERE user_id = auth.uid() AND is_active = true
  )
);

-- ============================================
-- POLICY 2: INSERT - Admin invitations
-- ============================================
-- Only admins in an organization can invite new members
CREATE POLICY org_users_insert ON organization_users
FOR INSERT
WITH CHECK (
  EXISTS (
    SELECT 1
    FROM organization_users
    WHERE organization_id = organization_users.organization_id
      AND user_id = auth.uid()
      AND role IN ('admin', 'owner')
      AND is_active = true
  )
);

-- ============================================
-- POLICY 3: UPDATE - Admin management
-- ============================================
-- Only admins can update member roles, status, etc.
CREATE POLICY org_users_update ON organization_users
FOR UPDATE
USING (
  EXISTS (
    SELECT 1
    FROM organization_users ou
    WHERE ou.organization_id = organization_users.organization_id
      AND ou.user_id = auth.uid()
      AND ou.role IN ('admin', 'owner')
      AND ou.is_active = true
  )
);

-- ============================================
-- POLICY 4: DELETE - Admin member removal
-- ============================================
-- Only admins can delete member records
CREATE POLICY org_users_delete ON organization_users
FOR DELETE
USING (
  EXISTS (
    SELECT 1
    FROM organization_users ou
    WHERE ou.organization_id = organization_users.organization_id
      AND ou.user_id = auth.uid()
      AND ou.role IN ('admin', 'owner')
      AND ou.is_active = true
  )
);
