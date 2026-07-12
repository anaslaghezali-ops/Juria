-- Échéances réelles (page Échéances / dashboard).
--
-- Contexte : bootstrap.js lit document_obligations depuis le début, mais
-- RIEN n'y écrit — l'UI affichait des échéances de démo codées en dur
-- (getDemoDeadlines) dont les dates glissaient à chaque chargement.
-- Cette migration fait de document_obligations la seule source de vérité :
--   - créée si absente (elle peut déjà exister dans le projet Supabase) ;
--   - organization_id ajouté pour permettre des échéances manuelles sans
--     document et une requête directe par organisation ;
--   - document_id rendu optionnel (échéance manuelle « libre ») ;
--   - RLS multi-tenant alignée sur le modèle de document_risks.

-- 1) Table (no-op si elle existe déjà).
CREATE TABLE IF NOT EXISTS public.document_obligations (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id   uuid REFERENCES public.documents(id) ON DELETE CASCADE,
  description   text NOT NULL,
  due_date      date,
  is_critical   boolean NOT NULL DEFAULT false,
  created_at    timestamptz NOT NULL DEFAULT now()
);

-- 2) Colonnes ajoutées si la table préexistait sans elles.
ALTER TABLE public.document_obligations
  ADD COLUMN IF NOT EXISTS organization_id uuid REFERENCES public.organizations(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'analysis',   -- 'analysis' | 'manual'
  ADD COLUMN IF NOT EXISTS created_by uuid,
  ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now();

-- 3) Échéances manuelles : document facultatif.
ALTER TABLE public.document_obligations
  ALTER COLUMN document_id DROP NOT NULL;

-- 4) Backfill de organization_id depuis le document parent.
UPDATE public.document_obligations o
SET organization_id = d.organization_id
FROM public.documents d
WHERE o.document_id = d.id
  AND o.organization_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_document_obligations_org_due
  ON public.document_obligations (organization_id, due_date);

-- 5) RLS multi-tenant (scope organisation, mêmes rôles que document_risks).
ALTER TABLE public.document_obligations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS obligations_select ON public.document_obligations;
DROP POLICY IF EXISTS obligations_insert ON public.document_obligations;
DROP POLICY IF EXISTS obligations_update ON public.document_obligations;
DROP POLICY IF EXISTS obligations_delete ON public.document_obligations;

CREATE POLICY obligations_select ON public.document_obligations
FOR SELECT
USING (organization_id IN (SELECT fn_user_organization_ids()));

CREATE POLICY obligations_insert ON public.document_obligations
FOR INSERT
WITH CHECK (
  organization_id IN (SELECT fn_user_organization_ids())
  AND fn_user_role(organization_id) IN ('owner','admin','lawyer','member')
  AND (document_id IS NULL OR fn_document_org_id(document_id) = organization_id)
);

CREATE POLICY obligations_update ON public.document_obligations
FOR UPDATE
USING (fn_user_role(organization_id) IN ('owner','admin','lawyer','member'))
WITH CHECK (fn_user_role(organization_id) IN ('owner','admin','lawyer','member'));

CREATE POLICY obligations_delete ON public.document_obligations
FOR DELETE
USING (fn_user_role(organization_id) IN ('owner','admin','lawyer','member'));
