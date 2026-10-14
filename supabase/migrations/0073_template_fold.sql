-- Modèles de produits pliés (dépliants, cartes de souhait) : le pli du
-- modèle, d'où l'outil tire ses volets (voir lib/folds.ts).
--   * fold : { type: "half" | "roll" | "accordion",
--              direction: "vertical" | "horizontal",
--              panels: nombre de volets, safetyMm: zone de sécurité d'un pli }
--            null = produit à plat.
-- Les guides (plis, nom des volets, zones de sécurité) s'affichent dans
-- l'outil seulement, jamais dans le PDF imprimé.
-- À exécuter dans Supabase : Dashboard > SQL Editor > coller ce fichier > Run

alter table public.templates
  add column if not exists fold jsonb;
