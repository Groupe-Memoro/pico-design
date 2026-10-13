/**
 * De la liste importée aux finissants : reconnaît les colonnes (prénom, nom,
 * groupe, photo) et associe chaque photo à son élève par son nom de fichier.
 */

export interface ImportedStudent {
  first_name: string;
  last_name: string;
  group_name: string;
  // Nom du fichier photo donné par la liste (colonne « photo »), s'il y en a un.
  photo: string;
}

// Minuscules, sans accents ni ponctuation : « Gagné-Bélanger » = « gagne belanger ».
export function normalize(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\.[a-z0-9]{2,4}$/, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

const COLUMNS: Record<keyof ImportedStudent, string[]> = {
  first_name: ["prenom", "first name", "firstname", "prenoms"],
  last_name: ["nom", "nom de famille", "last name", "lastname", "surname", "famille"],
  group_name: ["groupe", "group", "classe", "class", "foyer", "gr"],
  photo: ["photo", "fichier", "image", "file", "photo fichier", "nom du fichier"],
};

// Colonne « nom complet » (une seule colonne pour le prénom et le nom).
const FULL_NAME = ["nom complet", "eleve", "full name", "name", "nom prenom", "prenom nom", "etudiant"];

export function studentsFromRows(rows: string[][]): { students: ImportedStudent[]; columns: string[] } {
  if (rows.length < 2) return { students: [], columns: [] };
  const header = rows[0].map(normalize);
  const find = (names: string[]) => header.findIndex((h) => names.includes(h));
  const idx = {
    first_name: find(COLUMNS.first_name),
    last_name: find(COLUMNS.last_name),
    group_name: find(COLUMNS.group_name),
    photo: find(COLUMNS.photo),
  };
  const full = find(FULL_NAME);
  const columns = Object.entries(idx)
    .filter(([, i]) => i >= 0)
    .map(([key]) => key);

  const students = rows.slice(1).map((r) => {
    const cell = (i: number) => (i >= 0 ? (r[i] ?? "").trim() : "");
    let first = cell(idx.first_name);
    let last = cell(idx.last_name);
    // Sans colonne prénom : « Prénom Nom » dans la colonne nom (ou nom complet).
    if (!first && (full >= 0 || idx.first_name < 0)) {
      const whole = full >= 0 ? cell(full) : last;
      const parts = whole.split(/\s+/);
      first = parts.length > 1 ? parts[0] : "";
      last = parts.length > 1 ? parts.slice(1).join(" ") : whole;
    }
    return { first_name: first, last_name: last, group_name: cell(idx.group_name), photo: cell(idx.photo) };
  });
  return { students: students.filter((s) => s.first_name || s.last_name), columns };
}

// Clé de comparaison d'un nom : ses mots, triés (« Tremblay Julie » = « Julie Tremblay »).
function nameKey(first: string, last: string): string {
  return normalize(`${first} ${last}`).split(" ").filter(Boolean).sort().join(" ");
}

/**
 * Associe des fichiers photo à des élèves. Un fichier correspond à un élève si
 * son nom est celui que donne la liste (colonne « photo »), ou s'il porte le
 * prénom et le nom de l'élève, dans un ordre quelconque
 * (« Tremblay_Julie.jpg », « julie-tremblay.png »).
 * Renvoie l'index du fichier de chaque élève (ou -1) et les fichiers restés seuls.
 */
export function matchPhotos(
  students: { first_name: string; last_name: string; photo?: string }[],
  fileNames: string[]
): { fileOf: number[]; unmatched: number[] } {
  const byName = new Map<string, number>();
  const byKey = new Map<string, number>();
  fileNames.forEach((name, i) => {
    byName.set(normalize(name), i);
    byKey.set(normalize(name).split(" ").filter(Boolean).sort().join(" "), i);
  });
  const used = new Set<number>();
  const fileOf = students.map((s) => {
    const candidates = [s.photo ? byName.get(normalize(s.photo)) : undefined, byKey.get(nameKey(s.first_name, s.last_name))];
    const hit = candidates.find((i): i is number => i !== undefined && !used.has(i));
    if (hit === undefined) return -1;
    used.add(hit);
    return hit;
  });
  const unmatched = fileNames.map((_, i) => i).filter((i) => !used.has(i));
  return { fileOf, unmatched };
}
