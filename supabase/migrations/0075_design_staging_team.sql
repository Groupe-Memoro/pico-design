-- Dépôt temporaire des fichiers lourds de l'ÉQUIPE (fichiers d'impression
-- grand format : un PNG 30 × 40 po à 300 dpi dépasse 100 Mo). Même principe
-- que design-staging (voir 0069_design_staging.sql), mais réservé aux
-- utilisateurs connectés : app/api/design/stage n'y donne d'adresse d'envoi
-- qu'avec une session. design-staging garde sa limite de 40 Mo pour l'outil
-- public (Shopify).
--
-- Limite : 500 Mo par fichier. Elle ne peut pas dépasser la limite globale
-- du projet : Dashboard > Storage > Settings > « Upload file size limit »
-- (50 Mo par défaut), à relever d'abord.
-- À exécuter dans Supabase : Dashboard > SQL Editor > coller ce fichier > Run

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('design-staging-team', 'design-staging-team', false, 524288000, array['image/*', 'application/pdf'])
on conflict (id) do update
  set file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;
