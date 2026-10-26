-- Repères placés dans l'éditeur des thèmes : lignes verticales et
-- horizontales, en mm depuis le coin haut-gauche de la page, fond perdu
-- compris (voir lib/variableData/snap.ts). Les emplacements photo et les
-- zones de texte s'y aimantent. Jamais imprimés.
-- À exécuter dans Supabase : Dashboard > SQL Editor > coller ce fichier > Run

alter table public.themes add column if not exists guides jsonb not null default '[]'::jsonb;
