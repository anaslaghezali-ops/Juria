-- 21_safe_document_delete.sql — Débloque la suppression d'un document.
--
-- diag_doc_children : la plupart des enfants d'un document sont ON DELETE
-- CASCADE (risques, analyses, contenu, échéances, résumés… — supprimés avec
-- le document, ce qui est voulu). MAIS deux liens sont en NO ACTION et
-- bloquaient toute suppression dès qu'un document portait :
--   - une tâche  (tasks.document_id)
--   - un commentaire (comments.document_id)
--
-- On les bascule en SET NULL : la tâche / le commentaire survit, détaché du
-- document supprimé (cohérent avec la suppression non destructive des dossiers
-- et contreparties, migration 20). Idempotente.

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

SELECT public._fk_set_null('public.tasks'::regclass, 'document_id', 'public.documents'::regclass, 'tasks_document_id_fkey');

DO $$ BEGIN
  IF to_regclass('public.comments') IS NOT NULL THEN
    PERFORM public._fk_set_null('public.comments'::regclass, 'document_id', 'public.documents'::regclass, 'comments_document_id_fkey');
  END IF;
END $$;

DROP FUNCTION public._fk_set_null(regclass, text, regclass, text);
