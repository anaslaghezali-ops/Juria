-- Quota System v2: Global org budget + credit-based operations
-- Phase 1: Infrastructure

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
  org_id bigint not null references organizations(id) on delete cascade,
  month date not null,  -- First day of month for grouping
  operation_type text not null references operation_costs(operation_type),
  count int not null default 1,
  cost_per_unit float not null,
  total_cost float not null,
  description text,  -- Optional: doc_id, user_id, etc for audit trail
  created_at timestamp with time zone default now(),
  constraint unique_org_month_type unique (org_id, month, operation_type)
);
comment on table organization_usage is 'Monthly usage log: tracks credits consumed per org per operation type';
create index if not exists idx_organization_usage_org_month on organization_usage (org_id, month);

-- 4. Enable RLS on new tables
alter table operation_costs enable row level security;
alter table organization_usage enable row level security;

-- Allow authenticated users to read operation_costs (public reference)
create policy "operation_costs_select_authenticated" on operation_costs
  for select
  using (auth.role() = 'authenticated');

-- Allow authenticated users to read their org's usage
create policy "organization_usage_select_own_org" on organization_usage
  for select
  using (
    org_id in (
      select id from organizations
      where id = (select organization_id from users where id = auth.uid())
    )
  );

-- Allow service role to insert usage logs (from edge functions)
create policy "organization_usage_insert_service" on organization_usage
  for insert
  with check (auth.role() = 'service_role');

-- Allow service role to update usage logs
create policy "organization_usage_update_service" on organization_usage
  for update
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');
