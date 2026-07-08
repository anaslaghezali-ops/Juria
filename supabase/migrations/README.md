# Database Migrations

SQL migrations for the Juria Supabase project (`dnrudcpaqcqyybpbbrum`).

These files mirror migrations that were **applied and verified** on the remote
project on 2026-07-08. They are kept here as human-readable, version-controlled
history. See `../../RLS_IMPLEMENTATION_GUIDE.md` for the full root-cause writeup.

## Migrations

### `01_enable_rls_organization_users.sql`
Enables recursion-safe RLS on `organization_users` and `organizations`.
Policies reuse the existing `SECURITY DEFINER` helpers
(`fn_user_organization_ids`, `fn_user_role`) so a policy on `organization_users`
can reference `organization_users` without infinite recursion.

- SELECT: members see everyone in organizations they belong to
- INSERT / UPDATE / DELETE: only `owner` / `admin` roles
- Service-role edge functions bypass RLS, so `invite-user` and
  `link-user-to-org` keep working.

### `02_harden_rls_helper_search_path.sql`
Pins `SET search_path = public` on the two `SECURITY DEFINER` RLS helpers.
Behavior-preserving hardening; clears the `function_search_path_mutable`
advisor warning for those functions.

## Verified behavior (RLS ON)

| Context       | Own org | Sees members | Writes |
|---------------|---------|--------------|--------|
| Owner         | ✅      | ✅           | ✅     |
| Member        | ✅      | ✅           | ❌     |
| Anonymous     | ❌      | ❌           | ❌     |

## Rollback (emergency only)

If RLS ever needs to be turned off to unblock the app:

```sql
ALTER TABLE organization_users DISABLE ROW LEVEL SECURITY;
ALTER TABLE organizations      DISABLE ROW LEVEL SECURITY;
```

The policies remain defined and re-enable instantly with the reverse
`ENABLE ROW LEVEL SECURITY`. Note: the 406 that was previously blamed on RLS was
actually a `.single()`-on-zero-rows bug in the frontend (now fixed with
`.maybeSingle()`), so disabling RLS is **not** a fix for that class of error.

## Notes on remaining advisor warnings (pre-existing, out of scope)

- `risks` and `document_content` have permissive `USING (true)` policies —
  these predate this work and should be tightened separately.
- The `SECURITY DEFINER` helper functions being callable by `anon`/`authenticated`
  is expected: they only ever return data scoped to `auth.uid()`, so an
  unauthenticated caller gets nothing.
