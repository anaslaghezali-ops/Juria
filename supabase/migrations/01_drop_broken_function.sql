-- Drop the problematic is_org_admin function that caused 406 errors
-- This function used auth.uid() which returns NULL in REST API context,
-- breaking Supabase's JSON serialization layer

DROP FUNCTION IF EXISTS is_org_admin(UUID) CASCADE;

-- Note: CASCADE will also drop any RLS policies that used this function
-- We'll recreate RLS policies without functions in the next migration
