-- TESTS — partage de contrepartie entière (migration 18). Pas une migration.
-- Scénario : A possède la CP « Oracle » avec 2 dossiers (F1, F2). A partage la
-- CONTREPARTIE à B (viewer). Attendu : B voit Oracle + F1 + F2 ; un 3e dossier
-- créé APRÈS le partage est aussi visible ; B ne peut pas écrire (viewer) ;
-- révocation coupe l'accès ; C (non partagé) ne voit rien.

RESET ROLE;
DROP TABLE IF EXISTS public.zz_cps_results;
CREATE TABLE public.zz_cps_results (test text, expected text, got text, verdict text);
GRANT ALL ON public.zz_cps_results TO authenticated;

DELETE FROM public.folders        WHERE organization_id='8a000000-0000-4000-a000-000000000001';
DELETE FROM public.counterparties WHERE organization_id='8a000000-0000-4000-a000-000000000001';
DELETE FROM public.organization_users WHERE organization_id='8a000000-0000-4000-a000-000000000001';
DELETE FROM public.organizations  WHERE id='8a000000-0000-4000-a000-000000000001';
DELETE FROM auth.users WHERE id IN (
  '8a000000-0000-4000-a000-0000000000aa','8a000000-0000-4000-a000-0000000000bb','8a000000-0000-4000-a000-0000000000cc');

INSERT INTO auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at, confirmation_token, recovery_token, email_change, email_change_token_new, raw_app_meta_data, raw_user_meta_data)
VALUES
  ('00000000-0000-0000-0000-000000000000','8a000000-0000-4000-a000-0000000000aa','authenticated','authenticated','zz-cps-a@t.local','', now(), now(), now(), '', '', '', '', '{}','{}'),
  ('00000000-0000-0000-0000-000000000000','8a000000-0000-4000-a000-0000000000bb','authenticated','authenticated','zz-cps-b@t.local','', now(), now(), now(), '', '', '', '', '{}','{}'),
  ('00000000-0000-0000-0000-000000000000','8a000000-0000-4000-a000-0000000000cc','authenticated','authenticated','zz-cps-c@t.local','', now(), now(), now(), '', '', '', '', '{}','{}');

INSERT INTO public.organizations (id, name, slug) VALUES ('8a000000-0000-4000-a000-000000000001','ZZ CPS','zz-cps');
INSERT INTO public.organization_users (organization_id, user_id, role, is_active) VALUES
  ('8a000000-0000-4000-a000-000000000001','8a000000-0000-4000-a000-0000000000aa','lawyer', true),
  ('8a000000-0000-4000-a000-000000000001','8a000000-0000-4000-a000-0000000000bb','member', true),
  ('8a000000-0000-4000-a000-000000000001','8a000000-0000-4000-a000-0000000000cc','member', true);

INSERT INTO public.counterparties (id, organization_id, name, created_by)
VALUES ('8a000000-0000-4000-a000-0000000000c1','8a000000-0000-4000-a000-000000000001','ZZ Oracle','8a000000-0000-4000-a000-0000000000aa');

INSERT INTO public.folders (id, organization_id, name, created_by, visibility, counterparty_id) VALUES
  ('8a000000-0000-4000-a000-0000000000f1','8a000000-0000-4000-a000-000000000001','ZZ F1','8a000000-0000-4000-a000-0000000000aa','private','8a000000-0000-4000-a000-0000000000c1'),
  ('8a000000-0000-4000-a000-0000000000f2','8a000000-0000-4000-a000-000000000001','ZZ F2','8a000000-0000-4000-a000-0000000000aa','private','8a000000-0000-4000-a000-0000000000c1');

-- ── B avant partage : ne voit ni la CP ni ses dossiers ──────────────
SELECT set_config('request.jwt.claims','{"sub":"8a000000-0000-4000-a000-0000000000bb","role":"authenticated"}',true);
SET LOCAL ROLE authenticated;
INSERT INTO public.zz_cps_results
SELECT '01_B_avant_folders','0',count(*)::text,CASE WHEN count(*)=0 THEN 'PASS' ELSE 'FAIL' END FROM public.folders WHERE name LIKE 'ZZ %';
RESET ROLE;

-- ── A partage la CONTREPARTIE à B (viewer) ──────────────────────────
SELECT set_config('request.jwt.claims','{"sub":"8a000000-0000-4000-a000-0000000000aa","role":"authenticated"}',true);
SET LOCAL ROLE authenticated;
DO $$ BEGIN
  INSERT INTO public.counterparty_members (counterparty_id, user_id, role, granted_by)
  VALUES ('8a000000-0000-4000-a000-0000000000c1','8a000000-0000-4000-a000-0000000000bb','viewer','8a000000-0000-4000-a000-0000000000aa');
  INSERT INTO public.zz_cps_results VALUES ('02_A_partage_CP','succès','succès','PASS');
EXCEPTION WHEN OTHERS THEN
  INSERT INTO public.zz_cps_results VALUES ('02_A_partage_CP','succès','refusé: '||SQLERRM,'FAIL');
END $$;
RESET ROLE;

-- ── B après partage : voit la CP + les 2 dossiers ───────────────────
SELECT set_config('request.jwt.claims','{"sub":"8a000000-0000-4000-a000-0000000000bb","role":"authenticated"}',true);
SET LOCAL ROLE authenticated;
INSERT INTO public.zz_cps_results
SELECT '03_B_voit_CP','1',count(*)::text,CASE WHEN count(*)=1 THEN 'PASS' ELSE 'FAIL' END FROM public.counterparties WHERE name LIKE 'ZZ %';
INSERT INTO public.zz_cps_results
SELECT '04_B_voit_2_dossiers','2',count(*)::text,CASE WHEN count(*)=2 THEN 'PASS' ELSE 'FAIL' END FROM public.folders WHERE name LIKE 'ZZ %';
-- viewer : pas d'écriture
DO $$ DECLARE n int; BEGIN
  UPDATE public.folders SET name='ZZ hack' WHERE id='8a000000-0000-4000-a000-0000000000f1';
  GET DIAGNOSTICS n = ROW_COUNT;
  INSERT INTO public.zz_cps_results VALUES ('05_B_viewer_no_write','0 ligne',n||' ligne(s)',CASE WHEN n=0 THEN 'PASS' ELSE 'FAIL' END);
END $$;
RESET ROLE;

-- ── A crée un 3e dossier APRÈS le partage → B doit le voir (héritage futur) ─
SELECT set_config('request.jwt.claims','{"sub":"8a000000-0000-4000-a000-0000000000aa","role":"authenticated"}',true);
SET LOCAL ROLE authenticated;
INSERT INTO public.folders (id, organization_id, name, created_by, visibility, counterparty_id)
VALUES ('8a000000-0000-4000-a000-0000000000f3','8a000000-0000-4000-a000-000000000001','ZZ F3 futur','8a000000-0000-4000-a000-0000000000aa','private','8a000000-0000-4000-a000-0000000000c1');
RESET ROLE;

SELECT set_config('request.jwt.claims','{"sub":"8a000000-0000-4000-a000-0000000000bb","role":"authenticated"}',true);
SET LOCAL ROLE authenticated;
INSERT INTO public.zz_cps_results
SELECT '06_B_voit_dossier_futur','3',count(*)::text,CASE WHEN count(*)=3 THEN 'PASS' ELSE 'FAIL' END FROM public.folders WHERE name LIKE 'ZZ %';
RESET ROLE;

-- ── C (non partagé) ne voit rien ────────────────────────────────────
SELECT set_config('request.jwt.claims','{"sub":"8a000000-0000-4000-a000-0000000000cc","role":"authenticated"}',true);
SET LOCAL ROLE authenticated;
INSERT INTO public.zz_cps_results
SELECT '07_C_voit_rien','0',count(*)::text,CASE WHEN count(*)=0 THEN 'PASS' ELSE 'FAIL' END FROM public.folders WHERE name LIKE 'ZZ %';
-- C ne peut pas s'auto-partager la contrepartie
DO $$ BEGIN
  INSERT INTO public.counterparty_members (counterparty_id, user_id, role, granted_by)
  VALUES ('8a000000-0000-4000-a000-0000000000c1','8a000000-0000-4000-a000-0000000000cc','editor','8a000000-0000-4000-a000-0000000000cc');
  INSERT INTO public.zz_cps_results VALUES ('08_C_auto_partage','refus','accepté','FAIL');
EXCEPTION WHEN OTHERS THEN
  INSERT INTO public.zz_cps_results VALUES ('08_C_auto_partage','refus','refusé','PASS');
END $$;
RESET ROLE;

-- ── B reçoit une notification de partage ────────────────────────────
SELECT set_config('request.jwt.claims','{"sub":"8a000000-0000-4000-a000-0000000000bb","role":"authenticated"}',true);
SET LOCAL ROLE authenticated;
INSERT INTO public.zz_cps_results
SELECT '09_B_notif','counterparty_shared',
       COALESCE((SELECT type FROM public.notifications WHERE user_id='8a000000-0000-4000-a000-0000000000bb' AND type LIKE 'counterparty%' LIMIT 1),'AUCUNE'),
       CASE WHEN EXISTS(SELECT 1 FROM public.notifications WHERE user_id='8a000000-0000-4000-a000-0000000000bb' AND type='counterparty_shared') THEN 'PASS' ELSE 'FAIL' END;
RESET ROLE;

-- ── A révoque → B ne voit plus rien ─────────────────────────────────
SELECT set_config('request.jwt.claims','{"sub":"8a000000-0000-4000-a000-0000000000aa","role":"authenticated"}',true);
SET LOCAL ROLE authenticated;
DELETE FROM public.counterparty_members
WHERE counterparty_id='8a000000-0000-4000-a000-0000000000c1' AND user_id='8a000000-0000-4000-a000-0000000000bb';
RESET ROLE;

SELECT set_config('request.jwt.claims','{"sub":"8a000000-0000-4000-a000-0000000000bb","role":"authenticated"}',true);
SET LOCAL ROLE authenticated;
INSERT INTO public.zz_cps_results
SELECT '10_B_apres_revocation','0',count(*)::text,CASE WHEN count(*)=0 THEN 'PASS' ELSE 'FAIL' END FROM public.folders WHERE name LIKE 'ZZ %';
RESET ROLE;

-- nettoyage
DELETE FROM public.notifications      WHERE organization_id='8a000000-0000-4000-a000-000000000001';
DELETE FROM public.counterparty_members WHERE counterparty_id='8a000000-0000-4000-a000-0000000000c1';
DELETE FROM public.folders        WHERE organization_id='8a000000-0000-4000-a000-000000000001';
DELETE FROM public.counterparties WHERE organization_id='8a000000-0000-4000-a000-000000000001';
DELETE FROM public.organization_users WHERE organization_id='8a000000-0000-4000-a000-000000000001';
DELETE FROM public.organizations  WHERE id='8a000000-0000-4000-a000-000000000001';
DELETE FROM auth.users WHERE id IN (
  '8a000000-0000-4000-a000-0000000000aa','8a000000-0000-4000-a000-0000000000bb','8a000000-0000-4000-a000-0000000000cc');

SELECT * FROM public.zz_cps_results ORDER BY test;
