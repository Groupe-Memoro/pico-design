import { logoShadowOf } from "@/lib/logoShadowSettings";
import { generateProductMockupPng } from "@/lib/pdf/mockup";
import { generateBeautyShotMockupPng } from "@/lib/pdf/beautyShot";
import { loadBeautyShotBundle } from "@/lib/pdf/beautyShotBundle";
import { generateStationeryMockupPng } from "@/lib/pdf/stationeryMockup";
import { generateFoldedMockupPng } from "@/lib/pdf/foldedMockup";
import { resolveMockupBundle } from "@/lib/templateMockups";
import { loadLogoImage } from "@/lib/pdf/logo";
import { applyOrientation } from "@/lib/pdf/orientation";
import { parseFold } from "@/lib/folds";
import type { createAdminSupabaseClient, createServerSupabaseClient } from "@/lib/supabase/server";
import type { Product, Template } from "@/lib/types";

type Db = ReturnType<typeof createServerSupabaseClient> | ReturnType<typeof createAdminSupabaseClient>;
type Admin = ReturnType<typeof createAdminSupabaseClient>;

// Erreur à montrer telle quelle (ex. bundle mockup incohérent).
export class MockupError extends Error {
  constructor(
    message: string,
    public status = 500
  ) {
    super(message);
  }
}

/**
 * Mockup PNG d'un produit Pico : le mockup réaliste du modèle (`mockupId`,
 * sinon le premier, sinon le masque/ombrage hérité). `flatFallback` : sans
 * mockup, l'aperçu du produit lui-même (à plat, ou plié pour un dépliant)
 * plutôt qu'une erreur — pour l'export Shopify, qui veut une image pour tout.
 */
export async function renderProductMockup(
  db: Db,
  admin: Admin,
  product: Product,
  rawTemplate: Template,
  { mockupId = null, flatFallback = false }: { mockupId?: string | null; flatFallback?: boolean } = {}
): Promise<Buffer> {
  const bundle = await resolveMockupBundle(db, rawTemplate, mockupId);
  if (mockupId && !bundle) throw new MockupError("Mockup introuvable pour ce modèle.", 404);
  const hasLegacy = Boolean(rawTemplate.mask_path && rawTemplate.shading_path);
  if (!bundle && !hasLegacy && !flatFallback) {
    throw new MockupError("Ce modèle n'a pas de bundle mockup (XML) ni de masque/ombrage.", 400);
  }
  const template = applyOrientation(rawTemplate, product.rotated);

  const sourceRes = await admin.storage.from("uploads").download(product.image_path);
  if (!sourceRes.data) throw new MockupError("Impossible de charger l'image du produit.");
  const sourceBuffer = Buffer.from(await sourceRes.data.arrayBuffer());

  let logoBuffer: Buffer | null = null;
  if (product.show_logo && template.logo_on_front) {
    logoBuffer = await loadLogoImage(admin, product.logo_shape, product.logo_color, product.logo_secondary_color);
  }

  if (bundle) {
    const { config, assets } = await loadBeautyShotBundle(admin.storage, bundle.xmlPath);
    return generateBeautyShotMockupPng(
      template,
      config,
      assets,
      sourceBuffer,
      logoBuffer,
      // Le cadrage enregistré du produit place son visuel sur la page —
      // le même que l'aperçu et le PDF. Celui du mockup, plus bas, ne
      // choisit que la tranche vue par la caméra.
      product.image_position_x,
      product.image_position_y,
      logoShadowOf(product),
      bundle.overlayOpacities,
      1,
      0,
      [],
      bundle.marginLeft,
      bundle.marginRight,
      bundle.marginTop,
      bundle.marginBottom,
      bundle.positionX ?? 0.5,
      bundle.positionY ?? 0.5,
      bundle.zoom ?? 1
    );
  }

  if (hasLegacy) {
    const [maskRes, shadingRes] = await Promise.all([
      admin.storage.from("overlays").download(rawTemplate.mask_path!),
      admin.storage.from("overlays").download(rawTemplate.shading_path!),
    ]);
    if (!maskRes.data || !shadingRes.data) throw new MockupError("Impossible de charger les fichiers du mockup.");
    return generateProductMockupPng(
      template,
      sourceBuffer,
      Buffer.from(await maskRes.data.arrayBuffer()),
      Buffer.from(await shadingRes.data.arrayBuffer()),
      logoBuffer,
      product.image_position_x,
      product.image_position_y,
      logoShadowOf(product)
    );
  }

  // Sans mockup : le produit à plat (carte posée), ou entrouvert s'il est plié.
  const fold = parseFold(template.fold);
  const side = await generateStationeryMockupPng({
    template,
    image: sourceBuffer,
    positionX: product.image_position_x,
    positionY: product.image_position_y,
    zoom: 1,
    flat: Boolean(fold),
    maxDimPx: fold ? 2000 : undefined,
  });
  return fold
    ? generateFoldedMockupPng({ print: side, fold, widthMm: template.width_mm, heightMm: template.height_mm, side: "front" })
    : side;
}
