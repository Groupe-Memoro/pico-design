-- Gabarits à données variables : un produit bâti sur un modèle existant
-- (format, fond perdu), dont le graphiste fournit le fond, et où Pico Design
-- pose pour chaque ligne d'un fichier (Excel ou CSV) des textes, une photo et
-- un code-barres — comme les cartes étudiantes (0079), pour tout format.
-- Le résultat : un PDF d'une page par ligne (recto, verso à la suite), au
-- format du modèle fond perdu compris, prêt à imposer.
--   * template_id     : le modèle (format et fond perdu repris à chaque rendu) ;
--   * two_sided       : le gabarit a un verso ;
--   * front_path / back_path : fonds (PDF, PNG ou JPEG), fond perdu compris ;
--   * zones           : en mm depuis le coin haut-gauche de la page, fond
--                       perdu compris (voir lib/studentCards/types.ts) ;
--   * sample, photo_column : comme les cartes étudiantes.
-- Fichiers dans le bucket privé "data-templates", sous <id>/.
-- À exécuter dans Supabase : Dashboard > SQL Editor > coller ce fichier > Run

create table if not exists public.data_templates (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  template_id uuid not null references public.templates(id) on delete cascade,
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

create index if not exists data_templates_template_id_idx on public.data_templates(template_id);

alter table public.data_templates enable row level security;

drop policy if exists "Les employés gèrent les gabarits à données" on public.data_templates;
create policy "Les employés gèrent les gabarits à données" on public.data_templates
  for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');

insert into storage.buckets (id, name, public)
values ('data-templates', 'data-templates', false)
on conflict (id) do nothing;

drop policy if exists "Employés lisent/écrivent data-templates" on storage.objects;
create policy "Employés lisent/écrivent data-templates" on storage.objects
  for all using (bucket_id = 'data-templates' and auth.role() = 'authenticated')
  with check (bucket_id = 'data-templates' and auth.role() = 'authenticated');
