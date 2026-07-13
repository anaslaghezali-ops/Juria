# Tests d'isolation RLS (multi-tenant)

Ces tests vérifient que la **Row Level Security** empêche une organisation de
voir les données d'une autre — la garantie de confidentialité la plus critique
de Juria. Ils tournent sur une base Postgres **jetable** en CI
(`.github/workflows/rls-tests.yml`), **jamais sur la production**.

## Fichiers
- `00_schema.sql` — schéma de référence : rôles `authenticated`/`anon`, schéma
  `auth` + `auth.uid()`, structures des tables tenant, helpers des migrations
  01–03 (appliquées à la main en prod, hors dépôt).
- `rls_isolation_test.sql` — le test : deux organisations, tentatives d'accès
  inter-tenants (qui doivent échouer), compartimentage intra-org et partage
  borné. Produit une ligne finale `RLS_TESTS_PASSED` / `RLS_TESTS_FAILED`.

## Comment la CI reconstruit la base
`00_schema.sql` **puis** `supabase/migrations/12..22` → l'état RLS de prod.
Vérifié : 60/60 définitions de politiques identiques au schéma prod (hors table
héritée `comments`, dont la politique n'est pas encore versionnée).

## Lancer en local
```bash
createdb rlsci
psql -d rlsci -f tests/rls/00_schema.sql
for m in 12_document_obligations 13_folder_sharing 14_performance_indexes \
         15_sharing_notifications 16_fix_insert_returning_rls \
         17_counterparty_compartmentalization 18_counterparty_sharing \
         19_fk_indexes 20_safe_deletes 21_safe_document_delete \
         22_document_versioning; do
  psql -d rlsci -f "supabase/migrations/$m.sql"
done
psql -d rlsci -f tests/rls/rls_isolation_test.sql
```

## ⚠️ Maintenance
Quand une migration **ajoute ou modifie une table tenant** (ou une colonne
utilisée par une politique), mettre `00_schema.sql` à jour en conséquence, et
ajouter les assertions correspondantes dans `rls_isolation_test.sql`.

## Limite connue
La table héritée `comments` (ère 01–05, hors dépôt) n'est pas couverte : sa
politique RLS ne vit qu'en prod. À intégrer au dépôt pour la couvrir.
