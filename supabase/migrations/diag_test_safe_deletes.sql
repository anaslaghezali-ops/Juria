-- TESTS — suppressions non destructives (migration 20). Pas une migration.
-- A crée : CP Oracle, dossier F (sous Oracle) + sous-dossier SF, un document D
-- dans F, une tâche T sur F. Puis supprime F, puis supprime Oracle. Attendu :
-- D survit (détaché) ; T survit (détachée) ; SF supprimé ; après suppression de
-- la CP, dossiers/docs restants survivent sans counterparty_id.

RESET ROLE;
DROP TABLE IF EXISTS public.zz_del_results;
CREATE TABLE public.zz_del_results (test text, expected text, got text, verdict text);
GRANT ALL ON public.zz_del_results TO authenticated;

DELETE FROM public.tasks          WHERE organization_id='9a000000-0000-4000-a000-000000000001';
DELETE FROM public.documents      WHERE organization_id='9a000000-0000-4000-a000-000000000001';
DELETE FROM public.folders        WHERE organization_id='9a000000-0000-4000-a000-000000000001';
DELETE FROM public.counterparties WHERE organization_id='9a000000-0000-4000-a000-000000000001';
DELETE FROM public.organization_users WHERE organization_id='9a000000-0000-4000-a000-000000000001';
DELETE FROM public.organizations  WHERE id='9a000000-0000-4000-a000-000000000001';
DELETE FROM auth.users WHERE id='9a000000-0000-4000-a000-0000000000aa';

INSERT INTO auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at, confirmation_token, recovery_token, email_change, email_change_token_new, raw_app_meta_data, raw_user_meta_data)
VALUES ('00000000-0000-0000-0000-000000000000','9a000000-0000-4000-a000-0000000000aa','authenticated','authenticated','zz-del-a@t.local','', now(), now(), now(), '', '', '', '', '{}','{}');
INSERT INTO public.organizations (id, name, slug) VALUES ('9a000000-0000-4000-a000-000000000001','ZZ Del','zz-del');
INSERT INTO public.organization_users (organization_id, user_id, role, is_active)
VALUES ('9a000000-0000-4000-a000-000000000001','9a000000-0000-4000-a000-0000000000aa','owner', true);
INSERT INTO public.counterparties (id, organization_id, name, created_by)
VALUES ('9a000000-0000-4000-a000-0000000000c1','9a000000-0000-4000-a000-000000000001','ZZ Oracle','9a000000-0000-4000-a000-0000000000aa');
INSERT INTO public.folders (id, organization_id, name, created_by, visibility, counterparty_id, parent_id) VALUES
  ('9a000000-0000-4000-a000-0000000000f1','9a000000-0000-4000-a000-000000000001','ZZ F','9a000000-0000-4000-a000-0000000000aa','private','9a000000-0000-4000-a000-0000000000c1',NULL),
  ('9a000000-0000-4000-a000-0000000000f2','9a000000-0000-4000-a000-000000000001','ZZ SF','9a000000-0000-4000-a000-0000000000aa','private','9a000000-0000-4000-a000-0000000000c1','9a000000-0000-4000-a000-0000000000f1');
INSERT INTO public.documents (id, organization_id, folder_id, counterparty_id, uploaded_by, name, file_type)
VALUES ('9a000000-0000-4000-a000-0000000000d1','9a000000-0000-4000-a000-000000000001','9a000000-0000-4000-a000-0000000000f1','9a000000-0000-4000-a000-0000000000c1','9a000000-0000-4000-a000-0000000000aa','ZZ doc.pdf','pdf');
INSERT INTO public.tasks (id, organization_id, title, created_by, folder_id)
VALUES ('9a000000-0000-4000-a000-0000000000a1','9a000000-0000-4000-a000-000000000001','ZZ tâche','9a000000-0000-4000-a000-0000000000aa','9a000000-0000-4000-a000-0000000000f1');

SELECT set_config('request.jwt.claims','{"sub":"9a000000-0000-4000-a000-0000000000aa","role":"authenticated"}',true);
SET LOCAL ROLE authenticated;

-- ── Supprimer le dossier F (avec tâche + doc + sous-dossier) ─────────
DO $$ BEGIN
  DELETE FROM public.folders WHERE id='9a000000-0000-4000-a000-0000000000f1';
  INSERT INTO public.zz_del_results VALUES ('01_suppr_dossier','succès','succès','PASS');
EXCEPTION WHEN OTHERS THEN
  INSERT INTO public.zz_del_results VALUES ('01_suppr_dossier','succès','BLOQUÉ: '||SQLERRM,'FAIL');
END $$;

-- Le document survit, détaché (folder_id NULL)
INSERT INTO public.zz_del_results
SELECT '02_doc_survit', 'existe, folder_id NULL',
       CASE WHEN EXISTS(SELECT 1 FROM public.documents WHERE id='9a000000-0000-4000-a000-0000000000d1' AND folder_id IS NULL) THEN 'existe, folder_id NULL' ELSE 'PERDU ou encore rattaché' END,
       CASE WHEN EXISTS(SELECT 1 FROM public.documents WHERE id='9a000000-0000-4000-a000-0000000000d1' AND folder_id IS NULL) THEN 'PASS' ELSE 'FAIL' END;

-- La tâche survit, détachée
INSERT INTO public.zz_del_results
SELECT '03_tache_survit', 'existe, folder_id NULL',
       CASE WHEN EXISTS(SELECT 1 FROM public.tasks WHERE id='9a000000-0000-4000-a000-0000000000a1' AND folder_id IS NULL) THEN 'existe, folder_id NULL' ELSE 'PERDUE ou rattachée' END,
       CASE WHEN EXISTS(SELECT 1 FROM public.tasks WHERE id='9a000000-0000-4000-a000-0000000000a1' AND folder_id IS NULL) THEN 'PASS' ELSE 'FAIL' END;

-- Le sous-dossier a bien été supprimé (option a)
INSERT INTO public.zz_del_results
SELECT '04_sous_dossier_supprime', 'supprimé',
       CASE WHEN EXISTS(SELECT 1 FROM public.folders WHERE id='9a000000-0000-4000-a000-0000000000f2') THEN 'encore là' ELSE 'supprimé' END,
       CASE WHEN EXISTS(SELECT 1 FROM public.folders WHERE id='9a000000-0000-4000-a000-0000000000f2') THEN 'FAIL' ELSE 'PASS' END;

-- ── Supprimer la contrepartie Oracle (le doc la référence encore) ───
DO $$ BEGIN
  DELETE FROM public.counterparties WHERE id='9a000000-0000-4000-a000-0000000000c1';
  INSERT INTO public.zz_del_results VALUES ('05_suppr_contrepartie','succès','succès','PASS');
EXCEPTION WHEN OTHERS THEN
  INSERT INTO public.zz_del_results VALUES ('05_suppr_contrepartie','succès','BLOQUÉ: '||SQLERRM,'FAIL');
END $$;

-- Le document survit, détaché de la contrepartie
INSERT INTO public.zz_del_results
SELECT '06_doc_sans_CP', 'existe, counterparty_id NULL',
       CASE WHEN EXISTS(SELECT 1 FROM public.documents WHERE id='9a000000-0000-4000-a000-0000000000d1' AND counterparty_id IS NULL) THEN 'existe, counterparty_id NULL' ELSE 'PERDU ou rattaché' END,
       CASE WHEN EXISTS(SELECT 1 FROM public.documents WHERE id='9a000000-0000-4000-a000-0000000000d1' AND counterparty_id IS NULL) THEN 'PASS' ELSE 'FAIL' END;

RESET ROLE;

-- nettoyage
DELETE FROM public.tasks          WHERE organization_id='9a000000-0000-4000-a000-000000000001';
DELETE FROM public.documents      WHERE organization_id='9a000000-0000-4000-a000-000000000001';
DELETE FROM public.folders        WHERE organization_id='9a000000-0000-4000-a000-000000000001';
DELETE FROM public.counterparties WHERE organization_id='9a000000-0000-4000-a000-000000000001';
DELETE FROM public.organization_users WHERE organization_id='9a000000-0000-4000-a000-000000000001';
DELETE FROM public.organizations  WHERE id='9a000000-0000-4000-a000-000000000001';
DELETE FROM auth.users WHERE id='9a000000-0000-4000-a000-0000000000aa';

SELECT * FROM public.zz_del_results ORDER BY test;
