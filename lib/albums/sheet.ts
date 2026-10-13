/**
 * Lecture de la liste des finissants, dans le navigateur : un fichier Excel
 * (.xlsx, première feuille) ou CSV (virgule, point-virgule ou tabulation —
 * Excel en français exporte au point-virgule). Renvoie les lignes du tableau,
 * la première étant l'en-tête.
 */

export async function readSheet(file: File): Promise<string[][]> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  // Un .xlsx est une archive zip (« PK »).
  if (bytes[0] === 0x50 && bytes[1] === 0x4b) return readXlsx(bytes);
  return parseCsv(decodeText(bytes));
}

function decodeText(bytes: Uint8Array): string {
  const utf8 = new TextDecoder("utf-8").decode(bytes);
  // Un CSV d'Excel Windows est souvent en Windows-1252 : les accents y
  // deviennent des « � » en UTF-8.
  return utf8.includes("�") ? new TextDecoder("windows-1252").decode(bytes) : utf8;
}

export function parseCsv(text: string): string[][] {
  const clean = text.replace(/^﻿/, "");
  const firstLine = clean.split(/\r?\n/, 1)[0] ?? "";
  const delimiter = [";", "\t", ","].reduce((best, d) => (firstLine.split(d).length > firstLine.split(best).length ? d : best), ",");
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < clean.length; i++) {
    const ch = clean[i];
    if (quoted) {
      if (ch === '"' && clean[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === delimiter) {
      row.push(cell);
      cell = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && clean[i + 1] === "\n") i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else cell += ch;
  }
  if (cell || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows.map((r) => r.map((c) => c.trim())).filter((r) => r.some(Boolean));
}

// --- .xlsx : archive zip de fichiers XML, lue sans bibliothèque. ---

async function unzipEntry(bytes: Uint8Array, name: string): Promise<string | null> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  // Fin du répertoire central : signature 0x06054b50, cherchée depuis la fin.
  let eocd = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--) {
    if (view.getUint32(i, true) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error("Fichier Excel illisible.");
  const count = view.getUint16(eocd + 10, true);
  let p = view.getUint32(eocd + 16, true);
  for (let n = 0; n < count; n++) {
    const method = view.getUint16(p + 10, true);
    const size = view.getUint32(p + 20, true);
    const nameLen = view.getUint16(p + 28, true);
    const extraLen = view.getUint16(p + 30, true);
    const commentLen = view.getUint16(p + 32, true);
    const local = view.getUint32(p + 42, true);
    const entryName = new TextDecoder().decode(bytes.subarray(p + 46, p + 46 + nameLen));
    if (entryName === name) {
      const start = local + 30 + view.getUint16(local + 26, true) + view.getUint16(local + 28, true);
      const data = bytes.subarray(start, start + size);
      if (method === 0) return new TextDecoder().decode(data);
      const stream = new Blob([new Uint8Array(data)]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
      return new Response(stream).text();
    }
    p += 46 + nameLen + extraLen + commentLen;
  }
  return null;
}

function columnIndex(ref: string): number {
  const letters = ref.replace(/[0-9]/g, "");
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

async function readXlsx(bytes: Uint8Array): Promise<string[][]> {
  const parser = new DOMParser();
  const shared: string[] = [];
  const sharedXml = await unzipEntry(bytes, "xl/sharedStrings.xml");
  if (sharedXml) {
    const doc = parser.parseFromString(sharedXml, "application/xml");
    for (const si of Array.from(doc.getElementsByTagName("si"))) {
      shared.push(Array.from(si.getElementsByTagName("t")).map((t) => t.textContent ?? "").join(""));
    }
  }
  const sheetXml = await unzipEntry(bytes, "xl/worksheets/sheet1.xml");
  if (!sheetXml) throw new Error("Première feuille du fichier Excel introuvable.");
  const doc = parser.parseFromString(sheetXml, "application/xml");
  const rows: string[][] = [];
  for (const rowEl of Array.from(doc.getElementsByTagName("row"))) {
    const row: string[] = [];
    for (const c of Array.from(rowEl.getElementsByTagName("c"))) {
      const type = c.getAttribute("t");
      const v = c.getElementsByTagName("v")[0]?.textContent ?? "";
      const value =
        type === "s" ? shared[Number(v)] ?? "" : type === "inlineStr" ? c.getElementsByTagName("t")[0]?.textContent ?? "" : v;
      row[columnIndex(c.getAttribute("r") ?? "A")] = value.trim();
    }
    rows.push(Array.from(row, (cell) => cell ?? ""));
  }
  return rows.filter((r) => r.some(Boolean));
}
