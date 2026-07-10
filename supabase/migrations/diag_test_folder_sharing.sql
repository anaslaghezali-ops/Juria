-- TESTS D'ACCÈS — partage de dossiers (migration 13). Pas une migration.
-- Exécuté via le workflow apply-migrations (files=diag_test_folder_sharing.sql)
-- APRÈS 13_folder_sharing.sql. Rejouable : purge ses fixtures en entrée/sortie.
--
-- Simule 4 utilisateurs (pattern du RLS guide : request.jwt.claims + SET LOCAL
-- ROLE authenticated) dans une org de test jetable :
--   A  (lawyer) : crée F_priv (privé), F_shared (privé, C invité viewer) + F_sub
--   B  (member) : crée F_org (visibilité org), importe D_free (sans dossier)
--   C  (member) : invité viewer sur F_shared
--   ADM (admin) : doit tout voir
-- Le dernier SELECT rend le verdict PASS/FAIL de chaque test.

RESET ROLE;

-- ── 0) Table de résultats ────────────────────────────────────────────
DROP TABLE IF EXISTS public.zz_share_test_results;
CREATE TABLE public.zz_share_test_results (test text, expected text, got text, verdict text);
GRANT ALL ON public.zz_share_test_results TO authenticated;

-- ── 1) Purge d'un éventuel run précédent (enfants → parents) ─────────
DELETE FROM public.document_risks       WHERE organization_id = '5a000000-0000-4000-a000-000000000001';
DELETE FROM public.document_obligations WHERE organization_id = '5a000000-0000-4000-a000-000000000001';
DELETE FROM public.tasks                WHERE organization_id = '5a000000-0000-4000-a000-000000000001';
DELETE FROM public.documents            WHERE organization_id = '5a000000-0000-4000-a000-000000000001';
DELETE FROM public.folders              WHERE organization_id = '5a000000-0000-4000-a000-000000000001';
DELETE FROM public.organization_users   WHERE organization_id = '5a000000-0000-4000-a000-000000000001';
DELETE FROM public.organizations        WHERE id = '5a000000-0000-4000-a000-000000000001';
DELETE FROM auth.users WHERE id IN (
  '5a000000-0000-4000-a000-0000000000aa','5a000000-0000-4000-a000-0000000000bb',
  '5a000000-0000-4000-a000-0000000000cc','5a000000-0000-4000-a000-0000000000ad');

-- ── 2) Fixtures ──────────────────────────────────────────────────────
INSERT INTO auth.users (instance_id, id, aud, role, email, encrypted_password,
                        email_confirmed_at, created_at, updated_at,
                        confirmation_token, recovery_token, email_change, email_change_token_new,
                        raw_app_meta_data, raw_user_meta_data)
VALUES
  ('00000000-0000-0000-0000-000000000000','5a000000-0000-4000-a000-0000000000aa','authenticated','authenticated','zz-share-test-a@test.local','', now(), now(), now(), '', '', '', '', '{"provider":"email","providers":["email"]}','{}'),
  ('00000000-0000-0000-0000-000000000000','5a000000-0000-4000-a000-0000000000bb','authenticated','authenticated','zz-share-test-b@test.local','', now(), now(), now(), '', '', '', '', '{"provider":"email","providers":["email"]}','{}'),
  ('00000000-0000-0000-0000-000000000000','5a000000-0000-4000-a000-0000000000cc','authenticated','authenticated','zz-share-test-c@test.local','', now(), now(), now(), '', '', '', '', '{"provider":"email","providers":["email"]}','{}'),
  ('00000000-0000-0000-0000-000000000000','5a000000-0000-4000-a000-0000000000ad','authenticated','authenticated','zz-share-test-adm@test.local','', now(), now(), now(), '', '', '', '', '{"provider":"email","providers":["email"]}','{}');

INSERT INTO public.organizations (id, name, slug)
VALUES ('5a000000-0000-4000-a000-000000000001', 'ZZ Test Partage', 'zz-test-partage');

INSERT INTO public.organization_users (organization_id, user_id, role, is_active) VALUES
  ('5a000000-0000-4000-a000-000000000001','5a000000-0000-4000-a000-0000000000aa','lawyer', true),
  ('5a000000-0000-4000-a000-000000000001','5a000000-0000-4000-a000-0000000000bb','member', true),
  ('5a000000-0000-4000-a000-000000000001','5a000000-0000-4000-a000-0000000000cc','member', true),
  ('5a000000-0000-4000-a000-000000000001','5a000000-0000-4000-a000-0000000000ad','admin',  true);

INSERT INTO public.folders (id, organization_id, name, created_by, visibility, parent_id) VALUES
  ('5a000000-0000-4000-a000-000000000f01','5a000000-0000-4000-a000-000000000001','ZZ privé A',   '5a000000-0000-4000-a000-0000000000aa','private', NULL),
  ('5a000000-0000-4000-a000-000000000f02','5a000000-0000-4000-a000-000000000001','ZZ partagé A', '5a000000-0000-4000-a000-0000000000aa','private', NULL),
  ('5a000000-0000-4000-a000-000000000f03','5a000000-0000-4000-a000-000000000001','ZZ org B',     '5a000000-0000-4000-a000-0000000000bb','org',     NULL),
  ('5a000000-0000-4000-a000-000000000f04','5a000000-0000-4000-a000-000000000001','ZZ sous-dossier','5a000000-0000-4000-a000-0000000000aa','private','5a000000-0000-4000-a000-000000000f02');

INSERT INTO public.folder_members (folder_id, user_id, role, granted_by) VALUES
  ('5a000000-0000-4000-a000-000000000f02','5a000000-0000-4000-a000-0000000000cc','viewer','5a000000-0000-4000-a000-0000000000aa');

INSERT INTO public.documents (id, organization_id, folder_id, uploaded_by, name) VALUES
  ('5a000000-0000-4000-a000-000000000d01','5a000000-0000-4000-a000-000000000001','5a000000-0000-4000-a000-000000000f01','5a000000-0000-4000-a000-0000000000aa','ZZ doc privé.pdf'),
  ('5a000000-0000-4000-a000-000000000d02','5a000000-0000-4000-a000-000000000001','5a000000-0000-4000-a000-000000000f02','5a000000-0000-4000-a000-0000000000aa','ZZ doc partagé.pdf'),
  ('5a000000-0000-4000-a000-000000000d03','5a000000-0000-4000-a000-000000000001','5a000000-0000-4000-a000-000000000f03','5a000000-0000-4000-a000-0000000000bb','ZZ doc org.pdf'),
  ('5a000000-0000-4000-a000-000000000d04','5a000000-0000-4000-a000-000000000001',NULL,                                     '5a000000-0000-4000-a000-0000000000bb','ZZ doc libre B.pdf'),
  ('5a000000-0000-4000-a000-000000000d05','5a000000-0000-4000-a000-000000000001','5a000000-0000-4000-a000-000000000f04','5a000000-0000-4000-a000-0000000000aa','ZZ doc sous-dossier.pdf');

INSERT INTO public.document_risks (id, document_id, organization_id, severity, category, clause_name, problem, status) VALUES
  ('5a000000-0000-4000-a000-000000000e01','5a000000-0000-4000-a000-000000000d01','5a000000-0000-4000-a000-000000000001','high','autre','ZZ clause privée','test','open'),
  ('5a000000-0000-4000-a000-000000000e02','5a000000-0000-4000-a000-000000000d02','5a000000-0000-4000-a000-000000000001','high','autre','ZZ clause partagée','test','open');

INSERT INTO public.document_obligations (id, document_id, organization_id, description, source, created_by) VALUES
  ('5a000000-0000-4000-a000-000000000c01','5a000000-0000-4000-a000-000000000d01','5a000000-0000-4000-a000-000000000001','ZZ échéance doc privé','analysis','5a000000-0000-4000-a000-0000000000aa'),
  ('5a000000-0000-4000-a000-000000000c02',NULL,                                     '5a000000-0000-4000-a000-000000000001','ZZ échéance manuelle libre','manual','5a000000-0000-4000-a000-0000000000bb');

-- ── 3) Tests utilisateur A (lawyer, propriétaire de F_priv/F_shared) ─
SELECT set_config('request.jwt.claims', '{"sub":"5a000000-0000-4000-a000-0000000000aa","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;

INSERT INTO public.zz_share_test_results
SELECT '00_canary_jwt', '5a...00aa', COALESCE(auth.uid()::text,'NULL (simulation JWT KO — tout le reste est invalide)'),
       CASE WHEN auth.uid() = '5a000000-0000-4000-a000-0000000000aa' THEN 'PASS' ELSE 'FAIL' END;

INSERT INTO public.zz_share_test_results
SELECT '01_A_voit_folders', '4', count(*)::text, CASE WHEN count(*) = 4 THEN 'PASS' ELSE 'FAIL' END
FROM public.folders WHERE name LIKE 'ZZ %';

-- A ne voit PAS le doc libre de B (importateur seul) : 4 et non 5.
INSERT INTO public.zz_share_test_results
SELECT '02_A_voit_docs', '4 (le doc libre de B est privé)', count(*)::text, CASE WHEN count(*) = 4 THEN 'PASS' ELSE 'FAIL' END
FROM public.documents WHERE name LIKE 'ZZ %';

INSERT INTO public.zz_share_test_results
SELECT '03_A_voit_risques', '2', count(*)::text, CASE WHEN count(*) = 2 THEN 'PASS' ELSE 'FAIL' END
FROM public.document_risks WHERE clause_name LIKE 'ZZ %';

RESET ROLE;

-- ── 4) Tests utilisateur B (member, rien ne lui est partagé) ─────────
SELECT set_config('request.jwt.claims', '{"sub":"5a000000-0000-4000-a000-0000000000bb","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;

INSERT INTO public.zz_share_test_results
SELECT '04_B_voit_folders', '1 (F_org)', count(*)::text, CASE WHEN count(*) = 1 THEN 'PASS' ELSE 'FAIL' END
FROM public.folders WHERE name LIKE 'ZZ %';

INSERT INTO public.zz_share_test_results
SELECT '05_B_voit_docs', '2 (D_org + D_free)', count(*)::text, CASE WHEN count(*) = 2 THEN 'PASS' ELSE 'FAIL' END
FROM public.documents WHERE name LIKE 'ZZ %';

INSERT INTO public.zz_share_test_results
SELECT '06_B_voit_risques', '0', count(*)::text, CASE WHEN count(*) = 0 THEN 'PASS' ELSE 'FAIL' END
FROM public.document_risks WHERE clause_name LIKE 'ZZ %';

INSERT INTO public.zz_share_test_results
SELECT '07_B_voit_echeances', '1 (manuelle libre)', count(*)::text, CASE WHEN count(*) = 1 THEN 'PASS' ELSE 'FAIL' END
FROM public.document_obligations WHERE description LIKE 'ZZ %';

RESET ROLE;

-- ── 5) Tests utilisateur C (member, invité viewer sur F_shared) ──────
SELECT set_config('request.jwt.claims', '{"sub":"5a000000-0000-4000-a000-0000000000cc","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;

INSERT INTO public.zz_share_test_results
SELECT '08_C_voit_folders', '3 (F_shared + F_sub hérité + F_org)', count(*)::text, CASE WHEN count(*) = 3 THEN 'PASS' ELSE 'FAIL' END
FROM public.folders WHERE name LIKE 'ZZ %';

INSERT INTO public.zz_share_test_results
SELECT '09_C_voit_docs', '3 (partagé + sous-dossier + org)', count(*)::text, CASE WHEN count(*) = 3 THEN 'PASS' ELSE 'FAIL' END
FROM public.documents WHERE name LIKE 'ZZ %';

INSERT INTO public.zz_share_test_results
SELECT '10_C_voit_risques', '1 (celui du doc partagé)', count(*)::text, CASE WHEN count(*) = 1 THEN 'PASS' ELSE 'FAIL' END
FROM public.document_risks WHERE clause_name LIKE 'ZZ %';

-- C est VIEWER : ses écritures doivent être refusées.
DO $$ DECLARE n int; BEGIN
  UPDATE public.documents SET name = 'ZZ hacked.pdf' WHERE id = '5a000000-0000-4000-a000-000000000d02';
  GET DIAGNOSTICS n = ROW_COUNT;
  INSERT INTO public.zz_share_test_results
  VALUES ('11_viewer_update_doc', '0 ligne modifiée', n || ' ligne(s)', CASE WHEN n = 0 THEN 'PASS' ELSE 'FAIL' END);
END $$;

DO $$ BEGIN
  INSERT INTO public.documents (id, organization_id, folder_id, uploaded_by, name)
  VALUES ('5a000000-0000-4000-a000-000000000d99','5a000000-0000-4000-a000-000000000001',
          '5a000000-0000-4000-a000-000000000f02','5a000000-0000-4000-a000-0000000000cc','ZZ intrusion.pdf');
  INSERT INTO public.zz_share_test_results VALUES ('12_viewer_insert_doc', 'refus RLS', 'insert accepté', 'FAIL');
EXCEPTION WHEN OTHERS THEN
  INSERT INTO public.zz_share_test_results VALUES ('12_viewer_insert_doc', 'refus RLS', 'refusé', 'PASS');
END $$;

DO $$ DECLARE n int; BEGIN
  UPDATE public.folder_members SET role = 'editor'
  WHERE folder_id = '5a000000-0000-4000-a000-000000000f02' AND user_id = auth.uid();
  GET DIAGNOSTICS n = ROW_COUNT;
  INSERT INTO public.zz_share_test_results
  VALUES ('13_viewer_autopromotion', '0 ligne modifiée', n || ' ligne(s)', CASE WHEN n = 0 THEN 'PASS' ELSE 'FAIL' END);
END $$;

RESET ROLE;

-- ── 6) Tests ADM (admin d'org : supervision totale) ──────────────────
SELECT set_config('request.jwt.claims', '{"sub":"5a000000-0000-4000-a000-0000000000ad","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;

INSERT INTO public.zz_share_test_results
SELECT '14_admin_voit_folders', '4', count(*)::text, CASE WHEN count(*) = 4 THEN 'PASS' ELSE 'FAIL' END
FROM public.folders WHERE name LIKE 'ZZ %';

INSERT INTO public.zz_share_test_results
SELECT '15_admin_voit_docs', '5', count(*)::text, CASE WHEN count(*) = 5 THEN 'PASS' ELSE 'FAIL' END
FROM public.documents WHERE name LIKE 'ZZ %';

RESET ROLE;

-- ── 7) A partage F_priv à B (viewer) + tentatives interdites ─────────
SELECT set_config('request.jwt.claims', '{"sub":"5a000000-0000-4000-a000-0000000000aa","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;

DO $$ BEGIN
  INSERT INTO public.folder_members (folder_id, user_id, role, granted_by)
  VALUES ('5a000000-0000-4000-a000-000000000f01','5a000000-0000-4000-a000-0000000000bb','viewer','5a000000-0000-4000-a000-0000000000aa');
  INSERT INTO public.zz_share_test_results VALUES ('16_owner_partage', 'succès', 'succès', 'PASS');
EXCEPTION WHEN OTHERS THEN
  INSERT INTO public.zz_share_test_results VALUES ('16_owner_partage', 'succès', 'refusé: ' || SQLERRM, 'FAIL');
END $$;

-- Partager un SOUS-dossier est interdit (racine uniquement).
DO $$ BEGIN
  INSERT INTO public.folder_members (folder_id, user_id, role, granted_by)
  VALUES ('5a000000-0000-4000-a000-000000000f04','5a000000-0000-4000-a000-0000000000bb','viewer','5a000000-0000-4000-a000-0000000000aa');
  INSERT INTO public.zz_share_test_results VALUES ('17_partage_sous_dossier', 'refus RLS', 'insert accepté', 'FAIL');
EXCEPTION WHEN OTHERS THEN
  INSERT INTO public.zz_share_test_results VALUES ('17_partage_sous_dossier', 'refus RLS', 'refusé', 'PASS');
END $$;

-- A est editor (pas owner) de F_org : changer sa visibilité doit être bloqué
-- par le trigger garde-fou.
DO $$ BEGIN
  UPDATE public.folders SET visibility = 'private' WHERE id = '5a000000-0000-4000-a000-000000000f03';
  INSERT INTO public.zz_share_test_results VALUES ('18_editor_change_visibilite', 'refus trigger', 'update accepté', 'FAIL');
EXCEPTION WHEN OTHERS THEN
  INSERT INTO public.zz_share_test_results VALUES ('18_editor_change_visibilite', 'refus trigger', 'refusé', 'PASS');
END $$;

RESET ROLE;

-- ── 8) B revoit F_priv maintenant qu'il est invité ───────────────────
SELECT set_config('request.jwt.claims', '{"sub":"5a000000-0000-4000-a000-0000000000bb","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;

INSERT INTO public.zz_share_test_results
SELECT '19_B_apres_partage_folders', '2 (F_org + F_priv)', count(*)::text, CASE WHEN count(*) = 2 THEN 'PASS' ELSE 'FAIL' END
FROM public.folders WHERE name LIKE 'ZZ %';

INSERT INTO public.zz_share_test_results
SELECT '20_B_apres_partage_docs', '3 (+ doc du dossier partagé)', count(*)::text, CASE WHEN count(*) = 3 THEN 'PASS' ELSE 'FAIL' END
FROM public.documents WHERE name LIKE 'ZZ %';

RESET ROLE;

-- ── 9) Nettoyage des fixtures ────────────────────────────────────────
DELETE FROM public.document_risks       WHERE organization_id = '5a000000-0000-4000-a000-000000000001';
DELETE FROM public.document_obligations WHERE organization_id = '5a000000-0000-4000-a000-000000000001';
DELETE FROM public.tasks                WHERE organization_id = '5a000000-0000-4000-a000-000000000001';
DELETE FROM public.documents            WHERE organization_id = '5a000000-0000-4000-a000-000000000001';
DELETE FROM public.folders              WHERE organization_id = '5a000000-0000-4000-a000-000000000001';
DELETE FROM public.organization_users   WHERE organization_id = '5a000000-0000-4000-a000-000000000001';
DELETE FROM public.organizations        WHERE id = '5a000000-0000-4000-a000-000000000001';
DELETE FROM auth.users WHERE id IN (
  '5a000000-0000-4000-a000-0000000000aa','5a000000-0000-4000-a000-0000000000bb',
  '5a000000-0000-4000-a000-0000000000cc','5a000000-0000-4000-a000-0000000000ad');

-- ── 10) Verdict ──────────────────────────────────────────────────────
SELECT * FROM public.zz_share_test_results ORDER BY test;
