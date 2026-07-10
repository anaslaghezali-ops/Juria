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

### `06_quota_system_v2.sql`
Système de quota v2 : budget global de crédits par organisation.
- `organizations.monthly_quota` (défaut 1000, `-1` = illimité)
- `operation_costs` : coût unitaire par type (`synthesis` 1.0, `risk_analysis` 0.5,
  `doc_comparison` 0.5, `chat` 0.1) — ajustable depuis le back-office
- `organization_usage` : une ligne par (org, mois, type), compteurs incrémentés
  atomiquement via `log_org_usage()` (SECURITY DEFINER, réservée au service role)
- RLS : chaque membre actif lit la consommation de sa propre org

### `07_superadmin.sql`
Back-office fondateur (`superadmin.html` + edge function `superadmin`).
- Table `superadmins` (accès plateforme, distinct des rôles d'organisation)
- RLS : chacun ne peut vérifier que son propre statut
- Seed : `anaslaghezali@gmail.com`

> 06 et 07 ont été appliquées le 2026-07-09 via le workflow
> `apply-migrations.yml` (API de management Supabase) et vérifiées :
> `operation_costs=4, superadmins=1, monthly_quota_col=1`.

### `08_fix_cabinet_duplicate_org.sql`
Data fix : supprime l'org trial créée en doublon au signup de
`cabinet@cabinet.com` (claim d'invitation sensible à la casse + signup
organique, tous deux corrigés dans `link-user-to-org`), rattache le compte à
« Cabinet 1 », et normalise en minuscules les emails d'invitations en attente.
Depuis ce fix, Juria est **sur invitation uniquement** : aucun compte ne peut
être créé sans invitation préalable (superadmin ou admin d'organisation).

### `09_superadmin_purge_org.sql`
Fonction `superadmin_purge_organization(uuid)` (SECURITY DEFINER, service
role uniquement) : purge complète d'une organisation par introspection —
enfants des documents (`document_id`), messages des conversations
(`conversation_id`), toute table portant `organization_id` / `org_id`, puis
l'organisation. Appelée par l'action `delete_org` de l'edge function
superadmin, qui supprime ensuite les comptes auth des membres n'appartenant
à aucune autre organisation.

### `10_storage_quota.sql`
Quota de stockage par organisation (variable payante gérée au superadmin) :
- `organizations.max_storage_mb` (défaut 500, `-1` = illimité)
- `fn_org_storage_bytes(org)` : octets consommés (somme `documents.file_size`),
  appelable par un membre actif de l'org, un superadmin ou le service role
- Trigger `trg_enforce_org_storage_quota` sur `documents` : refuse l'INSERT
  au-delà du plafond (enforcement serveur, non contournable)
Affichage : colonne + champs dans superadmin.html ; carte « Consommation »
(crédits IA du mois + stockage) dans administration.html pour l'admin d'org.

### `11_match_threshold.sql`
`match_document_chunks` déclarait un paramètre `match_threshold` qu'elle
n'appliquait pas : le top-N était renvoyé même totalement hors sujet, et l'IA
répondait « basé sur 10 passages » à partir de bruit. Le seuil de similarité
est désormais appliqué (défaut 0.2, calibré pour text-embedding-3-small).

### `12_document_obligations.sql`
Échéances réelles (page Échéances / dashboard) : `document_obligations`
devient la source de vérité — organization_id + backfill, `source`
(analysis | manual), document_id optionnel, RLS org-scopée.

### `13_folder_sharing.sql`
Partage de dossiers, Phase 1 (appliquée et vérifiée le 2026-07-10) :
- `folders.visibility` (`private` | `org`) — existants backfillés à `org`
  (personne ne perd l'accès), nouveaux dossiers privés par défaut ;
  l'état « partagé » de l'UI est dérivé (privé + invitations).
- `folder_members` (viewer | editor) : invitations nominatives par le
  propriétaire (`folders.created_by`), dossiers RACINE uniquement ;
  sous-dossiers, documents, risques, échéances, analyses, contenu,
  chunks RAG, résumés et commentaires héritent de la racine.
- Primitives `fn_folder_access` / `fn_document_access`
  (owner | editor | viewer | NULL, SECURITY DEFINER) réutilisées par
  toutes les policies ; admin/owner d'org : accès de supervision.
- Trigger garde-fou : visibilité/propriétaire/rattachement modifiables
  par le seul propriétaire.
- Supprime deux vieilles policies permissives qui auraient contourné le
  partage (`document_chunks`, `document_summaries`).
- **Fix échéances** : `document_obligations.analysis_id` était NOT NULL
  (table préexistante à la 12) → tout INSERT d'échéance échouait
  silencieusement. Contrainte supprimée ; analyse-contrat.html envoie
  désormais `analysis_id`.

Vérifiée par `diag_test_folder_sharing.sql` : suite de 21 tests d'accès
(matrice lawyer / member / invité viewer / admin, refus d'écriture du
viewer, auto-promotion bloquée, partage de sous-dossier interdit,
trigger, partage puis re-comptage) — **21/21 PASS en prod**, fixtures
auto-nettoyées. Également validée sur un sandbox Postgres 16 local
(schéma miroir + simulation JWT) avant tout envoi en prod.

### `14_performance_indexes.sql`
Indexes de l'audit scalabilité (appliquée le 2026-07-10) : composites
org-scopés sur documents / document_risks / tasks / counterparties /
folders / analyses / commentaires, `organization_users(user_id,
is_active)` au service de chaque évaluation de policy RLS, et lookups
par document pour `fn_document_access` et les chunks RAG.

### `15_sharing_notifications.sql`
Partage de dossiers, Phase 3 (appliquée et vérifiée le 2026-07-10) :
- `notifications` : boîte personnelle (partage / changement de rôle /
  révocation), chacun ne lit et ne marque que les siennes.
- `folder_access_log` : journal d'audit immuable (qui a invité qui,
  quand, révocations, changements de visibilité), lisible par le
  propriétaire du dossier et l'admin ; survit à la suppression du
  dossier (nom dénormalisé).
- Écriture UNIQUEMENT par triggers SECURITY DEFINER sur `folder_members`
  et `folders.visibility` : aucune notification forgeable ou oubliable
  côté client (aucun grant INSERT). Pas d'auto-notification.

Vérifiée par `diag_test_sharing_notifications.sql` — **8/8 PASS en
prod** (ordre du journal, absence d'auto-notification, payload,
marquage lu, journal invisible au non-propriétaire, forge refusée,
vue admin), après validation sur le sandbox Postgres local.

### `diag_*.sql` (pas des migrations)
Fichiers de diagnostic en lecture seule, exécutés à la demande via le
workflow `apply-migrations` (input `files=diag_….sql`), qui affiche le
résultat des SELECT dans les logs du run. `diag_chat_rag.sql` a établi la
cause racine du bug « Aucun passage pertinent trouvé » : chunks bloqués en
`pending` (process-chunks interrogeait la colonne inexistante
`documents.user_id` → 403 systématique → embeddings jamais calculés), et
ids de conversation non-uuid (`conv_<timestamp>`) rejetés par
`chat_conversations.id` (le 400 de persistance).

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
