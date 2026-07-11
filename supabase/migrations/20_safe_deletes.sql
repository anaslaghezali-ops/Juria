-- 20_safe_deletes.sql — Rendre les suppressions possibles ET non destructives.
--
-- État constaté (diag_cascade_rules) :
--   - Supprimer un dossier BLOQUE s'il porte une tâche (tasks.folder_id NO ACTION)
--     ou un commentaire (comments.folder_id NO ACTION).
--   - Supprimer une contrepartie BLOQUE dès qu'elle a un dossier ou un document
--     (folders/documents.counterparty_id NO ACTION).
--
-- Cible (option choisie : documents JAMAIS détruits, sous-dossiers supprimés
-- avec le parent) :
--   - documents.folder_id      : SET NULL (déjà) — le doc survit, « sans dossier »
--   - folders.parent_id        : CASCADE (déjà) — sous-dossiers supprimés
--   - tasks.folder_id          : NO ACTION → SET NULL — la tâche survit, détachée
--   - comments.folder_id       : NO ACTION → SET NULL — le commentaire survit
--   - documents.counterparty_id: NO ACTION → SET NULL — le doc survit, « sans CP »
--   - folders.counterparty_id  : NO ACTION → SET NULL — le dossier survit, « sans CP »
--   - folder_members / counterparty_members : CASCADE (déjà) — partages retirés
--
-- Idempotente : la FK est recréée avec un nom déterministe ; un re-run retrouve
-- ce nom, le supprime et le recrée à l'identique.

-- Helper local : bascule une FK (child.col → parent) en ON DELETE SET NULL.
CREATE OR REPLACE FUNCTION public._fk_set_null(p_child regclass, p_col text, p_parent regclass, p_new_name text)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE cname text;
BEGIN
  SELECT c.conname INTO cname
  FROM pg_constraint c
  JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = c.conkey[1]
  WHERE c.contype = 'f' AND c.conrelid = p_child AND a.attname = p_col;

  IF cname IS NOT NULL THEN
    EXECUTE format('ALTER TABLE %s DROP CONSTRAINT %I', p_child, cname);
  END IF;

  EXECUTE format(
    'ALTER TABLE %s ADD CONSTRAINT %I FOREIGN KEY (%I) REFERENCES %s(id) ON DELETE SET NULL',
    p_child, p_new_name, p_col, p_parent
  );
END $$;

-- Dossier supprimable même avec tâches / commentaires : ceux-ci se détachent.
SELECT public._fk_set_null('public.tasks'::regclass, 'folder_id', 'public.folders'::regclass, 'tasks_folder_id_fkey');

DO $$ BEGIN
  IF to_regclass('public.comments') IS NOT NULL THEN
    PERFORM public._fk_set_null('public.comments'::regclass, 'folder_id', 'public.folders'::regclass, 'comments_folder_id_fkey');
  END IF;
END $$;

-- Contrepartie supprimable même avec dossiers / documents : ils se détachent.
SELECT public._fk_set_null('public.folders'::regclass,   'counterparty_id', 'public.counterparties'::regclass, 'folders_counterparty_id_fkey');
SELECT public._fk_set_null('public.documents'::regclass, 'counterparty_id', 'public.counterparties'::regclass, 'documents_counterparty_id_fkey');

DROP FUNCTION public._fk_set_null(regclass, text, regclass, text);
