-- TESTS — notifications + journal des accès (migration 15). Pas une migration.
-- Exécuté via le workflow apply-migrations (files=diag_test_sharing_notifications.sql)
-- APRÈS 15_sharing_notifications.sql. Rejouable : purge ses fixtures.
--
-- Scénario : A (lawyer) possède un dossier privé, le partage à B (member),
-- change son rôle, la visibilité, puis révoque. Chaque action doit produire
-- sa ligne de journal et sa notification — et rien ne doit fuiter vers B.

RESET ROLE;

-- ── 0) Résultats ─────────────────────────────────────────────────────
DROP TABLE IF EXISTS public.zz_notif_test_results;
CREATE TABLE public.zz_notif_test_results (test text, expected text, got text, verdict text);
GRANT ALL ON public.zz_notif_test_results TO authenticated;

-- ── 1) Purge d'un run précédent ──────────────────────────────────────
DELETE FROM public.notifications      WHERE organization_id = '5b000000-0000-4000-a000-000000000001';
DELETE FROM public.folder_access_log  WHERE organization_id = '5b000000-0000-4000-a000-000000000001';
DELETE FROM public.folder_members     WHERE folder_id = '5b000000-0000-4000-a000-000000000f01';
DELETE FROM public.folders            WHERE organization_id = '5b000000-0000-4000-a000-000000000001';
DELETE FROM public.organization_users WHERE organization_id = '5b000000-0000-4000-a000-000000000001';
DELETE FROM public.organizations      WHERE id = '5b000000-0000-4000-a000-000000000001';
DELETE FROM auth.users WHERE id IN (
  '5b000000-0000-4000-a000-0000000000aa','5b000000-0000-4000-a000-0000000000bb',
  '5b000000-0000-4000-a000-0000000000ad');

-- ── 2) Fixtures ──────────────────────────────────────────────────────
INSERT INTO auth.users (instance_id, id, aud, role, email, encrypted_password,
                        email_confirmed_at, created_at, updated_at,
                        confirmation_token, recovery_token, email_change, email_change_token_new,
                        raw_app_meta_data, raw_user_meta_data)
VALUES
  ('00000000-0000-0000-0000-000000000000','5b000000-0000-4000-a000-0000000000aa','authenticated','authenticated','zz-notif-test-a@test.local','', now(), now(), now(), '', '', '', '', '{"provider":"email","providers":["email"]}','{}'),
  ('00000000-0000-0000-0000-000000000000','5b000000-0000-4000-a000-0000000000bb','authenticated','authenticated','zz-notif-test-b@test.local','', now(), now(), now(), '', '', '', '', '{"provider":"email","providers":["email"]}','{}'),
  ('00000000-0000-0000-0000-000000000000','5b000000-0000-4000-a000-0000000000ad','authenticated','authenticated','zz-notif-test-adm@test.local','', now(), now(), now(), '', '', '', '', '{"provider":"email","providers":["email"]}','{}');

INSERT INTO public.organizations (id, name, slug)
VALUES ('5b000000-0000-4000-a000-000000000001', 'ZZ Test Notifs', 'zz-test-notifs');

INSERT INTO public.organization_users (organization_id, user_id, role, is_active) VALUES
  ('5b000000-0000-4000-a000-000000000001','5b000000-0000-4000-a000-0000000000aa','lawyer', true),
  ('5b000000-0000-4000-a000-000000000001','5b000000-0000-4000-a000-0000000000bb','member', true),
  ('5b000000-0000-4000-a000-000000000001','5b000000-0000-4000-a000-0000000000ad','admin',  true);

INSERT INTO public.folders (id, organization_id, name, created_by, visibility) VALUES
  ('5b000000-0000-4000-a000-000000000f01','5b000000-0000-4000-a000-000000000001','ZZ dossier notifs','5b000000-0000-4000-a000-0000000000aa','private');

-- ── 3) A partage, change le rôle, la visibilité, puis révoque ────────
SELECT set_config('request.jwt.claims', '{"sub":"5b000000-0000-4000-a000-0000000000aa","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;

INSERT INTO public.folder_members (folder_id, user_id, role, granted_by)
VALUES ('5b000000-0000-4000-a000-000000000f01','5b000000-0000-4000-a000-0000000000bb','viewer','5b000000-0000-4000-a000-0000000000aa');

UPDATE public.folder_members SET role = 'editor'
WHERE folder_id = '5b000000-0000-4000-a000-000000000f01' AND user_id = '5b000000-0000-4000-a000-0000000000bb';

UPDATE public.folders SET visibility = 'org' WHERE id = '5b000000-0000-4000-a000-000000000f01';

DELETE FROM public.folder_members
WHERE folder_id = '5b000000-0000-4000-a000-000000000f01' AND user_id = '5b000000-0000-4000-a000-0000000000bb';

-- Le journal du propriétaire : 4 actions dans l'ordre
INSERT INTO public.zz_notif_test_results
SELECT '01_A_journal_complet', 'granted,role_changed,visibility_changed,revoked',
       COALESCE(string_agg(action, ',' ORDER BY created_at), 'VIDE'),
       CASE WHEN string_agg(action, ',' ORDER BY created_at) = 'granted,role_changed,visibility_changed,revoked' THEN 'PASS' ELSE 'FAIL' END
FROM public.folder_access_log WHERE folder_id = '5b000000-0000-4000-a000-000000000f01';

-- A n'a reçu aucune notification (il est l'auteur)
INSERT INTO public.zz_notif_test_results
SELECT '02_A_zero_notif', '0', count(*)::text, CASE WHEN count(*) = 0 THEN 'PASS' ELSE 'FAIL' END
FROM public.notifications WHERE organization_id = '5b000000-0000-4000-a000-000000000001';

RESET ROLE;

-- ── 4) B : ses notifications, pas le journal ─────────────────────────
SELECT set_config('request.jwt.claims', '{"sub":"5b000000-0000-4000-a000-0000000000bb","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;

INSERT INTO public.zz_notif_test_results
SELECT '03_B_notifs', 'folder_shared,folder_role_changed,folder_revoked',
       COALESCE(string_agg(type, ',' ORDER BY created_at), 'VIDE'),
       CASE WHEN string_agg(type, ',' ORDER BY created_at) = 'folder_shared,folder_role_changed,folder_revoked' THEN 'PASS' ELSE 'FAIL' END
FROM public.notifications;

INSERT INTO public.zz_notif_test_results
SELECT '04_B_payload_nom_dossier', 'ZZ dossier notifs',
       COALESCE((SELECT payload->>'folder_name' FROM public.notifications WHERE type = 'folder_shared' LIMIT 1), 'VIDE'),
       CASE WHEN (SELECT payload->>'folder_name' FROM public.notifications WHERE type = 'folder_shared' LIMIT 1) = 'ZZ dossier notifs' THEN 'PASS' ELSE 'FAIL' END;

-- B marque tout lu
UPDATE public.notifications SET is_read = true WHERE is_read = false;
INSERT INTO public.zz_notif_test_results
SELECT '05_B_marque_lu', '0 non lue', count(*)::text || ' non lue(s)',
       CASE WHEN count(*) = 0 THEN 'PASS' ELSE 'FAIL' END
FROM public.notifications WHERE is_read = false;

-- B (plus invité, dossier org → editor mais PAS owner) ne lit pas le journal
INSERT INTO public.zz_notif_test_results
SELECT '06_B_journal_invisible', '0', count(*)::text, CASE WHEN count(*) = 0 THEN 'PASS' ELSE 'FAIL' END
FROM public.folder_access_log WHERE folder_id = '5b000000-0000-4000-a000-000000000f01';

-- B ne peut pas forger une notification (aucun grant INSERT)
DO $$ BEGIN
  INSERT INTO public.notifications (organization_id, user_id, type, payload)
  VALUES ('5b000000-0000-4000-a000-000000000001','5b000000-0000-4000-a000-0000000000bb','folder_shared','{}');
  INSERT INTO public.zz_notif_test_results VALUES ('07_B_forge_notif', 'refus', 'insert accepté', 'FAIL');
EXCEPTION WHEN OTHERS THEN
  INSERT INTO public.zz_notif_test_results VALUES ('07_B_forge_notif', 'refus', 'refusé', 'PASS');
END $$;

RESET ROLE;

-- ── 5) L'admin voit le journal ───────────────────────────────────────
SELECT set_config('request.jwt.claims', '{"sub":"5b000000-0000-4000-a000-0000000000ad","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;

INSERT INTO public.zz_notif_test_results
SELECT '08_admin_voit_journal', '4', count(*)::text, CASE WHEN count(*) = 4 THEN 'PASS' ELSE 'FAIL' END
FROM public.folder_access_log WHERE folder_id = '5b000000-0000-4000-a000-000000000f01';

RESET ROLE;

-- ── 6) Nettoyage ─────────────────────────────────────────────────────
DELETE FROM public.notifications      WHERE organization_id = '5b000000-0000-4000-a000-000000000001';
DELETE FROM public.folder_access_log  WHERE organization_id = '5b000000-0000-4000-a000-000000000001';
DELETE FROM public.folder_members     WHERE folder_id = '5b000000-0000-4000-a000-000000000f01';
DELETE FROM public.folders            WHERE organization_id = '5b000000-0000-4000-a000-000000000001';
DELETE FROM public.organization_users WHERE organization_id = '5b000000-0000-4000-a000-000000000001';
DELETE FROM public.organizations      WHERE id = '5b000000-0000-4000-a000-000000000001';
DELETE FROM auth.users WHERE id IN (
  '5b000000-0000-4000-a000-0000000000aa','5b000000-0000-4000-a000-0000000000bb',
  '5b000000-0000-4000-a000-0000000000ad');

-- ── 7) Verdict ───────────────────────────────────────────────────────
SELECT * FROM public.zz_notif_test_results ORDER BY test;
