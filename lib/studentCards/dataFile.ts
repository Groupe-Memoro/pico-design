// Lecture d'un fichier de données (Excel .xlsx ou CSV) dans le navigateur :
// celui qu'on dépose, ou celui conservé avec le document (voir 0081).

import { decodeCsv, parseCsv, type CsvData } from "./csv";
import { parseXlsx } from "./xlsx";

export function parseDataFile(bytes: ArrayBuffer, name: string): CsvData {
  if (/\.xls$/i.test(name)) {
    throw new Error("L'ancien format Excel (.xls) n'est pas lu : enregistrez le fichier en .xlsx ou en CSV.");
  }
  const data = /\.xlsx$/i.test(name) ? parseXlsx(bytes) : parseCsv(decodeCsv(bytes));
  if (data.columns.length === 0 || data.rows.length === 0) {
    throw new Error("Ce fichier ne contient aucune donnée (la première ligne doit donner les colonnes).");
  }
  return data;
}
