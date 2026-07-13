-- Versions de documents — voir l'évolution d'un contrat au fil de ses révisions.
--
-- Modèle : la table `documents` reste le POINTEUR vers la version COURANTE
-- (son storage_path / file_size / document_content = l'état actuel). La table
-- `document_versions` archive les versions PRÉCÉDENTES (une ligne par version
-- superseded, jamais la courante). Conséquences :
--   - le stockage consommé = Σ documents.file_size + Σ document_versions.file_size,
--     deux ensembles DISJOINTS → aucun double comptage, et les documents
--     existants (sans historique) restent comptés une seule fois ;
--   - chaque version archivée fige son propre `extracted_text` → la comparaison
--     entre deux versions est instantanée (pas de ré-extraction) ;
--   - la sécurité est HÉRITÉE du document parent via fn_document_access :
--     mêmes règles que document_risks (partage de dossier respecté, isolation
--     inter-organisations garantie).
--
-- Idempotente : IF NOT EXISTS / OR REPLACE / DROP … IF EXISTS.

-- ═══════════════════════════════════════════════════════════════════
-- 1) Table des versions archivées
-- ═══════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.document_versions (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id     uuid NOT NULL REFERENCES public.documents(id)     ON DELETE CASCADE,
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  version_number  int  NOT NULL,
  name            text,
  file_type       text,
  file_size       bigint,
  storage_path    text,
  storage_bucket  text DEFAULT 'juria-documents',
  extracted_text  text,
  change_summary  text,
  created_by      uuid,
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (document_id, version_number)
);

-- Colonnes ajoutées si la table préexistait (défensif).
ALTER TABLE public.document_versions
  ADD COLUMN IF NOT EXISTS extracted_text text,
  ADD COLUMN IF NOT EXISTS change_summary text,
  ADD COLUMN IF NOT EXISTS created_by     uuid;

CREATE INDEX IF NOT EXISTS idx_document_versions_doc
  ON public.document_versions (document_id, version_number DESC);
CREATE INDEX IF NOT EXISTS idx_document_versions_org
  ON public.document_versions (organization_id);

-- ═══════════════════════════════════════════════════════════════════
-- 2) Compteurs de version sur documents (version courante = pointeur)
-- ═══════════════════════════════════════════════════════════════════
ALTER TABLE public.documents
  ADD COLUMN IF NOT EXISTS current_version int NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS version_count   int NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS version_note    text;   -- note de la version COURANTE


-- ═══════════════════════════════════════════════════════════════════
-- 3) RLS — calquée sur document_risks (héritage via fn_document_access)
-- ═══════════════════════════════════════════════════════════════════
ALTER TABLE public.document_versions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS versions_select ON public.document_versions;
DROP POLICY IF EXISTS versions_insert ON public.document_versions;
DROP POLICY IF EXISTS versions_update ON public.document_versions;
DROP POLICY IF EXISTS versions_delete ON public.document_versions;

-- Voir une version = pouvoir voir le document parent (org, propriété, partage).
CREATE POLICY versions_select ON public.document_versions
FOR SELECT USING (public.fn_document_access(document_id) IS NOT NULL);

-- Archiver une version exige d'être éditeur/propriétaire du document, dans l'org.
CREATE POLICY versions_insert ON public.document_versions
FOR INSERT WITH CHECK (
  organization_id IN (SELECT public.fn_user_organization_ids())
  AND public.fn_document_access(document_id) IN ('owner','editor')
);

CREATE POLICY versions_update ON public.document_versions
FOR UPDATE
USING  (public.fn_document_access(document_id) IN ('owner','editor'))
WITH CHECK (public.fn_document_access(document_id) IN ('owner','editor'));

CREATE POLICY versions_delete ON public.document_versions
FOR DELETE USING (
  public.fn_is_org_admin(organization_id)
  OR public.fn_document_access(document_id) = 'owner'
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.document_versions TO authenticated;
GRANT SELECT ON public.document_versions TO anon;

-- ═══════════════════════════════════════════════════════════════════
-- 4) Quota de stockage : inclure les versions archivées
-- ═══════════════════════════════════════════════════════════════════
-- documents (courant) + document_versions (archivé) = ensembles disjoints.
CREATE OR REPLACE FUNCTION fn_org_storage_bytes(p_org_id uuid)
RETURNS bigint
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
begin
  if auth.uid() is not null
     and not exists (
       select 1 from organization_users
       where organization_id = p_org_id
         and user_id = auth.uid()
         and is_active = true
     )
     and not exists (
       select 1 from superadmins where user_id = auth.uid()
     )
  then
    raise exception 'Accès refusé : vous n''êtes pas membre de cette organisation';
  end if;

  return (
    (select coalesce(sum(file_size), 0) from documents
       where organization_id = p_org_id)
    +
    (select coalesce(sum(file_size), 0) from document_versions
       where organization_id = p_org_id)
  )::bigint;
end;
$$;

revoke execute on function fn_org_storage_bytes(uuid) from public, anon;
grant execute on function fn_org_storage_bytes(uuid) to authenticated, service_role;

-- Enforcement : couvre désormais l'INSERT d'un document ET l'UPDATE qui fait
-- GROSSIR file_size (cas d'une nouvelle version dont la taille remplace la
-- courante). On raisonne en DELTA pour ne jamais bloquer une réduction ou un
-- simple changement de métadonnées.
CREATE OR REPLACE FUNCTION fn_enforce_org_storage_quota()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
declare
  v_max_mb int;
  v_used   bigint;
  v_delta  bigint;
begin
  if TG_OP = 'UPDATE' then
    v_delta := coalesce(new.file_size, 0) - coalesce(old.file_size, 0);
    if v_delta <= 0 then
      return new;                       -- taille stable ou en baisse : OK
    end if;
  else
    v_delta := coalesce(new.file_size, 0);
  end if;

  select max_storage_mb into v_max_mb
  from organizations
  where id = new.organization_id;

  if v_max_mb is null or v_max_mb = -1 then
    return new;                         -- pas de plafond / illimité
  end if;

  -- Total courant (documents + versions), AVANT que ce changement ne s'applique.
  select
    (select coalesce(sum(file_size), 0) from documents
       where organization_id = new.organization_id)
    +
    (select coalesce(sum(file_size), 0) from document_versions
       where organization_id = new.organization_id)
  into v_used;

  if v_used + v_delta > v_max_mb::bigint * 1024 * 1024 then
    raise exception 'STORAGE_QUOTA_EXCEEDED: stockage maximal de % Mo atteint pour cette organisation. Contactez Juria pour augmenter votre espace.', v_max_mb;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_enforce_org_storage_quota on documents;
create trigger trg_enforce_org_storage_quota
  before insert or update on documents
  for each row
  execute function fn_enforce_org_storage_quota();
