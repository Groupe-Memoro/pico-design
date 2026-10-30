-- Thème en plusieurs parties (cartes de souhait et autres produits pliés) :
-- par planche, une partie pour le recto et/ou le verso ; par volet, une
-- partie pour n'importe quels volets (« front:1 » = recto, 2e volet). Chaque
-- partie a son graphisme, son fond, ses emplacements, ses zones de texte et
-- ses repères (voir lib/themeParts.ts) :
--   [{ key, overlay_path, background_path, overlay_fit, slots, text_zones, guides }]
-- Vide = thème d'avant, d'une seule partie (le recto) : les colonnes
-- overlay_path, slots, text_zones… La première partie y est aussi recopiée.
-- À exécuter dans Supabase : Dashboard > SQL Editor > coller ce fichier > Run

alter table public.themes add column if not exists parts jsonb not null default '[]'::jsonb;
