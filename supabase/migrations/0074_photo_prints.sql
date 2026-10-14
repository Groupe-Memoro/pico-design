-- Outil Shopify : module « Impression de photos », à côté de la création de
-- design. Le client choisit son format, téléverse ses photos (ou un zip),
-- valide le cadrage de chacune et sa quantité ; chaque photo devient un design
-- enregistré (design_submissions) et une ligne de son panier Shopify.
--   * templates.tool_module : module qu'ouvre ce modèle dans l'outil
--     ("design" = création de design, "photos" = impression de photos) ;
--   * design_submissions.batch_id : les photos envoyées ensemble. Le bloc
--     Liquid de la fiche produit lit le lot (GET /api/design/batch/<id>)
--     pour ajouter une ligne de panier par photo, avec sa quantité.
-- À exécuter dans Supabase : Dashboard > SQL Editor > coller ce fichier > Run

alter table public.templates
  add column if not exists tool_module text not null default 'design'
    check (tool_module in ('design', 'photos'));

alter table public.design_submissions
  add column if not exists batch_id uuid;

create index if not exists design_submissions_batch_idx on public.design_submissions (batch_id);
