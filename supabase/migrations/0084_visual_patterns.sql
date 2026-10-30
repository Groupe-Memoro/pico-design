-- Motif répétable : le visuel est conçu pour se répéter sans raccord visible
-- (mosaïque). Repérable dans la banque de visuels (badge, filtre) et proposé
-- en premier quand un produit utilise le mode « Visuel — mosaïque ».
-- À exécuter dans Supabase : Dashboard > SQL Editor > coller ce fichier > Run

alter table public.visuals add column if not exists is_pattern boolean not null default false;
