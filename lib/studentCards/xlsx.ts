// Lecture d'un classeur Excel (.xlsx) d'élèves, dans le navigateur : un
// .xlsx est un ZIP de fichiers XML — ouvert avec fflate, lu avec DOMParser,
// sans bibliothèque de plus. La première feuille, première ligne = colonnes.
// (L'ancien format .xls, binaire, n'est pas lu : l'enregistrer en .xlsx ou CSV.)

import { unzipSync, strFromU8 } from "fflate";
import { tableToData, type CsvData } from "./csv";

const NS_REL = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";

function xml(files: Record<string, Uint8Array>, path: string): Document | null {
  const bytes = files[path];
  return bytes ? new DOMParser().parseFromString(strFromU8(bytes), "application/xml") : null;
}

// « B12 » → 1 (colonne B, à partir de 0).
function columnIndex(ref: string): number {
  const letters = ref.replace(/\d+$/, "");
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

// Formats de date intégrés d'Excel, et formats personnalisés qui en sont.
const BUILTIN_DATE_FORMATS = new Set([14, 15, 16, 17, 22, 27, 30, 36, 50, 57]);
const isDateFormatCode = (code: string) => /[dmy]/i.test(code.replace(/"[^"]*"|\[[^\]]*\]/g, ""));

// Styles de cellule (index de <cellXfs>) qui affichent une date.
function dateStyles(doc: Document | null): Set<number> {
  const result = new Set<number>();
  if (!doc) return result;
  const custom = new Map<number, string>();
  for (const f of Array.from(doc.getElementsByTagName("numFmt"))) {
    custom.set(Number(f.getAttribute("numFmtId")), f.getAttribute("formatCode") ?? "");
  }
  const cellXfs = doc.getElementsByTagName("cellXfs")[0];
  if (!cellXfs) return result;
  Array.from(cellXfs.getElementsByTagName("xf")).forEach((xf, i) => {
    const id = Number(xf.getAttribute("numFmtId"));
    if (BUILTIN_DATE_FORMATS.has(id) || (custom.has(id) && isDateFormatCode(custom.get(id)!))) result.add(i);
  });
  return result;
}

// Numéro de série Excel → « 2012-05-17 ».
function serialToDate(serial: number): string {
  const ms = Math.round((serial - 25569) * 86400 * 1000);
  return new Date(ms).toISOString().slice(0, 10);
}

// Texte d'un élément <si> ou <is> : ses <t>, mises en forme comprises.
function richText(el: Element): string {
  return Array.from(el.getElementsByTagName("t"))
    .map((t) => t.textContent ?? "")
    .join("");
}

export function parseXlsx(bytes: ArrayBuffer): CsvData {
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(new Uint8Array(bytes));
  } catch {
    throw new Error("Ce fichier Excel est illisible. Enregistrez-le en .xlsx ou en CSV.");
  }

  // La première feuille du classeur, d'après ses relations.
  const workbook = xml(files, "xl/workbook.xml");
  const firstSheet = workbook?.getElementsByTagName("sheet")[0];
  const relId = firstSheet?.getAttributeNS(NS_REL, "id") ?? firstSheet?.getAttribute("r:id");
  const rels = xml(files, "xl/_rels/workbook.xml.rels");
  const target = Array.from(rels?.getElementsByTagName("Relationship") ?? [])
    .find((r) => r.getAttribute("Id") === relId)
    ?.getAttribute("Target");
  const sheetPath = target ? (target.startsWith("/") ? target.slice(1) : `xl/${target.replace(/^\.\//, "")}`) : "xl/worksheets/sheet1.xml";
  const sheet = xml(files, sheetPath) ?? xml(files, "xl/worksheets/sheet1.xml");
  if (!sheet) throw new Error("Aucune feuille trouvée dans ce classeur.");

  const shared = Array.from(xml(files, "xl/sharedStrings.xml")?.getElementsByTagName("si") ?? []).map(richText);
  const dates = dateStyles(xml(files, "xl/styles.xml"));

  const table: string[][] = [];
  for (const rowEl of Array.from(sheet.getElementsByTagName("row"))) {
    const rowIndex = Number(rowEl.getAttribute("r") ?? table.length + 1) - 1;
    const row: string[] = [];
    for (const c of Array.from(rowEl.getElementsByTagName("c"))) {
      const ref = c.getAttribute("r");
      const col = ref ? columnIndex(ref) : row.length;
      const type = c.getAttribute("t");
      const v = c.getElementsByTagName("v")[0]?.textContent ?? "";
      let value: string;
      if (type === "s") value = shared[Number(v)] ?? "";
      else if (type === "inlineStr") value = richText(c.getElementsByTagName("is")[0] ?? c);
      else if (type === "b") value = v === "1" ? "VRAI" : "FAUX";
      else if (!type || type === "n") {
        const style = Number(c.getAttribute("s") ?? -1);
        value = v && dates.has(style) ? serialToDate(Number(v)) : v;
      } else value = v; // str (formule), e (erreur)
      row[col] = value;
    }
    table[rowIndex] = Array.from(row, (x) => x ?? "");
  }
  return tableToData(Array.from(table, (r) => r ?? []));
}
