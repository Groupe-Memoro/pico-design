-- Module « Cartes étudiantes » (Scolaire) : un modèle de carte par école.
-- Le graphiste fournit le fond de la carte (recto, et verso s'il y en a un) ;
-- Pico Design y pose, pour chaque ligne d'un fichier CSV, les textes, la photo
-- de l'élève et un code-barres, dans des zones dessinées sur le modèle. Le
-- résultat est un PDF d'une carte par page (CR80 par défaut), pour une
-- imprimante à cartes PVC.
--   * school          : école du modèle (regroupe la liste) ;
--   * width_mm / height_mm : format de la carte ;
--   * two_sided       : la carte a un verso (pages recto, verso, recto…) ;
--   * front_path / back_path : fonds de la carte (PDF, PNG ou JPEG) ;
--   * zones           : zones de texte, de photo et de code-barres, en mm
--                       depuis le coin haut-gauche (voir lib/studentCards/types.ts) ;
--   * sample          : colonnes et une ligne du dernier CSV, pour l'aperçu ;
--   * photo_column    : colonne du CSV qui désigne la photo de l'élève.
-- Fichiers dans le bucket privé "student-cards", sous <id>/. Les photos des
-- élèves n'y sont jamais enregistrées : elles ne servent qu'au rendu.
-- À exécuter dans Supabase : Dashboard > SQL Editor > coller ce fichier > Run

create table if not exists public.student_card_templates (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  school text not null default '',
  width_mm numeric not null default 85.6 check (width_mm > 0 and width_mm <= 300),
  height_mm numeric not null default 54 check (height_mm > 0 and height_mm <= 300),
  two_sided boolean not null default false,
  front_path text,
  back_path text,
  zones jsonb not null default '[]'::jsonb,
  sample jsonb,
  photo_column text,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.student_card_templates enable row level security;

drop policy if exists "Les employés gèrent les modèles de cartes étudiantes" on public.student_card_templates;
create policy "Les employés gèrent les modèles de cartes étudiantes" on public.student_card_templates
  for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');

insert into storage.buckets (id, name, public)
values ('student-cards', 'student-cards', false)
on conflict (id) do nothing;

drop policy if exists "Employés lisent/écrivent student-cards" on storage.objects;
create policy "Employés lisent/écrivent student-cards" on storage.objects
  for all using (bucket_id = 'student-cards' and auth.role() = 'authenticated')
  with check (bucket_id = 'student-cards' and auth.role() = 'authenticated');
