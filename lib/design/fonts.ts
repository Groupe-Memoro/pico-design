import { GOOGLE_FONTS, type GoogleFontEntry } from "./googleFonts";

// Polices proposées par l'outil de calques (texte) de Design Shopify — les
// 25 polices Google Fonts les plus populaires, libres (SIL Open Font
// License), fournies avec l'outil (public/fonts/) plutôt que les polices de
// la marque Pico (Apercu/Gelica, réservées à l'habillage du site) : un
// client qui personnalise son propre visuel choisit parmi celles-ci, pas
// parmi nos polices de marque.
//
// Fichiers TTF à graisse variable (axe "wght") — rendus aussi bien à
// l'écran (client, via @font-face, voir globals.css) qu'à l'impression
// (serveur, voir lib/pdf/textLayer.ts qui les charge avec `fontkit` et en
// tire les contours des glyphes directement, sans dépendre d'aucune police
// installée sur le serveur).
export interface FontOption {
  id: string;
  label: string;
  // Police du catalogue Google Fonts (identifiant « g:<famille> ») : pas de
  // fichier dans public/fonts, elle se charge chez Google — à l'écran par
  // leur feuille de style, au serveur par téléchargement (lib/pdf/textLayer.ts).
  google?: boolean;
  // Graisses disponibles en italique (polices Google) ; vide = pas d'italique.
  italicWeights?: number[];
  // Nom CSS (@font-face) pour l'aperçu écran.
  family: string;
  // Chemins publics (servis tels quels, et relus depuis le disque côté
  // serveur — voir lib/pdf/textLayer.ts).
  regularFile: string;
  italicFile: string | null;
  // Valeurs de l'axe "wght" à utiliser pour le non-gras/gras (polices à
  // graisse variable — une seule et même police, instanciée différemment).
  weightRegular: number;
  weightBold: number;
}

export const FONT_OPTIONS: FontOption[] = [
  {
    id: "inter",
    label: "Inter (Sans-serif)",
    family: "Inter",
    regularFile: "/fonts/Inter.ttf",
    italicFile: "/fonts/Inter-Italic.ttf",
    weightRegular: 400,
    weightBold: 700,
  },
  {
    id: "playfair",
    label: "Playfair Display (Serif)",
    family: "Playfair Display",
    regularFile: "/fonts/PlayfairDisplay.ttf",
    italicFile: "/fonts/PlayfairDisplay-Italic.ttf",
    weightRegular: 400,
    weightBold: 700,
  },
  {
    id: "caveat",
    label: "Caveat (Manuscrite)",
    family: "Caveat",
    regularFile: "/fonts/Caveat.ttf",
    // Pas de fichier italique dédié — police déjà penchée par nature ;
    // l'italique bascule simplement sur le gras si activé (voir
    // resolveFontFile), plutôt qu'un italique synthétique hasardeux.
    italicFile: null,
    weightRegular: 400,
    weightBold: 700,
  },
  {
    id: "oswald",
    label: "Oswald (Affiche)",
    family: "Oswald",
    regularFile: "/fonts/Oswald.ttf",
    italicFile: null,
    weightRegular: 400,
    weightBold: 700,
  },
  {
    id: "roboto",
    label: "Roboto (Sans-serif)",
    family: "Roboto",
    regularFile: "/fonts/Roboto.ttf",
    italicFile: "/fonts/Roboto-Italic.ttf",
    weightRegular: 400,
    weightBold: 700,
  },
  {
    id: "opensans",
    label: "Open Sans (Sans-serif)",
    family: "Open Sans",
    regularFile: "/fonts/OpenSans.ttf",
    italicFile: "/fonts/OpenSans-Italic.ttf",
    weightRegular: 400,
    weightBold: 700,
  },
  {
    id: "montserrat",
    label: "Montserrat (Sans-serif)",
    family: "Montserrat",
    regularFile: "/fonts/Montserrat.ttf",
    italicFile: "/fonts/Montserrat-Italic.ttf",
    weightRegular: 400,
    weightBold: 700,
  },
  {
    id: "nunito",
    label: "Nunito (Sans-serif)",
    family: "Nunito",
    regularFile: "/fonts/Nunito.ttf",
    italicFile: "/fonts/Nunito-Italic.ttf",
    weightRegular: 400,
    weightBold: 700,
  },
  {
    id: "raleway",
    label: "Raleway (Sans-serif)",
    family: "Raleway",
    regularFile: "/fonts/Raleway.ttf",
    italicFile: "/fonts/Raleway-Italic.ttf",
    weightRegular: 400,
    weightBold: 700,
  },
  {
    id: "worksans",
    label: "Work Sans (Sans-serif)",
    family: "Work Sans",
    regularFile: "/fonts/WorkSans.ttf",
    italicFile: "/fonts/WorkSans-Italic.ttf",
    weightRegular: 400,
    weightBold: 700,
  },
  {
    id: "josefinsans",
    label: "Josefin Sans (Sans-serif)",
    family: "Josefin Sans",
    regularFile: "/fonts/JosefinSans.ttf",
    italicFile: "/fonts/JosefinSans-Italic.ttf",
    weightRegular: 400,
    weightBold: 700,
  },
  {
    id: "quicksand",
    label: "Quicksand (Sans-serif)",
    family: "Quicksand",
    regularFile: "/fonts/Quicksand.ttf",
    italicFile: null,
    weightRegular: 400,
    weightBold: 700,
  },
  {
    id: "spacegrotesk",
    label: "Space Grotesk (Sans-serif)",
    family: "Space Grotesk",
    regularFile: "/fonts/SpaceGrotesk.ttf",
    italicFile: null,
    weightRegular: 400,
    weightBold: 700,
  },
  {
    id: "dmsans",
    label: "DM Sans (Sans-serif)",
    family: "DM Sans",
    regularFile: "/fonts/DMSans.ttf",
    italicFile: "/fonts/DMSans-Italic.ttf",
    weightRegular: 400,
    weightBold: 700,
  },
  {
    id: "manrope",
    label: "Manrope (Sans-serif)",
    family: "Manrope",
    regularFile: "/fonts/Manrope.ttf",
    italicFile: null,
    weightRegular: 400,
    weightBold: 700,
  },
  {
    id: "lora",
    label: "Lora (Serif)",
    family: "Lora",
    regularFile: "/fonts/Lora.ttf",
    italicFile: "/fonts/Lora-Italic.ttf",
    weightRegular: 400,
    weightBold: 700,
  },
  {
    id: "crimsonpro",
    label: "Crimson Pro (Serif)",
    family: "Crimson Pro",
    regularFile: "/fonts/CrimsonPro.ttf",
    italicFile: "/fonts/CrimsonPro-Italic.ttf",
    weightRegular: 400,
    weightBold: 700,
  },
  {
    id: "bitter",
    label: "Bitter (Serif)",
    family: "Bitter",
    regularFile: "/fonts/Bitter.ttf",
    italicFile: "/fonts/Bitter-Italic.ttf",
    weightRegular: 400,
    weightBold: 700,
  },
  {
    id: "fraunces",
    label: "Fraunces (Affiche)",
    family: "Fraunces",
    regularFile: "/fonts/Fraunces.ttf",
    italicFile: "/fonts/Fraunces-Italic.ttf",
    weightRegular: 400,
    weightBold: 700,
  },
  {
    id: "dancingscript",
    label: "Dancing Script (Manuscrite)",
    family: "Dancing Script",
    regularFile: "/fonts/DancingScript.ttf",
    italicFile: null,
    weightRegular: 400,
    weightBold: 700,
  },
  {
    id: "rubik",
    label: "Rubik (Sans-serif)",
    family: "Rubik",
    regularFile: "/fonts/Rubik.ttf",
    italicFile: "/fonts/Rubik-Italic.ttf",
    weightRegular: 400,
    weightBold: 700,
  },
  {
    id: "karla",
    label: "Karla (Sans-serif)",
    family: "Karla",
    regularFile: "/fonts/Karla.ttf",
    italicFile: "/fonts/Karla-Italic.ttf",
    weightRegular: 400,
    weightBold: 700,
  },
  {
    id: "mulish",
    label: "Mulish (Sans-serif)",
    family: "Mulish",
    regularFile: "/fonts/Mulish.ttf",
    italicFile: "/fonts/Mulish-Italic.ttf",
    weightRegular: 400,
    weightBold: 700,
  },
  {
    id: "notosans",
    label: "Noto Sans (Sans-serif)",
    family: "Noto Sans",
    regularFile: "/fonts/NotoSans.ttf",
    italicFile: "/fonts/NotoSans-Italic.ttf",
    weightRegular: 400,
    weightBold: 700,
  },
  {
    id: "merriweather",
    label: "Merriweather (Serif)",
    family: "Merriweather",
    regularFile: "/fonts/Merriweather.ttf",
    italicFile: "/fonts/Merriweather-Italic.ttf",
    weightRegular: 400,
    weightBold: 700,
  },
];

const CATEGORY_LABELS: Record<string, string> = {
  s: "Sans-serif",
  r: "Serif",
  d: "Décorative",
  h: "Manuscrite",
  m: "Chasse fixe",
};

const GOOGLE_PREFIX = "g:";
const nearest = (list: number[], target: number) =>
  list.reduce((best, w) => (Math.abs(w - target) < Math.abs(best - target) ? w : best), list[0]);

function googleOption([family, category, weights, italicWeights]: GoogleFontEntry): FontOption {
  const list = weights.split(",").map(Number);
  const regular = nearest(list, 400);
  const heavier = list.filter((w) => w > regular);
  return {
    id: GOOGLE_PREFIX + family,
    label: `${family} (${CATEGORY_LABELS[category] ?? "Sans-serif"})`,
    family,
    regularFile: "",
    italicFile: null,
    weightRegular: regular,
    // Gras : la graisse la plus proche de 700 au-dessus de la normale, sinon
    // la normale (police à une seule graisse : pas de faux gras).
    weightBold: heavier.length ? nearest(heavier, 700) : regular,
    google: true,
    italicWeights: italicWeights ? italicWeights.split(",").map(Number) : [],
  };
}

let googleByFamily: Map<string, GoogleFontEntry> | null = null;
function googleEntry(family: string): GoogleFontEntry | undefined {
  googleByFamily ??= new Map(GOOGLE_FONTS.map((e) => [e[0], e]));
  return googleByFamily.get(family);
}

export function fontOptionById(id: string): FontOption {
  const local = FONT_OPTIONS.find((f) => f.id === id);
  if (local) return local;
  if (id?.startsWith(GOOGLE_PREFIX)) {
    const entry = googleEntry(id.slice(GOOGLE_PREFIX.length));
    if (entry) return googleOption(entry);
  }
  return FONT_OPTIONS[0];
}

// Identifiant reconnu (police fournie ou du catalogue Google).
export function isKnownFontId(id: unknown): id is string {
  return typeof id === "string" && fontOptionById(id).id === id;
}

/**
 * Choix du sélecteur de police : les 25 polices les plus populaires de
 * Google Fonts (dans l'ordre de popularité), puis toutes les autres par ordre
 * alphabétique. Une police déjà fournie (public/fonts) garde son identifiant
 * d'origine, pour ne rien changer aux designs enregistrés.
 */
export function fontPickerGroups(): { label: string; options: FontOption[] }[] {
  const localByFamily = new Map(FONT_OPTIONS.map((f) => [f.family, f]));
  const toOption = (entry: GoogleFontEntry) => localByFamily.get(entry[0]) ?? googleOption(entry);
  const popular = GOOGLE_FONTS.slice(0, 25).map(toOption);
  const taken = new Set(popular.map((f) => f.id));
  const others = [...FONT_OPTIONS.filter((f) => !taken.has(f.id)), ...GOOGLE_FONTS.slice(25).filter((e) => !localByFamily.has(e[0])).map(googleOption)]
    .filter((f) => !taken.has(f.id))
    .sort((a, b) => a.family.localeCompare(b.family, "fr"));
  return [
    { label: "Les plus populaires", options: popular },
    { label: "Autres polices", options: others },
  ];
}

// Fichier à charger pour un style donné : l'italique retombe sur le fichier
// normal si la police n'en a pas (voir `caveat`/`oswald` ci-dessus).
export function resolveFontFile(font: FontOption, italic: boolean): string {
  if (italic && font.italicFile) return font.italicFile;
  return font.regularFile;
}
