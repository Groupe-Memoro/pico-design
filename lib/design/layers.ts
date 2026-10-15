// Calques additionnels d'un côté (recto/verso) de l'Outil Shopify : texte,
// image et forme, en plus du visuel de fond (celui-là reste porté par
// ImageSourceValue, inchangé). Un tableau ordonné — l'ordre est l'ordre
// d'empilement (le premier est tout en bas, le dernier tout en haut).
//
// Type partagé client/serveur : uniquement des données pures (pas de DOM ni
// de fs ici), pour rester importable des deux côtés sans rien tirer
// d'inutile. Le rendu texte→contours et forme→SVG (serveur) vivent dans
// lib/pdf/textLayer.ts et lib/pdf/shapeLayer.ts ; l'aperçu écran vit dans
// ImageSourcePicker.

export type ShapeKind = "rectangle" | "ellipse";

// Forme des angles de la bordure d'un texte (SVG/canvas `linejoin`) :
// pointus, coupés en biseau, ou arrondis.
export type StrokeJoin = "miter" | "bevel" | "round";

export const STROKE_JOINS: { value: StrokeJoin; label: string; title: string }[] = [
  { value: "miter", label: "Pointus", title: "Angles pointus (miter)" },
  { value: "bevel", label: "Biseautés", title: "Angles coupés en biseau (bevel)" },
  { value: "round", label: "Arrondis", title: "Angles arrondis (round)" },
];

// Correspond à la fois aux valeurs CSS `mix-blend-mode` (aperçu écran) et,
// via sharpBlendFor (lib/pdf/layers.ts), aux modes de fusion de sharp/libvips
// (impression) — seule l'orthographe américaine ("color-…") diffère de
// libvips ("colour-…"), traduite à cet unique endroit.
export type BlendMode =
  | "normal"
  | "multiply"
  | "screen"
  | "overlay"
  | "darken"
  | "lighten"
  | "color-dodge"
  | "color-burn"
  | "hard-light"
  | "soft-light"
  | "difference"
  | "exclusion";

export const BLEND_MODES: { value: BlendMode; label: string }[] = [
  { value: "normal", label: "Normal" },
  { value: "multiply", label: "Multiply" },
  { value: "screen", label: "Screen" },
  { value: "overlay", label: "Overlay" },
  { value: "darken", label: "Darken" },
  { value: "lighten", label: "Lighten" },
  { value: "color-dodge", label: "Color Dodge" },
  { value: "color-burn", label: "Color Burn" },
  { value: "hard-light", label: "Hard Light" },
  { value: "soft-light", label: "Soft Light" },
  { value: "difference", label: "Difference" },
  { value: "exclusion", label: "Exclusion" },
];

// Champs communs aux trois types de calque — factorisés une fois pour ne
// pas les redéclarer trois fois et risquer qu'ils divergent.
interface BaseLayer {
  id: string;
  // Position du centre du calque, fraction 0-1 de la page (fond perdu
  // compris) — même convention que positionX/Y du visuel de fond.
  positionX: number;
  positionY: number;
  // Rotation du calque autour de son centre, en degrés (sens horaire),
  // réglée à la souris (poignée dédiée) — voir ImageSourcePicker.
  rotationDeg: number;
  // Opacité globale du calque, 0-1.
  opacity: number;
  // Mode de fusion avec ce qu'il y a en dessous (fond + calques inférieurs).
  blendMode: BlendMode;
}

export interface TextLayer extends BaseLayer {
  type: "text";
  content: string;
  fontId: string;
  // Taille de police en mm (unité physique, comme le reste du modèle —
  // cohérent quel que soit le DPI d'impression ou le zoom de l'aperçu).
  fontSizeMm: number;
  bold: boolean;
  italic: boolean;
  // Espacement entre les lettres, en mm (0 = normal, négatif = resserré) —
  // même principe que fontSizeMm : une unité physique, cohérente quel que
  // soit le DPI d'impression ou le zoom de l'aperçu.
  letterSpacingMm: number;
  // Couleur hexadécimale (#rrggbb).
  color: string;
  // Bordure (contour) du texte : épaisseur en mm (0 = pas de bordure) et
  // couleur hexadécimale. Rendue en trait autour de chaque glyphe, aussi
  // bien à l'écran (CSS -webkit-text-stroke) qu'à l'impression (SVG stroke,
  // voir lib/pdf/textLayer.ts).
  strokeWidthMm: number;
  strokeColor: string;
  // Angles de la bordure. Absent = arrondis (le rendu d'origine).
  strokeJoin?: StrokeJoin;
}

export interface ImageLayer extends BaseLayer {
  type: "image";
  // Fichier choisi (aperçu client) — jamais envoyé tel quel au serveur : un
  // champ de formulaire dédié par calque (voir layerImageFieldName), comme
  // pour le visuel de fond.
  file: File | null;
  // Nom du fichier, conservé même quand `file` redevient null après un
  // aller-retour serveur (n'arrive pas ici, mais documente l'intention).
  fileName: string | null;
  // Largeur du calque, en fraction 0-1 de la largeur de page (fond perdu
  // compris) — la hauteur suit le ratio naturel de l'image.
  widthRatio: number;
}

export interface ShapeLayer extends BaseLayer {
  type: "shape";
  shape: ShapeKind;
  // Largeur/hauteur du calque, fractions 0-1+ de la page (fond perdu
  // compris) — contrairement à l'image, les deux sont réglables
  // indépendamment (pas de ratio naturel à respecter).
  widthRatio: number;
  heightRatio: number;
  fillEnabled: boolean;
  fillColor: string;
  strokeWidthMm: number;
  strokeColor: string;
}

export type DesignLayer = TextLayer | ImageLayer | ShapeLayer;

let layerIdCounter = 0;
// Identifiant local (jamais persisté) — juste assez stable pour servir de
// clé React et de nom de champ de formulaire pendant une session.
export function nextLayerId(): string {
  layerIdCounter += 1;
  return `layer-${Date.now()}-${layerIdCounter}`;
}

export function newTextLayer(): TextLayer {
  return {
    id: nextLayerId(),
    type: "text",
    content: "Ton texte",
    fontId: "inter",
    fontSizeMm: 10,
    bold: false,
    italic: false,
    letterSpacingMm: 0,
    color: "#000000",
    positionX: 0.5,
    positionY: 0.5,
    rotationDeg: 0,
    opacity: 1,
    blendMode: "normal",
    strokeWidthMm: 0,
    strokeColor: "#ffffff",
    strokeJoin: "round",
  };
}

export function newImageLayer(file: File): ImageLayer {
  return {
    id: nextLayerId(),
    type: "image",
    file,
    fileName: file.name,
    widthRatio: 0.4,
    positionX: 0.5,
    positionY: 0.5,
    rotationDeg: 0,
    opacity: 1,
    blendMode: "normal",
  };
}

export function newShapeLayer(shape: ShapeKind = "rectangle"): ShapeLayer {
  return {
    id: nextLayerId(),
    type: "shape",
    shape,
    widthRatio: 0.3,
    heightRatio: 0.3,
    fillEnabled: true,
    fillColor: "#631028",
    strokeWidthMm: 0,
    strokeColor: "#ffffff",
    positionX: 0.5,
    positionY: 0.5,
    rotationDeg: 0,
    opacity: 1,
    blendMode: "normal",
  };
}

// Taille de texte maximale proposée pour un modèle donné (curseur + poignée
// de redimensionnement à la souris) : relative à son format plutôt qu'un
// plafond fixe — un grand format (affiche) permet un texte bien plus gros
// qu'une petite carte. 40mm de plancher pour rester généreux même sur les
// tout petits formats, et éviter qu'un modèle absent (aperçu pas encore
// chargé) ne réduise le curseur à presque rien.
export function maxTextSizeMmForTemplate(template: { width_mm: number; height_mm: number } | null): number {
  if (!template) return 40;
  return Math.max(40, Math.round(Math.max(template.width_mm, template.height_mm) * 0.9));
}

// Nom de champ de formulaire pour l'image d'un calque donné (recto/verso +
// id du calque, pour ne jamais collisionner entre les deux côtés ni avec
// l'image de fond) — utilisé à la fois par le client (append) et les routes
// serveur (lecture).
export function layerImageFieldName(side: "front" | "back", layerId: string): string {
  return `${side}LayerImage_${layerId}`;
}

// Vrai si au moins un calque forme, opaque et à plat (fusion "normal", pas
// tourné à un angle "sale"), couvre entièrement la page (fond perdu
// compris) — sert à ne pas afficher l'alerte de bordure blanche quand elle
// est de toute façon cachée par un calque par-dessus (typiquement un
// rectangle de couleur en fond). Volontairement limité aux formes : une
// image n'a pas de hauteur réglable indépendamment (elle suit son ratio
// naturel, pas connu à cet endroit), et un texte ne couvre jamais
// raisonnablement toute la page — un faux positif y serait pire qu'une
// alerte superflue.
export function layersFullyCoverCanvas(layers: DesignLayer[]): boolean {
  const EPS = 0.01;
  return layers.some((l) => {
    if (l.type !== "shape") return false;
    if (!l.fillEnabled) return false;
    if (l.opacity < 0.98) return false;
    if (l.blendMode !== "normal") return false;
    const rot = ((l.rotationDeg % 360) + 360) % 360;
    const swapped = Math.abs(rot - 90) < 0.5 || Math.abs(rot - 270) < 0.5;
    const axisAligned = swapped || rot < 0.5 || Math.abs(rot - 180) < 0.5;
    if (!axisAligned) return false;
    const w = swapped ? l.heightRatio : l.widthRatio;
    const h = swapped ? l.widthRatio : l.heightRatio;
    const left = l.positionX - w / 2;
    const right = l.positionX + w / 2;
    const top = l.positionY - h / 2;
    const bottom = l.positionY + h / 2;
    return left <= EPS && right >= 1 - EPS && top <= EPS && bottom >= 1 - EPS;
  });
}
