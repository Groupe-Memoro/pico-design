import { BarcodeIcon, BookIcon, CalendarIcon, Grid3x3Icon, ImageIcon, StickerIcon, BadgeIcon, MonitorCogIcon, PaintbrushVerticalIcon, PencilRulerIcon, RocketIcon, ShopifyIcon, TagIcon, UsersIcon } from "@/components/icons";

// Liste centrale des pages de nav / tuiles du tableau de bord, pour que les
// deux restent synchronisées sur le même ordre (voir `resolveMenuOrder`) et
// utilisent les mêmes icônes/couleurs.
export type MenuKey =
  | "templates"
  | "visuals"
  | "illustrations"
  | "stickers"
  | "albums"
  | "agendas"
  | "themes"
  | "products"
  | "design"
  | "skus"
  | "imposition"
  | "orders"
  | "users"
  | "settings";

export const MENU_ITEMS: Record<
  MenuKey,
  { href: string; title: string; icon: (props: { className?: string }) => JSX.Element; gradient: string }
> = {
  templates: {
    href: "/templates",
    title: "Modèles",
    icon: PencilRulerIcon,
    gradient: "from-teal-400 to-emerald-600",
  },
  visuals: {
    href: "/visuals",
    title: "Visuels",
    icon: ImageIcon,
    gradient: "from-amber-400 to-yellow-500",
  },
  illustrations: {
    href: "/illustrations",
    title: "Illustrations",
    icon: StickerIcon,
    gradient: "from-cyan-400 to-teal-600",
  },
  stickers: {
    href: "/autocollants",
    title: "Autocollants",
    icon: BadgeIcon,
    gradient: "from-lime-400 to-green-600",
  },
  albums: {
    href: "/albums",
    title: "Albums des finissants",
    icon: BookIcon,
    gradient: "from-indigo-400 to-blue-600",
  },
  agendas: {
    href: "/agendas",
    title: "Agendas scolaires",
    icon: CalendarIcon,
    gradient: "from-sky-400 to-cyan-600",
  },
  themes: {
    href: "/themes",
    title: "Thèmes",
    icon: PaintbrushVerticalIcon,
    gradient: "from-fuchsia-400 to-purple-600",
  },
  products: {
    href: "/products",
    title: "Produits",
    icon: RocketIcon,
    gradient: "from-pink-400 to-rose-500",
  },
  design: {
    href: "/design",
    title: "Outil Shopify",
    icon: ShopifyIcon,
    // Vert de la marque Shopify (#95BF47), plutôt qu'une paire Tailwind
    // générique — seule tuile de ce dégradé, pour bien l'associer à Shopify.
    gradient: "from-[#95BF47] to-[#5E8E3E]",
  },
  skus: {
    href: "/skus",
    title: "SKU",
    icon: BarcodeIcon,
    gradient: "from-sky-400 to-blue-600",
  },
  imposition: {
    href: "/imposition",
    title: "Imposition",
    icon: Grid3x3Icon,
    gradient: "from-orange-400 to-red-500",
  },
  users: {
    href: "/users",
    title: "Utilisateurs",
    icon: UsersIcon,
    gradient: "from-violet-400 to-purple-600",
  },
  orders: {
    href: "/orders",
    title: "Commandes",
    icon: TagIcon,
    gradient: "from-amber-400 to-orange-600",
  },
  settings: {
    href: "/settings",
    title: "Paramètres",
    icon: MonitorCogIcon,
    gradient: "from-slate-400 to-slate-600",
  },
};

// Regroupement du menu, par nature de la tâche : les produits Pico, la banque
// de contenus (thèmes, visuels, illustrations), le scolaire, ce qui touche à
// la vente, et l'administration des accès. Les séparateurs de la
// barre ne tombent qu'entre ces groupes — avec un trait entre chaque lien,
// dix entrées se lisaient comme une liste indifférenciée.
//
// Ce découpage prime sur l'ordre personnalisé (voir groupMenuOrder) : un
// glisser-déposer déplace un lien À L'INTÉRIEUR de son groupe, jamais d'un
// groupe à l'autre, sans quoi le regroupement ne tiendrait pas.
export const MENU_GROUPS: MenuKey[][] = [
  ["products", "templates", "skus", "imposition"],
  ["themes", "visuals", "illustrations"],
  ["stickers", "albums", "agendas"],
  ["design", "orders", "settings"],
  ["users"],
];

// Titre de chaque groupe, dans l'ordre de MENU_GROUPS. La barre n'en affiche
// pas (le trait suffit), le tableau de bord, si : ses groupes sont des
// sections, l'une sous l'autre.
const MENU_GROUP_LABELS = ["Produits Pico", "Banque", "Scolaire", "Vente", "Administration"] as const;

// Titre d'un groupe tel que le rend groupMenuOrder (qui retire les groupes
// vides : on ne peut donc pas se fier à sa position), lu d'après son premier lien.
export function menuGroupLabel(groupe: MenuKey[]): string {
  const index = MENU_GROUPS.findIndex((g) => groupe[0] !== undefined && g.includes(groupe[0]));
  return MENU_GROUP_LABELS[index] ?? MENU_GROUP_LABELS[MENU_GROUP_LABELS.length - 1];
}

// Pages réservées aux administrateurs : Utilisateurs et Paramètres, qui
// changent respectivement les accès et l'interface de tout le monde (leurs
// pages appellent requireAdmin). Le menu ET les tuiles du tableau de bord les
// masquent aux autres rôles : une tuile visible qui renvoie aussitôt à
// l'accueil passerait pour un lien cassé.
const ADMIN_ONLY: MenuKey[] = ["users", "settings"];

// Les pages qu'un rôle peut ouvrir, dans l'ordre par défaut.
export function menuKeysForRole(role: string | null | undefined): MenuKey[] {
  return role === "admin" ? DEFAULT_MENU_ORDER : DEFAULT_MENU_ORDER.filter((k) => !ADMIN_ONLY.includes(k));
}

// Pages sans menu de gauche : le tableau de bord, dont les tuiles sont déjà
// le menu, et l'Outil Shopify, ouvert aussi aux clients. Lue par Nav (le menu)
// et par AppShell (le décalage de la page), qui doivent toujours concorder.
export function hasSidebar(pathname: string): boolean {
  return pathname !== "/" && pathname !== "/design" && !pathname.startsWith("/design/");
}

// Ordre par défaut quand l'utilisateur n'a encore rien personnalisé : celui
// des groupes, mis à plat.
export const DEFAULT_MENU_ORDER: MenuKey[] = MENU_GROUPS.flat();

function isMenuKey(value: string): value is MenuKey {
  return Object.prototype.hasOwnProperty.call(MENU_ITEMS, value);
}

// Combine l'ordre sauvegardé (peut contenir des clés obsolètes ou en
// manquer de nouvelles) avec les clés effectivement permises pour cet
// utilisateur (ex. "users" seulement pour les admins) : garde l'ordre
// choisi pour les clés connues, puis ajoute à la fin les clés permises
// mais absentes de la sauvegarde (nouvelle page, jamais réordonnée).
export function resolveMenuOrder(saved: string[] | null | undefined, allowedKeys: MenuKey[]): MenuKey[] {
  const allowedSet = new Set(allowedKeys);
  const fromSaved = (saved ?? []).filter((key): key is MenuKey => isMenuKey(key) && allowedSet.has(key));
  const missing = DEFAULT_MENU_ORDER.filter((key) => allowedSet.has(key) && !fromSaved.includes(key));
  return [...fromSaved, ...missing];
}

/**
 * Répartit un ordre déjà résolu dans les groupes du menu, en conservant
 * l'ordre choisi À L'INTÉRIEUR de chaque groupe.
 *
 * Les groupes vides disparaissent : sans ça, un non-administrateur — qui ne
 * voit ni Utilisateurs ni Paramètres — hériterait d'un séparateur en fin de
 * barre, suivi de rien.
 *
 * Une clé qui n'appartiendrait à aucun groupe (page ajoutée, oubliée dans
 * MENU_GROUPS) rejoint le dernier groupe plutôt que de disparaître : mieux
 * vaut un lien mal rangé qu'un lien introuvable.
 */
export function groupMenuOrder(order: MenuKey[]): MenuKey[][] {
  const position = new Map(order.map((key, index) => [key, index]));
  const groupes = MENU_GROUPS.map((groupe) =>
    groupe.filter((key) => position.has(key)).sort((a, b) => position.get(a)! - position.get(b)!)
  );

  const rangées = new Set(MENU_GROUPS.flat());
  const orphelines = order.filter((key) => !rangées.has(key));
  if (orphelines.length > 0) groupes[groupes.length - 1].push(...orphelines);

  return groupes.filter((groupe) => groupe.length > 0);
}
