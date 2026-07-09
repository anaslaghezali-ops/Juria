-- Quota System v2: Global org budget + credit-based operations
-- Phase 1: Infrastructure
--
-- NB : organizations.id est un UUID (cf. 05_synthesis_memo_foundation.sql).
-- Le lien user → org passe par organization_users (PAS de table users).

-- 1. Add monthly_quota to organizations
alter table organizations add column if not exists monthly_quota int default 1000;
comment on column organizations.monthly_quota is 'Monthly credit budget for this organization. -1 = unlimited.';

-- 2. Table: operation_costs (define cost per operation type)
create table if not exists operation_costs (
  id bigint primary key generated always as identity,
  operation_type text not null unique,
  base_cost float not null default 1.0,
  description text,
  created_at timestamp with time zone default now(),
  updated_at timestamp with time zone default now()
);
comment on table operation_costs is 'Cost per operation type (synthesis, risk_analysis, doc_comparison, chat)';

-- Insert default costs
insert into operation_costs (operation_type, base_cost, description)
values
  ('synthesis', 1.0, 'Full synthesis (extract + compose)'),
  ('risk_analysis', 0.5, 'Single risk analysis run'),
  ('doc_comparison', 0.5, 'Document comparison'),
  ('chat', 0.1, 'Single AI chat message')
on conflict (operation_type) do nothing;

-- 3. Table: organization_usage (centralized log of credit consumption)
create table if not exists organization_usage (
  id bigint primary key generated always as identity,
  org_id uuid not null references organizations(id) on delete cascade,
  month date not null,  -- First day of month for grouping
  operation_type text not null references operation_costs(operation_type),
  count int not null default 1,
  cost_per_unit float not null,
  total_cost float not null,
  description text,
  created_at timestamp with time zone default now(),
  constraint unique_org_month_type unique (org_id, month, operation_type)
);
comment on table organization_usage is 'Monthly usage log: tracks credits consumed per org per operation type';
create index if not exists idx_organization_usage_org_month on organization_usage (org_id, month);

-- 4. Atomic increment: one row per (org, month, operation_type), counters
--    incremented — jamais écrasés — même sous appels concurrents.
create or replace function log_org_usage(
  p_org_id uuid,
  p_operation_type text,
  p_quantity int default 1,
  p_description text default null
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cost float;
begin
  select base_cost into v_cost from operation_costs where operation_type = p_operation_type;
  if v_cost is null then
    raise exception 'Unknown operation type: %', p_operation_type;
  end if;

  insert into organization_usage (org_id, month, operation_type, count, cost_per_unit, total_cost, description)
  values (
    p_org_id,
    date_trunc('month', now())::date,
    p_operation_type,
    p_quantity,
    v_cost,
    v_cost * p_quantity,
    p_description
  )
  on conflict (org_id, month, operation_type) do update
    set count = organization_usage.count + excluded.count,
        total_cost = organization_usage.total_cost + excluded.total_cost,
        cost_per_unit = excluded.cost_per_unit;
end;
$$;

-- Réservée aux edge functions (service role) : jamais appelable côté client.
revoke execute on function log_org_usage(uuid, text, int, text) from public, anon, authenticated;

-- 5. RLS
alter table operation_costs enable row level security;
alter table organization_usage enable row level security;

-- Coûts unitaires : lecture publique authentifiée (référentiel)
drop policy if exists "operation_costs_select_authenticated" on operation_costs;
create policy "operation_costs_select_authenticated" on operation_costs
  for select
  using (auth.role() = 'authenticated');

-- Usage : chaque membre actif voit la consommation de SON organisation
drop policy if exists "organization_usage_select_own_org" on organization_usage;
create policy "organization_usage_select_own_org" on organization_usage
  for select
  using (
    org_id in (
      select organization_id from organization_users
      where user_id = auth.uid() and is_active = true
    )
  );

-- Écriture : uniquement le service role (edge functions), via log_org_usage.
-- Pas de policy insert/update pour anon/authenticated : le service role
-- bypasse RLS par construction.
