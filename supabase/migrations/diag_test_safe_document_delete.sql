-- TESTS — suppression non destructive d'un DOCUMENT (migration 21). Pas une migration.
-- Contexte : diag_doc_children montre que seuls tasks.document_id et
-- comments.document_id étaient en NO ACTION (donc bloquants) ; tout le reste
-- (risks, obligations, summaries, dates, parties, conversations) est déjà en
-- CASCADE. Ce test valide donc précisément ce que la migration 21 change.
--
-- A crée : CP, dossier F, un document D dans F, une tâche T sur D, un
-- commentaire C sur D. Puis supprime D. Attendu :
--   - la suppression réussit (plus bloquée) ;
--   - la tâche T survit, détachée (document_id NULL) ;
--   - le commentaire C survit, détaché (document_id NULL).

RESET ROLE;
DROP TABLE IF EXISTS public.zz_docdel_results;
CREATE TABLE public.zz_docdel_results (test text, expected text, got text, verdict text);
GRANT ALL ON public.zz_docdel_results TO authenticated;

DELETE FROM public.tasks              WHERE organization_id='9b000000-0000-4000-a000-000000000001';
DELETE FROM public.comments           WHERE organization_id='9b000000-0000-4000-a000-000000000001';
DELETE FROM public.documents          WHERE organization_id='9b000000-0000-4000-a000-000000000001';
DELETE FROM public.folders            WHERE organization_id='9b000000-0000-4000-a000-000000000001';
DELETE FROM public.counterparties     WHERE organization_id='9b000000-0000-4000-a000-000000000001';
DELETE FROM public.organization_users WHERE organization_id='9b000000-0000-4000-a000-000000000001';
DELETE FROM public.organizations      WHERE id='9b000000-0000-4000-a000-000000000001';
DELETE FROM auth.users WHERE id='9b000000-0000-4000-a000-0000000000aa';

INSERT INTO auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at, confirmation_token, recovery_token, email_change, email_change_token_new, raw_app_meta_data, raw_user_meta_data)
VALUES ('00000000-0000-0000-0000-000000000000','9b000000-0000-4000-a000-0000000000aa','authenticated','authenticated','zz-docdel-a@t.local','', now(), now(), now(), '', '', '', '', '{}','{}');
INSERT INTO public.organizations (id, name, slug) VALUES ('9b000000-0000-4000-a000-000000000001','ZZ DocDel','zz-docdel');
INSERT INTO public.organization_users (organization_id, user_id, role, is_active)
VALUES ('9b000000-0000-4000-a000-000000000001','9b000000-0000-4000-a000-0000000000aa','owner', true);
INSERT INTO public.counterparties (id, organization_id, name, created_by)
VALUES ('9b000000-0000-4000-a000-0000000000c1','9b000000-0000-4000-a000-000000000001','ZZ CP','9b000000-0000-4000-a000-0000000000aa');
INSERT INTO public.folders (id, organization_id, name, created_by, visibility, counterparty_id, parent_id)
VALUES ('9b000000-0000-4000-a000-0000000000f1','9b000000-0000-4000-a000-000000000001','ZZ F','9b000000-0000-4000-a000-0000000000aa','private','9b000000-0000-4000-a000-0000000000c1',NULL);
INSERT INTO public.documents (id, organization_id, folder_id, counterparty_id, uploaded_by, name, file_type)
VALUES ('9b000000-0000-4000-a000-0000000000d1','9b000000-0000-4000-a000-000000000001','9b000000-0000-4000-a000-0000000000f1','9b000000-0000-4000-a000-0000000000c1','9b000000-0000-4000-a000-0000000000aa','ZZ doc.pdf','pdf');
INSERT INTO public.tasks (id, organization_id, title, created_by, document_id)
VALUES ('9b000000-0000-4000-a000-0000000000a1','9b000000-0000-4000-a000-000000000001','ZZ tâche','9b000000-0000-4000-a000-0000000000aa','9b000000-0000-4000-a000-0000000000d1');
INSERT INTO public.comments (id, organization_id, document_id, author_id, content)
VALUES ('9b000000-0000-4000-a000-0000000000b1','9b000000-0000-4000-a000-000000000001','9b000000-0000-4000-a000-0000000000d1','9b000000-0000-4000-a000-0000000000aa','ZZ commentaire');

SELECT set_config('request.jwt.claims','{"sub":"9b000000-0000-4000-a000-0000000000aa","role":"authenticated"}',true);
SET LOCAL ROLE authenticated;

-- ── Supprimer le document D (portant une tâche + un commentaire) ──────
DO $$ BEGIN
  DELETE FROM public.documents WHERE id='9b000000-0000-4000-a000-0000000000d1';
  INSERT INTO public.zz_docdel_results VALUES ('01_suppr_document','succès','succès','PASS');
EXCEPTION WHEN OTHERS THEN
  INSERT INTO public.zz_docdel_results VALUES ('01_suppr_document','succès','BLOQUÉ: '||SQLERRM,'FAIL');
END $$;

-- La tâche survit, détachée
INSERT INTO public.zz_docdel_results
SELECT '02_tache_survit', 'existe, document_id NULL',
       CASE WHEN EXISTS(SELECT 1 FROM public.tasks WHERE id='9b000000-0000-4000-a000-0000000000a1' AND document_id IS NULL) THEN 'existe, document_id NULL' ELSE 'PERDUE ou rattachée' END,
       CASE WHEN EXISTS(SELECT 1 FROM public.tasks WHERE id='9b000000-0000-4000-a000-0000000000a1' AND document_id IS NULL) THEN 'PASS' ELSE 'FAIL' END;

-- Le commentaire survit, détaché
INSERT INTO public.zz_docdel_results
SELECT '03_commentaire_survit', 'existe, document_id NULL',
       CASE WHEN EXISTS(SELECT 1 FROM public.comments WHERE id='9b000000-0000-4000-a000-0000000000b1' AND document_id IS NULL) THEN 'existe, document_id NULL' ELSE 'PERDU ou rattaché' END,
       CASE WHEN EXISTS(SELECT 1 FROM public.comments WHERE id='9b000000-0000-4000-a000-0000000000b1' AND document_id IS NULL) THEN 'PASS' ELSE 'FAIL' END;

RESET ROLE;

-- nettoyage
DELETE FROM public.tasks              WHERE organization_id='9b000000-0000-4000-a000-000000000001';
DELETE FROM public.comments           WHERE organization_id='9b000000-0000-4000-a000-000000000001';
DELETE FROM public.documents          WHERE organization_id='9b000000-0000-4000-a000-000000000001';
DELETE FROM public.folders            WHERE organization_id='9b000000-0000-4000-a000-000000000001';
DELETE FROM public.counterparties     WHERE organization_id='9b000000-0000-4000-a000-000000000001';
DELETE FROM public.organization_users WHERE organization_id='9b000000-0000-4000-a000-000000000001';
DELETE FROM public.organizations      WHERE id='9b000000-0000-4000-a000-000000000001';
DELETE FROM auth.users WHERE id='9b000000-0000-4000-a000-0000000000aa';

SELECT * FROM public.zz_docdel_results ORDER BY test;
