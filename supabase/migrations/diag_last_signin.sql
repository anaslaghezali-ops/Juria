-- DIAGNOSTIC (lecture seule) — quel compte teste actuellement ?
select 'a_signin' as bloc,
       u.email as info1,
       coalesce(u.last_sign_in_at::text, 'jamais') as info2,
       case when exists (select 1 from organization_users ou where ou.user_id = u.id and ou.is_active)
            then 'a une org active' else 'AUCUNE ORG — mode démo + 42501 garanti' end as info3
from auth.users u
order by u.last_sign_in_at desc nulls last;
