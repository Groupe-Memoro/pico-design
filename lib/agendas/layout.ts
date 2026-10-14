import { lineMm, type LaidOutPage, type LayoutElement, type PrintGeometry } from "../print/elements";
import {
  MONTHS,
  OUTSIDE_YEAR,
  WEEKDAYS,
  addDays,
  dayOfMonth,
  eachDay,
  lastDayOfMonth,
  mondayOf,
  monthIndex,
  monthsBetween,
  schoolCalendar,
  weekdayIndex,
  year,
  type DayInfo,
} from "./calendar";
import {
  SPONSOR_SLOTS,
  dayKindInfo,
  type Agenda,
  type AgendaDay,
  type AgendaPage,
  type AgendaSettings,
  type CalendarContent,
  type CoverContent,
  type InfoContent,
  type NotesContent,
  type PdfContent,
  type SponsorsContent,
} from "./types";

/**
 * Mise en page d'un agenda : ses blocs deviennent des pages d'éléments posés
 * en mm (voir lib/print/elements.ts), lus tels quels par l'aperçu et le PDF.
 *
 * Gauche ou droite : la page 1 (couverture) est une page de droite, les pages
 * paires sont à gauche. Une double page (semaine ou mois sur 2 pages) commence
 * toujours à gauche : au besoin, une page de notes la précède. La marge de
 * reliure (gutterMm) est du côté intérieur : à droite d'une page de gauche, à
 * gauche d'une page de droite.
 */

type Builder = (isLeft: boolean) => LayoutElement[];

interface Ctx {
  g: PrintGeometry;
  s: AgendaSettings;
  cal: Map<string, DayInfo>;
}

const FOOTER_MM = 7;
const LINE_STEP_MM = 6.5;
const LINE_COLOR = "#d4d4d4";
const capitalize = (t: string) => t.charAt(0).toUpperCase() + t.slice(1);

// Une couleur adoucie vers le blanc (0 = la couleur, 1 = blanc).
function tint(hex: string, amount: number): string {
  const n = parseInt(hex.slice(1), 16);
  const mix = (c: number) => Math.round(c + (255 - c) * amount);
  const r = mix((n >> 16) & 255);
  const g = mix((n >> 8) & 255);
  const b = mix(n & 255);
  return `#${((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1)}`;
}

function frame(ctx: Ctx, isLeft: boolean) {
  const { g, s } = ctx;
  const left = isLeft ? s.marginMm : s.gutterMm;
  const right = isLeft ? s.gutterMm : s.marginMm;
  const footer = s.showPageNumbers ? FOOTER_MM : 0;
  return {
    x: g.bleedMm + left,
    y: g.bleedMm + s.marginMm,
    w: g.widthMm - left - right,
    h: g.heightMm - 2 * s.marginMm - footer,
  };
}

function background(ctx: Ctx): LayoutElement {
  const { g, s } = ctx;
  return { type: "rect", x: 0, y: 0, w: g.widthMm + 2 * g.bleedMm, h: g.heightMm + 2 * g.bleedMm, color: s.backgroundColor };
}

function text(
  ctx: Ctx,
  value: string,
  x: number,
  y: number,
  w: number,
  size: number,
  opts: Partial<Extract<LayoutElement, { type: "text" }>> = {}
): LayoutElement {
  return {
    type: "text",
    x,
    y,
    w,
    h: lineMm(size) * (opts.maxLines ?? 1),
    text: value,
    font: ctx.s.bodyFont,
    bold: false,
    size,
    color: ctx.s.textColor,
    align: "left",
    maxLines: 1,
    ...opts,
  };
}

function writingLines(els: LayoutElement[], x: number, top: number, w: number, bottom: number) {
  for (let y = top + LINE_STEP_MM; y <= bottom - 1; y += LINE_STEP_MM) {
    els.push({ type: "line", x1: x, y1: y, x2: x + w, y2: y, color: LINE_COLOR, widthPt: 0.4 });
  }
}

// Une case de jour : en-tête (jour, date, jour de cycle), journée spéciale,
// fond teinté s'il n'y a pas classe, lignes d'écriture.
function dayBox(ctx: Ctx, els: LayoutElement[], iso: string, x: number, y: number, w: number, h: number, big = false) {
  const { s } = ctx;
  const info = ctx.cal.get(iso) ?? OUTSIDE_YEAR;
  const kind = info.kind ? dayKindInfo(info.kind) : null;
  if (kind?.noSchool) els.push({ type: "rect", x, y, w, h, color: tint(s.accentColor, 0.9) });
  else if (!info.inYear) els.push({ type: "rect", x, y, w, h, color: "#f5f5f5" });
  els.push({ type: "line", x1: x, y1: y, x2: x + w, y2: y, color: s.accentColor, widthPt: big ? 1.2 : 0.9 });

  const size = big ? 16 : 9.5;
  const headH = lineMm(size) + 2;
  const wd = capitalize(WEEKDAYS[weekdayIndex(iso)]);
  const title = big ? `${wd} ${dayOfMonth(iso)} ${MONTHS[monthIndex(iso)]}` : `${wd} ${dayOfMonth(iso)}`;
  els.push(text(ctx, title, x + 1, y + 1.2, w * 0.62, size, { bold: true, font: big ? s.headingFont : s.bodyFont }));
  if (info.cycle) {
    els.push(text(ctx, `${s.cycleLabel} ${info.cycle}`, x + w * 0.6, y + 1.2 + (big ? lineMm(size) - lineMm(10) : 0), w * 0.4 - 1, big ? 10 : 8.5, { bold: true, color: s.accentColor, align: "right" }));
  }
  let top = y + headH;
  if (info.label) {
    els.push(text(ctx, info.label, x + 1, top, w - 2, big ? 10 : 8, { bold: true, color: kind?.color ?? s.accentColor }));
    top += lineMm(big ? 10 : 8);
  }
  if (s.dayLines && info.inYear && !kind?.noSchool) writingLines(els, x + 1, top, w - 2, y + h);
}

function monthLabel(from: string, to: string): string {
  const a = `${capitalize(MONTHS[monthIndex(from)])}`;
  const b = `${capitalize(MONTHS[monthIndex(to)])}`;
  if (monthIndex(from) === monthIndex(to)) return `${a} ${year(from)}`;
  return year(from) === year(to) ? `${a} – ${b} ${year(to)}` : `${a} ${year(from)} – ${b} ${year(to)}`;
}

function weekRange(monday: string): string {
  const sunday = addDays(monday, 6);
  const sameMonth = monthIndex(monday) === monthIndex(sunday);
  return `Semaine du ${dayOfMonth(monday)}${sameMonth ? "" : ` ${MONTHS[monthIndex(monday)]}`} au ${dayOfMonth(sunday)} ${MONTHS[monthIndex(sunday)]}`;
}

// Bandeau de commanditaire en bas de page : sa hauteur, réservée sous les jours.
function bannerHeight(f: { h: number }) {
  return Math.min(30, f.h * 0.13);
}

function pushBanner(els: LayoutElement[], f: { x: number; y: number; w: number; h: number }, path: string | undefined) {
  if (!path) return;
  const bh = bannerHeight(f);
  els.push({ type: "image", x: f.x, y: f.y + f.h - bh, w: f.w, h: bh, path, focus: "smart" });
}

function monthGrid(ctx: Ctx, first: string, isLeft: boolean): LayoutElement[] {
  const { s } = ctx;
  const f = frame(ctx, isLeft);
  const els = [background(ctx)];
  const titleSize = 24;
  els.push(text(ctx, `${capitalize(MONTHS[monthIndex(first)])} ${year(first)}`, f.x, f.y, f.w, titleSize, { font: s.headingFont, color: s.accentColor }));
  const headTop = f.y + lineMm(titleSize) + 3;
  const headH = lineMm(9) + 1.5;
  const last = lastDayOfMonth(first);
  const start = mondayOf(first);
  const weeks = Math.ceil((weekdayIndex(first) + dayOfMonth(last)) / 7);
  const cw = f.w / 7;
  const gridTop = headTop + headH;
  const ch = (f.y + f.h - gridTop) / weeks;
  // Noms complets si la case est assez large, sinon « Lun. ».
  WEEKDAYS.forEach((wd, i) => {
    const label = cw >= 24 ? capitalize(wd) : `${capitalize(wd.slice(0, 3))}.`;
    els.push(text(ctx, label, f.x + i * cw, headTop, cw, 9, { bold: true, align: "center", color: s.accentColor }));
  });
  for (let w = 0; w < weeks; w++) {
    for (let d = 0; d < 7; d++) {
      const iso = addDays(start, w * 7 + d);
      const x = f.x + d * cw;
      const y = gridTop + w * ch;
      const inMonth = monthIndex(iso) === monthIndex(first);
      const info = ctx.cal.get(iso) ?? OUTSIDE_YEAR;
      const kind = info.kind ? dayKindInfo(info.kind) : null;
      if (inMonth && kind?.noSchool) els.push({ type: "rect", x, y, w: cw, h: ch, color: tint(s.accentColor, 0.9) });
      if (!inMonth) continue;
      els.push(text(ctx, String(dayOfMonth(iso)), x + 1.2, y + 1, cw / 2, 10, { bold: true, color: info.inYear ? s.textColor : "#9a9a9a" }));
      if (info.cycle) els.push(text(ctx, `${s.cycleLabel.charAt(0)}${info.cycle}`, x + cw / 2, y + 1.3, cw / 2 - 1.2, 7.5, { align: "right", color: s.accentColor, bold: true }));
      if (info.label) {
        els.push(text(ctx, info.label, x + 1, y + lineMm(10) + 1.5, cw - 2, 6.5, { maxLines: 3, color: kind?.color ?? s.accentColor, bold: true }));
      }
    }
  }
  // Quadrillage.
  for (let w = 0; w <= weeks; w++) els.push({ type: "line", x1: f.x, y1: gridTop + w * ch, x2: f.x + f.w, y2: gridTop + w * ch, color: "#bdbdbd", widthPt: 0.5 });
  for (let d = 0; d <= 7; d++) els.push({ type: "line", x1: f.x + d * cw, y1: gridTop, x2: f.x + d * cw, y2: gridTop + weeks * ch, color: "#bdbdbd", widthPt: 0.5 });
  return els;
}

function notesPage(ctx: Ctx, isLeft: boolean, title: string, lined = true): LayoutElement[] {
  const f = frame(ctx, isLeft);
  const els = [background(ctx)];
  let top = f.y;
  if (title) {
    els.push(text(ctx, title, f.x, top, f.w, 18, { font: ctx.s.headingFont, color: ctx.s.accentColor }));
    top += lineMm(18) + 2;
  }
  if (lined) writingLines(els, f.x, top, f.w, f.y + f.h);
  return els;
}

class Pages {
  list: { blockId: string; kind: string; build: Builder; numbered: boolean }[] = [];
  constructor(private ctx: Ctx) {}
  push(blockId: string, kind: string, build: Builder, numbered = true) {
    this.list.push({ blockId, kind, build, numbered });
  }
  // La prochaine page sera-t-elle une page de gauche ? (page 1 = droite)
  nextIsLeft() {
    return this.list.length % 2 === 1;
  }
  // Une double page commence à gauche : sinon, une page de notes avant.
  ensureLeft(blockId: string, kind: string) {
    if (!this.nextIsLeft()) this.push(blockId, kind, (isLeft) => notesPage(this.ctx, isLeft, "Notes"));
  }
}

function calendarBlock(ctx: Ctx, pages: Pages, block: AgendaPage, agenda: Pick<Agenda, "start_date" | "end_date">) {
  const c = block.content as CalendarContent;
  const from = c.from || agenda.start_date;
  const to = c.to || agenda.end_date;
  if (to < from) return;
  const id = block.id;
  let banner = 0;
  const nextBanner = () => (c.banners.length ? c.banners[banner++ % c.banners.length] : undefined);

  const monthSpread = (first: string) => {
    pages.ensureLeft(id, "calendar");
    pages.push(id, "calendar", (isLeft) => monthGrid(ctx, first, isLeft));
    pages.push(id, "calendar", (isLeft) => notesPage(ctx, isLeft, `Notes — ${capitalize(MONTHS[monthIndex(first)])}`));
  };

  if (c.layout === "month1" || c.layout === "month2") {
    for (const first of monthsBetween(from, to)) {
      if (c.layout === "month2") monthSpread(first);
      else pages.push(id, "calendar", (isLeft) => monthGrid(ctx, first, isLeft));
    }
    return;
  }

  // Semaines (ou jours), avec la vue du mois avant chaque nouveau mois.
  const overview = (monday: string, firstWeek: boolean) => {
    if (!c.monthOverview) return;
    const firsts = eachDay(monday, addDays(monday, 6)).filter((d) => dayOfMonth(d) === 1 && d >= from && d <= to);
    const first = firsts[0] ?? (firstWeek ? `${from.slice(0, 8)}01` : null);
    if (!first) return;
    if (c.layout === "week2") monthSpread(first);
    else pages.push(id, "calendar", (isLeft) => monthGrid(ctx, first, isLeft));
  };

  let firstWeek = true;
  for (let monday = mondayOf(from); monday <= to; monday = addDays(monday, 7)) {
    overview(monday, firstWeek);
    firstWeek = false;
    const days = eachDay(monday, addDays(monday, 6));

    if (c.layout === "week2") {
      pages.ensureLeft(id, "calendar");
      const path = nextBanner();
      pages.push(id, "calendar", (isLeft) => {
        const f = frame(ctx, isLeft);
        const els = [background(ctx)];
        const head = lineMm(18) + 3;
        els.push(text(ctx, monthLabel(days[0], days[6]), f.x, f.y, f.w, 18, { font: ctx.s.headingFont, color: ctx.s.accentColor }));
        const rowH = (f.h - head - (path ? bannerHeight(f) + 3 : 0)) / 3;
        days.slice(0, 3).forEach((d, i) => dayBox(ctx, els, d, f.x, f.y + head + i * rowH, f.w, rowH - 2));
        return els;
      });
      pages.push(id, "calendar", (isLeft) => {
        const f = frame(ctx, isLeft);
        const els = [background(ctx)];
        const head = lineMm(18) + 3;
        els.push(text(ctx, weekRange(monday), f.x, f.y + lineMm(18) - lineMm(10), f.w, 10, { align: "right" }));
        const rowH = (f.h - head - (path ? bannerHeight(f) + 3 : 0)) / 3;
        dayBox(ctx, els, days[3], f.x, f.y + head, f.w, rowH - 2);
        dayBox(ctx, els, days[4], f.x, f.y + head + rowH, f.w, rowH - 2);
        const half = (f.w - 3) / 2;
        dayBox(ctx, els, days[5], f.x, f.y + head + 2 * rowH, half, rowH - 2);
        dayBox(ctx, els, days[6], f.x + half + 3, f.y + head + 2 * rowH, half, rowH - 2);
        pushBanner(els, f, path);
        return els;
      });
    } else if (c.layout === "week1") {
      const path = nextBanner();
      pages.push(id, "calendar", (isLeft) => {
        const f = frame(ctx, isLeft);
        const els = [background(ctx)];
        const head = lineMm(16) + 2;
        els.push(text(ctx, monthLabel(days[0], days[6]), f.x, f.y, f.w * 0.55, 16, { font: ctx.s.headingFont, color: ctx.s.accentColor }));
        els.push(text(ctx, weekRange(monday), f.x + f.w * 0.45, f.y + lineMm(16) - lineMm(9), f.w * 0.55, 9, { align: "right" }));
        const rowH = (f.h - head - (path ? bannerHeight(f) + 3 : 0)) / 6;
        days.slice(0, 5).forEach((d, i) => dayBox(ctx, els, d, f.x, f.y + head + i * rowH, f.w, rowH - 1.5));
        const half = (f.w - 3) / 2;
        dayBox(ctx, els, days[5], f.x, f.y + head + 5 * rowH, half, rowH - 1.5);
        dayBox(ctx, els, days[6], f.x + half + 3, f.y + head + 5 * rowH, half, rowH - 1.5);
        pushBanner(els, f, path);
        return els;
      });
    } else {
      // Un jour par page ; samedi et dimanche se partagent la leur.
      for (const d of days.slice(0, 5)) {
        if (d < from || d > to) continue;
        const path = nextBanner();
        pages.push(id, "calendar", (isLeft) => {
          const f = frame(ctx, isLeft);
          const els = [background(ctx)];
          const h = f.h - (path ? bannerHeight(f) + 3 : 0);
          dayBox(ctx, els, d, f.x, f.y, f.w, h, true);
          pushBanner(els, f, path);
          return els;
        });
      }
      if (days[5] <= to && days[6] >= from) {
        pages.push(id, "calendar", (isLeft) => {
          const f = frame(ctx, isLeft);
          const els = [background(ctx)];
          const half = (f.h - 4) / 2;
          dayBox(ctx, els, days[5], f.x, f.y, f.w, half, true);
          dayBox(ctx, els, days[6], f.x, f.y + half + 4, f.w, half, true);
          return els;
        });
      }
    }
  }
}

function coverPage(ctx: Ctx, c: CoverContent): LayoutElement[] {
  const { g, s } = ctx;
  const W = g.widthMm + 2 * g.bleedMm;
  const H = g.heightMm + 2 * g.bleedMm;
  const x = g.bleedMm + s.marginMm;
  const w = g.widthMm - 2 * s.marginMm;
  const els = [background(ctx)];
  const titles = (top: number) => [
    text(ctx, c.title, x, top, w, 36, { font: s.headingFont, color: s.accentColor, align: "center", maxLines: 2 }),
    text(ctx, c.subtitle, x, top + lineMm(36) * 2, w, 16, { align: "center", maxLines: 2 }),
  ];
  if (c.photo && c.photoMode === "full") {
    els.push({ type: "image", x: 0, y: 0, w: W, h: H, path: c.photo, focus: "smart" });
    const band = 48;
    els.push({ type: "rect", x: 0, y: H - g.bleedMm - band, w: W, h: band + g.bleedMm, color: s.backgroundColor });
    els.push(...titles(H - g.bleedMm - band + 5));
  } else if (c.photo) {
    const photoH = g.bleedMm + g.heightMm * 0.6;
    els.push({ type: "image", x: 0, y: 0, w: W, h: photoH, path: c.photo, focus: "smart" });
    els.push(...titles(photoH + (H - g.bleedMm - photoH - lineMm(36) * 2 - lineMm(16) * 2) / 2));
  } else {
    els.push(...titles(g.bleedMm + g.heightMm / 2 - lineMm(36) * 1.5));
  }
  return els;
}

function infoPage(ctx: Ctx, c: InfoContent, isLeft: boolean): LayoutElement[] {
  const f = frame(ctx, isLeft);
  const els = [background(ctx)];
  let top = f.y;
  if (c.title) {
    els.push(text(ctx, c.title, f.x, top, f.w, 22, { font: ctx.s.headingFont, color: ctx.s.accentColor }));
    top += lineMm(22) + 3;
  }
  if (c.photo) {
    const ph = (f.y + f.h - top) * 0.45;
    els.push({ type: "image", x: f.x, y: top, w: f.w, h: ph, path: c.photo, focus: "smart" });
    top += ph + 4;
  }
  if (c.text.trim()) {
    const size = 10.5;
    const lines = Math.max(1, Math.floor((f.y + f.h - top) / lineMm(size)));
    els.push({ ...(text(ctx, c.text, f.x, top, f.w, size, { maxLines: lines }) as Extract<LayoutElement, { type: "text" }>), h: f.y + f.h - top });
  }
  return els;
}

function sponsorsPage(ctx: Ctx, c: SponsorsContent, isLeft: boolean): LayoutElement[] {
  const f = frame(ctx, isLeft);
  const els = [background(ctx)];
  let top = f.y;
  if (c.title) {
    els.push(text(ctx, c.title, f.x, top, f.w, 20, { font: ctx.s.headingFont, color: ctx.s.accentColor, align: "center" }));
    top += lineMm(20) + 4;
  }
  const n = SPONSOR_SLOTS[c.layout];
  const landscape = ctx.g.widthMm > ctx.g.heightMm;
  const { cols, rows } =
    n === 1 ? { cols: 1, rows: 1 } : n === 2 ? (landscape ? { cols: 2, rows: 1 } : { cols: 1, rows: 2 }) : n === 4 ? { cols: 2, rows: 2 } : landscape ? { cols: 3, rows: 2 } : { cols: 2, rows: 3 };
  const gap = 4;
  const cw = (f.w - (cols - 1) * gap) / cols;
  const ch = (f.y + f.h - top - (rows - 1) * gap) / rows;
  for (let i = 0; i < n; i++) {
    els.push({ type: "image", x: f.x + (i % cols) * (cw + gap), y: top + Math.floor(i / cols) * (ch + gap), w: cw, h: ch, path: c.photos[i] ?? null, focus: "smart" });
  }
  return els;
}

export function layoutAgenda(
  g: PrintGeometry,
  agenda: Pick<Agenda, "start_date" | "end_date">,
  settings: AgendaSettings,
  blocks: AgendaPage[],
  days: AgendaDay[]
): LaidOutPage[] {
  const ctx: Ctx = { g, s: settings, cal: schoolCalendar(agenda.start_date, agenda.end_date, days, settings.cycleLength) };
  const pages = new Pages(ctx);

  for (const block of [...blocks].sort((a, b) => a.position - b.position)) {
    const c = block.content;
    switch (block.kind) {
      case "cover":
        pages.push(block.id, "cover", () => coverPage(ctx, c as CoverContent), false);
        break;
      case "calendar":
        calendarBlock(ctx, pages, block, agenda);
        break;
      case "info":
        pages.push(block.id, "info", (isLeft) => infoPage(ctx, c as InfoContent, isLeft));
        break;
      case "pdf": {
        const pdf = c as PdfContent;
        for (let i = 0; pdf.path && i < pdf.pageCount; i++) {
          // Le PDF fourni occupe le format fini ; ses pages ont leurs propres numéros.
          pages.push(block.id, "pdf", () => [background(ctx), { type: "pdf", x: g.bleedMm, y: g.bleedMm, w: g.widthMm, h: g.heightMm, path: pdf.path!, pageIndex: i }], false);
        }
        break;
      }
      case "sponsors":
        pages.push(block.id, "sponsors", (isLeft) => sponsorsPage(ctx, c as SponsorsContent, isLeft));
        break;
      case "notes": {
        const n = c as NotesContent;
        for (let i = 0; i < n.count; i++) {
          pages.push(block.id, "notes", (isLeft) => notesPage(ctx, isLeft, i === 0 ? n.title : "", n.style === "lined"));
        }
        break;
      }
    }
  }

  return pages.list.map((p, i) => {
    const isLeft = i % 2 === 1;
    const elements = p.build(isLeft);
    const number = settings.showPageNumbers && p.numbered ? i + 1 : null;
    if (number !== null) {
      const f = frame(ctx, isLeft);
      // Numéro au coin extérieur, sous le cadre.
      elements.push(text(ctx, String(number), f.x, g.bleedMm + g.heightMm - settings.marginMm - lineMm(8) + 2, f.w, 8, { align: isLeft ? "left" : "right", color: "#7a7a7a" }));
    }
    return { blockId: p.blockId, kind: p.kind, number, elements };
  });
}
