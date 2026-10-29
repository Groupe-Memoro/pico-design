import { requireApiUser } from "@/lib/api";
import { NextResponse } from "next/server";
import { contentDisposition } from "@/lib/contentDisposition";
import type { Category, Product, ProductCollection, Sku, Template } from "@/lib/types";

export const runtime = "nodejs";

// Colonnes du modèle d'import de produits Shopify (CSV actuel). Les deux
// dernières sont les métachamps lus par le bloc Liquid de la page Aide.
const HEADERS = [
  "Title",
  "URL handle",
  "Description",
  "Vendor",
  "Product category",
  "Type",
  "Tags",
  "Published on online store",
  "Status",
  "SKU",
  "Option1 name",
  "Option1 value",
  "Price",
  "Charge tax",
  "Inventory tracker",
  "Inventory quantity",
  "Continue selling when out of stock",
  "Requires shipping",
  "Fulfillment service",
  "Product image URL",
  "Image position",
  "Image alt text",
  "Variant image URL",
  "Gift card",
  "SEO title",
  "SEO description",
  "Produit Pico (product.metafields.custom.pico_product)",
  "Variantes Pico (product.metafields.custom.pico_variants)",
] as const;
type Row = Partial<Record<(typeof HEADERS)[number], string>>;

function csvCell(value: string | undefined): string {
  const v = value ?? "";
  return /[",\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

// « Cartes de Noël 2026 » → « cartes-de-noel-2026 ».
function handleize(text: string): string {
  return (
    text
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "produit"
  );
}

interface ExportItem {
  id: string;
  images: string[];
}

/**
 * Fichier d'import Shopify des produits choisis : un produit Shopify par
 * collection (une variante « Format » par produit Pico), ou par produit Pico
 * s'il n'est dans aucune collection. Les images sont les mockups préparés par
 * /api/products/[id]/shopify-images. Les produits arrivent en brouillon.
 */
export async function POST(request: Request) {
  const session = await requireApiUser();
  if (session instanceof NextResponse) return session;
  const { supabase } = session;

  const body = (await request.json().catch(() => ({}))) as { price?: unknown; items?: unknown };
  const price = Number(String(body.price ?? "").replace(",", "."));
  if (!Number.isFinite(price) || price < 0) return NextResponse.json({ error: "Prix invalide." }, { status: 400 });
  const items = (Array.isArray(body.items) ? body.items : [])
    .filter((it): it is ExportItem => typeof it?.id === "string" && Array.isArray(it?.images))
    .slice(0, 500);
  if (items.length === 0) return NextResponse.json({ error: "Choisissez au moins un produit." }, { status: 400 });
  const imagesById = new Map(items.map((it) => [it.id, it.images.filter((u) => typeof u === "string")]));

  const { data: productRows } = await supabase
    .from("products")
    .select("*")
    .in("id", items.map((it) => it.id));
  const products = ((productRows as Product[] | null) ?? []).sort((a, b) => a.name.localeCompare(b.name, "fr"));
  const templateIds = Array.from(new Set(products.map((p) => p.template_id)));
  const collectionIds = Array.from(new Set(products.flatMap((p) => (p.collection_id ? [p.collection_id] : []))));
  const [{ data: templates }, { data: categories }, { data: skus }, { data: collections }] = await Promise.all([
    supabase.from("templates").select("*").in("id", templateIds),
    supabase.from("categories").select("*"),
    supabase.from("skus").select("*"),
    collectionIds.length
      ? supabase.from("product_collections").select("*").in("id", collectionIds)
      : Promise.resolve({ data: [] }),
  ]);
  const templateById = new Map(((templates as Template[] | null) ?? []).map((t) => [t.id, t]));
  const categoryById = new Map(((categories as Category[] | null) ?? []).map((c) => [c.id, c.name]));
  const skuById = new Map(((skus as Sku[] | null) ?? []).map((s) => [s.id, s.sku]));
  const collectionById = new Map(((collections as ProductCollection[] | null) ?? []).map((c) => [c.id, c.name]));

  // Regroupement : une collection = un produit Shopify.
  const groups = new Map<string, { title: string; products: Product[] }>();
  for (const p of products) {
    const collection = p.collection_id ? collectionById.get(p.collection_id) : undefined;
    const key = collection ? `c:${p.collection_id}` : `p:${p.id}`;
    if (!groups.has(key)) groups.set(key, { title: collection ?? p.name, products: [] });
    groups.get(key)!.products.push(p);
  }

  const usedHandles = new Set<string>();
  const rows: Row[] = [];
  const priceText = price.toFixed(2);
  for (const group of Array.from(groups.values())) {
    let handle = handleize(group.title);
    for (let n = 2; usedHandles.has(handle); n++) handle = `${handleize(group.title)}-${n}`;
    usedHandles.add(handle);

    const single = group.products.length === 1 && !group.products[0].collection_id;
    // Valeur de l'option : le nom du modèle, rendu unique au besoin.
    const variantTitles = new Map<string, string>();
    const seen = new Map<string, number>();
    for (const p of group.products) {
      const base = templateById.get(p.template_id)?.name ?? p.name;
      const count = (seen.get(base) ?? 0) + 1;
      seen.set(base, count);
      variantTitles.set(p.id, count > 1 ? `${base} (${count})` : base);
    }
    const picoVariants = Object.fromEntries(group.products.map((p) => [variantTitles.get(p.id)!, p.id]));

    const categoriesOfGroup = Array.from(
      new Set(group.products.flatMap((p) => {
        const name = categoryById.get(templateById.get(p.template_id)?.category_id ?? "");
        return name ? [name] : [];
      }))
    );

    const extraImages: string[] = [];
    let position = 0;
    group.products.forEach((p, i) => {
      const template = templateById.get(p.template_id);
      const [first, ...rest] = imagesById.get(p.id) ?? [];
      const row: Row = {
        "URL handle": handle,
        "Option1 name": single ? "Title" : "Format",
        "Option1 value": single ? "Default Title" : variantTitles.get(p.id),
        SKU: template?.sku_id ? skuById.get(template.sku_id) : undefined,
        Price: priceText,
        "Charge tax": "TRUE",
        "Inventory tracker": "",
        "Continue selling when out of stock": "DENY",
        "Requires shipping": "TRUE",
        "Fulfillment service": "manual",
        "Gift card": "FALSE",
      };
      if (first) {
        row["Product image URL"] = first;
        row["Image position"] = String(++position);
        row["Image alt text"] = `${group.title} — ${single ? p.name : variantTitles.get(p.id)}`;
        if (!single) row["Variant image URL"] = first;
      }
      extraImages.push(...rest);
      if (i === 0) {
        Object.assign(row, {
          Title: group.title,
          Vendor: "Pico",
          Type: categoriesOfGroup[0] ?? "",
          Tags: categoriesOfGroup.join(", "),
          "Published on online store": "FALSE",
          Status: "draft",
          "SEO title": group.title,
          ...(single
            ? { "Produit Pico (product.metafields.custom.pico_product)": p.id }
            : { "Variantes Pico (product.metafields.custom.pico_variants)": JSON.stringify(picoVariants) }),
        } satisfies Row);
      }
      rows.push(row);
    });
    for (const url of extraImages) {
      rows.push({
        "URL handle": handle,
        "Product image URL": url,
        "Image position": String(++position),
        "Image alt text": group.title,
      });
    }
  }

  // BOM : Excel ouvre ainsi le fichier en UTF-8 (accents intacts).
  const csv =
    "﻿" +
    [HEADERS.join(","), ...rows.map((r) => HEADERS.map((h) => csvCell(r[h])).join(","))].join("\r\n") +
    "\r\n";
  const date = new Date().toISOString().slice(0, 10);
  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": contentDisposition(`shopify-produits-${date}.csv`),
      "Cache-Control": "no-store",
    },
  });
}
