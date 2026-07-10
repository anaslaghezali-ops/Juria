-- DIAGNOSTIC (repro) — INSERT avec le compte a@a.com (le testeur actif)
-- et le payload EXACT de l'ancien front servi par GitHub Pages. Se nettoie.

RESET ROLE;

DROP TABLE IF EXISTS public.zz_repro2_results;
CREATE TABLE public.zz_repro2_results (seq int, info text, detail text);
GRANT ALL ON public.zz_repro2_results TO authenticated;

DO $$
DECLARE
  v_uid uuid;
  v_org uuid;
BEGIN
  SELECT id INTO v_uid FROM auth.users WHERE email = 'a@a.com' LIMIT 1;
  SELECT organization_id INTO v_org FROM public.organization_users
  WHERE user_id = v_uid AND is_active = true LIMIT 1;
  INSERT INTO public.zz_repro2_results VALUES
    (1, 'a@a.com uid', coalesce(v_uid::text, 'INTROUVABLE')),
    (2, 'org active', coalesce(v_org::text, 'AUCUNE') || ' role=' || coalesce(public.fn_user_role(v_org), '?'));
  IF v_uid IS NULL OR v_org IS NULL THEN RETURN; END IF;

  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_uid, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;

  INSERT INTO public.zz_repro2_results
  SELECT 3, 'role check', 'fn_user_role=' || coalesce(public.fn_user_role(v_org), 'NULL')
         || ' orgs_ok=' || (v_org IN (SELECT public.fn_user_organization_ids()))::text;

  -- Payload folders identique à FolderService (main)
  BEGIN
    INSERT INTO public.folders (id, name, description, organization_id, created_by,
                                counterparty_id, parent_id, color, icon, created_at, updated_at)
    VALUES ('5d000000-0000-4000-a000-00000000f099', 'ZZ repro a@a', NULL, v_org, v_uid,
            NULL, NULL, '#6366f1', '📁', now(), now());
    INSERT INTO public.zz_repro2_results VALUES (4, 'INSERT folders (payload main)', 'OK');
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO public.zz_repro2_results VALUES (4, 'INSERT folders (payload main)', 'ÉCHEC [' || SQLSTATE || '] ' || SQLERRM);
  END;

  -- Payload documents identique à confirmUpload (main)
  BEGIN
    INSERT INTO public.documents (id, organization_id, uploaded_by, name, file_type,
                                  file_size, document_type, language, governing_law,
                                  storage_bucket, currency, chunk_version, status,
                                  is_starred, is_archived, folder_id, counterparty_id,
                                  created_at, updated_at)
    VALUES ('5d000000-0000-4000-a000-00000000d099', v_org, v_uid, 'ZZ repro.pdf', 'pdf',
            12345, 'autre', 'fr', 'Droit marocain', 'juria-documents', 'MAD', 0, 'imported',
            false, false, NULL, NULL, now(), now());
    INSERT INTO public.zz_repro2_results VALUES (5, 'INSERT documents (payload main)', 'OK');
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO public.zz_repro2_results VALUES (5, 'INSERT documents (payload main)', 'ÉCHEC [' || SQLSTATE || '] ' || SQLERRM);
  END;

  RESET ROLE;
END $$;

RESET ROLE;

-- Triggers en place sur documents/folders
INSERT INTO public.zz_repro2_results
SELECT 6, 'trigger ' || c.relname || '.' || t.tgname, 'enabled=' || t.tgenabled
FROM pg_trigger t
JOIN pg_class c ON c.oid = t.tgrelid
WHERE NOT t.tgisinternal AND c.relname IN ('documents', 'folders');

DELETE FROM public.documents WHERE id = '5d000000-0000-4000-a000-00000000d099';
DELETE FROM public.folders   WHERE id = '5d000000-0000-4000-a000-00000000f099';

SELECT * FROM public.zz_repro2_results ORDER BY seq, info;
