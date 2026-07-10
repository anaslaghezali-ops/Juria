-- Data fix : doublon d'organisation créé au signup de cabinet@cabinet.com
--
-- Cause : l'email invité était stocké en minuscules mais le claim de
-- link-user-to-org comparait en sensible à la casse ; le clavier iPhone a
-- capitalisé l'email au signup → claim raté → le chemin "signup organique"
-- (supprimé depuis) a créé une org trial en doublon (slug cabinet-7a94142e)
-- au lieu de rattacher le compte à "Cabinet 1".
--
-- Ce script est idempotent et défensif : il ne supprime l'org en doublon
-- que si elle ne contient aucun document.

do $$
declare
  v_user uuid;
  v_dup_org uuid;
begin
  select id into v_user from auth.users where lower(email) = 'cabinet@cabinet.com';
  if v_user is null then
    raise notice 'cabinet@cabinet.com introuvable dans auth.users — rien à faire';
    return;
  end if;

  -- L'org en doublon, identifiée par son slug exact (cf. back-office),
  -- uniquement si elle est vide de documents.
  select o.id into v_dup_org
  from organizations o
  where o.slug = 'cabinet-7a94142e'
    and not exists (select 1 from documents d where d.organization_id = o.id);

  -- 1. Réclamer l'invitation en attente dans "Cabinet 1"
  update organization_users
     set user_id = v_user,
         email   = 'cabinet@cabinet.com'
   where lower(email) = 'cabinet@cabinet.com'
     and user_id is null;

  -- 2. Supprimer l'adhésion et l'organisation en doublon
  if v_dup_org is not null then
    delete from organization_users where organization_id = v_dup_org;
    delete from organizations where id = v_dup_org;
    raise notice 'Org en doublon % supprimée', v_dup_org;
  else
    raise notice 'Org en doublon absente ou non vide — non supprimée';
  end if;
end $$;

-- Hygiène : normaliser en minuscules les emails des invitations en attente
-- (les nouvelles écritures sont désormais normalisées à la source).
update organization_users
   set email = lower(email)
 where user_id is null
   and email is not null
   and email <> lower(email);
