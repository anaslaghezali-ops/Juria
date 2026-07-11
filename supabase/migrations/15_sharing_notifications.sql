-- 15_sharing_notifications.sql — Partage de dossiers, Phase 3 :
-- notifications in-app + journal des accès.
--
-- Principe : les écritures passent par des TRIGGERS SECURITY DEFINER sur
-- folder_members et folders.visibility — le client ne peut ni oublier ni
-- falsifier une notification ou une ligne de journal (aucun droit INSERT
-- direct n'est accordé sur ces deux tables).
--
--   - notifications : boîte personnelle (« X vous a donné accès au dossier
--     Y »). Chacun ne lit / marque lu / supprime que les siennes.
--   - folder_access_log : journal d'audit immuable des accès (invitation,
--     changement de rôle, révocation, changement de visibilité), lisible
--     par le propriétaire du dossier et l'admin d'organisation.
--
-- Idempotente : IF NOT EXISTS / OR REPLACE / DROP … IF EXISTS partout.

-- ═══════════════════════════════════════════════════════════════════
-- 1) TABLES
-- ═══════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.notifications (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  user_id         uuid NOT NULL,               -- destinataire
  type            text NOT NULL,               -- folder_shared | folder_revoked | folder_role_changed
  payload         jsonb NOT NULL DEFAULT '{}', -- { folder_id, folder_name, by, role }
  is_read         boolean NOT NULL DEFAULT false,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_notifications_user_unread
  ON public.notifications (user_id, is_read, created_at DESC);

-- Journal d'audit : pas de FK CASCADE vers folders — le journal survit à la
-- suppression du dossier (folder_name est dénormalisé pour rester lisible).
CREATE TABLE IF NOT EXISTS public.folder_access_log (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  folder_id       uuid NOT NULL,
  folder_name     text,
  organization_id uuid NOT NULL,
  action          text NOT NULL,   -- granted | role_changed | revoked | visibility_changed
  target_user     uuid,            -- l'invité concerné (NULL pour visibility_changed)
  actor           uuid,            -- auteur (NULL si opération service role)
  detail          text,            -- viewer | editor | org | private
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_folder_access_log_folder
  ON public.folder_access_log (folder_id, created_at DESC);

-- Grants : lecture pour tous les connectés (filtrée par RLS) ; le marquage
-- lu / la suppression ne concernent que notifications ; AUCUN INSERT client.
GRANT SELECT, UPDATE, DELETE ON public.notifications TO authenticated;
GRANT SELECT ON public.folder_access_log TO authenticated;

-- ═══════════════════════════════════════════════════════════════════
-- 2) TRIGGERS (SECURITY DEFINER → bypass RLS, seuls points d'écriture)
-- ═══════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.fn_log_folder_share()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_folder_id uuid := COALESCE(NEW.folder_id, OLD.folder_id);
  v_folder    record;
  v_action    text;
  v_target    uuid;
  v_role      text;
  v_notif     text;
BEGIN
  IF TG_OP = 'INSERT' THEN
    v_action := 'granted';      v_target := NEW.user_id; v_role := NEW.role; v_notif := 'folder_shared';
  ELSIF TG_OP = 'UPDATE' THEN
    IF NEW.role IS NOT DISTINCT FROM OLD.role THEN RETURN NEW; END IF;
    v_action := 'role_changed'; v_target := NEW.user_id; v_role := NEW.role; v_notif := 'folder_role_changed';
  ELSE
    v_action := 'revoked';      v_target := OLD.user_id; v_role := OLD.role; v_notif := 'folder_revoked';
  END IF;

  SELECT id, name, organization_id INTO v_folder FROM folders WHERE id = v_folder_id;
  -- Dossier en cours de suppression (cascade) : rien à journaliser.
  IF v_folder.id IS NULL THEN RETURN COALESCE(NEW, OLD); END IF;

  INSERT INTO folder_access_log (folder_id, folder_name, organization_id, action, target_user, actor, detail)
  VALUES (v_folder.id, v_folder.name, v_folder.organization_id, v_action, v_target, auth.uid(), v_role);

  -- Notifier l'intéressé (sauf s'il est l'auteur : se retirer soi-même).
  IF v_target IS DISTINCT FROM auth.uid() THEN
    INSERT INTO notifications (organization_id, user_id, type, payload)
    VALUES (
      v_folder.organization_id, v_target, v_notif,
      jsonb_build_object('folder_id', v_folder.id, 'folder_name', v_folder.name,
                         'by', auth.uid(), 'role', v_role)
    );
  END IF;

  RETURN COALESCE(NEW, OLD);
END $$;

DROP TRIGGER IF EXISTS trg_folder_members_log ON public.folder_members;
CREATE TRIGGER trg_folder_members_log
AFTER INSERT OR UPDATE OR DELETE ON public.folder_members
FOR EACH ROW EXECUTE FUNCTION public.fn_log_folder_share();

CREATE OR REPLACE FUNCTION public.fn_log_folder_visibility()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF NEW.visibility IS DISTINCT FROM OLD.visibility THEN
    INSERT INTO folder_access_log (folder_id, folder_name, organization_id, action, target_user, actor, detail)
    VALUES (NEW.id, NEW.name, NEW.organization_id, 'visibility_changed', NULL, auth.uid(), NEW.visibility);
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_folders_visibility_log ON public.folders;
CREATE TRIGGER trg_folders_visibility_log
AFTER UPDATE ON public.folders
FOR EACH ROW EXECUTE FUNCTION public.fn_log_folder_visibility();

-- ═══════════════════════════════════════════════════════════════════
-- 3) RLS
-- ═══════════════════════════════════════════════════════════════════

ALTER TABLE public.notifications     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.folder_access_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS notifications_select ON public.notifications;
DROP POLICY IF EXISTS notifications_update ON public.notifications;
DROP POLICY IF EXISTS notifications_delete ON public.notifications;

CREATE POLICY notifications_select ON public.notifications
FOR SELECT USING (user_id = auth.uid());

CREATE POLICY notifications_update ON public.notifications
FOR UPDATE USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

CREATE POLICY notifications_delete ON public.notifications
FOR DELETE USING (user_id = auth.uid());

-- Journal : propriétaire du dossier ou admin d'org. Un dossier supprimé
-- (fn_folder_access → NULL) reste lisible par l'admin.
DROP POLICY IF EXISTS folder_access_log_select ON public.folder_access_log;

CREATE POLICY folder_access_log_select ON public.folder_access_log
FOR SELECT USING (
  public.fn_is_org_admin(organization_id)
  OR public.fn_folder_access(folder_id) = 'owner'
);
