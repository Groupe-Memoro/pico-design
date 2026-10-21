-- Commande vue : la pastille « nouvelles commandes » du menu compte celles
-- que personne n'a encore regardées (ouvertes dans Shopify, PDF téléchargé,
-- suivi changé, marquée vue…) ni retirées de l'outil. Partagé par l'équipe.
-- À exécuter dans Supabase : Dashboard > SQL Editor > coller ce fichier > Run

alter table public.orders
  add column if not exists viewed_at timestamptz;

-- Les commandes déjà traitées (avancées en atelier ou retirées) ne sont pas
-- « nouvelles » ; celles encore « reçues » le restent jusqu'à être vues.
update public.orders
  set viewed_at = coalesce(updated_at, now())
  where viewed_at is null and (pico_status <> 'recue' or archived_at is not null);
