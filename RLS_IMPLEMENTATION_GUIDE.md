# RLS Implementation Guide for Juria

## Current Status

✅ **System is working** - No RLS policies active (runs with RLS disabled)
❌ **406 errors persist** - When attempting to enable RLS with functions

## Why 406 Errors Occurred

The previous RLS attempt used:

```sql
CREATE OR REPLACE FUNCTION is_org_admin(org_id UUID)
RETURNS BOOLEAN AS $
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM organization_users
    WHERE organization_id = org_id
      AND user_id = auth.uid()
      AND role IN ('admin', 'owner')
  );
END;
$ LANGUAGE plpgsql STABLE;
```

Then RLS policies called this function:
```sql
CREATE POLICY org_users_select ON organization_users
FOR SELECT
USING (is_org_admin(organization_id));
```

### The Problem

1. **REST API has no user context**: When you query via REST API, `auth.uid()` returns `NULL`
2. **Function returns NULL behavior**: This breaks the type inference
3. **REST API serialization fails**: Supabase cannot coerce the result to JSON
4. **Result**: 406 "Not Acceptable" error

### The Solution

Instead of wrapping `auth.uid()` in a function, use direct comparisons in policies:

```sql
CREATE POLICY org_users_select ON organization_users
FOR SELECT
USING (
  organization_id IN (
    SELECT organization_id
    FROM organization_users
    WHERE user_id = auth.uid() AND is_active = true
  )
);
```

This works because:
- The subquery's type is known (array of UUIDs)
- `auth.uid()` is evaluated in the policy scope
- The WHERE clause is standard SQL
- REST API can properly serialize the result

## Step-by-Step Implementation

### Step 1: Go to Supabase SQL Editor

1. Open your Supabase project dashboard
2. Navigate to **SQL Editor** (left sidebar)
3. Click **+ New Query**

### Step 2: Drop Broken Function (CRITICAL)

Paste this and run it:

```sql
DROP FUNCTION IF EXISTS is_org_admin(UUID) CASCADE;
```

**Expected**: Query runs successfully, shows "Success - no rows returned"

**Verify**: Wait 10 seconds, then test REST API:
```bash
# Get your JWT token from browser console after login:
# (await supabase.auth.getSession()).data.session.access_token

curl -X GET 'https://dnrudcpaqcqyybpbbrum.supabase.co/rest/v1/organization_users?limit=1' \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -H "apikey: eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRucnVkY3BhcWNxeXlicGJicnVtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODEyODQwMjMsImV4cCI6MjA5Njg2MDAyM30.f6_byMzZBE2SQH2XjNmRQFQpRkRIfXE2OC0mNxQt5z4"
```

If you get back JSON data → 406 is FIXED ✅
If you get 406 again → schema corruption (skip to "If 406 Persists" section)

### Step 3: Enable RLS on Table

Create a new query:

```sql
ALTER TABLE organization_users ENABLE ROW LEVEL SECURITY;
```

**Expected**: Query runs successfully

### Step 4: Create New RLS Policies (SELECT)

```sql
CREATE POLICY org_users_select ON organization_users
FOR SELECT
USING (
  organization_id IN (
    SELECT organization_id
    FROM organization_users
    WHERE user_id = auth.uid() AND is_active = true
  )
);
```

Test immediately - users should only see their org's members.

### Step 5: Create RLS Policies (INSERT)

```sql
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
```

Test: Admins should be able to invite, non-admins should get permission error.

### Step 6: Create RLS Policies (UPDATE)

```sql
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
```

### Step 7: Create RLS Policies (DELETE)

```sql
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
```

## Testing Checklist

After each policy, test it:

```javascript
// In browser console after login
const { data, error } = await supabase
  .from('organization_users')
  .select('*');

console.log(data); // Should see only current org's members
console.log(error); // Should be null
```

| Test | Expected Result |
|------|-----------------|
| Admin logs in, loads members | ✅ See full member list |
| Member logs in, loads members | ✅ See full member list (same org) |
| Admin invites new member | ✅ Success |
| Member tries to invite | ❌ Permission denied |
| Admin changes member role | ✅ Success |
| Member tries to change role | ❌ Permission denied |
| Admin deactivates member | ✅ Success |
| Deleted user queries members | ❌ 403 Forbidden (no user_id) |

## If 406 Persists After Dropping Function

### Quick Test

```sql
-- Check if function is really gone
SELECT routine_name FROM information_schema.routines 
WHERE routine_name LIKE '%org%' AND routine_schema = 'public';
```

If `is_org_admin` still shows up, run:
```sql
DROP FUNCTION IF EXISTS is_org_admin(uuid) CASCADE;
```

### Disable RLS Temporarily

If 406 still occurs:

```sql
ALTER TABLE organization_users DISABLE ROW LEVEL SECURITY;
```

Then test REST API. If it works now:
- The schema corruption is related to RLS/policies
- Start fresh with policies, one at a time
- Test after each policy

If it STILL doesn't work:
- There's deeper corruption in the table schema
- May need Supabase support or project restart

## Architecture After RLS Is Working

```
User Actions
    ↓
Browser/Client
    ├─ supabase.auth.getSession() → JWT token
    ├─ supabase.from('organization_users').select() → includes JWT
    ↓
Supabase REST API
    ├─ Verifies JWT token
    ├─ Extracts auth.uid()
    ↓
PostgreSQL with RLS
    ├─ Evaluates RLS policies using auth.uid()
    ├─ Policies use subqueries to check authorization
    ├─ Only authorized rows returned
    ↓
REST API
    ├─ Serializes result to JSON (now always works)
    ↓
Client receives data (filtered by RLS)
```

## Edge Functions Still Work

Note: Your Edge Functions (invite-user, link-user-to-org) use `SERVICE_ROLE_KEY`, which **bypasses RLS policies**. This is correct - they need elevated permissions. RLS policies only affect:

1. Direct browser queries via Supabase JS client
2. REST API calls with JWT tokens
3. NOT Edge Functions or service-role operations

## Summary

| Before (Broken) | After (Fixed) |
|-----------------|---------------|
| Custom function in policies | Direct auth.uid() in policies |
| Uses `is_org_admin()` | No functions |
| Returns NULL → 406 errors | Always returns BOOLEAN |
| Type inference broken | Type inference works |
| System broken | System works + secure |

The key insight: **Never call functions with auth.uid() from RLS policies**. Instead, use the functions' logic directly in the policy's WHERE clause.
