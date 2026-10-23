-- Repères placés dans l'éditeur des gabarits à données variables et des
-- cartes étudiantes : lignes verticales et horizontales, en mm depuis le coin
-- haut-gauche de la page (voir lib/variableData/snap.ts). Les zones s'y aimantent.
-- À exécuter dans Supabase : Dashboard > SQL Editor > coller ce fichier > Run

alter table public.data_templates add column if not exists guides jsonb not null default '[]'::jsonb;
alter table public.student_card_templates add column if not exists guides jsonb not null default '[]'::jsonb;
