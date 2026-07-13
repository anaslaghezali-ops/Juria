-- DIAGNOSTIC (lecture seule) — état du quota pour l'utilisateur anaslaghezali@gmail.com.
-- Objectif : confirmer si l'erreur 429 à l'analyse = quota mensuel atteint.
with u as (
  select id, email from auth.users where email = 'anaslaghezali@gmail.com'
),
orgs as (
  select ou.organization_id, o.name, o.monthly_quota
  from public.organization_users ou
  join public.organizations o on o.id = ou.organization_id
  join u on u.id = ou.user_id
  where ou.is_active = true
),
usage as (
  select org_id, sum(total_cost) as used_this_month
  from public.organization_usage
  where month = date_trunc('month', now())::date
  group by org_id
)
select 'quota_state' as bloc,
       orgs.name,
       orgs.organization_id,
       orgs.monthly_quota,
       coalesce(usage.used_this_month, 0) as used_this_month,
       case when orgs.monthly_quota = -1 then 'ILLIMITÉ'
            else (orgs.monthly_quota - coalesce(usage.used_this_month,0))::text end as remaining,
       (select base_cost from public.operation_costs where operation_type = 'risk_analysis') as cost_par_fenetre
from orgs
left join usage on usage.org_id = orgs.organization_id;
