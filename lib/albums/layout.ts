import {
  FREE_LAYOUT_SLOTS,
  sortStudents,
  studentDisplayName,
  type AlbumPage,
  type AlbumSettings,
  type AlbumStudent,
  type CoverContent,
  type FreeContent,
  type PortraitsContent,
  type SignaturesContent,
} from "./types";

import { lineMm, type LaidOutPage, type LayoutElement, type PrintGeometry } from "../print/elements";

export { type LaidOutPage, type LayoutElement } from "../print/elements";
export type AlbumGeometry = PrintGeometry;

/**
 * Mise en page d'un album : transforme ses blocs (couverture, portraits, page
 * libre, signatures) en pages d'éléments posés en mm (voir lib/print/elements.ts).
 */

const PT_TO_MM = 25.4 / 72;

// Cadre utile d'une page : le fini moins la marge.
function frame(g: AlbumGeometry, s: AlbumSettings) {
  const x = g.bleedMm + s.marginMm;
  const y = g.bleedMm + s.marginMm;
  return { x, y, w: g.widthMm - 2 * s.marginMm, h: g.heightMm - 2 * s.marginMm };
}

function background(g: AlbumGeometry, s: AlbumSettings): LayoutElement {
  return { type: "rect", x: 0, y: 0, w: g.widthMm + 2 * g.bleedMm, h: g.heightMm + 2 * g.bleedMm, color: s.backgroundColor };
}

const FOOTER_MM = 8;

function heading(text: string, x: number, y: number, w: number, size: number, s: AlbumSettings, color = s.accentColor): LayoutElement {
  return { type: "text", x, y, w, h: lineMm(size), text, font: s.headingFont, bold: false, size, color, align: "center", maxLines: 1 };
}

function grid(n: number, landscape: boolean): { cols: number; rows: number } {
  if (n <= 1) return { cols: 1, rows: 1 };
  if (n === 2) return landscape ? { cols: 2, rows: 1 } : { cols: 1, rows: 2 };
  if (n === 4) return { cols: 2, rows: 2 };
  return landscape ? { cols: 3, rows: 2 } : { cols: 2, rows: 3 };
}

function coverPages(c: CoverContent, g: AlbumGeometry, s: AlbumSettings): LayoutElement[][] {
  const W = g.widthMm + 2 * g.bleedMm;
  const H = g.heightMm + 2 * g.bleedMm;
  const f = frame(g, s);
  const els: LayoutElement[] = [background(g, s)];
  const title = (y: number, color = s.accentColor) =>
    ({ type: "text", x: f.x, y, w: f.w, h: lineMm(40) * 2, text: c.title, font: s.headingFont, bold: false, size: 40, color, align: "center", maxLines: 2 }) as LayoutElement;
  const subtitle = (y: number) =>
    ({ type: "text", x: f.x, y, w: f.w, h: lineMm(18) * 2, text: c.subtitle, font: s.bodyFont, bold: false, size: 18, color: s.textColor, align: "center", maxLines: 2 }) as LayoutElement;

  if (c.photo && c.photoMode === "full") {
    els.push({ type: "image", x: 0, y: 0, w: W, h: H, path: c.photo, focus: "smart" });
    // Bandeau du fond, en bas, pour que le titre reste lisible sur la photo.
    const band = 52;
    els.push({ type: "rect", x: 0, y: H - g.bleedMm - band, w: W, h: band + g.bleedMm, color: s.backgroundColor });
    els.push(title(H - g.bleedMm - band + 6), subtitle(H - g.bleedMm - band + 6 + lineMm(40) * 2));
  } else if (c.photo) {
    const photoH = g.bleedMm + g.heightMm * 0.62;
    els.push({ type: "image", x: 0, y: 0, w: W, h: photoH, path: c.photo, focus: "smart" });
    const top = photoH + (H - g.bleedMm - photoH - lineMm(40) * 2 - lineMm(18) * 2) / 2;
    els.push(title(top), subtitle(top + lineMm(40) * 2));
  } else {
    const top = g.bleedMm + g.heightMm / 2 - lineMm(40) * 1.5;
    els.push(title(top), subtitle(top + lineMm(40) * 2));
  }
  return [els];
}

function portraitPages(
  c: PortraitsContent,
  students: AlbumStudent[],
  g: AlbumGeometry,
  s: AlbumSettings
): LayoutElement[][] {
  const f = frame(g, s);
  const wanted = c.group ? students.filter((st) => st.group_name === c.group) : students;
  const sorted = sortStudents(wanted);

  // Un groupe par série de pages quand le bloc les prend tous et que la liste
  // en a ; sinon une seule série.
  const groups = new Map<string, AlbumStudent[]>();
  for (const st of sorted) {
    const key = c.group ? c.group : st.group_name;
    groups.set(key, [...(groups.get(key) ?? []), st]);
  }
  if (groups.size === 0) groups.set(c.group, []);

  const titleSize = 26;
  const groupSize = 16;
  const titleH = c.title ? lineMm(titleSize) + 3 : 0;
  const hasGroupHeadings = [...groups.keys()].some((k) => k) && !(c.group && !c.title);
  const groupH = hasGroupHeadings || (c.group && !c.title) ? lineMm(groupSize) + 3 : 0;
  // Même taille de case sur toutes les pages : calculée avec l'en-tête le plus
  // haut (titre + groupe), celui de la première page.
  const footer = s.showPageNumbers ? FOOTER_MM : 0;
  const gridTop = titleH + groupH;
  const gap = Math.max(2, Math.min(6, f.w * 0.025));
  const cellW = (f.w - (s.columns - 1) * gap) / s.columns;
  const cellH = (f.h - gridTop - footer - (s.rows - 1) * gap) / s.rows;
  const nameSize = Math.max(6, Math.min(11, cellW / 4.8));
  const nameH = lineMm(nameSize) * 2 + 1;
  // Photo au format 4:5, bornée par la case.
  let photoW = cellW;
  let photoH = photoW * 1.25;
  if (photoH > cellH - nameH) {
    photoH = Math.max(5, cellH - nameH);
    photoW = photoH / 1.25;
  }

  const perPage = s.columns * s.rows;
  const pages: LayoutElement[][] = [];
  let first = true;
  for (const [groupName, list] of groups) {
    const chunks = list.length === 0 ? [[]] : Array.from({ length: Math.ceil(list.length / perPage) }, (_, i) => list.slice(i * perPage, (i + 1) * perPage));
    for (const chunk of chunks) {
      const els: LayoutElement[] = [background(g, s)];
      let y = f.y;
      if (first && c.title) {
        els.push(heading(c.title, f.x, y, f.w, titleSize, s));
        y += titleH;
      }
      const groupLabel = c.group && !c.title ? c.group : groupName;
      if (groupH && groupLabel) els.push(heading(groupLabel, f.x, y, f.w, groupSize, s, s.textColor));
      const gridY = f.y + gridTop;
      if (chunk.length === 0) {
        els.push({ type: "text", x: f.x, y: gridY + 10, w: f.w, h: lineMm(12), text: "Aucun finissant pour l'instant", font: s.bodyFont, bold: false, size: 12, color: "#9a9a9a", align: "center", maxLines: 1 });
      }
      chunk.forEach((st, i) => {
        const col = i % s.columns;
        const row = Math.floor(i / s.columns);
        const cx = f.x + col * (cellW + gap);
        const cy = gridY + row * (cellH + gap);
        // Sans photo : une case grise, plutôt qu'un trou dans la grille.
        if (!st.photo_path) els.push({ type: "rect", x: cx + (cellW - photoW) / 2, y: cy, w: photoW, h: photoH, color: "#e6e6e6" });
        else els.push({ type: "image", x: cx + (cellW - photoW) / 2, y: cy, w: photoW, h: photoH, path: st.photo_path, focus: "top" });
        els.push({
          type: "text",
          x: cx,
          y: cy + photoH + 1,
          w: cellW,
          h: nameH - 1,
          text: studentDisplayName(st, s.nameFormat),
          font: s.bodyFont,
          bold: true,
          size: nameSize,
          color: s.textColor,
          align: "center",
          maxLines: 2,
        });
      });
      pages.push(els);
      first = false;
    }
  }
  return pages;
}

function freePages(c: FreeContent, g: AlbumGeometry, s: AlbumSettings): LayoutElement[][] {
  const f = frame(g, s);
  const els: LayoutElement[] = [background(g, s)];
  const footer = s.showPageNumbers ? FOOTER_MM : 0;
  let top = f.y;
  if (c.title) {
    els.push(heading(c.title, f.x, top, f.w, 24, s));
    top += lineMm(24) + 4;
  }
  // Hauteur du texte estimée (≈ 0,5 em par caractère) : le PDF, lui, mesure
  // vraiment, et rétrécit si ça déborde.
  const textSize = 11;
  let textH = 0;
  if (c.text.trim()) {
    const charsPerLine = Math.max(10, f.w / (textSize * 0.5 * PT_TO_MM));
    const lines = c.text.split("\n").reduce((n, para) => n + Math.max(1, Math.ceil(para.length / charsPerLine)), 0);
    textH = Math.min(f.h * 0.4, lines * lineMm(textSize) + 1);
  }
  const photosBottom = f.y + f.h - footer - (textH ? textH + 4 : 0);
  const n = FREE_LAYOUT_SLOTS[c.layout];
  const { cols, rows } = grid(n, g.widthMm > g.heightMm);
  const gap = 4;
  const cw = (f.w - (cols - 1) * gap) / cols;
  const ch = (photosBottom - top - (rows - 1) * gap) / rows;
  for (let i = 0; i < n; i++) {
    const col = i % cols;
    const row = Math.floor(i / cols);
    els.push({ type: "image", x: f.x + col * (cw + gap), y: top + row * (ch + gap), w: cw, h: ch, path: c.photos[i] ?? null, focus: "smart" });
  }
  if (textH) {
    els.push({
      type: "text",
      x: f.x,
      y: photosBottom + 4,
      w: f.w,
      h: textH,
      text: c.text,
      font: s.bodyFont,
      bold: false,
      size: textSize,
      color: s.textColor,
      align: "center",
      maxLines: Math.max(1, Math.floor(textH / lineMm(textSize))),
    });
  }
  return [els];
}

function signaturePages(c: SignaturesContent, g: AlbumGeometry, s: AlbumSettings): LayoutElement[][] {
  const f = frame(g, s);
  const footer = s.showPageNumbers ? FOOTER_MM : 0;
  return Array.from({ length: c.count }, (_, i) => {
    const els: LayoutElement[] = [background(g, s)];
    let top = f.y;
    if (c.title && i === 0) {
      els.push(heading(c.title, f.x, top, f.w, 26, s));
      top += lineMm(26) + 6;
    }
    if (c.style === "lined") {
      for (let y = top + 10; y <= f.y + f.h - footer; y += 10) {
        els.push({ type: "line", x1: f.x, y1: y, x2: f.x + f.w, y2: y, color: "#c9c9c9", widthPt: 0.5 });
      }
    }
    return els;
  });
}

export function layoutAlbum(
  g: AlbumGeometry,
  settings: AlbumSettings,
  blocks: AlbumPage[],
  students: AlbumStudent[]
): LaidOutPage[] {
  const pages: LaidOutPage[] = [];
  for (const block of [...blocks].sort((a, b) => a.position - b.position)) {
    const content = block.content;
    const els =
      block.kind === "cover"
        ? coverPages(content as CoverContent, g, settings)
        : block.kind === "portraits"
          ? portraitPages(content as PortraitsContent, students, g, settings)
          : block.kind === "free"
            ? freePages(content as FreeContent, g, settings)
            : signaturePages(content as SignaturesContent, g, settings);
    for (const elements of els) pages.push({ blockId: block.id, kind: block.kind, number: null, elements });
  }

  // Numéros : la couverture compte pour la page 1 mais n'en porte pas.
  pages.forEach((page, i) => {
    if (!settings.showPageNumbers || page.kind === "cover") return;
    page.number = i + 1;
    page.elements.push({
      type: "text",
      x: g.bleedMm,
      y: g.bleedMm + g.heightMm - settings.marginMm / 2 - lineMm(9) / 2,
      w: g.widthMm,
      h: lineMm(9),
      text: String(i + 1),
      font: settings.bodyFont,
      bold: false,
      size: 9,
      color: settings.textColor,
      align: "center",
      maxLines: 1,
    });
  });
  return pages;
}
