-- Profils d'imposition : la façon d'imposer un modèle (feuille, machine, job(s)
-- Duplo ou profil Graphtec, sens des pièces, retournement), choisie dans la
-- fiche du modèle. La mise en production d'une ou plusieurs commandes regroupe
-- leurs designs par profil et fabrique le PDF imposé directement.
-- À exécuter dans Supabase : Dashboard > SQL Editor > coller ce fichier > Run

create table if not exists public.imposition_profiles (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  sheet_id uuid not null references public.imposition_sheets(id),
  machine text not null check (machine in ('duplo', 'graphtec')),
  duplo_job_id uuid references public.imposition_duplo_jobs(id) on delete set null,
  -- 2e passe sur la Duplo (morceaux recoupés), et sens du quart de tour.
  duplo_job2_id uuid references public.imposition_duplo_jobs(id) on delete set null,
  duplo_job2_turn text not null default 'cw' check (duplo_job2_turn in ('cw', 'ccw')),
  cutter_id uuid references public.imposition_cutters(id) on delete set null,
  orientation text not null default 'auto' check (orientation in ('auto', 'normal', 'rotated')),
  flip text not null default 'long' check (flip in ('long', 'short')),
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now()
);

alter table public.imposition_profiles enable row level security;

create policy "Les employés lisent les profils d'imposition" on public.imposition_profiles
  for select using (auth.role() = 'authenticated');
create policy "Les employés créent des profils d'imposition" on public.imposition_profiles
  for insert with check (auth.role() = 'authenticated');
create policy "Les employés modifient des profils d'imposition" on public.imposition_profiles
  for update using (auth.role() = 'authenticated');
create policy "Les employés suppriment des profils d'imposition" on public.imposition_profiles
  for delete using (auth.role() = 'authenticated');

-- Le profil de chaque modèle (facultatif).
alter table public.templates
  add column if not exists imposition_profile_id uuid references public.imposition_profiles(id) on delete set null;

-- Mises en production : les commandes regroupées et les PDF imposés produits
-- (un par profil et par modèle), dans le bucket « outputs ».
create table if not exists public.production_batches (
  id uuid primary key default gen_random_uuid(),
  order_ids uuid[] not null,
  -- [{ name, path, sheets, pieces }]
  files jsonb not null default '[]'::jsonb,
  -- Articles laissés de côté (sans profil, sans design…), pour les signaler.
  skipped jsonb not null default '[]'::jsonb,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now()
);

create index if not exists production_batches_orders_idx on public.production_batches using gin (order_ids);

alter table public.production_batches enable row level security;

create policy "Les employés lisent les mises en production" on public.production_batches
  for select using (auth.role() = 'authenticated');
create policy "Les employés créent des mises en production" on public.production_batches
  for insert with check (auth.role() = 'authenticated');
