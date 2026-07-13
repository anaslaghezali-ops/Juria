-- ═══════════════════════════════════════════════════════════════════════════
-- TEST D'ISOLATION MULTI-TENANT (RLS)
-- ═══════════════════════════════════════════════════════════════════════════
-- Vérifie que les politiques Row Level Security empêchent une organisation de
-- voir les données d'une autre — la garantie de confidentialité la plus
-- critique d'un outil juridique. Exécuté en CI sur une base jetable.
--
-- Acteurs : Org A (propriétaire UA, + collègue membre UC) et Org B
-- (propriétaire UB, autre tenant). Org A possède deux dossiers privés — F1
-- (sera partagé avec UC) et F2 (jamais partagé) — chacun avec un document et
-- ses enfants (risque, échéance, analyse, contenu, chunk, résumé, commentaire
-- de risque), plus une contrepartie, une tâche, une notification.
--
-- Attendu :
--   Phase 1  — Isolation tenant : UB (Org B) et l'anonyme voient ZÉRO ligne
--     d'Org A sur TOUTES les tables. Contrôle positif : UA voit ses lignes.
--   Phase 1b — Compartimentage intra-org : UC (membre d'Org A) ne voit RIEN
--     des dossiers privés de UA tant que rien n'est partagé.
--   Phase 2  — Partage borné : UA partage F1 (pas F2) avec UC → UC voit F1 et
--     son document/enfants, jamais F2 ; et Org B reste totalement isolée.
--
-- Convention : chaque assertion insère (test, attendu, obtenu, verdict). Le
-- job CI échoue s'il reste un seul FAIL.

RESET ROLE;
DROP TABLE IF EXISTS public.rls_results;
CREATE TABLE public.rls_results (test text, expected int, got int, verdict text);
GRANT ALL ON public.rls_results TO authenticated, anon;

-- ── Nettoyage (idempotence) ──────────────────────────────────────────
DELETE FROM public.folder_members       WHERE folder_id IN (SELECT id FROM public.folders WHERE organization_id IN ('a0000000-0000-4000-a000-000000000001','b0000000-0000-4000-a000-000000000001'));
DELETE FROM public.counterparty_members WHERE counterparty_id IN (SELECT id FROM public.counterparties WHERE organization_id IN ('a0000000-0000-4000-a000-000000000001','b0000000-0000-4000-a000-000000000001'));
DELETE FROM public.notifications        WHERE organization_id IN ('a0000000-0000-4000-a000-000000000001','b0000000-0000-4000-a000-000000000001');
DELETE FROM public.risk_comments        WHERE organization_id IN ('a0000000-0000-4000-a000-000000000001','b0000000-0000-4000-a000-000000000001');
DELETE FROM public.tasks                WHERE organization_id IN ('a0000000-0000-4000-a000-000000000001','b0000000-0000-4000-a000-000000000001');
DELETE FROM public.document_summaries   WHERE organization_id IN ('a0000000-0000-4000-a000-000000000001','b0000000-0000-4000-a000-000000000001');
DELETE FROM public.document_chunks      WHERE organization_id IN ('a0000000-0000-4000-a000-000000000001','b0000000-0000-4000-a000-000000000001');
DELETE FROM public.document_analyses    WHERE organization_id IN ('a0000000-0000-4000-a000-000000000001','b0000000-0000-4000-a000-000000000001');
DELETE FROM public.document_obligations WHERE organization_id IN ('a0000000-0000-4000-a000-000000000001','b0000000-0000-4000-a000-000000000001');
DELETE FROM public.document_risks       WHERE organization_id IN ('a0000000-0000-4000-a000-000000000001','b0000000-0000-4000-a000-000000000001');
DELETE FROM public.document_content     WHERE document_id IN (SELECT id FROM public.documents WHERE organization_id IN ('a0000000-0000-4000-a000-000000000001','b0000000-0000-4000-a000-000000000001'));
DELETE FROM public.documents            WHERE organization_id IN ('a0000000-0000-4000-a000-000000000001','b0000000-0000-4000-a000-000000000001');
DELETE FROM public.folders              WHERE organization_id IN ('a0000000-0000-4000-a000-000000000001','b0000000-0000-4000-a000-000000000001');
DELETE FROM public.counterparties       WHERE organization_id IN ('a0000000-0000-4000-a000-000000000001','b0000000-0000-4000-a000-000000000001');
DELETE FROM public.organization_users   WHERE organization_id IN ('a0000000-0000-4000-a000-000000000001','b0000000-0000-4000-a000-000000000001');
DELETE FROM public.organizations        WHERE id IN ('a0000000-0000-4000-a000-000000000001','b0000000-0000-4000-a000-000000000001');
DELETE FROM auth.users                  WHERE id IN ('a0000000-0000-4000-a000-0000000000a1','a0000000-0000-4000-a000-0000000000a2','b0000000-0000-4000-a000-0000000000b1');

-- ── Seed (en tant que superuser, RLS non appliquée) ──────────────────
-- UA = propriétaire d'Org A ; UC = collègue membre d'Org A (workspace
-- compartimenté) ; UB = propriétaire d'Org B (autre tenant).
INSERT INTO auth.users (id, aud, role, email) VALUES
  ('a0000000-0000-4000-a000-0000000000a1','authenticated','authenticated','ua@a.test'),
  ('a0000000-0000-4000-a000-0000000000a2','authenticated','authenticated','uc@a.test'),
  ('b0000000-0000-4000-a000-0000000000b1','authenticated','authenticated','ub@b.test');
INSERT INTO public.organizations (id, name, slug) VALUES
  ('a0000000-0000-4000-a000-000000000001','Org A','org-a'),
  ('b0000000-0000-4000-a000-000000000001','Org B','org-b');
INSERT INTO public.organization_users (organization_id, user_id, role, is_active) VALUES
  ('a0000000-0000-4000-a000-000000000001','a0000000-0000-4000-a000-0000000000a1','owner',true),
  ('a0000000-0000-4000-a000-000000000001','a0000000-0000-4000-a000-0000000000a2','member',true),
  ('b0000000-0000-4000-a000-000000000001','b0000000-0000-4000-a000-0000000000b1','owner',true);
INSERT INTO public.counterparties (id, organization_id, name, created_by) VALUES
  ('a0000000-0000-4000-a000-0000000000c1','a0000000-0000-4000-a000-000000000001','CP A','a0000000-0000-4000-a000-0000000000a1');
INSERT INTO public.folders (id, organization_id, name, created_by, visibility, counterparty_id) VALUES
  ('a0000000-0000-4000-a000-0000000000f1','a0000000-0000-4000-a000-000000000001','F1 (à partager)','a0000000-0000-4000-a000-0000000000a1','private','a0000000-0000-4000-a000-0000000000c1'),
  ('a0000000-0000-4000-a000-0000000000f2','a0000000-0000-4000-a000-000000000001','F2 (privé)','a0000000-0000-4000-a000-0000000000a1','private','a0000000-0000-4000-a000-0000000000c1');
INSERT INTO public.documents (id, organization_id, folder_id, uploaded_by, name, counterparty_id) VALUES
  ('a0000000-0000-4000-a000-0000000000d1','a0000000-0000-4000-a000-000000000001','a0000000-0000-4000-a000-0000000000f1','a0000000-0000-4000-a000-0000000000a1','Doc A1','a0000000-0000-4000-a000-0000000000c1'),
  ('a0000000-0000-4000-a000-0000000000d2','a0000000-0000-4000-a000-000000000001','a0000000-0000-4000-a000-0000000000f2','a0000000-0000-4000-a000-0000000000a1','Doc A2','a0000000-0000-4000-a000-0000000000c1');
INSERT INTO public.document_risks (id, document_id, organization_id, severity, problem) VALUES
  ('a0000000-0000-4000-a000-0000000000e1','a0000000-0000-4000-a000-0000000000d1','a0000000-0000-4000-a000-000000000001','high','risque A1');
INSERT INTO public.document_obligations (id, document_id, organization_id, description) VALUES
  ('a0000000-0000-4000-a000-0000000000e2','a0000000-0000-4000-a000-0000000000d1','a0000000-0000-4000-a000-000000000001','échéance A1');
INSERT INTO public.document_analyses (id, document_id, organization_id) VALUES
  ('a0000000-0000-4000-a000-0000000000e3','a0000000-0000-4000-a000-0000000000d1','a0000000-0000-4000-a000-000000000001');
INSERT INTO public.document_content (document_id, extracted_text) VALUES
  ('a0000000-0000-4000-a000-0000000000d1','texte A1'),
  ('a0000000-0000-4000-a000-0000000000d2','texte A2');
INSERT INTO public.document_chunks (id, document_id, organization_id, chunk_index, content) VALUES
  ('a0000000-0000-4000-a000-0000000000e4','a0000000-0000-4000-a000-0000000000d1','a0000000-0000-4000-a000-000000000001',0,'chunk A1');
INSERT INTO public.document_summaries (id, document_id, organization_id, section_index) VALUES
  ('a0000000-0000-4000-a000-0000000000e5','a0000000-0000-4000-a000-0000000000d1','a0000000-0000-4000-a000-000000000001',0);
INSERT INTO public.risk_comments (id, risk_id, organization_id, content, created_by) VALUES
  ('a0000000-0000-4000-a000-0000000000e6','a0000000-0000-4000-a000-0000000000e1','a0000000-0000-4000-a000-000000000001','commentaire A1','a0000000-0000-4000-a000-0000000000a1');
INSERT INTO public.tasks (id, organization_id, title, created_by, folder_id) VALUES
  ('a0000000-0000-4000-a000-0000000000a5','a0000000-0000-4000-a000-000000000001','tâche A1','a0000000-0000-4000-a000-0000000000a1','a0000000-0000-4000-a000-0000000000f1');
INSERT INTO public.notifications (id, organization_id, user_id, type, payload) VALUES
  ('a0000000-0000-4000-a000-000000000091','a0000000-0000-4000-a000-000000000001','a0000000-0000-4000-a000-0000000000a1','test','{}');

-- ════════════════════ PHASE 1 — ISOLATION (aucun partage) ════════════
-- Acteur : UB (propriétaire d'Org B). Doit voir 0 ligne d'Org A partout.
SELECT set_config('request.jwt.claims','{"sub":"b0000000-0000-4000-a000-0000000000b1","role":"authenticated"}', false);
SET ROLE authenticated;

INSERT INTO public.rls_results SELECT 'P1_B_voit_folders_A',        0, count(*)::int, CASE WHEN count(*)=0 THEN 'PASS' ELSE 'FAIL' END FROM public.folders              WHERE organization_id='a0000000-0000-4000-a000-000000000001';
INSERT INTO public.rls_results SELECT 'P1_B_voit_documents_A',      0, count(*)::int, CASE WHEN count(*)=0 THEN 'PASS' ELSE 'FAIL' END FROM public.documents            WHERE organization_id='a0000000-0000-4000-a000-000000000001';
INSERT INTO public.rls_results SELECT 'P1_B_voit_counterparties_A', 0, count(*)::int, CASE WHEN count(*)=0 THEN 'PASS' ELSE 'FAIL' END FROM public.counterparties       WHERE organization_id='a0000000-0000-4000-a000-000000000001';
INSERT INTO public.rls_results SELECT 'P1_B_voit_tasks_A',          0, count(*)::int, CASE WHEN count(*)=0 THEN 'PASS' ELSE 'FAIL' END FROM public.tasks                WHERE organization_id='a0000000-0000-4000-a000-000000000001';
INSERT INTO public.rls_results SELECT 'P1_B_voit_risks_A',          0, count(*)::int, CASE WHEN count(*)=0 THEN 'PASS' ELSE 'FAIL' END FROM public.document_risks       WHERE organization_id='a0000000-0000-4000-a000-000000000001';
INSERT INTO public.rls_results SELECT 'P1_B_voit_obligations_A',    0, count(*)::int, CASE WHEN count(*)=0 THEN 'PASS' ELSE 'FAIL' END FROM public.document_obligations WHERE organization_id='a0000000-0000-4000-a000-000000000001';
INSERT INTO public.rls_results SELECT 'P1_B_voit_analyses_A',       0, count(*)::int, CASE WHEN count(*)=0 THEN 'PASS' ELSE 'FAIL' END FROM public.document_analyses    WHERE organization_id='a0000000-0000-4000-a000-000000000001';
INSERT INTO public.rls_results SELECT 'P1_B_voit_chunks_A',         0, count(*)::int, CASE WHEN count(*)=0 THEN 'PASS' ELSE 'FAIL' END FROM public.document_chunks      WHERE organization_id='a0000000-0000-4000-a000-000000000001';
INSERT INTO public.rls_results SELECT 'P1_B_voit_summaries_A',      0, count(*)::int, CASE WHEN count(*)=0 THEN 'PASS' ELSE 'FAIL' END FROM public.document_summaries   WHERE organization_id='a0000000-0000-4000-a000-000000000001';
INSERT INTO public.rls_results SELECT 'P1_B_voit_risk_comments_A',  0, count(*)::int, CASE WHEN count(*)=0 THEN 'PASS' ELSE 'FAIL' END FROM public.risk_comments        WHERE organization_id='a0000000-0000-4000-a000-000000000001';
INSERT INTO public.rls_results SELECT 'P1_B_voit_content_A',        0, count(*)::int, CASE WHEN count(*)=0 THEN 'PASS' ELSE 'FAIL' END FROM public.document_content     WHERE document_id IN ('a0000000-0000-4000-a000-0000000000d1','a0000000-0000-4000-a000-0000000000d2');
INSERT INTO public.rls_results SELECT 'P1_B_voit_orgusers_A',       0, count(*)::int, CASE WHEN count(*)=0 THEN 'PASS' ELSE 'FAIL' END FROM public.organization_users   WHERE organization_id='a0000000-0000-4000-a000-000000000001';
INSERT INTO public.rls_results SELECT 'P1_B_voit_notifs_A',         0, count(*)::int, CASE WHEN count(*)=0 THEN 'PASS' ELSE 'FAIL' END FROM public.notifications        WHERE organization_id='a0000000-0000-4000-a000-000000000001';
RESET ROLE;

-- Acteur : anonyme (pas de session). Ne doit rien voir.
SELECT set_config('request.jwt.claims','', false);
SET ROLE anon;
INSERT INTO public.rls_results SELECT 'P1_anon_voit_folders',   0, count(*)::int, CASE WHEN count(*)=0 THEN 'PASS' ELSE 'FAIL' END FROM public.folders   WHERE organization_id='a0000000-0000-4000-a000-000000000001';
INSERT INTO public.rls_results SELECT 'P1_anon_voit_documents', 0, count(*)::int, CASE WHEN count(*)=0 THEN 'PASS' ELSE 'FAIL' END FROM public.documents WHERE organization_id='a0000000-0000-4000-a000-000000000001';
RESET ROLE;

-- Contrôle positif : UA voit BIEN ses propres données (sinon le test ne prouve rien).
SELECT set_config('request.jwt.claims','{"sub":"a0000000-0000-4000-a000-0000000000a1","role":"authenticated"}', false);
SET ROLE authenticated;
INSERT INTO public.rls_results SELECT 'P1_UA_voit_ses_folders',   2, count(*)::int, CASE WHEN count(*)=2 THEN 'PASS' ELSE 'FAIL' END FROM public.folders   WHERE organization_id='a0000000-0000-4000-a000-000000000001';
INSERT INTO public.rls_results SELECT 'P1_UA_voit_ses_documents', 2, count(*)::int, CASE WHEN count(*)=2 THEN 'PASS' ELSE 'FAIL' END FROM public.documents WHERE organization_id='a0000000-0000-4000-a000-000000000001';
RESET ROLE;

-- ════════════════════ PHASE 1b — COMPARTIMENTAGE INTRA-ORG ════════════
-- UC est membre d'Org A mais N'A PAS créé F1/F2 (privés) → ne doit rien voir
-- tant qu'aucun partage n'a lieu (workspaces indépendants au sein de l'org).
SELECT set_config('request.jwt.claims','{"sub":"a0000000-0000-4000-a000-0000000000a2","role":"authenticated"}', false);
SET ROLE authenticated;
INSERT INTO public.rls_results SELECT 'P1b_UC_voit_F1_avant_partage', 0, count(*)::int, CASE WHEN count(*)=0 THEN 'PASS' ELSE 'FAIL' END FROM public.folders   WHERE id='a0000000-0000-4000-a000-0000000000f1';
INSERT INTO public.rls_results SELECT 'P1b_UC_voit_F2_avant_partage', 0, count(*)::int, CASE WHEN count(*)=0 THEN 'PASS' ELSE 'FAIL' END FROM public.folders   WHERE id='a0000000-0000-4000-a000-0000000000f2';
INSERT INTO public.rls_results SELECT 'P1b_UC_voit_docF1_avant',      0, count(*)::int, CASE WHEN count(*)=0 THEN 'PASS' ELSE 'FAIL' END FROM public.documents WHERE id='a0000000-0000-4000-a000-0000000000d1';
RESET ROLE;

-- ════════════════════ PHASE 2 — PARTAGE BORNÉ (intra-org) ═════════════
-- UA partage F1 (et pas F2) avec son collègue UC.
INSERT INTO public.folder_members (folder_id, user_id, role, granted_by)
VALUES ('a0000000-0000-4000-a000-0000000000f1','a0000000-0000-4000-a000-0000000000a2','viewer','a0000000-0000-4000-a000-0000000000a1');

SELECT set_config('request.jwt.claims','{"sub":"a0000000-0000-4000-a000-0000000000a2","role":"authenticated"}', false);
SET ROLE authenticated;
-- F1 devient visible, F2 reste invisible
INSERT INTO public.rls_results SELECT 'P2_UC_voit_F1_partagé',    1, count(*)::int, CASE WHEN count(*)=1 THEN 'PASS' ELSE 'FAIL' END FROM public.folders   WHERE id='a0000000-0000-4000-a000-0000000000f1';
INSERT INTO public.rls_results SELECT 'P2_UC_voit_F2_privé',      0, count(*)::int, CASE WHEN count(*)=0 THEN 'PASS' ELSE 'FAIL' END FROM public.folders   WHERE id='a0000000-0000-4000-a000-0000000000f2';
-- doc de F1 visible, doc de F2 invisible
INSERT INTO public.rls_results SELECT 'P2_UC_voit_docF1',         1, count(*)::int, CASE WHEN count(*)=1 THEN 'PASS' ELSE 'FAIL' END FROM public.documents WHERE id='a0000000-0000-4000-a000-0000000000d1';
INSERT INTO public.rls_results SELECT 'P2_UC_voit_docF2',         0, count(*)::int, CASE WHEN count(*)=0 THEN 'PASS' ELSE 'FAIL' END FROM public.documents WHERE id='a0000000-0000-4000-a000-0000000000d2';
-- enfants du doc de F1 visibles (via l'accès au document), enfants de F2 non
INSERT INTO public.rls_results SELECT 'P2_UC_voit_risqueF1',      1, count(*)::int, CASE WHEN count(*)=1 THEN 'PASS' ELSE 'FAIL' END FROM public.document_risks   WHERE id='a0000000-0000-4000-a000-0000000000e1';
INSERT INTO public.rls_results SELECT 'P2_UC_voit_contenuF2',     0, count(*)::int, CASE WHEN count(*)=0 THEN 'PASS' ELSE 'FAIL' END FROM public.document_content WHERE document_id='a0000000-0000-4000-a000-0000000000d2';
-- Et surtout : partager dans Org A ne fait JAMAIS fuiter vers Org B.
RESET ROLE;
SELECT set_config('request.jwt.claims','{"sub":"b0000000-0000-4000-a000-0000000000b1","role":"authenticated"}', false);
SET ROLE authenticated;
INSERT INTO public.rls_results SELECT 'P2_B_toujours_isolé_F1',   0, count(*)::int, CASE WHEN count(*)=0 THEN 'PASS' ELSE 'FAIL' END FROM public.folders WHERE id='a0000000-0000-4000-a000-0000000000f1';
RESET ROLE;

-- ── Résultats + nettoyage ────────────────────────────────────────────
RESET ROLE;
DELETE FROM public.folder_members       WHERE folder_id IN (SELECT id FROM public.folders WHERE organization_id IN ('a0000000-0000-4000-a000-000000000001','b0000000-0000-4000-a000-000000000001'));
DELETE FROM public.notifications        WHERE organization_id IN ('a0000000-0000-4000-a000-000000000001','b0000000-0000-4000-a000-000000000001');
DELETE FROM public.risk_comments        WHERE organization_id IN ('a0000000-0000-4000-a000-000000000001','b0000000-0000-4000-a000-000000000001');
DELETE FROM public.tasks                WHERE organization_id IN ('a0000000-0000-4000-a000-000000000001','b0000000-0000-4000-a000-000000000001');
DELETE FROM public.document_summaries   WHERE organization_id IN ('a0000000-0000-4000-a000-000000000001','b0000000-0000-4000-a000-000000000001');
DELETE FROM public.document_chunks      WHERE organization_id IN ('a0000000-0000-4000-a000-000000000001','b0000000-0000-4000-a000-000000000001');
DELETE FROM public.document_analyses    WHERE organization_id IN ('a0000000-0000-4000-a000-000000000001','b0000000-0000-4000-a000-000000000001');
DELETE FROM public.document_obligations WHERE organization_id IN ('a0000000-0000-4000-a000-000000000001','b0000000-0000-4000-a000-000000000001');
DELETE FROM public.document_risks       WHERE organization_id IN ('a0000000-0000-4000-a000-000000000001','b0000000-0000-4000-a000-000000000001');
DELETE FROM public.document_content     WHERE document_id IN (SELECT id FROM public.documents WHERE organization_id IN ('a0000000-0000-4000-a000-000000000001','b0000000-0000-4000-a000-000000000001'));
DELETE FROM public.documents            WHERE organization_id IN ('a0000000-0000-4000-a000-000000000001','b0000000-0000-4000-a000-000000000001');
DELETE FROM public.folders              WHERE organization_id IN ('a0000000-0000-4000-a000-000000000001','b0000000-0000-4000-a000-000000000001');
DELETE FROM public.counterparties       WHERE organization_id IN ('a0000000-0000-4000-a000-000000000001','b0000000-0000-4000-a000-000000000001');
DELETE FROM public.organization_users   WHERE organization_id IN ('a0000000-0000-4000-a000-000000000001','b0000000-0000-4000-a000-000000000001');
DELETE FROM public.organizations        WHERE id IN ('a0000000-0000-4000-a000-000000000001','b0000000-0000-4000-a000-000000000001');
DELETE FROM auth.users                  WHERE id IN ('a0000000-0000-4000-a000-0000000000a1','a0000000-0000-4000-a000-0000000000a2','b0000000-0000-4000-a000-0000000000b1');

SELECT test, expected, got, verdict FROM public.rls_results ORDER BY test;
-- Ligne de synthèse lisible par le script CI : compte les échecs.
SELECT count(*) FILTER (WHERE verdict='FAIL') AS fails,
       count(*)                                AS total,
       CASE WHEN count(*) FILTER (WHERE verdict='FAIL')=0 THEN 'RLS_TESTS_PASSED' ELSE 'RLS_TESTS_FAILED' END AS summary
FROM public.rls_results;
