-- TESTS — contreparties cloisonnées (migration 17). Pas une migration.
-- Exécuté via apply-migrations (files=diag_test_counterparty_compart.sql)
-- APRÈS 17. Rejouable ; se nettoie.
--
-- Scénario : A (lawyer) crée la contrepartie « Oracle » + un dossier F_oracle
-- dessous. B (member) crée sa propre contrepartie « ACME ». A partage
-- F_oracle à B. Attendu : B ne voit Oracle qu'APRÈS le partage ; A ne voit
-- jamais ACME ; l'admin voit tout ; création de CP avec .insert().select() OK.

RESET ROLE;

DROP TABLE IF EXISTS public.zz_cp_test_results;
CREATE TABLE public.zz_cp_test_results (test text, expected text, got text, verdict text);
GRANT ALL ON public.zz_cp_test_results TO authenticated;

-- purge
DELETE FROM public.folders        WHERE organization_id='7a000000-0000-4000-a000-000000000001';
DELETE FROM public.counterparties WHERE organization_id='7a000000-0000-4000-a000-000000000001';
DELETE FROM public.organization_users WHERE organization_id='7a000000-0000-4000-a000-000000000001';
DELETE FROM public.organizations  WHERE id='7a000000-0000-4000-a000-000000000001';
DELETE FROM auth.users WHERE id IN (
  '7a000000-0000-4000-a000-0000000000aa','7a000000-0000-4000-a000-0000000000bb',
  '7a000000-0000-4000-a000-0000000000ad');

INSERT INTO auth.users (instance_id, id, aud, role, email, encrypted_password,
                        email_confirmed_at, created_at, updated_at,
                        confirmation_token, recovery_token, email_change, email_change_token_new,
                        raw_app_meta_data, raw_user_meta_data)
VALUES
  ('00000000-0000-0000-0000-000000000000','7a000000-0000-4000-a000-0000000000aa','authenticated','authenticated','zz-cp-a@test.local','', now(), now(), now(), '', '', '', '', '{}','{}'),
  ('00000000-0000-0000-0000-000000000000','7a000000-0000-4000-a000-0000000000bb','authenticated','authenticated','zz-cp-b@test.local','', now(), now(), now(), '', '', '', '', '{}','{}'),
  ('00000000-0000-0000-0000-000000000000','7a000000-0000-4000-a000-0000000000ad','authenticated','authenticated','zz-cp-adm@test.local','', now(), now(), now(), '', '', '', '', '{}','{}');

INSERT INTO public.organizations (id, name, slug)
VALUES ('7a000000-0000-4000-a000-000000000001','ZZ CP','zz-cp-compart');

INSERT INTO public.organization_users (organization_id, user_id, role, is_active) VALUES
  ('7a000000-0000-4000-a000-000000000001','7a000000-0000-4000-a000-0000000000aa','lawyer', true),
  ('7a000000-0000-4000-a000-000000000001','7a000000-0000-4000-a000-0000000000bb','member', true),
  ('7a000000-0000-4000-a000-000000000001','7a000000-0000-4000-a000-0000000000ad','admin',  true);

-- CP Oracle créée par A, ACME créée par B
INSERT INTO public.counterparties (id, organization_id, name, created_by) VALUES
  ('7a000000-0000-4000-a000-0000000000c1','7a000000-0000-4000-a000-000000000001','ZZ Oracle','7a000000-0000-4000-a000-0000000000aa'),
  ('7a000000-0000-4000-a000-0000000000c2','7a000000-0000-4000-a000-000000000001','ZZ ACME','7a000000-0000-4000-a000-0000000000bb');

-- Dossier d'A sous Oracle (privé)
INSERT INTO public.folders (id, organization_id, name, created_by, visibility, counterparty_id) VALUES
  ('7a000000-0000-4000-a000-0000000000f1','7a000000-0000-4000-a000-000000000001','ZZ F_oracle','7a000000-0000-4000-a000-0000000000aa','private','7a000000-0000-4000-a000-0000000000c1');

-- ── A : voit Oracle (créateur), PAS ACME ────────────────────────────
SELECT set_config('request.jwt.claims','{"sub":"7a000000-0000-4000-a000-0000000000aa","role":"authenticated"}',true);
SET LOCAL ROLE authenticated;
INSERT INTO public.zz_cp_test_results
SELECT '01_A_voit_CP', 'ZZ Oracle', COALESCE(string_agg(name, ',' ORDER BY name),'VIDE'),
       CASE WHEN COALESCE(string_agg(name, ',' ORDER BY name),'') = 'ZZ Oracle' THEN 'PASS' ELSE 'FAIL' END
FROM public.counterparties WHERE name LIKE 'ZZ %';
-- A crée une CP avec relecture (.insert().select())
DO $$ DECLARE n int; BEGIN
  WITH x AS (
    INSERT INTO public.counterparties (organization_id, name, created_by)
    VALUES ('7a000000-0000-4000-a000-000000000001','ZZ NouvelleCP A','7a000000-0000-4000-a000-0000000000aa')
    RETURNING id
  ) SELECT count(*) INTO n FROM x;
  INSERT INTO public.zz_cp_test_results VALUES ('02_A_insert_select_CP','1 ligne relue', n||' ligne(s)', CASE WHEN n=1 THEN 'PASS' ELSE 'FAIL' END);
EXCEPTION WHEN OTHERS THEN
  INSERT INTO public.zz_cp_test_results VALUES ('02_A_insert_select_CP','1 ligne relue','ÉCHEC: '||SQLERRM,'FAIL');
END $$;
RESET ROLE;
DELETE FROM public.counterparties WHERE name='ZZ NouvelleCP A';

-- ── B avant partage : voit ACME (la sienne), PAS Oracle ─────────────
SELECT set_config('request.jwt.claims','{"sub":"7a000000-0000-4000-a000-0000000000bb","role":"authenticated"}',true);
SET LOCAL ROLE authenticated;
INSERT INTO public.zz_cp_test_results
SELECT '03_B_avant_partage', 'ZZ ACME', COALESCE(string_agg(name, ',' ORDER BY name),'VIDE'),
       CASE WHEN COALESCE(string_agg(name, ',' ORDER BY name),'') = 'ZZ ACME' THEN 'PASS' ELSE 'FAIL' END
FROM public.counterparties WHERE name LIKE 'ZZ %';
RESET ROLE;

-- ── A partage F_oracle à B (viewer) ─────────────────────────────────
SELECT set_config('request.jwt.claims','{"sub":"7a000000-0000-4000-a000-0000000000aa","role":"authenticated"}',true);
SET LOCAL ROLE authenticated;
INSERT INTO public.folder_members (folder_id, user_id, role, granted_by)
VALUES ('7a000000-0000-4000-a000-0000000000f1','7a000000-0000-4000-a000-0000000000bb','viewer','7a000000-0000-4000-a000-0000000000aa');
RESET ROLE;

-- ── B après partage : voit ACME + Oracle (via le dossier partagé) ───
SELECT set_config('request.jwt.claims','{"sub":"7a000000-0000-4000-a000-0000000000bb","role":"authenticated"}',true);
SET LOCAL ROLE authenticated;
INSERT INTO public.zz_cp_test_results
SELECT '04_B_apres_partage', 'ZZ ACME,ZZ Oracle', COALESCE(string_agg(name, ',' ORDER BY name),'VIDE'),
       CASE WHEN COALESCE(string_agg(name, ',' ORDER BY name),'') = 'ZZ ACME,ZZ Oracle' THEN 'PASS' ELSE 'FAIL' END
FROM public.counterparties WHERE name LIKE 'ZZ %';
-- B ne peut pas modifier Oracle (pas créateur)
DO $$ DECLARE n int; BEGIN
  UPDATE public.counterparties SET name='ZZ Hacked' WHERE id='7a000000-0000-4000-a000-0000000000c1';
  GET DIAGNOSTICS n = ROW_COUNT;
  INSERT INTO public.zz_cp_test_results VALUES ('05_B_update_CP_autrui','0 ligne', n||' ligne(s)', CASE WHEN n=0 THEN 'PASS' ELSE 'FAIL' END);
END $$;
RESET ROLE;

-- ── A ne voit toujours pas ACME ─────────────────────────────────────
SELECT set_config('request.jwt.claims','{"sub":"7a000000-0000-4000-a000-0000000000aa","role":"authenticated"}',true);
SET LOCAL ROLE authenticated;
INSERT INTO public.zz_cp_test_results
SELECT '06_A_ne_voit_pas_ACME', 'ACME absente', CASE WHEN bool_or(name='ZZ ACME') THEN 'ACME VISIBLE' ELSE 'ACME absente' END,
       CASE WHEN bool_or(name='ZZ ACME') THEN 'FAIL' ELSE 'PASS' END
FROM public.counterparties WHERE name LIKE 'ZZ %';
RESET ROLE;

-- ── Admin voit les deux CP ──────────────────────────────────────────
SELECT set_config('request.jwt.claims','{"sub":"7a000000-0000-4000-a000-0000000000ad","role":"authenticated"}',true);
SET LOCAL ROLE authenticated;
INSERT INTO public.zz_cp_test_results
SELECT '07_admin_voit_tout', '2', count(*)::text, CASE WHEN count(*)=2 THEN 'PASS' ELSE 'FAIL' END
FROM public.counterparties WHERE name LIKE 'ZZ %';
RESET ROLE;

-- nettoyage
DELETE FROM public.folder_members WHERE folder_id='7a000000-0000-4000-a000-0000000000f1';
DELETE FROM public.folders        WHERE organization_id='7a000000-0000-4000-a000-000000000001';
DELETE FROM public.counterparties WHERE organization_id='7a000000-0000-4000-a000-000000000001';
DELETE FROM public.organization_users WHERE organization_id='7a000000-0000-4000-a000-000000000001';
DELETE FROM public.organizations  WHERE id='7a000000-0000-4000-a000-000000000001';
DELETE FROM auth.users WHERE id IN (
  '7a000000-0000-4000-a000-0000000000aa','7a000000-0000-4000-a000-0000000000bb',
  '7a000000-0000-4000-a000-0000000000ad');

SELECT * FROM public.zz_cp_test_results ORDER BY test;
