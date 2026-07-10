-- DIAGNOSTIC (lecture seule) — que renvoie la vue legacy user_profiles_compat ?
-- (documents.html s'en servait comme source d'organization_id : si elle
-- diverge d'organization_users, c'est la cause racine du 42501 à l'upload.)
select 'a_compat' as bloc,
       coalesce(u.email, p.id::text) as info1,
       coalesce(p.organization_id::text, 'NULL') as info2,
       case
         when p.organization_id is null then '-'
         when exists (select 1 from organization_users ou
                      where ou.user_id = p.id
                        and ou.organization_id = p.organization_id
                        and ou.is_active) then 'COHÉRENT avec organization_users'
         else 'DIVERGENT — org où l''utilisateur n''est PAS membre actif'
       end as info3
from public.user_profiles_compat p
left join auth.users u on u.id = p.id
order by 1, 2;
