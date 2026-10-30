-- Type de thème : 'sheet' (par planche : un graphisme par face, recto et/ou
-- verso) ou 'panel' (par volet d'un produit plié : un graphisme par volet, sur
-- les volets choisis ; fond perdu retiré côté pli au rendu — voir
-- app/api/design/theme-image). Les parties elles-mêmes : migration 0087.
-- À exécuter dans Supabase : Dashboard > SQL Editor > coller ce fichier > Run

alter table public.themes add column if not exists scope text not null default 'sheet'
  check (scope in ('sheet', 'panel'));
