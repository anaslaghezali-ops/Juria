-- 21_safe_document_delete.sql — Débloque la suppression d'un document.
--
-- diag_doc_children : seuls tasks.document_id et comments.document_id étaient
-- en NO ACTION → ils bloquaient toute suppression d'un document. Tout le reste
-- (risques, échéances, résumés, analyses, contenu, dates, parties…) est déjà
-- en CASCADE.
--
-- Choix (validé avec le PO) : un document est un CONTENU supprimé
-- volontairement ; ses tâches et ses commentaires sont des annotations qui
-- n'ont de sens que dans son contexte. On les passe donc en ON DELETE CASCADE,
-- alignés sur les autres enfants du document.
--   ⚠ À ne pas confondre avec les liens vers un DOSSIER / une CONTREPARTIE
--   (migration 20), qui restent en SET NULL : là, le conteneur disparaît mais
--   son contenu (documents) survit détaché.
--
-- Idempotente : la FK est recréée avec un nom déterministe ; un re-run retrouve
-- ce nom, le supprime et le recrée à l'identique.

-- Helper local : (re)crée une FK (child.col → parent) avec l'action ON DELETE voulue.
CREATE OR REPLACE FUNCTION public._fk_set_action(p_child regclass, p_col text, p_parent regclass, p_new_name text, p_action text)
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
    'ALTER TABLE %s ADD CONSTRAINT %I FOREIGN KEY (%I) REFERENCES %s(id) ON DELETE %s',
    p_child, p_new_name, p_col, p_parent, p_action
  );
END $$;

-- Un document supprimé emporte ses tâches et ses commentaires.
SELECT public._fk_set_action('public.tasks'::regclass, 'document_id', 'public.documents'::regclass, 'tasks_document_id_fkey', 'CASCADE');

DO $$ BEGIN
  IF to_regclass('public.comments') IS NOT NULL THEN
    PERFORM public._fk_set_action('public.comments'::regclass, 'document_id', 'public.documents'::regclass, 'comments_document_id_fkey', 'CASCADE');
  END IF;
END $$;

DROP FUNCTION public._fk_set_action(regclass, text, regclass, text, text);
