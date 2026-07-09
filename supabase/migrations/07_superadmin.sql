-- Superadmin : back-office fondateur (gestion des organisations clientes)
--
-- Le superadmin n'est PAS un rôle d'organisation : c'est un accès plateforme,
-- porté par une table dédiée. La vérification d'autorité se fait côté
-- serveur (edge function superadmin) via service role — la RLS ci-dessous ne
-- sert qu'à laisser un client vérifier SON PROPRE statut (affichage du lien).

create table if not exists superadmins (
  user_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamp with time zone default now()
);
comment on table superadmins is 'Comptes plateforme autorisés au back-office superadmin.';

alter table superadmins enable row level security;

-- Chacun peut uniquement savoir s'il est lui-même superadmin.
drop policy if exists "superadmins_select_self" on superadmins;
create policy "superadmins_select_self" on superadmins
  for select
  using (user_id = auth.uid());

-- Seed : le compte fondateur.
insert into superadmins (user_id)
select id from auth.users where email = 'anaslaghezali@gmail.com'
on conflict (user_id) do nothing;
