-- Module "Albums des finissants" : l'équipe monte l'album d'une école à
-- partir de la liste des élèves et de leurs photos, puis en tire un PDF
-- multipage pour l'imprimeur (voir lib/albums/).
--   * albums        : l'album, son format (mm, fond perdu) et son style
--                     (settings : grille des portraits, polices, couleurs…) ;
--   * album_students: les finissants (nom, groupe, photo) ;
--   * album_pages   : les blocs de l'album, dans l'ordre (position). Un bloc
--                     « portraits » se déploie en autant de pages qu'il faut ;
--                     les autres (couverture, page libre, signatures) ont leur
--                     contenu dans `content`.
-- Les photos vivent dans le bucket privé "albums", sous albums/<id>/ : une
-- version d'impression (réduite par le navigateur avant l'envoi) et une
-- vignette pour l'écran. Le PDF généré y est rangé aussi.
-- À exécuter dans Supabase : Dashboard > SQL Editor > coller ce fichier > Run

create table if not exists public.albums (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  school text not null default '',
  year text not null default '',
  width_mm numeric not null default 215.9,
  height_mm numeric not null default 279.4,
  bleed_mm numeric not null default 3.175,
  settings jsonb not null default '{}'::jsonb,
  pdf_path text,
  pdf_generated_at timestamptz,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.album_students (
  id uuid primary key default gen_random_uuid(),
  album_id uuid not null references public.albums(id) on delete cascade,
  first_name text not null default '',
  last_name text not null default '',
  group_name text not null default '',
  photo_path text,
  thumb_path text,
  created_at timestamptz not null default now()
);

create index if not exists album_students_album_idx on public.album_students (album_id);

create table if not exists public.album_pages (
  id uuid primary key default gen_random_uuid(),
  album_id uuid not null references public.albums(id) on delete cascade,
  position integer not null default 0,
  kind text not null check (kind in ('cover', 'portraits', 'free', 'signatures')),
  content jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists album_pages_album_idx on public.album_pages (album_id, position);

alter table public.albums enable row level security;
alter table public.album_students enable row level security;
alter table public.album_pages enable row level security;

drop policy if exists "Les employés gèrent les albums" on public.albums;
create policy "Les employés gèrent les albums" on public.albums
  for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');
drop policy if exists "Les employés gèrent les finissants" on public.album_students;
create policy "Les employés gèrent les finissants" on public.album_students
  for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');
drop policy if exists "Les employés gèrent les pages d'album" on public.album_pages;
create policy "Les employés gèrent les pages d'album" on public.album_pages
  for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');

-- Bucket privé, sans policy : on y écrit par adresse signée (envoi direct du
-- navigateur, Vercel refusant les requêtes de plus de 4,5 Mo) et on y lit par
-- la clé de service ou par adresse signée.
insert into storage.buckets (id, name, public)
values ('albums', 'albums', false)
on conflict (id) do nothing;
