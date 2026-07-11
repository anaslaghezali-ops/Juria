-- 18_counterparty_sharing.sql — Partage d'une CONTREPARTIE entière.
--
-- Deuxième niveau de partage, complémentaire du partage de dossier :
-- partager une contrepartie donne accès à TOUS ses dossiers (présents ET
-- futurs) et à leurs documents. Le rôle le plus permissif gagne si un
-- utilisateur a à la fois un partage de dossier et de contrepartie.
--
-- Mécanique : counterparty_members (jumelle de folder_members) ; fn_folder_access
-- et fn_document_access consultent désormais aussi cette table via la
-- counterparty_id du dossier racine → tout nouveau dossier de la contrepartie
-- devient automatiquement accessible, sans re-partage.
--
-- Idempotente.

-- ── 1) Table des membres d'une contrepartie ──────────────────────────
CREATE TABLE IF NOT EXISTS public.counterparty_members (
  counterparty_id uuid NOT NULL REFERENCES public.counterparties(id) ON DELETE CASCADE,
  user_id         uuid NOT NULL,
  role            text NOT NULL CHECK (role IN ('viewer','editor')),
  granted_by      uuid NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (counterparty_id, user_id)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.counterparty_members TO authenticated;
GRANT SELECT ON public.counterparty_members TO anon;

CREATE INDEX IF NOT EXISTS idx_counterparty_members_user
  ON public.counterparty_members (user_id);

-- ── 2) fn_folder_access : ajoute l'accès hérité de la contrepartie ───
-- (identique à la migration 13, + LEFT JOIN counterparty_members ;
--  éditeur l'emporte sur lecteur entre les deux sources de partage.)
CREATE OR REPLACE FUNCTION public.fn_folder_access(p_folder_id uuid)
RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT CASE
    WHEN ou.role IS NULL THEN NULL                     -- pas membre actif de l'org
    WHEN ou.role IN ('owner','admin') THEN 'owner'     -- supervision admin
    WHEN r.created_by = auth.uid() THEN 'owner'        -- créateur = propriétaire
    WHEN fm.role = 'editor' OR cm.role = 'editor' THEN 'editor'  -- partage dossier OU contrepartie
    WHEN fm.role = 'viewer' OR cm.role = 'viewer' THEN 'viewer'
    WHEN r.visibility = 'org' AND ou.role IN ('lawyer','member') THEN 'editor'
    WHEN r.visibility = 'org' THEN 'viewer'            -- rôle reader
    ELSE NULL
  END
  FROM folders r
  LEFT JOIN organization_users ou
    ON ou.organization_id = r.organization_id
   AND ou.user_id = auth.uid()
   AND ou.is_active = true
  LEFT JOIN folder_members fm
    ON fm.folder_id = r.id AND fm.user_id = auth.uid()
  LEFT JOIN counterparty_members cm
    ON cm.counterparty_id = r.counterparty_id AND cm.user_id = auth.uid()
  WHERE r.id = public.fn_folder_root_id(p_folder_id);
$$;

-- ── 3) fn_document_access : un document SANS dossier mais rattaché à une
--    contrepartie partagée devient accessible aussi (cohérence). Les docs
--    en dossier passent déjà par fn_folder_access ci-dessus.
CREATE OR REPLACE FUNCTION public.fn_document_access(p_document_id uuid)
RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT CASE
    WHEN x.org_role IS NULL THEN NULL
    WHEN x.org_role IN ('owner','admin') THEN 'owner'
    WHEN d.folder_id IS NOT NULL THEN public.fn_folder_access(d.folder_id)
    WHEN d.uploaded_by = auth.uid() THEN
      CASE WHEN x.org_role = 'reader' THEN 'viewer' ELSE 'owner' END
    WHEN cm.role IS NOT NULL THEN cm.role          -- doc libre d'une contrepartie partagée
    WHEN d.uploaded_by IS NULL THEN
      CASE WHEN x.org_role = 'reader' THEN 'viewer' ELSE 'editor' END
    ELSE NULL
  END
  FROM documents d
  CROSS JOIN LATERAL (SELECT public.fn_user_role(d.organization_id) AS org_role) x
  LEFT JOIN counterparty_members cm
    ON cm.counterparty_id = d.counterparty_id AND cm.user_id = auth.uid()
  WHERE d.id = p_document_id;
$$;

-- ── 4) Contrepartie visible dès qu'elle m'est partagée (même sans dossier) ─
DROP POLICY IF EXISTS counterparties_select ON public.counterparties;
CREATE POLICY counterparties_select ON public.counterparties
FOR SELECT USING (
  organization_id IN (SELECT public.fn_user_organization_ids())
  AND (
    created_by = auth.uid()
    OR public.fn_is_org_admin(organization_id)
    OR EXISTS (
      SELECT 1 FROM public.counterparty_members cm
      WHERE cm.counterparty_id = counterparties.id AND cm.user_id = auth.uid()
    )
    OR EXISTS (
      SELECT 1 FROM public.folders f
      WHERE f.counterparty_id = counterparties.id
        AND public.fn_folder_access(f.id) IS NOT NULL
    )
  )
);

-- ── 5) Qui peut partager une contrepartie : son créateur ou l'admin,
--    vers un membre actif de la même organisation. ─────────────────────
CREATE OR REPLACE FUNCTION public.fn_can_share_counterparty(p_cp_id uuid, p_target_user uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (
      SELECT 1 FROM counterparties c
      WHERE c.id = p_cp_id
        AND (c.created_by = auth.uid() OR public.fn_is_org_admin(c.organization_id))
    )
    AND EXISTS (
      SELECT 1 FROM counterparties c
      JOIN organization_users ou ON ou.organization_id = c.organization_id
      WHERE c.id = p_cp_id AND ou.user_id = p_target_user AND ou.is_active = true
    );
$$;

CREATE OR REPLACE FUNCTION public.fn_counterparty_is_manager(p_cp_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM counterparties c
    WHERE c.id = p_cp_id
      AND (c.created_by = auth.uid() OR public.fn_is_org_admin(c.organization_id))
  );
$$;

-- ── 6) RLS de counterparty_members ───────────────────────────────────
ALTER TABLE public.counterparty_members ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS cp_members_select ON public.counterparty_members;
DROP POLICY IF EXISTS cp_members_insert ON public.counterparty_members;
DROP POLICY IF EXISTS cp_members_update ON public.counterparty_members;
DROP POLICY IF EXISTS cp_members_delete ON public.counterparty_members;

CREATE POLICY cp_members_select ON public.counterparty_members
FOR SELECT USING (
  user_id = auth.uid() OR public.fn_counterparty_is_manager(counterparty_id)
);

CREATE POLICY cp_members_insert ON public.counterparty_members
FOR INSERT WITH CHECK (
  public.fn_can_share_counterparty(counterparty_id, user_id)
  AND granted_by = auth.uid()
  AND user_id <> auth.uid()
);

CREATE POLICY cp_members_update ON public.counterparty_members
FOR UPDATE
USING  (public.fn_counterparty_is_manager(counterparty_id))
WITH CHECK (public.fn_can_share_counterparty(counterparty_id, user_id));

CREATE POLICY cp_members_delete ON public.counterparty_members
FOR DELETE USING (
  public.fn_counterparty_is_manager(counterparty_id) OR user_id = auth.uid()
);

-- ── 7) Notification du destinataire (réutilise la table notifications) ─
CREATE OR REPLACE FUNCTION public.fn_notify_counterparty_share()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_cp record;
  v_target uuid;
  v_role text;
  v_type text;
BEGIN
  IF TG_OP = 'INSERT' THEN
    v_target := NEW.user_id; v_role := NEW.role; v_type := 'counterparty_shared';
  ELSIF TG_OP = 'UPDATE' THEN
    IF NEW.role IS NOT DISTINCT FROM OLD.role THEN RETURN NEW; END IF;
    v_target := NEW.user_id; v_role := NEW.role; v_type := 'counterparty_role_changed';
  ELSE
    v_target := OLD.user_id; v_role := OLD.role; v_type := 'counterparty_revoked';
  END IF;

  SELECT id, name, organization_id INTO v_cp
  FROM counterparties WHERE id = COALESCE(NEW.counterparty_id, OLD.counterparty_id);
  IF v_cp.id IS NULL THEN RETURN COALESCE(NEW, OLD); END IF;

  IF v_target IS DISTINCT FROM auth.uid() THEN
    INSERT INTO notifications (organization_id, user_id, type, payload)
    VALUES (v_cp.organization_id, v_target, v_type,
            jsonb_build_object('counterparty_id', v_cp.id, 'counterparty_name', v_cp.name,
                               'by', auth.uid(), 'role', v_role));
  END IF;
  RETURN COALESCE(NEW, OLD);
END $$;

DROP TRIGGER IF EXISTS trg_counterparty_members_notify ON public.counterparty_members;
CREATE TRIGGER trg_counterparty_members_notify
AFTER INSERT OR UPDATE OR DELETE ON public.counterparty_members
FOR EACH ROW EXECUTE FUNCTION public.fn_notify_counterparty_share();
