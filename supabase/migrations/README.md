# Database Migrations

This directory contains SQL migrations for the Juria Supabase project.

## Applying Migrations

### Manual Application (Recommended for troubleshooting)

1. Go to Supabase Dashboard → SQL Editor
2. Create a new query for each migration in order
3. Copy-paste the migration SQL
4. Run it and verify success
5. Check that no errors appear

### Order of Application

**01_drop_broken_function.sql** (URGENT - Fixes 406 errors)
- Drops the problematic `is_org_admin()` function
- Run this FIRST to fix REST API 406 errors
- The CASCADE will drop dependent RLS policies

**02_rebuild_rls_policies.sql** (After verification)
- Recreates RLS policies without custom functions
- Uses direct `auth.uid()` calls instead
- Run only after confirming 01 fixed the 406 errors

## Verification Checklist

After applying migrations:

```
☐ SQL Editor runs without errors
☐ No 406 errors on REST API calls
☐ GET /organization_users returns 200
☐ Logged-in user can see their organization members
☐ Admin can still invite new members
☐ Admin can update member roles
☐ Non-admin users cannot modify members
```

## Testing RLS Policies

### Test 1: Admin can see members
```bash
# As logged-in admin user
curl -X GET 'https://dnrudcpaqcqyybpbbrum.supabase.co/rest/v1/organization_users?limit=10' \
  -H "Authorization: Bearer <ADMIN_JWT_TOKEN>" \
  -H "apikey: <ANON_KEY>"
```
Expected: Returns organization_users records for admin's org

### Test 2: Member can see members
```bash
# As logged-in regular member
curl -X GET 'https://dnrudcpaqcqyybpbbrum.supabase.co/rest/v1/organization_users?limit=10' \
  -H "Authorization: Bearer <MEMBER_JWT_TOKEN>" \
  -H "apikey: <ANON_KEY>"
```
Expected: Returns only members from member's organization

### Test 3: Unauthenticated request
```bash
curl -X GET 'https://dnrudcpaqcqyybpbbrum.supabase.co/rest/v1/organization_users?limit=1' \
  -H "apikey: <ANON_KEY>"
```
Expected: 403 Forbidden (no user context)

## Troubleshooting

### Still seeing 406 errors after running migration 01?

1. Check if function was actually dropped:
   ```sql
   SELECT routine_name FROM information_schema.routines 
   WHERE routine_name LIKE '%org%' AND routine_schema = 'public';
   ```

2. If it still exists, manually drop it:
   ```sql
   DROP FUNCTION IF EXISTS is_org_admin(uuid) CASCADE;
   ```

3. Restart your browser to clear JWT tokens

4. If still broken, disable RLS temporarily:
   ```sql
   ALTER TABLE organization_users DISABLE ROW LEVEL SECURITY;
   ```

### REST API suddenly returns fewer records than expected

This is RLS working correctly! Each user only sees members of their organization.

### Admin cannot invite new members (INSERT fails)

Check if:
1. Admin has `role = 'admin'` in organization_users
2. Admin has `is_active = true`
3. The organization_id matches what they're trying to insert into

## Backup

If anything goes wrong:
1. Disable RLS: `ALTER TABLE organization_users DISABLE ROW LEVEL SECURITY;`
2. System will work (without security) while you debug
3. Never disable RLS in production for extended periods

## Next Steps

Once RLS is working reliably:
1. Apply same pattern to other sensitive tables (folders, tasks, documents)
2. Create audit logging for who modified what
3. Test with production load
4. Monitor Supabase logs for RLS policy violations
