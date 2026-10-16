// `cn` des fichiers Animate UI (shadcn l'importe de lib/utils, avec
// tailwind-merge) : ici, une simple concaténation des classes suffit.
export function cn(...classes: unknown[]): string {
  return classes.filter((c): c is string => typeof c === "string" && c.length > 0).join(" ");
}
