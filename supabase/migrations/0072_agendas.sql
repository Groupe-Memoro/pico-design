-- Module "Agendas scolaires" : l'équipe monte l'agenda d'une école (année
-- scolaire, journées spéciales, pages de calendrier au choix, pages de
-- l'école et des commanditaires), puis en tire un PDF pour l'imprimeur (voir
-- lib/agendas/).
--   * agendas      : l'agenda, son format (mm, fond perdu), ses dates de début
--                    et de fin d'année, son style (settings : polices,
--                    couleurs, marge de reliure, jours de cycle…) ;
--   * agenda_days  : les journées spéciales (congé, journée pédagogique,
--                    férié, examen, événement), une ligne par date ; les jours
--                    de cycle se calculent à partir d'elles ;
--   * agenda_pages : les blocs de l'agenda, dans l'ordre (position). Un bloc
--                    « calendrier » se déploie en autant de pages qu'il faut.
-- Photos, bandeaux et PDF fournis vivent dans le bucket privé "agendas",
-- sous agendas/<id>/ ; le PDF généré y est rangé aussi.
-- À exécuter dans Supabase : Dashboard > SQL Editor > coller ce fichier > Run

create table if not exists public.agendas (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  school text not null default '',
  year_label text not null default '',
  width_mm numeric not null default 215.9,
  height_mm numeric not null default 279.4,
  bleed_mm numeric not null default 3.175,
  start_date date not null,
  end_date date not null,
  settings jsonb not null default '{}'::jsonb,
  pdf_path text,
  pdf_generated_at timestamptz,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (end_date >= start_date)
);

create table if not exists public.agenda_days (
  agenda_id uuid not null references public.agendas(id) on delete cascade,
  day date not null,
  kind text not null check (kind in ('conge', 'pedago', 'ferie', 'examen', 'evenement')),
  label text not null default '',
  primary key (agenda_id, day)
);

create table if not exists public.agenda_pages (
  id uuid primary key default gen_random_uuid(),
  agenda_id uuid not null references public.agendas(id) on delete cascade,
  position integer not null default 0,
  kind text not null check (kind in ('cover', 'calendar', 'info', 'pdf', 'sponsors', 'notes')),
  content jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists agenda_pages_agenda_idx on public.agenda_pages (agenda_id, position);

alter table public.agendas enable row level security;
alter table public.agenda_days enable row level security;
alter table public.agenda_pages enable row level security;

drop policy if exists "Les employés gèrent les agendas" on public.agendas;
create policy "Les employés gèrent les agendas" on public.agendas
  for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');
drop policy if exists "Les employés gèrent les journées d'agenda" on public.agenda_days;
create policy "Les employés gèrent les journées d'agenda" on public.agenda_days
  for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');
drop policy if exists "Les employés gèrent les pages d'agenda" on public.agenda_pages;
create policy "Les employés gèrent les pages d'agenda" on public.agenda_pages
  for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');

-- Bucket privé, sans policy : écriture par adresse signée (envoi direct du
-- navigateur), lecture par la clé de service ou par adresse signée.
insert into storage.buckets (id, name, public)
values ('agendas', 'agendas', false)
on conflict (id) do nothing;
