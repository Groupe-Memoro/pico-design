-- Zones de texte des thèmes : des rectangles où le client écrit son propre
-- texte (nom, date, message…), dans la police, la taille maximale, la couleur
-- et l'alignement choisis par l'équipe (voir lib/themeText.ts). Le texte est
-- posé par-dessus le graphisme du thème (voir lib/pdf/theme.ts).
-- À exécuter dans Supabase : Dashboard > SQL Editor > coller ce fichier > Run

alter table public.themes
  add column if not exists text_zones jsonb not null default '[]'::jsonb;
