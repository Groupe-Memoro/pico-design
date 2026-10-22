"use client";

import { useEffect, useRef, useState } from "react";
import { DEFAULT_LOGO_SHADOW, LOGO_SHADOW_RANGES, logoShadowSettingsOf, type LogoShadowSettings } from "@/lib/logoShadowSettings";
import type { Category, LogoShape, Product, ProductCollection, Template } from "@/lib/types";
import type { VisualWithUrl } from "@/components/VisualsGrid";
import ImageSourcePicker, { DEFAULT_TILE_SIZE_MM, isPdfFile, type ImageSourceValue } from "@/components/ImageSourcePicker";
import { formatIn } from "@/lib/pdf/units";
import { pdfPageCount, planPdfPages } from "@/lib/pdf/pdfPages";
import { LOGO_COLOR_PALETTE } from "@/lib/logoColors";
import { applyOrientation, isLandscape } from "@/lib/pdf/orientation";
import { allowsPanels, allowsSheet, panelCells, parseFold } from "@/lib/folds";
import { stageLargeFiles } from "@/lib/design/stageUpload";
import { PanelLeftRightDashedIcon, SpinnerIcon, SquareSplitHorizontalIcon } from "@/components/icons";
import ColorPickerButton from "@/components/ColorPickerButton";
import { templateOptionLabel } from "@/lib/templateLabel";

const SHADOW_CONTROLS: { key: keyof LogoShadowSettings; label: string; unit: string }[] = [
  { key: "blur", label: "Flou", unit: "%" },
  { key: "distance", label: "Distance", unit: "%" },
  { key: "angle", label: "Angle", unit: "°" },
  { key: "opacity", label: "Opacité", unit: "%" },
];

// Saturation passagère de Supabase (connexions du stockage épuisées, visuel
// illisible un instant, erreur 5xx) : le produit n'a pas été enregistré,
// on peut donc le renvoyer sans risque de doublon.
const TRANSIENT_ERROR = /too many connections|impossible de télécharger|timeout|timed out|fetch failed|ECONNRESET/i;
const RETRY_DELAYS_MS = [1500, 4000, 8000];

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function postProductWithRetry(body: FormData) {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch("/api/products", { method: "POST", body }).catch(() => null);
    const data = res ? await res.json().catch(() => ({})) : { error: "fetch failed" };
    const transient = !res || res.status >= 500 || TRANSIENT_ERROR.test(String(data.error ?? ""));
    if (res && (res.ok || !transient)) return { res, data };
    if (attempt >= RETRY_DELAYS_MS.length) {
      return { res: res ?? new Response(null, { status: 503 }), data: res ? data : { error: "Serveur injoignable." } };
    }
    await sleep(RETRY_DELAYS_MS[attempt]);
  }
}

const LAST_CATEGORY_KEY = "pico:product-form-category";

const LOGO_SHAPES: { value: LogoShape; label: string }[] = [
  { value: "logo", label: "Logo" },
  { value: "pastille", label: "Pastille" },
];

export default function ProductForm({
  templates,
  categories,
  visuals,
  collections,
  product,
  currentImageUrl,
  currentBackImageUrl,
  onSuccess,
  onBusyChange,
  onProgressChange,
  initialCategoryId = "",
}: {
  templates: Template[];
  categories: Category[];
  visuals: VisualWithUrl[];
  collections: ProductCollection[];
  product?: Product;
  currentImageUrl?: string | null;
  currentBackImageUrl?: string | null;
  onSuccess: () => void;
  onBusyChange?: (busy: boolean) => void;
  // Création de plusieurs produits : la progression, pour le voile de la fenêtre.
  onProgressChange?: (progress: { done: number; total: number } | null) => void;
  // Création : catégorie dont les modèles sont seuls affichés d'emblée (le
  // filtre de la page Produits, sinon la dernière choisie).
  initialCategoryId?: string;
}) {
  const isEditing = Boolean(product);
  const [name, setName] = useState(product?.name ?? "");
  const [nameTouched, setNameTouched] = useState(isEditing);
  const [templateId, setTemplateId] = useState(product?.template_id ?? templates[0]?.id ?? "");
  const [presetCategoryId, setPresetCategoryId] = useState(() => {
    if (isEditing) return "";
    let id = initialCategoryId;
    if (!id) {
      try {
        id = localStorage.getItem(LAST_CATEGORY_KEY) ?? "";
      } catch {
        // Stockage indisponible (navigation privée) : pas de présélection.
      }
    }
    return templates.some((t) => t.category_id === id) ? id : "";
  });
  const [selectedTemplateIds, setSelectedTemplateIds] = useState<string[]>([]);
  // Modèles affichés à la création : ceux de la catégorie filtrée, ou tous.
  const visibleTemplates = presetCategoryId ? templates.filter((t) => t.category_id === presetCategoryId) : templates;
  const [collectionId, setCollectionId] = useState(product?.collection_id ?? "");
  const [front, setFront] = useState<ImageSourceValue>({
    sourceMode: product?.visual_mode ?? "upload",
    file: null,
    visualId: product?.visual_id ?? visuals[0]?.id ?? "",
    tileSizeMm: product?.tile_size_mm ?? DEFAULT_TILE_SIZE_MM,
    positionX: product?.image_position_x ?? 0.5,
    positionY: product?.image_position_y ?? 0.5,
  });
  const [back, setBack] = useState<ImageSourceValue>({
    sourceMode: product?.back_visual_mode ?? "upload",
    file: null,
    visualId: product?.back_visual_id ?? visuals[0]?.id ?? "",
    tileSizeMm: product?.back_tile_size_mm ?? DEFAULT_TILE_SIZE_MM,
    positionX: product?.back_image_position_x ?? 0.5,
    positionY: product?.back_image_position_y ?? 0.5,
  });
  const [sameAsFront, setSameAsFront] = useState(false);
  const [rotated, setRotated] = useState(product?.rotated ?? false);
  const [showLogo, setShowLogo] = useState(product?.show_logo ?? true);
  const [logoShape, setLogoShape] = useState<LogoShape>(product?.logo_shape ?? "logo");
  const [logoColor, setLogoColor] = useState(product?.logo_color ?? "#000000");
  const [logoSecondaryColor, setLogoSecondaryColor] = useState(
    product?.logo_secondary_color ?? "#FFFFFF"
  );
  const [logoShadow, setLogoShadow] = useState(product?.logo_shadow ?? false);
  const [shadowSettings, setShadowSettings] = useState<LogoShadowSettings>(
    product ? logoShadowSettingsOf(product) : DEFAULT_LOGO_SHADOW
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [createProgress, setCreateProgress] = useState<{ done: number; total: number } | null>(
    null
  );

  useEffect(() => {
    onBusyChange?.(loading);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading]);

  useEffect(() => {
    onProgressChange?.(createProgress);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [createProgress]);

  // En édition, il n'y a toujours qu'un seul modèle. En création, l'aperçu
  // (et le verso) ne sont possibles que si un seul modèle est coché parmi
  // la sélection.
  const previewTemplateId = isEditing
    ? templateId
    : selectedTemplateIds.length === 1
    ? selectedTemplateIds[0]
    : "";
  const isMultiTemplate = !isEditing && selectedTemplateIds.length > 1;
  const previewTemplate = templates.find((t) => t.id === previewTemplateId) ?? null;
  const effectiveTemplate = previewTemplate ? applyOrientation(previewTemplate, rotated) : null;
  const showOrientationToggle =
    Boolean(previewTemplate?.allow_orientation_change) && !isMultiTemplate;
  // "Paysage" = plus large que haut. Le bouton actif reflète l'orientation
  // effective (après inversion éventuelle par `rotated`), pas le modèle brut.
  const effectiveIsLandscape = effectiveTemplate
    ? isLandscape(effectiveTemplate.width_mm, effectiveTemplate.height_mm)
    : true;
  // Réinitialisée quand le modèle change (voir useEffect ci-dessous) plutôt
  // qu'à chaque rendu, pour ne pas écraser le choix de l'utilisateur.
  const previousPreviewTemplateIdRef = useRef(previewTemplateId);
  useEffect(() => {
    if (previousPreviewTemplateIdRef.current !== previewTemplateId) {
      previousPreviewTemplateIdRef.current = previewTemplateId;
      setRotated(false);
    }
  }, [previewTemplateId]);
  const showBackSection = !isMultiTemplate && Boolean(previewTemplate?.two_sided);

  // Produit plié : composé sur la feuille entière (fichier recto-verso) ou
  // par volet (un fichier par volet), selon le réglage du modèle.
  const fold = effectiveTemplate ? parseFold(effectiveTemplate.fold) : null;
  const canPanels = !isMultiTemplate && allowsPanels(fold);
  const canSheet = allowsSheet(fold);
  const [panelMode, setPanelMode] = useState(false);
  const panelGrid = fold ? (fold.direction === "vertical" ? { cols: fold.panels, rows: 1 } : { cols: 1, rows: fold.panels }) : { cols: 1, rows: 1 };
  function choosePanelMode(on: boolean) {
    setPanelMode(on);
    const count = fold?.panels ?? 0;
    const toMode = (v: ImageSourceValue): ImageSourceValue =>
      on
        ? {
            ...v,
            sourceMode: "mosaic",
            mosaicFiles: v.mosaicFiles?.length === count ? v.mosaicFiles : Array.from({ length: count }, () => null),
            mosaicCellAdjust: v.mosaicFiles?.length === count ? v.mosaicCellAdjust : [],
          }
        : { ...v, sourceMode: v.sourceMode === "mosaic" ? "upload" : v.sourceMode };
    setFront(toMode);
    setBack(toMode);
    if (on) setSameAsFront(false);
  }
  // Un modèle conçu seulement par volet y passe d'office ; changer de modèle
  // repart du mode par défaut de ce modèle.
  useEffect(() => {
    choosePanelMode(canPanels && !canSheet);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [previewTemplateId, canPanels, canSheet]);
  const usePanels = panelMode && canPanels;

  // Un PDF de deux pages importé pour le recto fournit aussi le verso d'un
  // modèle recto-verso (page 2). Le serveur applique la même règle
  // (planPdfPages) ; ici elle sert à l'avis, à la validation et à l'aperçu.
  const [frontPdfPages, setFrontPdfPages] = useState(1);
  const frontPdf = front.sourceMode === "upload" && isPdfFile(front.file) ? front.file : null;
  useEffect(() => {
    if (!frontPdf) {
      setFrontPdfPages(1);
      return;
    }
    let cancelled = false;
    frontPdf
      .arrayBuffer()
      .then(pdfPageCount)
      .then((n) => {
        if (!cancelled) setFrontPdfPages(n);
      });
    return () => {
      cancelled = true;
    };
  }, [frontPdf]);
  const hasOwnBack =
    back.sourceMode === "upload" ? Boolean(back.file) : Boolean(back.visualId);
  const pdfPlan =
    frontPdf && previewTemplate
      ? planPdfPages({
          pageCount: frontPdfPages,
          twoSided: previewTemplate.two_sided,
          hasOwnBack: showBackSection && hasOwnBack,
        })
      : null;
  const backFromPdf = showBackSection && pdfPlan?.backPage ? { file: frontPdf!, page: pdfPlan.backPage } : null;
  const someSelectedAreTwoSided =
    !isEditing && selectedTemplateIds.some((id) => templates.find((t) => t.id === id)?.two_sided);
  // Sans modèle unique connu (aucun choisi, ou plusieurs sélectionnés), on
  // ne peut pas savoir si le logo s'applique — on affiche l'option par
  // défaut, le serveur respecte de toute façon les réglages du modèle réel
  // à la génération.
  const frontLogoEnabled = previewTemplate ? previewTemplate.logo_on_front : true;
  const backLogoEnabled = previewTemplate ? previewTemplate.two_sided && previewTemplate.logo_on_back : false;
  const showLogoSection = !previewTemplate || frontLogoEnabled || backLogoEnabled;
  const logoLabel = !previewTemplate
    ? "Logo"
    : frontLogoEnabled && backLogoEnabled
    ? "Logo (recto et verso)"
    : backLogoEnabled
    ? "Logo (verso uniquement)"
    : "Logo (recto uniquement)";

  function updateFront(patch: Partial<ImageSourceValue>) {
    setFront((f) => ({ ...f, ...patch }));
  }

  function updateBack(patch: Partial<ImageSourceValue>) {
    setBack((b) => ({ ...b, ...patch }));
  }

  // Verso identique au recto : le verso suit le recto tant que la case est
  // cochée, plutôt que d'être copié une seule fois (donc toujours à jour si
  // le recto est ajusté ensuite).
  useEffect(() => {
    if (sameAsFront) setBack(front);
  }, [sameAsFront, front]);

  // Construit le nom automatiquement tant que l'utilisateur n'a pas modifié
  // le champ à la main. Avec un seul modèle : Modèle — Visuel. Avec
  // plusieurs modèles sélectionnés, le nom saisi sert de base commune et le
  // nom du modèle est ajouté à chaque produit créé (voir handleSubmit).
  useEffect(() => {
    if (nameTouched) return;
    const visualName =
      front.sourceMode !== "upload" ? visuals.find((v) => v.id === front.visualId)?.name ?? "" : "";
    if (isMultiTemplate) {
      setName(visualName);
      return;
    }
    const templateName = templates.find((t) => t.id === previewTemplateId)?.name ?? "";
    setName(visualName ? `${templateName} — ${visualName}` : templateName);
  }, [previewTemplateId, isMultiTemplate, front.sourceMode, front.visualId, templates, visuals, nameTouched]);

  function toggleTemplate(id: string, checked: boolean) {
    setSelectedTemplateIds((prev) =>
      checked ? [...prev, id] : prev.filter((existing) => existing !== id)
    );
  }

  function toggleAllTemplates() {
    setSelectedTemplateIds((prev) =>
      prev.length === visibleTemplates.length ? [] : visibleTemplates.map((t) => t.id)
    );
  }

  // Menu « Catégorie » : n'affiche que ses modèles. Les modèles cochés
  // ailleurs sont décochés — on ne crée pas de produit pour un modèle caché.
  function presetCategory(categoryId: string) {
    setPresetCategoryId(categoryId);
    if (categoryId) {
      const ids = new Set(templates.filter((t) => t.category_id === categoryId).map((t) => t.id));
      setSelectedTemplateIds((prev) => prev.filter((id) => ids.has(id)));
    }
    try {
      localStorage.setItem(LAST_CATEGORY_KEY, categoryId);
    } catch {
      // Sans stockage, la présélection n'est simplement pas retenue.
    }
  }

  function toggleCategoryTemplates(categoryId: string) {
    const categoryIds = templates.filter((t) => t.category_id === categoryId).map((t) => t.id);
    const allSelected = categoryIds.every((id) => selectedTemplateIds.includes(id));
    setSelectedTemplateIds((prev) => {
      if (allSelected) return prev.filter((id) => !categoryIds.includes(id));
      return [...new Set([...prev, ...categoryIds])];
    });
  }

  function buildFormData(productName: string, tId: string, cId: string) {
    const formData = new FormData();
    formData.append("name", productName);
    formData.append("templateId", tId);
    formData.append("logoShape", logoShape);
    formData.append("logoColor", logoColor);
    formData.append("logoSecondaryColor", logoSecondaryColor);
    formData.append("logoShadow", String(logoShadow));
    formData.append("logoShadowBlur", String(shadowSettings.blur));
    formData.append("logoShadowDistance", String(shadowSettings.distance));
    formData.append("logoShadowAngle", String(shadowSettings.angle));
    formData.append("logoShadowOpacity", String(shadowSettings.opacity));
    formData.append("positionX", String(front.positionX));
    formData.append("positionY", String(front.positionY));
    if (cId) formData.append("collectionId", cId);
    formData.append("rotated", String(rotated));
    formData.append("showLogo", String(showLogo));
    if (usePanels) {
      // Un fichier par volet, au recto et au verso : le serveur assemble chaque
      // côté aux plis du modèle (voir lib/products/panelsForm.ts).
      for (const [value, prefix] of [[front, ""], [back, "back"]] as const) {
        const field = (name: string) => (prefix ? `back${name.charAt(0).toUpperCase()}${name.slice(1)}` : name);
        if (!(value.mosaicFiles ?? []).some(Boolean)) continue;
        formData.append(field("mosaicPanels"), "1");
        formData.append(field("mosaicCols"), String(panelGrid.cols));
        formData.append(field("mosaicRows"), String(panelGrid.rows));
        (value.mosaicFiles ?? []).forEach((f, i) => {
          if (f) formData.append(prefix ? `backMosaicCell${i}` : `mosaicCell${i}`, f);
        });
        if (value.mosaicCellAdjust?.length) formData.append(field("mosaicCellAdjust"), JSON.stringify(value.mosaicCellAdjust));
      }
      return formData;
    }
    if (front.sourceMode === "upload") {
      if (front.file) formData.append("image", front.file);
    } else {
      formData.append("visualId", front.visualId);
      formData.append("visualMode", front.sourceMode);
      if (front.sourceMode === "tile") formData.append("tileSizeMm", String(front.tileSizeMm));
    }
    // Le serveur ignore ces champs si le modèle n'est pas recto-verso.
    formData.append("backPositionX", String(back.positionX));
    formData.append("backPositionY", String(back.positionY));
    if (back.sourceMode === "upload") {
      if (back.file) formData.append("backImage", back.file);
    } else {
      formData.append("backVisualId", back.visualId);
      formData.append("backVisualMode", back.sourceMode);
      if (back.sourceMode === "tile") formData.append("backTileSizeMm", String(back.tileSizeMm));
    }
    return formData;
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!isEditing && selectedTemplateIds.length === 0) {
      setError("Choisis au moins un modèle.");
      return;
    }
    if (usePanels) {
      if (!isEditing && !(front.mosaicFiles ?? []).some(Boolean)) {
        setError("Ajoute au moins un fichier de volet au recto.");
        return;
      }
    } else if (!isEditing && front.sourceMode === "upload" && !front.file) {
      setError("Une image est requise.");
      return;
    }
    if (!usePanels && front.sourceMode !== "upload" && !front.visualId) {
      setError("Choisis un visuel dans la banque.");
      return;
    }
    if (showBackSection && !usePanels) {
      const hasExistingBack = isEditing && Boolean(currentBackImageUrl);
      if (back.sourceMode === "upload" && !back.file && !hasExistingBack && !backFromPdf) {
        setError("Une image de verso est requise (modèle recto-verso).");
        return;
      }
      if (back.sourceMode !== "upload" && !back.visualId) {
        setError("Choisis un visuel pour le verso.");
        return;
      }
    }

    setLoading(true);
    setError(null);
    setCreateProgress(null);

    if (isEditing || !isMultiTemplate) {
      const tId = isEditing ? templateId : selectedTemplateIds[0];
      const formData = buildFormData(name, tId, collectionId);
      let body: FormData = formData;
      try {
        // Les fichiers lourds passent par le stockage : Vercel refuse toute
        // requête de plus de 4,5 Mo (une photo de grand format, des volets).
        body = await stageLargeFiles(formData);
      } catch (err) {
        setLoading(false);
        setError(err instanceof Error ? err.message : "Envoi des fichiers impossible.");
        return;
      }
      const res = await fetch(isEditing ? `/api/products/${product!.id}` : "/api/products", {
        method: isEditing ? "PATCH" : "POST",
        body,
      });
      const data = await res.json();
      setLoading(false);
      if (!res.ok) {
        setError(data.error ?? "Erreur lors de l'enregistrement.");
        return;
      }
      if (data.pdfError) {
        alert(`Le produit a été enregistré, mais le PDF n'a pas pu être généré : ${data.pdfError}`);
      }
      onSuccess();
      return;
    }

    // Création multiple : un produit par modèle sélectionné, regroupés
    // automatiquement dans une collection si aucune n'a été choisie. Le
    // verso (le cas échéant) n'est pas configuré en lot — à ajouter ensuite
    // en modifiant chaque produit individuellement.
    let targetCollectionId = collectionId;
    if (!targetCollectionId) {
      const collectionName =
        name.trim() || `Collection du ${new Date().toLocaleDateString("fr-CA")}`;
      const res = await fetch("/api/product-collections", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: collectionName }),
      });
      const data = await res.json();
      if (!res.ok) {
        setLoading(false);
        setError(data.error ?? "Erreur lors de la création de la collection.");
        return;
      }
      targetCollectionId = data.collection.id;
    }

    const total = selectedTemplateIds.length;
    setCreateProgress({ done: 0, total });
    const failures: string[] = [];
    const pdfWarnings: string[] = [];
    // Pages d'un PDF non utilisées, signalées par modèle (sans doublon).
    const pageWarnings: string[] = [];
    for (const tId of selectedTemplateIds) {
      const templateName = templates.find((t) => t.id === tId)?.name ?? "";
      const productName = name.trim() ? `${name.trim()} — ${templateName}` : templateName;
      const formData = buildFormData(productName, tId, targetCollectionId);
      // Même fichier pour tous les modèles : déposé une seule fois dans le
      // stockage (voir stageLargeFiles), puis seulement référencé.
      let body: FormData;
      try {
        body = await stageLargeFiles(formData);
      } catch (err) {
        failures.push(`${templateName} : ${err instanceof Error ? err.message : "envoi du fichier impossible"}`);
        setCreateProgress((p) => (p ? { done: p.done + 1, total: p.total } : { done: 1, total }));
        continue;
      }
      const { res, data } = await postProductWithRetry(body);
      if (!res.ok) {
        failures.push(`${templateName} : ${data.error ?? "erreur inconnue"}`);
      } else {
        if (data.pdfError) pdfWarnings.push(`${templateName} : ${data.pdfError}`);
        for (const w of (data.warnings ?? []) as string[]) pageWarnings.push(`${templateName} : ${w}`);
      }
      setCreateProgress((p) => (p ? { done: p.done + 1, total: p.total } : { done: 1, total }));
      // Un souffle entre deux produits : le stockage de Supabase a peu de
      // connexions, et chaque création en ouvre plusieurs.
      await sleep(300);
    }

    setLoading(false);
    if (failures.length > 0) {
      setError(`Certains produits n'ont pas pu être créés — ${failures.join(" · ")}`);
      return;
    }
    if (pdfWarnings.length > 0) {
      alert(
        `Les produits ont été créés, mais certains PDF n'ont pas pu être générés :\n${pdfWarnings.join(
          "\n"
        )}`
      );
    }
    if (pageWarnings.length > 0) {
      alert(`Les produits ont été créés.\n${pageWarnings.join("\n")}`);
    }
    onSuccess();
  }

  if (templates.length === 0) {
    return (
      <p className="rounded border border-amber-300 bg-amber-50 p-4 text-sm text-amber-800">
        Aucun modèle configuré. Crée d&apos;abord un modèle dans{" "}
        <a href="/templates" className="underline">
          Modèles
        </a>
        .
      </p>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <label className="block text-sm font-medium">Nom du produit</label>
        <input
          required={!isMultiTemplate}
          value={name}
          onChange={(e) => {
            setName(e.target.value);
            setNameTouched(true);
          }}
          placeholder={isMultiTemplate ? "Ex. Collection floral (optionnel)" : "Ex. Étui iPhone 15 — motif floral"}
          className="mt-1 w-full rounded border border-neutral-300 px-3 py-2"
        />
        {!nameTouched && (
          <p className="mt-1 text-xs text-neutral-500">
            Généré automatiquement à partir du modèle et du visuel — modifiable.
          </p>
        )}
        {isMultiTemplate && (
          <p className="mt-1 text-xs text-neutral-500">
            Ce nom sert de base commune — le nom du modèle sera ajouté à chaque produit créé.
          </p>
        )}
      </div>

      {isEditing ? (
        <div>
          <label className="block text-sm font-medium">Modèle</label>
          <select
            value={templateId}
            onChange={(e) => setTemplateId(e.target.value)}
            className="mt-1 w-full rounded border border-neutral-300 px-3 py-2"
          >
            {categories.map((category) => {
              const items = templates.filter((t) => t.category_id === category.id);
              if (items.length === 0) return null;
              return (
                <optgroup key={category.id} label={category.name}>
                  {items.map((t) => (
                    <option key={t.id} value={t.id}>
                      {templateOptionLabel(t)}
                    </option>
                  ))}
                </optgroup>
              );
            })}
          </select>
        </div>
      ) : (
        <div>
          <div className="flex items-center justify-between">
            <label className="block text-sm font-medium">
              Modèles{" "}
              {selectedTemplateIds.length > 1 && (
                <span className="font-normal text-neutral-400">
                  ({selectedTemplateIds.length} sélectionnés — un produit sera créé par modèle)
                </span>
              )}
            </label>
            <select
              value={presetCategoryId}
              onChange={(e) => presetCategory(e.target.value)}
              aria-label="Filtrer par catégorie"
              className="ml-auto mr-3 rounded border border-neutral-300 px-2 py-1 text-xs"
            >
              <option value="">Toutes les catégories</option>
              {categories
                .filter((c) => templates.some((t) => t.category_id === c.id))
                .map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
            </select>
            <button
              type="button"
              onClick={toggleAllTemplates}
              className="text-xs text-neutral-500 underline hover:text-pico-black"
            >
              {selectedTemplateIds.length === visibleTemplates.length ? "Tout désélectionner" : "Tout sélectionner"}
            </button>
          </div>
          <div className="mt-1 max-h-64 space-y-3 overflow-y-auto rounded border border-neutral-300 p-3">
            {categories.map((category) => {
              const items = visibleTemplates.filter((t) => t.category_id === category.id);
              if (items.length === 0) return null;
              const categoryAllSelected = items.every((t) => selectedTemplateIds.includes(t.id));
              return (
                <div key={category.id}>
                  <label className="mb-1 flex items-center gap-2 text-xs font-semibold uppercase text-neutral-400">
                    <input
                      type="checkbox"
                      checked={categoryAllSelected}
                      onChange={() => toggleCategoryTemplates(category.id)}
                    />
                    {category.name}
                  </label>
                  <div className="space-y-1">
                    {items.map((t) => (
                      <label key={t.id} className="flex items-center gap-2 text-sm text-pico-black">
                        <input
                          type="checkbox"
                          checked={selectedTemplateIds.includes(t.id)}
                          onChange={(e) => toggleTemplate(t.id, e.target.checked)}
                        />
                        {templateOptionLabel(t)}
                      </label>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
          {someSelectedAreTwoSided && (
            <p className="mt-1 text-xs text-neutral-500">
              Certains modèles sélectionnés sont recto-verso — configure le verso après création,
              en modifiant chaque produit.
            </p>
          )}
        </div>
      )}

      <div>
        <label className="block text-sm font-medium">Collection (optionnel)</label>
        <select
          value={collectionId}
          onChange={(e) => setCollectionId(e.target.value)}
          className="mt-1 w-full rounded border border-neutral-300 px-3 py-2"
        >
          <option value="">— Aucune —</option>
          {collections.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
        {isMultiTemplate && !collectionId && (
          <p className="mt-1 text-xs text-neutral-500">
            Une collection sera créée automatiquement pour regrouper ces produits.
          </p>
        )}
      </div>

      {showOrientationToggle && (
        <div>
          <label className="mb-2 block text-sm font-medium">Orientation</label>
          <div className="flex rounded-lg border border-neutral-300 p-0.5 text-sm">
            <button
              type="button"
              onClick={() => setRotated(previewTemplate ? isLandscape(previewTemplate.width_mm, previewTemplate.height_mm) : false)}
              className={`flex-1 rounded-md px-2 py-1.5 ${
                !effectiveIsLandscape ? "bg-pico-black text-white" : "text-neutral-600 hover:bg-neutral-100"
              }`}
            >
              Portrait
            </button>
            <button
              type="button"
              onClick={() => setRotated(previewTemplate ? !isLandscape(previewTemplate.width_mm, previewTemplate.height_mm) : false)}
              className={`flex-1 rounded-md px-2 py-1.5 ${
                effectiveIsLandscape ? "bg-pico-black text-white" : "text-neutral-600 hover:bg-neutral-100"
              }`}
            >
              Paysage
            </button>
          </div>
        </div>
      )}

      {canPanels && canSheet && (
        <div>
          <p className="mb-1 text-sm font-medium">Conception</p>
          <div className="flex rounded-lg border border-neutral-300 p-0.5 text-sm">
            {([false, true] as const).map((on) => (
              <button
                key={String(on)}
                type="button"
                onClick={() => choosePanelMode(on)}
                className={`flex flex-1 items-center justify-center gap-1.5 rounded-md px-2 py-1.5 ${usePanels === on ? "bg-pico-black text-white" : "text-neutral-600 hover:bg-neutral-100"}`}
              >
                {on ? <SquareSplitHorizontalIcon className="h-4 w-4 shrink-0" /> : <PanelLeftRightDashedIcon className="h-4 w-4 shrink-0" />}
                {on ? "Par volet" : "Par planche"}
              </button>
            ))}
          </div>
        </div>
      )}

      <div>
        <p className="mb-1 text-sm font-medium">Recto{usePanels ? " (extérieur)" : ""}</p>
        <ImageSourcePicker
          side="front"
          {...(usePanels && effectiveTemplate
            ? { sourceModes: ["mosaic" as const], mosaicGrid: panelGrid, panelCells: panelCells(effectiveTemplate, "front") }
            : {})}
          template={effectiveTemplate}
          rotated={rotated}
          visuals={visuals}
          value={front}
          onChange={updateFront}
          currentImageUrl={currentImageUrl}
          logo={frontLogoEnabled && showLogo ? { shape: logoShape, color: logoColor, secondaryColor: logoSecondaryColor, shadow: logoShadow ? shadowSettings : null } : null}
          previewUnavailableMessage={
            isMultiTemplate
              ? "Aperçu disponible pour un seul modèle à la fois — décoche pour n'en garder qu'un si tu veux vérifier le rendu avant de créer la collection."
              : undefined
          }
        />
        {pdfPlan?.warning && (
          <p className="mt-2 rounded border border-amber-300 bg-amber-50 p-3 text-sm text-amber-800">
            ⚠ {pdfPlan.warning}
          </p>
        )}
      </div>

      {showLogoSection && (
        <div>
          <div className="mb-1 flex items-center justify-between">
            <label className="text-sm font-medium">{logoLabel}</label>
            <label className="flex items-center gap-2 text-sm text-pico-black">
              <input
                type="checkbox"
                checked={showLogo}
                onChange={(e) => setShowLogo(e.target.checked)}
              />
              Afficher le logo
            </label>
          </div>
          {showLogo && (
          <>
          <div className="flex rounded-lg border border-neutral-300 p-0.5 text-sm">
            {LOGO_SHAPES.map((s) => (
              <button
                key={s.value}
                type="button"
                onClick={() => setLogoShape(s.value)}
                className={`flex-1 rounded-md px-2 py-1.5 ${
                  logoShape === s.value
                    ? "bg-pico-black text-white"
                    : "text-neutral-600 hover:bg-neutral-100"
                }`}
              >
                {s.label}
              </button>
            ))}
          </div>

          <p className="mb-1 mt-3 text-xs text-neutral-500">
            {logoShape === "pastille" ? "Couleur de la pastille" : "Couleur du logo"}
          </p>
          <div className="flex flex-wrap items-center gap-2">
            {LOGO_COLOR_PALETTE.map((c) => (
              <button
                key={c.hex}
                type="button"
                onClick={() => setLogoColor(c.hex)}
                title={c.name}
                aria-label={c.name}
                className={`h-7 w-7 rounded-full border outline-none transition-transform duration-150 hover:scale-110 focus-visible:ring-2 focus-visible:ring-pico-black focus-visible:ring-offset-2 ${
                  logoColor === c.hex
                    ? "border-pico-black ring-2 ring-pico-black ring-offset-2"
                    : "border-neutral-300"
                }`}
                style={{ backgroundColor: c.hex }}
              />
            ))}
            <span className="mx-1 h-6 w-px shrink-0 bg-neutral-200" aria-hidden="true" />
            <ColorPickerButton value={logoColor} onChange={setLogoColor} label="Couleur personnalisée" />
          </div>

          {logoShape === "pastille" && (
            <>
              <p className="mb-1 mt-3 text-xs text-neutral-500">Couleur du logo à l&apos;intérieur</p>
              <div className="flex flex-wrap items-center gap-2">
                {LOGO_COLOR_PALETTE.map((c) => (
                  <button
                    key={c.hex}
                    type="button"
                    onClick={() => setLogoSecondaryColor(c.hex)}
                    title={c.name}
                    aria-label={c.name}
                    className={`h-7 w-7 rounded-full border outline-none transition-transform duration-150 hover:scale-110 focus-visible:ring-2 focus-visible:ring-pico-black focus-visible:ring-offset-2 ${
                      logoSecondaryColor === c.hex
                        ? "border-pico-black ring-2 ring-pico-black ring-offset-2"
                        : "border-neutral-300"
                    }`}
                    style={{ backgroundColor: c.hex }}
                  />
                ))}
                <span className="mx-1 h-6 w-px shrink-0 bg-neutral-200" aria-hidden="true" />
                <ColorPickerButton
                  value={logoSecondaryColor}
                  onChange={setLogoSecondaryColor}
                  label="Couleur personnalisée"
                />
              </div>
            </>
          )}

          <label className="mt-3 flex items-center gap-2 text-sm text-pico-black">
            <input
              type="checkbox"
              checked={logoShadow}
              onChange={(e) => setLogoShadow(e.target.checked)}
            />
            Ombre portée
          </label>

          {logoShadow && (
            <div className="mt-2 space-y-2 rounded-lg border border-neutral-200 p-3">
              {SHADOW_CONTROLS.map((c) => (
                <label key={c.key} className="flex items-center gap-3 text-xs text-neutral-600">
                  <span className="w-16 shrink-0">{c.label}</span>
                  <input
                    type="range"
                    min={LOGO_SHADOW_RANGES[c.key].min}
                    max={LOGO_SHADOW_RANGES[c.key].max}
                    step={LOGO_SHADOW_RANGES[c.key].step}
                    value={shadowSettings[c.key]}
                    onChange={(e) => setShadowSettings((s) => ({ ...s, [c.key]: Number(e.target.value) }))}
                    className="min-w-0 flex-1"
                  />
                  <span className="w-12 shrink-0 text-right tabular-nums">
                    {shadowSettings[c.key]}
                    {c.unit}
                  </span>
                </label>
              ))}
              <div className="flex items-center justify-between pt-1">
                <p className="text-[11px] text-neutral-400">
                  Flou et distance en % de la largeur du logo. Angle : 0° = droite, 90° = bas.
                </p>
                <button
                  type="button"
                  onClick={() => setShadowSettings(DEFAULT_LOGO_SHADOW)}
                  className="shrink-0 text-xs text-neutral-500 underline hover:text-pico-black"
                >
                  Réinitialiser
                </button>
              </div>
            </div>
          )}
          </>
          )}
        </div>
      )}

      {showBackSection && (
        <div className="border-t border-neutral-200 pt-4">
          <div className="mb-1 flex items-center justify-between">
            <p className="text-sm font-medium">
              Verso <span className="font-normal text-neutral-400">(modèle recto-verso)</span>
            </p>
            {!usePanels && (
            <label className="flex items-center gap-2 text-sm text-pico-black">
              <input
                type="checkbox"
                checked={sameAsFront}
                onChange={(e) => setSameAsFront(e.target.checked)}
              />
              Même visuel que le recto
            </label>
            )}
          </div>
          {sameAsFront ? (
            <p className="text-xs text-neutral-500">
              Le verso reprendra automatiquement l&apos;image, le visuel et le positionnement du
              recto.
            </p>
          ) : (
            <ImageSourcePicker
              side="back"
              {...(usePanels && effectiveTemplate
                ? { sourceModes: ["mosaic" as const], mosaicGrid: panelGrid, panelCells: panelCells(effectiveTemplate, "back") }
                : {})}
              template={effectiveTemplate}
              rotated={rotated}
              visuals={visuals}
              value={back}
              onChange={updateBack}
              currentImageUrl={currentBackImageUrl}
              pairedPdf={backFromPdf}
              logo={backLogoEnabled && showLogo ? { shape: logoShape, color: logoColor, secondaryColor: logoSecondaryColor, shadow: logoShadow ? shadowSettings : null } : null}
            />
          )}
        </div>
      )}

      {error && <p className="text-sm text-red-600">{error}</p>}
      {createProgress && (
        <p className="flex items-center gap-2 text-sm text-neutral-500">
          <SpinnerIcon className="h-4 w-4" />
          Création des produits... ({createProgress.done}/{createProgress.total})
        </p>
      )}

      <button
        type="submit"
        disabled={loading}
        className="inline-flex items-center gap-2 rounded-lg bg-pico-maroon px-4 py-2 text-white hover:bg-pico-maroon-dark disabled:opacity-50"
      >
        {loading && <SpinnerIcon className="h-4 w-4" />}
        {loading
          ? "Enregistrement..."
          : isEditing
          ? "Enregistrer"
          : isMultiTemplate
          ? `Créer ${selectedTemplateIds.length} produits`
          : "Créer le produit"}
      </button>
    </form>
  );
}
