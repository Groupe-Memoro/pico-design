-- Cadrage du graphisme et du fond d'un thème sur la page (fond perdu compris).
-- 'fill' : étirés à la page (l'ancien comportement, gardé pour les thèmes
-- existants, dont les emplacements ont été placés sur le graphisme étiré).
-- 'cover' : agrandis sans déformation et recadrés au centre ; tout nouveau
-- thème, et tout thème dont on remplace le graphisme, passe en 'cover'.
-- À exécuter dans Supabase : Dashboard > SQL Editor > coller ce fichier > Run

alter table public.themes add column if not exists overlay_fit text not null default 'fill'
  check (overlay_fit in ('fill', 'cover'));
