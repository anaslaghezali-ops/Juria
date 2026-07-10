-- DIAGNOSTIC (lecture seule) — org_id des user_metadata vs appartenances réelles.
select 'a_meta' as bloc,
       u.email as info1,
       coalesce(u.raw_user_meta_data->>'org_id', 'ABSENT') as info2,
       case
         when u.raw_user_meta_data->>'org_id' is null then '-'
         when exists (select 1 from organization_users ou
                      where ou.user_id = u.id
                        and ou.organization_id = (u.raw_user_meta_data->>'org_id')::uuid
                        and ou.is_active) then 'membre actif de cette org'
         when exists (select 1 from organizations o where o.id = (u.raw_user_meta_data->>'org_id')::uuid)
           then 'ORG EXISTE MAIS PAS MEMBRE'
         else 'ORG INEXISTANTE (purgée ?)'
       end as info3
from auth.users u
union all
select 'b_org_policies',
       p.tablename || '.' || p.policyname,
       'cmd=' || p.cmd,
       left(regexp_replace(coalesce(p.qual, '-'), '\s+', ' ', 'g'), 240)
from pg_policies p
where p.schemaname = 'public' and p.tablename = 'organizations'
order by 1, 2;
