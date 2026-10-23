// Lecture d'un fichier CSV d'élèves (voir xlsx.ts pour Excel), dans le navigateur. Tolère ce que
// produisent Excel et les logiciels scolaires : séparateur « ; », « , » ou
// tabulation, encodage UTF-8 ou Windows-1252, guillemets, BOM.

export interface CsvData {
  columns: string[];
  rows: Record<string, string>[];
}

// UTF-8 si le fichier l'est vraiment ; sinon Windows-1252 (Excel en français).
export function decodeCsv(bytes: ArrayBuffer): string {
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    text = new TextDecoder("windows-1252").decode(bytes);
  }
  return text.replace(/^﻿/, "");
}

// Le séparateur le plus fréquent sur la première ligne, hors guillemets.
function detectDelimiter(text: string): string {
  const firstLine = text.split(/\r?\n/, 1)[0] ?? "";
  const counts: Record<string, number> = { ";": 0, ",": 0, "\t": 0 };
  let quoted = false;
  for (const ch of firstLine) {
    if (ch === '"') quoted = !quoted;
    else if (!quoted && ch in counts) counts[ch]++;
  }
  const [best, count] = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
  return count > 0 ? best : ",";
}

function parseRecords(text: string, delimiter: string): string[][] {
  const records: string[][] = [];
  let record: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === delimiter) {
      record.push(field);
      field = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      record.push(field);
      records.push(record);
      record = [];
      field = "";
    } else field += ch;
  }
  if (field || record.length) {
    record.push(field);
    records.push(record);
  }
  return records;
}

/**
 * Colonnes (première ligne non vide) et lignes. Une colonne sans titre devient
 * « Colonne 3 » ; deux colonnes de même titre, « Nom » et « Nom (2) ». Les
 * lignes entièrement vides sont ignorées.
 */
export function parseCsv(text: string): CsvData {
  return tableToData(parseRecords(text, detectDelimiter(text)));
}

// Un tableau de cellules (CSV ou feuille Excel) → colonnes et lignes.
export function tableToData(table: string[][]): CsvData {
  const records = [...table];
  // Lignes vides avant l'en-tête (titre de feuille décalé) : sautées.
  while (records.length && !records[0].some((v) => v.trim())) records.shift();
  const header = records.shift() ?? [];
  const seen = new Map<string, number>();
  const columns = header.map((raw, i) => {
    const base = raw.replace(/\s+/g, " ").trim() || `Colonne ${i + 1}`;
    const n = (seen.get(base) ?? 0) + 1;
    seen.set(base, n);
    return n > 1 ? `${base} (${n})` : base;
  });
  const rows = records
    .filter((r) => r.some((v) => v.trim()))
    .map((r) => Object.fromEntries(columns.map((c, i) => [c, (r[i] ?? "").trim()])));
  return { columns, rows };
}
