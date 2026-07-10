-- DIAGNOSTIC (repro) — INSERT documents/folders refusé par RLS en prod
-- alors que la même séquence passe en sandbox. Simule le vrai compte
-- fondateur et rapporte précisément quelle condition échoue. Pas une
-- migration ; se nettoie intégralement.

RESET ROLE;

DROP TABLE IF EXISTS public.zz_repro_results;
CREATE TABLE public.zz_repro_results (seq int, info text, detail text);
GRANT ALL ON public.zz_repro_results TO authenticated;

-- 1) Toutes les appartenances (qui est dans quelle org, rôle, actif)
INSERT INTO public.zz_repro_results
SELECT 1, 'membership: ' || coalesce(u.email, ou.user_id::text),
       'org=' || o.name || ' (' || ou.organization_id || ') role=' || ou.role || ' active=' || ou.is_active
FROM public.organization_users ou
LEFT JOIN auth.users u ON u.id = ou.user_id
LEFT JOIN public.organizations o ON o.id = ou.organization_id;

-- 2) Simulation du compte fondateur : évaluer chaque condition de policy
DO $$
DECLARE
  v_uid uuid;
  v_org uuid;
  v_role text;
  v_in_orgs boolean;
BEGIN
  SELECT id INTO v_uid FROM auth.users WHERE email = 'anaslaghezali@gmail.com' LIMIT 1;
  IF v_uid IS NULL THEN
    INSERT INTO public.zz_repro_results VALUES (2, 'fondateur', 'INTROUVABLE dans auth.users');
    RETURN;
  END IF;
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_uid, 'role', 'authenticated')::text, true);

  -- L'org active du fondateur (la première membership active)
  SELECT organization_id, role INTO v_org, v_role
  FROM public.organization_users
  WHERE user_id = v_uid AND is_active = true LIMIT 1;

  INSERT INTO public.zz_repro_results VALUES
    (2, 'fondateur uid', v_uid::text),
    (3, 'org active retenue', coalesce(v_org::text, 'AUCUNE') || ' role=' || coalesce(v_role, 'NULL'));

  -- Conditions des policies, évaluées une à une (en tant que definer,
  -- mais les fonctions lisent auth.uid() = jwt simulé)
  SELECT v_org IN (SELECT public.fn_user_organization_ids()) INTO v_in_orgs;
  INSERT INTO public.zz_repro_results VALUES
    (4, 'fn_user_organization_ids contient org', coalesce(v_in_orgs::text, 'NULL')),
    (5, 'fn_user_role(org)', coalesce(public.fn_user_role(v_org), 'NULL')),
    (6, 'auth.uid()', coalesce(auth.uid()::text, 'NULL'));
END $$;

-- 3) INSERT réels en tant que fondateur (rollback par DELETE juste après)
DO $$
DECLARE
  v_uid uuid;
  v_org uuid;
BEGIN
  SELECT id INTO v_uid FROM auth.users WHERE email = 'anaslaghezali@gmail.com' LIMIT 1;
  SELECT organization_id INTO v_org FROM public.organization_users
  WHERE user_id = v_uid AND is_active = true LIMIT 1;
  IF v_uid IS NULL OR v_org IS NULL THEN RETURN; END IF;

  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_uid, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;

  BEGIN
    INSERT INTO public.folders (id, organization_id, name, created_by)
    VALUES ('5c000000-0000-4000-a000-00000000f099', v_org, 'ZZ repro dossier', v_uid);
    INSERT INTO public.zz_repro_results VALUES (7, 'INSERT folders (fondateur)', 'OK');
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO public.zz_repro_results VALUES (7, 'INSERT folders (fondateur)', 'ÉCHEC: ' || SQLERRM);
  END;

  BEGIN
    INSERT INTO public.documents (id, organization_id, name, file_type, uploaded_by)
    VALUES ('5c000000-0000-4000-a000-00000000d099', v_org, 'ZZ repro doc.pdf', 'pdf', v_uid);
    INSERT INTO public.zz_repro_results VALUES (8, 'INSERT documents (fondateur)', 'OK');
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO public.zz_repro_results VALUES (8, 'INSERT documents (fondateur)', 'ÉCHEC: ' || SQLERRM);
  END;

  RESET ROLE;
END $$;

RESET ROLE;

-- 4) Les policies effectivement en place sur documents/folders
INSERT INTO public.zz_repro_results
SELECT 9, 'policy ' || tablename || '.' || policyname || ' [' || cmd || ']',
       left(regexp_replace(coalesce(with_check, qual, '-'), '\s+', ' ', 'g'), 300)
FROM pg_policies
WHERE schemaname = 'public' AND tablename IN ('documents', 'folders') AND cmd = 'INSERT';

-- 5) Nettoyage des lignes de repro
DELETE FROM public.documents WHERE id = '5c000000-0000-4000-a000-00000000d099';
DELETE FROM public.folders   WHERE id = '5c000000-0000-4000-a000-00000000f099';

SELECT * FROM public.zz_repro_results ORDER BY seq, info;
