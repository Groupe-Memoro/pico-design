-- Fichier de données (Excel ou CSV) conservé avec un gabarit à données
-- variables ou un modèle de carte étudiante : enregistré avec le document,
-- il est relu à son ouverture — plus besoin de le redéposer.
--   * data_path     : le fichier, dans le bucket du document (<id>/data.<ext>) ;
--   * data_filename : son nom d'origine, affiché dans l'éditeur.
-- À exécuter dans Supabase : Dashboard > SQL Editor > coller ce fichier > Run

alter table public.data_templates add column if not exists data_path text;
alter table public.data_templates add column if not exists data_filename text;

alter table public.student_card_templates add column if not exists data_path text;
alter table public.student_card_templates add column if not exists data_filename text;

