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

### `03_secure_document_content_and_risks.sql`
Closes the last two multi-tenant holes flagged by the security advisor:
- `document_content` had `USING (true)` — any signed-in user could read/write
  the extracted text of every organization's contracts. Now org-scoped through
  the parent document via a new reusable primitive `fn_document_org_id(doc)`;
  writes restricted to `owner/admin/lawyer/member` (mirrors `document_analyses`),
  deletes to `owner/admin`.
- `risks` (legacy, empty, unreferenced — code uses `document_risks`) had a
  public allow-all policy. Policy dropped → deny-by-default.
  (Table fully dropped in migration 04 after dependency checks.)
- Hardening: `fn_user_organization_ids()` / `fn_user_role()` now require
  `is_active = true`, so deactivating a member cuts their access entirely
  (consistent with the license model), not just frees a license.

### `04_drop_legacy_risks_table.sql`
Drops the legacy `risks` table (0 rows, 0 DB dependencies, 0 code references).
Its only code reference — `saveRiskType()` in `documents.html` — was a latent
bug: it updated `risks.risk_type` (nonexistent column, wrong table) while the
displayed risks come from `document_risks.category`. Fixed in the same commit:
the function now targets `document_risks.category` and the modal's options
match the DB CHECK constraint (`responsabilite`, `paiement`, `resiliation`,
`confidentialite`, `force_majeure`, `garantie`, `non_concurrence`, `arbitrage`,
`autre`). Original table DDL is archived in the migration file.

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

- The `SECURITY DEFINER` helper functions being callable by `anon`/`authenticated`
  is expected: they only ever return data scoped to `auth.uid()` (or a single
  org id for a document the caller must still pass RLS to use), so an
  unauthenticated caller gets nothing useful.
- `activity_feed` / `user_profiles_compat` are SECURITY DEFINER views (advisor
  ERROR) — pre-existing; review separately.
- Leaked-password protection (HaveIBeenPwned) is disabled in Auth settings —
  enable it in the Supabase dashboard (no SQL migration possible).
