# Juria — User Management & RLS: Root Cause and Resolution

_Last updated: 2026-07-08. Applied directly to project `dnrudcpaqcqyybpbbrum` and verified._

## TL;DR

The "406 that only RLS caused" was **two separate bugs** wearing the same symptom:

1. **The real, always-present bug:** `getCurrentOrganization()` called `.single()`,
   which returns **HTTP 406 / `PGRST116` ("Cannot coerce the result to a single
   JSON object")** whenever the query matches **0 rows**. The owner account had
   **no row in `organization_users`**, so it 406'd every time — with or without RLS.
2. **The thing that made RLS look guilty:** the earlier RLS attempt used a helper
   `is_org_admin()` that was `LANGUAGE plpgsql STABLE` (**not** `SECURITY DEFINER`).
   A policy **on** `organization_users` that queries `organization_users` through a
   non-definer function causes **infinite recursion**. When that broke, the 0-rows
   406 was already there, so disabling RLS didn't make the 406 go away — which
   looked like "RLS corrupted everything."

Both are now fixed and the system runs **with RLS enabled**.

## What was actually wrong

- The organization **owner** (`anaslaghezali@gmail.com`) was never inserted into
  `organization_users`. Only the invited member `av@av.com` had a row. So the
  owner was authenticated but org-less → guaranteed 406.
- Nothing provisioned an organization for **organic (non-invited) signups**, so
  every trial signup would hit the same 406.
- `getCurrentOrganization()` used `.single()` (throws on 0 rows) instead of
  `.maybeSingle()` (returns `null`).

## What was fixed (all applied and verified)

### 1. Data — linked the owner to their org
Inserted the owner into `organization_users` with `role = 'owner'`, `is_active = true`
for org `da00f4b6…` ("Anas Laghezali"). The failing query now returns a row.

### 2. Frontend — `services/organization-service.js`
- `getCurrentOrganization()` now uses `.maybeSingle()` and treats "no membership"
  as a normal `null` result instead of a 406 error. It also filters on
  `is_active = true`.
- `changeMemberRole()` now validates against the real DB constraint
  (`owner | admin | lawyer | member | reader`) instead of the stale
  `admin | member | viewer` (note: `viewer` was never a valid DB role).

### 3. Signup flow — `supabase/functions/link-user-to-org` + `auth.html`
The edge function is now a complete "provision membership" step:
- **Invited user:** claims the pending pre-invitation row (sets `user_id`).
- **Organic signup:** creates a personal organization (`plan = 'trial'`,
  collision-safe unique slug) and links the user as `owner`.
- **Idempotent:** if the user already has a membership, it's a no-op.
`auth.html` now passes the user's `name` so the auto-created org is named properly.

### 4. RLS — enabled, recursion-safe, and tested
See `supabase/migrations/01_enable_rls_organization_users.sql`. Policies reuse the
existing **`SECURITY DEFINER`** helpers `fn_user_organization_ids()` and
`fn_user_role()`, which bypass RLS during policy evaluation and therefore **cannot
recurse**. RLS is enabled on both `organization_users` and `organizations`.
Helper `search_path` was pinned for hardening
(`02_harden_rls_helper_search_path.sql`).

## Verified behavior (with RLS ON)

| Context        | Resolves own org | Sees org members | Can modify members |
|----------------|------------------|------------------|--------------------|
| Owner          | ✅               | ✅               | ✅                 |
| Member (`av`)  | ✅               | ✅               | ❌ (blocked)       |
| Anonymous      | ❌ (0 rows)      | ❌ (0 rows)      | ❌                 |

Tested by simulating each user's JWT (`SET LOCAL role authenticated` +
`request.jwt.claims`) and by attempting writes as a member (0 rows affected) vs.
as the owner (rows affected). Service-role edge functions bypass RLS, so
`invite-user` and `link-user-to-org` continue to work.

## Why the recursion-safe pattern matters

```sql
-- ❌ WRONG: policy on organization_users that reads organization_users
--    directly -> "infinite recursion detected in policy"
CREATE POLICY ... ON organization_users
USING (organization_id IN (SELECT organization_id FROM organization_users
                           WHERE user_id = auth.uid()));

-- ✅ RIGHT: read through a SECURITY DEFINER helper (bypasses RLS internally)
CREATE POLICY org_users_select ON organization_users
USING (organization_id IN (SELECT fn_user_organization_ids()));
```

`fn_user_organization_ids()` and `fn_user_role()` are `SECURITY DEFINER`, so the
query inside them runs as the function owner with RLS bypassed — no recursion.

## Key rule going forward

- **Reads that may return zero rows:** use `.maybeSingle()`, never `.single()`,
  unless a missing row is genuinely an error.
- **RLS on a self-referential table (memberships):** never query the table
  directly inside its own policy — go through a `SECURITY DEFINER` helper.
- **Org provisioning happens server-side** (service-role edge function), so the
  app never ends up with an authenticated-but-org-less user again.
