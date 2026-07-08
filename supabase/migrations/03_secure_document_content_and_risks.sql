-- Applied 2026-07-08 via Supabase MCP (apply_migration: secure_document_content_and_risks)
--
-- Ferme les deux dernières failles multi-tenant signalées par l'advisor :
--   - document_content : USING (true) -> n'importe quel utilisateur connecté
--     pouvait lire/modifier le texte extrait des contrats de TOUTES les
--     organisations.
--   - risks : table héritée (vide, non référencée — le code utilise
--     document_risks) ouverte à tous en lecture/écriture.
--
-- Modèle scalable :
--   - fn_user_organization_ids() / fn_user_role(org) : primitives d'appartenance
--     (SECURITY DEFINER, search_path épinglé), désormais filtrées sur
--     is_active = true -> désactiver un membre coupe réellement son accès.
--   - fn_document_org_id(doc) : nouvelle primitive donnant l'organisation d'un
--     document. Toute table enfant de documents (contenu, résumés, etc.) se
--     sécurise en 4 policies sans ajouter de colonne organization_id.

-- 1) Durcissement des helpers : un membre désactivé perd l'accès.

CREATE OR REPLACE FUNCTION public.fn_user_organization_ids()
RETURNS SETOF uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $function$
  SELECT organization_id
  FROM organization_users
  WHERE user_id = auth.uid()
    AND is_active = true;
$function$;

CREATE OR REPLACE FUNCTION public.fn_user_role(p_org_id uuid)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $function$
  SELECT role
  FROM organization_users
  WHERE user_id = auth.uid()
    AND organization_id = p_org_id
    AND is_active = true
  LIMIT 1;
$function$;

-- 2) Nouvelle primitive : organisation d'un document.
CREATE OR REPLACE FUNCTION public.fn_document_org_id(p_document_id uuid)
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $function$
  SELECT organization_id
  FROM documents
  WHERE id = p_document_id;
$function$;

-- 3) document_content : scope organisation via le document parent.
DROP POLICY IF EXISTS "Users can access document content" ON document_content;

CREATE POLICY doc_content_select ON document_content
FOR SELECT
USING (fn_document_org_id(document_id) IN (SELECT fn_user_organization_ids()));

-- Écritures : mêmes rôles que document_analyses (reader exclu)
CREATE POLICY doc_content_insert ON document_content
FOR INSERT
WITH CHECK (fn_user_role(fn_document_org_id(document_id)) IN ('owner','admin','lawyer','member'));

CREATE POLICY doc_content_update ON document_content
FOR UPDATE
USING (fn_user_role(fn_document_org_id(document_id)) IN ('owner','admin','lawyer','member'))
WITH CHECK (fn_user_role(fn_document_org_id(document_id)) IN ('owner','admin','lawyer','member'));

CREATE POLICY doc_content_delete ON document_content
FOR DELETE
USING (fn_user_role(fn_document_org_id(document_id)) IN ('owner','admin'));

-- 4) risks : suppression de la policy permissive -> RLS sans policy
--    = refus par défaut (le service role n'est pas affecté).
--    La table pourra être supprimée ultérieurement si confirmée inutile.
DROP POLICY IF EXISTS allow_all_risks ON risks;
