-- Quota de stockage par organisation (variable payante, gérée au superadmin)
--
-- - organizations.max_storage_mb : plafond en Mo (défaut 500, -1 = illimité)
-- - fn_org_storage_bytes(org)    : octets consommés (somme documents.file_size),
--   appelable par un membre actif de l'org, un superadmin, ou le service role
-- - trigger sur documents        : refuse l'INSERT au-delà du plafond
--   (enforcement serveur, non contournable par le client)
--
-- Idempotente : IF NOT EXISTS / OR REPLACE / DROP TRIGGER IF EXISTS.

-- 1. Plafond de stockage
alter table organizations add column if not exists max_storage_mb int default 500;
comment on column organizations.max_storage_mb is
  'Stockage maximal en Mo pour cette organisation. -1 = illimité.';

-- 2. Consommation (source de vérité : documents.file_size)
create or replace function fn_org_storage_bytes(p_org_id uuid)
returns bigint
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  -- Service role : auth.uid() est null → autorisé (edge functions).
  -- Utilisateur authentifié : membre actif de l'org OU superadmin.
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
    select coalesce(sum(file_size), 0)::bigint
    from documents
    where organization_id = p_org_id
  );
end;
$$;

revoke execute on function fn_org_storage_bytes(uuid) from public, anon;
grant execute on function fn_org_storage_bytes(uuid) to authenticated, service_role;

-- 3. Enforcement : refuse l'insertion d'un document au-delà du plafond
create or replace function fn_enforce_org_storage_quota()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_max_mb int;
  v_used bigint;
begin
  select max_storage_mb into v_max_mb
  from organizations
  where id = new.organization_id;

  -- Pas de plafond défini ou illimité : laisser passer.
  if v_max_mb is null or v_max_mb = -1 then
    return new;
  end if;

  select coalesce(sum(file_size), 0) into v_used
  from documents
  where organization_id = new.organization_id;

  if v_used + coalesce(new.file_size, 0) > v_max_mb::bigint * 1024 * 1024 then
    raise exception 'STORAGE_QUOTA_EXCEEDED: stockage maximal de % Mo atteint pour cette organisation. Contactez Juria pour augmenter votre espace.', v_max_mb;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_enforce_org_storage_quota on documents;
create trigger trg_enforce_org_storage_quota
  before insert on documents
  for each row
  execute function fn_enforce_org_storage_quota();
