// Types partagés avec le schéma Supabase (voir supabase/migrations/0001_init.sql).
// À régénérer plus précisément plus tard avec `supabase gen types typescript`.

export type LogoHAlign = "left" | "center" | "right";
export type LogoVAlign = "top" | "bottom";

export interface Category {
  id: string;
  name: string;
  sort_order: number;
  created_at: string;
}

export interface SkuGroup {
  id: string;
  name: string;
  created_at: string;
}

export interface Sku {
  id: string;
  sku: string;
  name: string;
  sku_group_id: string;
  created_at: string;
}

export interface Template {
  id: string;
  name: string;
  category_id: string;
  sku_id: string | null;
  width_mm: number;
  height_mm: number;
  bleed_mm: number;
  safety_margin_x_mm: number;
  safety_margin_y_mm: number;
  print_margin_x_mm: number;
  print_margin_y_mm: number;
  dpi: number;
  logo_h_align: LogoHAlign;
  logo_v_align: LogoVAlign;
  logo_width_mm: number;
  logo_margin_x_mm: number;
  logo_margin_y_mm: number;
  overlay_path: string | null;
  mask_path: string | null;
  shading_path: string | null;
  beauty_shot_xml_path: string | null;
  // Intensité (0-100) de chaque surcouche du bundle mockup, dans l'ordre des
  // <gifting:overlay> du XML. null ou case manquante = 100 (inchangé).
  beauty_shot_overlay_opacities: number[] | null;
  // Marques de pli : distances (mm) depuis le bord de coupe, une par pli —
  // "vertical" = ligne verticale (divise la largeur), "horizontal" = ligne
  // horizontale (divise la hauteur). Affichées seulement en aperçu écran,
  // jamais dans le PDF imprimé (voir lib/pdf/preview.ts). null/vide = aucune.
  fold_marks_vertical_mm: number[] | null;
  fold_marks_horizontal_mm: number[] | null;
  // Produit plié (dépliant, carte) : voir lib/folds.ts (parseFold). null = à plat.
  fold: unknown | null;
  // Module de l'Outil Shopify que ce modèle ouvre (voir 0074_photo_prints.sql).
  tool_module: "design" | "photos";
  // Profil d'imposition utilisé à la mise en production (voir 0078).
  imposition_profile_id?: string | null;
  two_sided: boolean;
  logo_on_front: boolean;
  logo_on_back: boolean;
  allow_orientation_change: boolean;
  created_at: string;
  created_by: string | null;
}

export type VisualMode = "full" | "tile";
export type LogoShape = "logo" | "pastille";

// Un emplacement de photo dans un Thème : position (centre) + taille,
// toutes en ratios 0-1 de la page (fond perdu compris) — même convention que
// DesignLayer (voir lib/design/layers.ts). La photo du client y est
// recadrée en "cover" pour remplir exactement ce rectangle, avant que le
// graphisme du thème (avec ses zones transparentes) ne soit posé par-dessus.
//
// `shape` découpe la photo dans ce rectangle : absente ou "rect", tout le
// rectangle ; "ellipse", l'ovale inscrit (un cercle si le rectangle est
// carré sur la page) ; "polygon", le polygone `points`, en ratios 0-1 du
// rectangle de l'emplacement (voir lib/themeShapes.ts) ; "svg", ce que
// dessine le SVG `maskSvg`, étiré au rectangle (un masque fourni par l'admin).
export type ThemeSlotShape = "rect" | "ellipse" | "polygon" | "svg";

export interface ThemeSlotPoint {
  x: number;
  y: number;
}

export interface ThemeSlot {
  positionX: number;
  positionY: number;
  widthRatio: number;
  heightRatio: number;
  shape?: ThemeSlotShape;
  points?: ThemeSlotPoint[];
  // Masque SVG (forme "svg"), déjà nettoyé : voir sanitizeMaskSvg.
  maskSvg?: string;
  // Rotation de l'emplacement autour de son centre, en degrés (sens horaire).
  // Absent = 0. La photo tourne avec lui.
  rotationDeg?: number;
}

// Zone de texte d'un thème : un rectangle de la page (centre et taille en
// fractions de la page, fond perdu compris — comme ThemeSlot) où le client
// écrit son texte. La taille de police est un maximum : un texte trop long
// rapetisse pour tenir dans la zone (voir fitThemeTextSize).
export type ThemeTextAlign = "left" | "center" | "right";
export type ThemeTextVerticalAlign = "top" | "middle" | "bottom";
export interface ThemeTextZone {
  id: string;
  // Ce qu'on demande au client (« Nom de l'élève »).
  label: string;
  // Texte de départ, que le client remplace (vide = zone vide au départ).
  defaultText: string;
  positionX: number;
  positionY: number;
  widthRatio: number;
  heightRatio: number;
  fontId: string;
  fontSizeMm: number;
  bold: boolean;
  italic: boolean;
  color: string;
  align: ThemeTextAlign;
  // Position du bloc de texte dans la hauteur de la zone. Absent = milieu.
  verticalAlign?: ThemeTextVerticalAlign;
  // Nombre de caractères permis (0 = sans limite) et retours à la ligne.
  maxChars: number;
  multiline: boolean;
  uppercase: boolean;
  // Rotation de la zone autour de son centre, en degrés (sens horaire).
  rotationDeg?: number;
}

// Ajustement (position/zoom) apporté par le CLIENT à la photo d'un
// emplacement, à l'intérieur de son rectangle (voir ThemeSlot, fixé par
// l'admin) — même sémantique que positionX/positionY/scale d'ImageSourceValue
// pour le fond simple, mais un jeu de valeurs par emplacement. 1 = cadrage
// "cover" minimal (voir coverCropToBuffer).
export interface ThemeSlotAdjust {
  positionX: number;
  positionY: number;
  scale: number;
}

// Thème : un graphisme préfait (avec transparence), attribué à UN modèle
// précis, affiché par-dessus 1 à 3 photos du client (voir ThemeSlot). Voir
// lib/pdf/theme.ts (composeThemeImage) pour le rendu, et DesignTypePicker
// pour son usage côté Design Shopify.
export interface Theme {
  id: string;
  template_id: string;
  name: string;
  overlay_path: string;
  // Image de fond facultative, posée SOUS les photos (voir
  // supabase/migrations/0068_theme_background.sql) : visible là où il n'y a
  // pas de photo. Sans fond, la page est blanche sous les photos.
  background_path?: string | null;
  slots: ThemeSlot[];
  // Zones de texte libres (voir lib/themeText.ts et la migration 0076) : le
  // client y écrit ce qu'il veut, dans la police et la couleur fixées ici.
  text_zones?: ThemeTextZone[];
  created_at: string;
  created_by: string | null;
}

// Un mockup (bundle « beauty shot ») d'un modèle — voir
// supabase/migrations/0049_template_mockups.sql. Un modèle peut en avoir
// plusieurs (mêmes produit sous différents angles) ; `xml_path` est la
// source de vérité, les images du bundle vivent dans le même dossier (voir
// beautyShotFolderOf, lib/pdf/beautyShot.ts).
export interface TemplateMockup {
  id: string;
  template_id: string;
  name: string;
  sort_order: number;
  xml_path: string;
  // Point de cadrage horizontal du visuel dans la zone du mockup : 0 = bord
  // gauche du visuel (vue de droite du produit), 0.5 = milieu (face), 1 =
  // bord droit (vue de gauche). Voir migration 0050.
  position_x: number;
  // Cadrage vertical (0 = haut, 1 = bas) et échelle du visuel dans la zone
  // (1 = « cover », 2 = agrandi ×2 puis recadré). Voir migration 0051.
  position_y: number;
  zoom: number;
  // Où le visuel commence et s'arrête dans le mesh, en fraction de la largeur
  // de la zone : le mesh couvre souvent toute la scène alors que le produit
  // n'en occupe qu'une partie. Voir migration 0052.
  margin_left: number;
  margin_right: number;
  // Idem en vertical, en fraction de la hauteur. Voir migration 0053.
  margin_top: number;
  margin_bottom: number;
  // Positionnel, dans l'ordre des <overlay> du XML ; null = 100 % partout.
  overlay_opacities: number[] | null;
  created_at: string;
  created_by: string | null;
}

export interface VisualCollection {
  id: string;
  name: string;
  sort_order: number;
  created_at: string;
  created_by: string | null;
}

export interface Visual {
  id: string;
  name: string;
  file_path: string;
  mime_type: string;
  collection_id: string | null;
  created_at: string;
  created_by: string | null;
}

export interface ProductCollection {
  id: string;
  name: string;
  sort_order: number;
  created_at: string;
  created_by: string | null;
}

export interface Product {
  id: string;
  name: string;
  template_id: string;
  image_path: string;
  visual_id: string | null;
  visual_mode: VisualMode | null;
  tile_size_mm: number | null;
  logo_shape: LogoShape;
  logo_color: string;
  logo_secondary_color: string;
  show_logo: boolean;
  logo_shadow: boolean;
  logo_shadow_blur: number;
  logo_shadow_distance: number;
  logo_shadow_angle: number;
  logo_shadow_opacity: number;
  rotated: boolean;
  collection_id: string | null;
  pdf_path: string | null;
  image_position_x: number;
  image_position_y: number;
  back_image_path: string | null;
  back_visual_id: string | null;
  back_visual_mode: VisualMode | null;
  back_tile_size_mm: number | null;
  back_image_position_x: number;
  back_image_position_y: number;
  created_at: string;
  created_by: string | null;
}

export interface ImpositionSheet {
  id: string;
  name: string;
  width_mm: number;
  height_mm: number;
  created_at: string;
  created_by: string | null;
}

// Illustration de la banque (module Illustrations) : posée par le client de
// l'Outil Shopify comme un calque image, voir supabase/migrations/0064.
export interface Illustration {
  id: string;
  name: string;
  file_path: string;
  mime_type: "image/png" | "image/jpeg" | "image/webp" | "image/svg+xml";
  created_at: string;
  created_by: string | null;
}

// Avec son adresse signée (le bucket est privé), telle que l'écran la reçoit.
export interface IllustrationWithUrl extends Illustration {
  fileUrl: string | null;
}

// Profil de découpe de la Graphtec : feuille, grille fixe, marges, espacement,
// calibration, marques imprimées et gabarit de guidage (aperçu seulement).
export interface ImpositionCutter {
  id: string;
  name: string;
  machine: "duplo" | "graphtec";
  // Null si la feuille du profil a été supprimée.
  sheet_id: string | null;
  grid_cols: number;
  grid_rows: number;
  margin_top_mm: number;
  margin_right_mm: number;
  margin_bottom_mm: number;
  margin_left_mm: number;
  gutter_x_mm: number;
  gutter_y_mm: number;
  offset_x_mm: number;
  offset_y_mm: number;
  center_grid: boolean;
  marks_path: string | null;
  guide_path: string | null;
  created_at: string;
  created_by: string | null;
}

// Profil d'imposition (voir supabase/migrations/0078_imposition_profiles.sql) :
// la façon d'imposer les modèles qui le choisissent, à la mise en production.
export interface ImpositionProfile {
  id: string;
  name: string;
  sheet_id: string;
  machine: "duplo" | "graphtec";
  duplo_job_id: string | null;
  duplo_job2_id: string | null;
  duplo_job2_turn: "cw" | "ccw";
  cutter_id: string | null;
  orientation: "auto" | "normal" | "rotated";
  flip: "long" | "short";
  created_at: string;
  created_by: string | null;
}

export interface ImpositionDuploJob {
  id: string;
  job_no: number;
  name: string;
  width_mm: number;
  length_mm: number;
  slits: number[];
  cuts: number[];
  // Repère REG lu par la machine, et sa distance (mm) aux bords de la feuille.
  reg_mark: boolean;
  side_mark_mm: number;
  lead_mark_mm: number;
  created_at: string;
  created_by: string | null;
}

export interface Job {
  id: string;
  template_id: string;
  product_id: string | null;
  source_image_path: string;
  output_pdf_path: string | null;
  status: "pending" | "processing" | "done" | "error";
  error_message: string | null;
  created_by: string | null;
  created_at: string;
}

export interface Profile {
  id: string;
  full_name: string | null;
  role: "admin" | "designer" | "gestionnaire";
  menu_order: string[] | null;
  created_at: string;
}

// Placeholder minimal pour satisfaire le générique <Database> de @supabase/ssr.
// Remplace par le type généré (`supabase gen types typescript --local`) quand
// tu veux l'autocomplétion complète des tables dans les requêtes .from(...).
export type Database = any;
