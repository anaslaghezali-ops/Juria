-- Suppression complète d'une organisation par le superadmin.
--
-- Purge TOUTES les données de l'org : enfants des documents (analyses,
-- risques, clauses, contenus, résumés…), messages des conversations, puis
-- toute table portant organization_id / org_id, et enfin l'organisation.
-- Générique par introspection (information_schema) : résiste à l'ajout de
-- nouvelles tables tant qu'elles suivent les conventions de nommage.
--
-- Les comptes auth des membres sont supprimés par l'edge function superadmin
-- (API admin), uniquement s'ils n'appartiennent à aucune autre organisation.

create or replace function superadmin_purge_organization(p_org_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  r record;
  parent text;
begin
  if not exists (select 1 from organizations where id = p_org_id) then
    raise exception 'Organisation % introuvable', p_org_id;
  end if;

  -- 1. Enfants des documents de l'org (toute table portant document_id)
  for r in
    select c.table_name
    from information_schema.columns c
    join information_schema.tables t
      on t.table_schema = c.table_schema and t.table_name = c.table_name
    where c.table_schema = 'public'
      and c.column_name = 'document_id'
      and t.table_type = 'BASE TABLE'
      and c.table_name <> 'documents'
  loop
    execute format(
      'delete from %I where document_id in (select id from documents where organization_id = $1)',
      r.table_name
    ) using p_org_id;
  end loop;

  -- 2. Messages des conversations de l'org (tables portant conversation_id,
  --    pour chaque parent plausible portant organization_id)
  foreach parent in array array['conversations', 'chat_conversations'] loop
    if to_regclass('public.' || parent) is not null and exists (
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = parent and column_name = 'organization_id'
    ) then
      for r in
        select c.table_name
        from information_schema.columns c
        join information_schema.tables t
          on t.table_schema = c.table_schema and t.table_name = c.table_name
        where c.table_schema = 'public'
          and c.column_name = 'conversation_id'
          and t.table_type = 'BASE TABLE'
      loop
        execute format(
          'delete from %I where conversation_id in (select id from %I where organization_id = $1)',
          r.table_name, parent
        ) using p_org_id;
      end loop;
    end if;
  end loop;

  -- 3. Toute table portant organization_id (documents inclus, leurs enfants
  --    étant déjà purgés), sauf organizations elle-même
  for r in
    select c.table_name
    from information_schema.columns c
    join information_schema.tables t
      on t.table_schema = c.table_schema and t.table_name = c.table_name
    where c.table_schema = 'public'
      and c.column_name = 'organization_id'
      and t.table_type = 'BASE TABLE'
      and c.table_name <> 'organizations'
  loop
    execute format('delete from %I where organization_id = $1', r.table_name) using p_org_id;
  end loop;

  -- 3bis. Variante org_id (organization_usage)
  for r in
    select c.table_name
    from information_schema.columns c
    join information_schema.tables t
      on t.table_schema = c.table_schema and t.table_name = c.table_name
    where c.table_schema = 'public'
      and c.column_name = 'org_id'
      and t.table_type = 'BASE TABLE'
  loop
    execute format('delete from %I where org_id = $1', r.table_name) using p_org_id;
  end loop;

  -- 4. L'organisation elle-même
  delete from organizations where id = p_org_id;
end;
$$;

-- Réservée au service role (edge function superadmin), jamais côté client.
revoke execute on function superadmin_purge_organization(uuid) from public, anon, authenticated;
