"use client";

import { useEffect, useMemo, useState } from "react";
import type { ImageSourceValue } from "@/components/ImageSourcePicker";
import type { ThemeWithOverlayUrl } from "@/components/ThemesTable";
import type { Category, Template, TemplateMockup } from "@/lib/types";
import { formatIn } from "@/lib/pdf/units";
import { stageLargeFiles } from "@/lib/design/stageUpload";
import { SpinnerIcon, XIcon } from "@/components/icons";
import MockupGallery, { type MockupView } from "@/components/MockupGallery";
import FoldedPreview from "@/components/FoldedPreview";
import { parseFold } from "@/lib/folds";
import { applyOrientation } from "@/lib/pdf/orientation";
import { layerImageFieldName, type DesignLayer } from "@/lib/design/layers";

// Ajoute les calques d'un côté au formulaire : un champ JSON (métadonnées
// seulement — un fichier n'est pas sérialisable en JSON) et, pour chaque
// calque image, son fichier dans son propre champ (voir layerImageFieldName)
// — lu par lib/pdf/layers.ts (`resolveLayersFromForm`) côté serveur.
function appendLayersToForm(body: FormData, side: "front" | "back", layers: DesignLayer[]) {
  const descriptors = layers.map((l) =>
    l.type === "image"
      ? {
          id: l.id,
          type: l.type,
          widthRatio: l.widthRatio,
          positionX: l.positionX,
          positionY: l.positionY,
          rotationDeg: l.rotationDeg,
          opacity: l.opacity,
          blendMode: l.blendMode,
        }
      : l
  );
  body.append(`${side}Layers`, JSON.stringify(descriptors));
  for (const l of layers) {
    if (l.type === "image" && l.file) body.append(layerImageFieldName(side, l.id), l.file);
  }
}

function appendMosaicToForm(
  body: FormData,
  value: ImageSourceValue,
  mosaicGrid: { cols: number; rows: number },
  backPrefixed: boolean
) {
  body.append(backPrefixed ? "backMosaicCols" : "mosaicCols", String(mosaicGrid.cols));
  body.append(backPrefixed ? "backMosaicRows" : "mosaicRows", String(mosaicGrid.rows));
  (value.mosaicFiles ?? []).forEach((f, i) => {
    if (f) body.append(backPrefixed ? `backMosaicCell${i}` : `mosaicCell${i}`, f);
  });
  // Cadrage de chaque case (position/zoom), voir composeMosaicImage.
  if (value.mosaicCellAdjust?.length) {
    body.append(backPrefixed ? "backMosaicCellAdjust" : "mosaicCellAdjust", JSON.stringify(value.mosaicCellAdjust));
  }
}

function appendThemeToForm(body: FormData, value: ImageSourceValue, themeId: string) {
  body.append("themeId", themeId);
  (value.themeSlotFiles ?? []).forEach((f, i) => {
    if (f) body.append(`themeSlot${i}`, f);
  });
  if (value.themeSlotAdjust) body.append("themeSlotAdjust", JSON.stringify(value.themeSlotAdjust));
}

interface GeneratedPdf {
  url: string;
  filename: string;
}

interface MockupState {
  loading: boolean;
  url: string | null;
  // L'image elle-même, gardée pour l'aperçu du panier (voir handleOrder) :
  // la relire depuis `url` (blob:) par fetch est bloqué par la CSP, dont
  // `connect-src` n'admet pas blob:.
  blob?: Blob;
}

// Une vue à rendre : soit un mockup précis du modèle (`mockupId`), soit un
// côté imprimé pour les modèles sans bundle (papeterie).
interface ViewSpec {
  key: string;
  label: string;
  side: "front" | "back";
  mockupId: string | null;
  // Côté à plat, au format fini : la matière de l'aperçu plié, pas une vue de la galerie.
  flat?: boolean;
}

/**
 * Overlay « Vérifier et commander » : remplace l'ancienne étape séparée
 * Résumé (DesignSummary.tsx, supprimé) — même logique de génération (au
 * montage, un PDF prêt-pour-impression via /api/design/pdf, et un mockup par
 * côté via /api/design/mockup), affichée par-dessus DesignEditor plutôt que
 * dans un écran séparé (l'Outil Shopify reste un seul écran, voir
 * DesignTool.tsx). `onClose` revient à l'éditeur sans perdre l'état ;
 * `onRestart` revient au choix de modèle.
 *
 * Pas de prix affiché : aucune vraie donnée de prix (Sku n'en a pas) ni
 * d'intégration commande/panier Shopify — hors de portée, voir le plan.
 */
export default function DesignReviewOverlay({
  category,
  template,
  rotated,
  front,
  back,
  frontLayers,
  backLayers,
  backFromPdf,
  mosaicGrid,
  selectedTheme,
  mockups,
  grant,
  shopify,
  onClose,
  onRestart,
}: {
  category: Category;
  template: Template;
  rotated: boolean;
  front: ImageSourceValue;
  back: ImageSourceValue;
  frontLayers: DesignLayer[];
  backLayers: DesignLayer[];
  backFromPdf: { file: File; page: number } | null;
  mosaicGrid: { cols: number; rows: number };
  selectedTheme: ThemeWithOverlayUrl | null;
  // Mockups configurés pour ce modèle (0, 1 ou plusieurs — voir
  // supabase/migrations/0049_template_mockups.sql). Vide = on retombe sur
  // le rendu par côté (recto/verso), comme avant.
  mockups: TemplateMockup[];
  // Laissez-passer du mode public (voir lib/publicDesign.ts) : il remplace
  // la session pour /api/design/pdf et /api/design/mockup.
  grant?: string;
  // Contexte transmis par Shopify (voir app/design/page.tsx) : présent
  // uniquement quand le client vient d'une fiche produit. Son design est
  // alors enregistré et il repart vers le panier, au lieu de repartir avec
  // un PDF.
  shopify?: { variantId: string; quantity: number; returnUrl: string | null };
  onClose: () => void;
  onRestart: () => void;
}) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pdf, setPdf] = useState<GeneratedPdf | null>(null);
  // Une vue par mockup du modèle (plusieurs angles possibles) ; à défaut,
  // une par côté imprimé, comme avant.
  const viewSpecs: ViewSpec[] = useMemo(() => {
    if (mockups.length > 0) {
      // Les bundles réalistes n'ont jamais de rendu verso (voir
      // /api/design/mockup) : chaque mockup montre le recto.
      return mockups.map((m) => ({ key: m.id, label: m.name, side: "front" as const, mockupId: m.id }));
    }
    const specs: ViewSpec[] = [{ key: "front", label: "Recto", side: "front", mockupId: null }];
    if (template.two_sided) specs.push({ key: "back", label: "Verso", side: "back", mockupId: null });
    return specs;
  }, [mockups, template.two_sided]);
  // Produit plié : ses deux côtés à plat, pour l'aperçu plié (les plis
  // tournent avec le format, voir applyOrientation).
  const oriented = useMemo(() => applyOrientation(template, rotated), [template, rotated]);
  const fold = useMemo(() => (oriented.two_sided ? parseFold(oriented.fold) : null), [oriented]);
  const flatSpecs: ViewSpec[] = fold
    ? [
        { key: "flat-front", label: "", side: "front", mockupId: null, flat: true },
        { key: "flat-back", label: "", side: "back", mockupId: null, flat: true },
      ]
    : [];

  const [mockupStates, setMockupStates] = useState<Record<string, MockupState>>(() =>
    Object.fromEntries(viewSpecs.map((v) => [v.key, { loading: true, url: null }]))
  );
  const [activeMockupKey, setActiveMockupKey] = useState(() => viewSpecs[0]?.key ?? "");
  // Mockup affiché en grand (plein écran) — cliquer une vignette l'ouvre,
  // Échap/clic la referme. Le mockup est l'élément qu'on vient vraiment
  // regarder dans ce résumé : il doit pouvoir être inspecté de près.
  const [zoomed, setZoomed] = useState<{ url: string; label: string } | null>(null);
  const [ordering, setOrdering] = useState(false);
  const [orderError, setOrderError] = useState<string | null>(null);

  /**
   * Enregistre le design puis renvoie le client vers son panier Shopify.
   * L'identifiant du design voyage en propriété de ligne « _design » : le
   * préfixe « _ » est la convention Shopify pour une propriété masquée au
   * client, et c'est cette valeur que le webhook lit pour rattacher la
   * commande payée à son design.
   */
  async function handleOrder() {
    if (!shopify) return;
    setOrdering(true);
    setOrderError(null);
    try {
      const body = buildPdfFormData();
      body.append("variantId", shopify.variantId);
      body.append("quantity", String(shopify.quantity));
      // Aperçu pour le panier Shopify : le mockup que le client regarde, à
      // défaut le premier prêt. Facultatif — sans lui, le panier garde la
      // photo du produit.
      const preview =
        mockupStates[activeMockupKey]?.blob ??
        viewSpecs.map((v) => mockupStates[v.key]?.blob).find(Boolean) ??
        null;
      if (preview) body.append("preview", preview, "preview.png");
      const res = await fetch("/api/design/submit", { method: "POST", body: await stageLargeFiles(body) });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error ?? "Erreur lors de l'enregistrement du design.");
      }
      const { id } = await res.json();
      // Retour vers la fiche produit avec le seul identifiant du design.
      //
      // On ne passe PAS par /cart/add en GET : cette route ne gère pas les
      // propriétés de ligne, et Shopify répond « expected Array to be a
      // Hash: properties ». Les propriétés doivent voyager dans le
      // formulaire du thème, en POST — c'est lui qui ajoutera un champ
      // caché à partir de ce paramètre (voir le bloc Liquid fourni).
      const base = shopify.returnUrl ?? "/";
      const params = new URLSearchParams({
        pico_design: id,
        variant: shopify.variantId,
        quantity: String(shopify.quantity),
      });
      window.location.href = `${base}${base.includes("?") ? "&" : "?"}${params}`;
    } catch (err) {
      setOrderError(err instanceof Error ? err.message : "Erreur lors de l'enregistrement.");
      setOrdering(false);
    }
  }

  useEffect(() => {
    if (!zoomed) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setZoomed(null);
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [zoomed]);

  /**
   * Le FormData du PDF — les ingrédients complets du design. Extrait ici
   * parce qu'il sert DEUX fois : pour fabriquer le PDF à télécharger, et
   * pour enregistrer le design quand le client repart commander sur Shopify.
   * Une seconde construction finirait par diverger de celle-ci.
   */
  function buildPdfFormData(): FormData {
      const body = new FormData();
      body.append("templateId", template.id);
      if (grant) body.append("grant", grant);
      body.append("rotated", String(rotated));
      if (front.sourceMode === "theme" && selectedTheme) {
        appendThemeToForm(body, front, selectedTheme.id);
      } else if (front.sourceMode === "mosaic") {
        appendMosaicToForm(body, front, mosaicGrid, false);
      } else if (front.file) {
        body.append("image", front.file);
      }
      body.append("pdfPage", "1");
      body.append("positionX", String(front.positionX));
      body.append("positionY", String(front.positionY));
      body.append("zoom", String(front.scale ?? 1));
      body.append("imageRotation", String(front.rotation ?? 0));
      appendLayersToForm(body, "front", frontLayers);
      if (template.two_sided) {
        if (back.sourceMode === "mosaic") {
          appendMosaicToForm(body, back, mosaicGrid, true);
        } else if (backFromPdf) {
          body.append("backImage", backFromPdf.file);
          body.append("backPdfPage", String(backFromPdf.page));
        } else if (back.file) {
          body.append("backImage", back.file);
          body.append("backPdfPage", "1");
        }
        body.append("backPositionX", String(back.positionX));
        body.append("backPositionY", String(back.positionY));
        body.append("backZoom", String(back.scale ?? 1));
        body.append("backImageRotation", String(back.rotation ?? 0));
        appendLayersToForm(body, "back", backLayers);
      }
    return body;
  }

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    (async () => {
      try {
        const body = buildPdfFormData();
        const res = await fetch("/api/design/pdf", { method: "POST", body: await stageLargeFiles(body) });
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error(data.error ?? "Erreur lors de la génération du PDF.");
        }
        const blob = await res.blob();
        const disposition = res.headers.get("Content-Disposition") ?? "";
        const filename = disposition.match(/filename="([^"]+)"/)?.[1] ?? `${template.name}.pdf`;
        if (!cancelled) setPdf({ url: URL.createObjectURL(blob), filename });
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "Erreur lors de la génération du design.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    function setState(key: string, state: MockupState) {
      setMockupStates((prev) => ({ ...prev, [key]: state }));
    }

    async function fetchMockup(
      spec: ViewSpec,
      value: ImageSourceValue,
      sideLayers: DesignLayer[],
      pdfOverride?: { file: File; page: number }
    ) {
      const { key, side, mockupId } = spec;
      setState(key, { loading: true, url: null });
      try {
        const isMosaic = value.sourceMode === "mosaic";
        const isTheme = value.sourceMode === "theme" && Boolean(selectedTheme);
        const file = pdfOverride?.file ?? value.file;
        const hasMosaicFile = isMosaic && (value.mosaicFiles ?? []).some(Boolean);
        if (!file && !hasMosaicFile && !isTheme && sideLayers.length === 0) {
          setState(key, { loading: false, url: null });
          return;
        }
        const body = new FormData();
        body.append("templateId", template.id);
        if (grant) body.append("grant", grant);
        body.append("rotated", String(rotated));
        body.append("side", side);
        // Quel mockup rendre, quand le modèle en a plusieurs.
        if (mockupId) body.append("mockupId", mockupId);
        if (spec.flat) body.append("flat", "1");
        if (isTheme && selectedTheme) {
          appendThemeToForm(body, value, selectedTheme.id);
        } else if (isMosaic) {
          appendMosaicToForm(body, value, mosaicGrid, false);
        } else if (file) {
          body.append("image", file);
        }
        body.append("pdfPage", String(pdfOverride?.page ?? 1));
        body.append("positionX", String(value.positionX));
        body.append("positionY", String(value.positionY));
        body.append("zoom", String(value.scale ?? 1));
        body.append("imageRotation", String(value.rotation ?? 0));
        appendLayersToForm(body, side, sideLayers);

        const res = await fetch("/api/design/mockup", { method: "POST", body: await stageLargeFiles(body) });
        if (res.status === 204 || !res.ok) {
          setState(key, { loading: false, url: null });
          return;
        }
        const blob = await res.blob();
        setState(key, { loading: false, url: URL.createObjectURL(blob), blob });
      } catch {
        setState(key, { loading: false, url: null });
      }
    }

    for (const spec of [...viewSpecs, ...flatSpecs]) {
      if (spec.side === "back") fetchMockup(spec, back, backLayers, backFromPdf ?? undefined);
      else fetchMockup(spec, front, frontLayers);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const views: MockupView[] = viewSpecs.map((spec) => ({
    key: spec.key,
    label: spec.label,
    ...(mockupStates[spec.key] ?? { loading: true, url: null }),
  }));
  const hasMockupColumn = views.some((v) => v.loading || v.url);

  return (
    // Presque tout l'écran : le mockup est ce qu'on vient regarder ici.
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-2 sm:p-4">
      <div className="max-h-[calc(100dvh-1rem)] w-full max-w-[110rem] overflow-y-auto rounded-2xl bg-surface p-4 shadow-lg sm:max-h-[calc(100dvh-2rem)] sm:p-6">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm text-text-subtle">
              {category.name} — {template.name}
            </p>
            <h2 className="font-heading text-xl font-semibold text-text">Ton design</h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Fermer et revenir à l'éditeur"
            className="rounded-lg border border-border p-2 text-text-muted hover:bg-surface-muted"
          >
            <XIcon className="h-5 w-5" />
          </button>
        </div>

        {/* Le(s) mockup(s) sont l'élément principal du résumé : ils prennent
            toute la place restante (colonne de détails fixée à ~300px),
            plutôt qu'une moitié chacun comme avant. */}
        <div
          className={`mt-4 ${
            hasMockupColumn
              ? "grid gap-6 md:grid-cols-[minmax(0,280px)_minmax(0,1fr)] md:items-start"
              : "mx-auto max-w-xl"
          }`}
        >
          {/* Détails du produit à gauche de l'aperçu dès que la largeur le
              permet (sous l'aperçu sur téléphone). Pas de SKU : c'est une
              information interne. */}
          <div className="order-2 space-y-6 md:order-none">
            <dl className="grid gap-4 rounded-2xl border border-border bg-surface-muted p-5 text-sm sm:grid-cols-2 md:grid-cols-1">
              <div>
                <dt className="text-text-subtle">Produit</dt>
                <dd className="mt-0.5 font-medium text-text">{template.name}</dd>
              </div>
              <div>
                <dt className="text-text-subtle">Format</dt>
                <dd className="mt-0.5 font-medium text-text">
                  {formatIn(template.width_mm)} × {formatIn(template.height_mm)} po
                  {template.two_sided ? " · Recto verso" : " · Recto"}
                </dd>
              </div>
              {shopify ? (
                <div>
                  <dt className="text-text-subtle">Quantité</dt>
                  <dd className="mt-0.5 font-medium text-text">{shopify.quantity}</dd>
                </div>
              ) : (
                // Usage interne : le nom du fichier qu'on va télécharger.
                <div>
                  <dt className="text-text-subtle">Fichier PDF</dt>
                  <dd className="mt-0.5 break-all font-medium text-text">{pdf?.filename ?? (loading ? "…" : "—")}</dd>
                </div>
              )}
            </dl>

            {loading && (
              <div className="flex items-center justify-center gap-2 rounded-2xl border border-border p-12 text-text-muted">
                <SpinnerIcon className="h-5 w-5" />
                Préparation de ton PDF...
              </div>
            )}
            {error && <p className="text-sm text-danger">{error}</p>}

            {orderError && <p className="text-sm text-danger">{orderError}</p>}

            {/* Venu d'une fiche produit Shopify : son design est enregistré
                et il repart au panier. Sinon (usage interne, ou lien public
                sans contexte de commande), le PDF se télécharge comme avant. */}
            {shopify ? (
              <div className="flex justify-center md:justify-start">
                <button
                  type="button"
                  onClick={handleOrder}
                  disabled={ordering || loading}
                  className="inline-flex items-center justify-center gap-2 rounded-full bg-primary px-6 py-3 text-sm font-medium text-text-on-brand hover:bg-primary-hover disabled:opacity-50"
                >
                  {ordering && <SpinnerIcon className="h-4 w-4" />}
                  {ordering ? "Enregistrement..." : "Ajouter au panier"}
                </button>
              </div>
            ) : (
              pdf && (
                <div className="flex justify-center md:justify-start">
                  <a
                    href={pdf.url}
                    download={pdf.filename}
                    className="inline-flex items-center justify-center rounded-full bg-primary px-6 py-3 text-sm font-medium text-text-on-brand hover:bg-primary-hover"
                  >
                    Télécharger le PDF
                  </a>
                </div>
              )
            )}
          </div>

          {hasMockupColumn && (
            <div className="order-1 flex flex-col items-center gap-6 md:order-none">
              {fold && mockupStates["flat-front"]?.url && mockupStates["flat-back"]?.url && (
                <FoldedPreview
                  fold={fold}
                  widthMm={oriented.width_mm}
                  heightMm={oriented.height_mm}
                  frontUrl={mockupStates["flat-front"].url}
                  backUrl={mockupStates["flat-back"].url}
                />
              )}
              <MockupGallery
                views={views}
                activeKey={activeMockupKey}
                onActiveKeyChange={setActiveMockupKey}
                onZoom={(view) => view.url && setZoomed({ url: view.url, label: view.label })}
                // Toute la hauteur libre : l'écran, moins le titre de la
                // fenêtre, la légende de la vue, les vignettes et les marges.
                imageMaxHeight="max(15rem, calc(100dvh - 16rem))"
              />
            </div>
          )}
        </div>

        <div className="mt-8 flex justify-center gap-3 border-t border-border pt-6">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-border px-4 py-2 text-sm text-text-muted hover:bg-surface-muted"
          >
            Continuer à modifier
          </button>
          <button
            type="button"
            onClick={onRestart}
            className="rounded-lg border border-border px-4 py-2 text-sm text-text-muted hover:bg-surface-muted"
          >
            Recommencer un nouveau design
          </button>
        </div>
      </div>

      {/* Mockup en grand — par-dessus la modale de résumé (z plus élevé),
          fermé au clic n'importe où, par le ✕, ou avec Échap (voir l'effet
          plus haut). */}
      {zoomed && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-black/80 p-4"
          role="dialog"
          aria-modal="true"
          aria-label={`${zoomed.label} — vue agrandie`}
          onClick={() => setZoomed(null)}
        >
          <button
            type="button"
            onClick={() => setZoomed(null)}
            aria-label="Fermer la vue agrandie"
            className="absolute right-4 top-4 rounded-lg bg-white/10 p-2 text-white hover:bg-white/20"
          >
            <XIcon className="h-5 w-5" />
          </button>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={zoomed.url}
            alt={`${zoomed.label} — vue agrandie`}
            className="max-h-full max-w-full rounded-lg object-contain"
          />
        </div>
      )}
    </div>
  );
}
