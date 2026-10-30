"use client";

import { useEffect, useRef, useState } from "react";
import type { Canvas, FabricObject } from "fabric";
import { fontOptionById, fontWeight } from "@/lib/design/fonts";
import type { DesignLayer } from "@/lib/design/layers";
import { loadFont } from "@/lib/design/fontLoader";

/**
 * Calques de l'Outil Shopify (texte, image, forme) édités avec Fabric.js —
 * l'éditeur des calques. Seul un calque en mode de fusion repasse d'office
 * sur l'aperçu d'origine (voir DesignEditor) : le canevas ne le mélange pas
 * au fond.
 *
 * Fabric ne sert qu'à l'ÉCRAN : poignées, rotation, texte modifiable sur
 * place. Les calques (DesignLayer, en fractions de la page et en mm) restent
 * la seule source de vérité : ce canevas les lit, et chaque modification les
 * réécrit (onChangeLayers). Le rendu d'impression (lib/pdf/layers.ts) ne
 * change pas.
 *
 * Le canevas est posé exactement sur l'aperçu, entre le visuel de fond et les
 * guides. Un clic à côté d'un calque n'est pas consommé : l'aperçu reprend la
 * main (déplacer le fond), voir `hitRef`.
 */

type LayerObject = FabricObject & { layerId?: string; imageUrl?: string };

const ACCENT = "#631028";

function blendOf(layer: DesignLayer): GlobalCompositeOperation {
  return (layer.blendMode && layer.blendMode !== "normal" ? layer.blendMode : "source-over") as GlobalCompositeOperation;
}

export default function FabricLayerCanvas({
  layers,
  selectedLayerId,
  onChangeLayers,
  onSelectLayer,
  width,
  height,
  pxPerMm,
  imageUrls,
  maxFontSizeMm,
  hitRef,
}: {
  layers: DesignLayer[];
  selectedLayerId: string | null;
  onChangeLayers: (layers: DesignLayer[]) => void;
  onSelectLayer?: (id: string | null) => void;
  // Taille de l'aperçu (px) : la page entière, fond perdu compris.
  width: number;
  height: number;
  pxPerMm: number;
  // Adresse d'aperçu de chaque calque image (par id).
  imageUrls: Record<string, string>;
  maxFontSizeMm: number;
  // Vrai pendant un clic sur un calque : l'aperçu ne doit pas déplacer le fond.
  hitRef: React.MutableRefObject<boolean>;
}) {
  const canvasEl = useRef<HTMLCanvasElement>(null);
  const canvasRef = useRef<Canvas | null>(null);
  const fabricRef = useRef<typeof import("fabric") | null>(null);
  const objects = useRef(new Map<string, LayerObject>());
  const [ready, setReady] = useState(false);
  const [fontsTick, setFontsTick] = useState(0);

  // Dernières valeurs, lues par les gestionnaires d'événements Fabric
  // (installés une seule fois).
  const latest = useRef({ layers, onChangeLayers, onSelectLayer, width, height, pxPerMm, maxFontSizeMm });
  latest.current = { layers, onChangeLayers, onSelectLayer, width, height, pxPerMm, maxFontSizeMm };
  // Sélection posée par nous (synchronisation) : ne pas la renvoyer.
  const syncing = useRef(false);

  // Création du canevas, une fois. Fabric est chargé à la demande : il n'a
  // rien à faire côté serveur ni dans l'éditeur actuel.
  useEffect(() => {
    let disposed = false;
    import("fabric").then((fabric) => {
      if (disposed || !canvasEl.current) return;
      fabricRef.current = fabric;
      const canvas = new fabric.Canvas(canvasEl.current, {
        width: latest.current.width,
        height: latest.current.height,
        selection: false,
        preserveObjectStacking: true,
      });
      canvasRef.current = canvas;

      const commit = (obj: LayerObject) => {
        const { layers: current, onChangeLayers: change, width: W, height: H, pxPerMm: k, maxFontSizeMm: maxMm } = latest.current;
        const layer = current.find((l) => l.id === obj.layerId);
        if (!layer) return;
        const clamp01 = (n: number) => Math.min(1, Math.max(0, n));
        const base = {
          positionX: clamp01((obj.left ?? 0) / W),
          positionY: clamp01((obj.top ?? 0) / H),
          rotationDeg: Math.round((obj.angle ?? 0) * 10) / 10,
        };
        let next: DesignLayer;
        if (layer.type === "text") {
          const text = (obj as unknown as { text: string }).text;
          const fontSizeMm = Math.min(maxMm, Math.max(1, layer.fontSizeMm * (obj.scaleX ?? 1)));
          // La bordure et l'espacement grandissent avec la police : le texte
          // agrandi garde ses proportions (comme pendant le geste, où Fabric
          // agrandit tout l'objet).
          const factor = fontSizeMm / layer.fontSizeMm;
          obj.set({ scaleX: 1, scaleY: 1, fontSize: fontSizeMm * k } as Partial<FabricObject>);
          next = {
            ...layer,
            ...base,
            content: text,
            fontSizeMm,
            strokeWidthMm: layer.strokeWidthMm * factor,
            letterSpacingMm: layer.letterSpacingMm * factor,
          };
        } else if (layer.type === "image") {
          next = { ...layer, ...base, widthRatio: Math.max(0.01, obj.getScaledWidth() / W) };
        } else {
          const w = obj.getScaledWidth() - (obj.strokeWidth ?? 0);
          const h = obj.getScaledHeight() - (obj.strokeWidth ?? 0);
          next = { ...layer, ...base, widthRatio: Math.max(0.01, w / W), heightRatio: Math.max(0.01, h / H) };
        }
        change(current.map((l) => (l.id === layer.id ? next : l)));
      };

      // Désélection au RELÂCHEMENT d'un simple clic dans le vide, pas à
      // l'appui : sinon le panneau du calque disparaît en plein glisser et
      // l'aperçu saute (un glisser dans le vide déplace le fond).
      let downAt: { x: number; y: number } | null = null;
      canvas.on("mouse:down", (e) => {
        hitRef.current = Boolean(e.target);
        const p = e.viewportPoint;
        downAt = e.target ? null : { x: p.x, y: p.y };
      });
      canvas.on("mouse:up", (e) => {
        hitRef.current = false;
        const p = e.viewportPoint;
        if (downAt && Math.hypot(p.x - downAt.x, p.y - downAt.y) < 4) latest.current.onSelectLayer?.(null);
        downAt = null;
      });
      const select = (e: { selected?: FabricObject[] }) => {
        if (syncing.current) return;
        const id = (e.selected?.[0] as LayerObject | undefined)?.layerId ?? null;
        latest.current.onSelectLayer?.(id);
      };
      canvas.on("selection:created", select);
      canvas.on("selection:updated", select);
      canvas.on("object:modified", (e) => commit(e.target as LayerObject));
      canvas.on("text:changed", (e) => commit(e.target as LayerObject));
      setReady(true);
    });
    return () => {
      disposed = true;
      canvasRef.current?.dispose();
      canvasRef.current = null;
      objects.current.clear();
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Polices : le canevas mesure le texte à sa création ; une police chargée
  // après coup demande de le remesurer.
  const fontsKey = layers.map((l) => (l.type === "text" ? `${l.fontId}:${l.bold}:${l.weight ?? ""}:${l.italic}` : "")).join("|");
  useEffect(() => {
    const loads = layers
      .filter((l): l is Extract<DesignLayer, { type: "text" }> => l.type === "text")
      .map((l) => {
        const f = fontOptionById(l.fontId);
        // Police Google : sa feuille de style d'abord (voir fontLoader).
        return loadFont(l.fontId, `${l.italic ? "italic " : ""}${fontWeight(f, l)} 32px "${f.family}"`);
      });
    Promise.all(loads).then(() => setFontsTick((t) => t + 1)).catch(() => undefined);
  }, [fontsKey]); // eslint-disable-line react-hooks/exhaustive-deps

  // Synchronisation calques → objets Fabric.
  useEffect(() => {
    const canvas = canvasRef.current;
    const fabric = fabricRef.current;
    if (!ready || !canvas || !fabric) return;
    canvas.setDimensions({ width, height });

    const controls = {
      borderColor: ACCENT,
      cornerColor: "#ffffff",
      cornerStrokeColor: ACCENT,
      transparentCorners: false,
      cornerStyle: "circle" as const,
      cornerSize: 10,
      padding: 4,
      borderDashArray: [4, 3],
    };
    const seen = new Set<string>();

    layers.forEach((layer, index) => {
      seen.add(layer.id);
      let obj = objects.current.get(layer.id);
      const common = {
        left: layer.positionX * width,
        top: layer.positionY * height,
        angle: layer.rotationDeg ?? 0,
        opacity: layer.opacity ?? 1,
        globalCompositeOperation: blendOf(layer),
        originX: "center" as const,
        originY: "center" as const,
      };

      if (layer.type === "text") {
        const font = fontOptionById(layer.fontId);
        const fontSize = layer.fontSizeMm * pxPerMm;
        const props = {
          ...common,
          fontFamily: font.family,
          fontSize,
          fontWeight: fontWeight(font, layer),
          fontStyle: layer.italic ? ("italic" as const) : ("normal" as const),
          fill: layer.color,
          lineHeight: 1.25,
          textAlign: "center",
          // Fabric : millièmes d'em.
          charSpacing: layer.letterSpacingMm ? ((layer.letterSpacingMm * pxPerMm) / fontSize) * 1000 : 0,
          // Contour à l'extérieur seulement : trait doublé, peint SOUS le
          // remplissage (comme l'aperçu actuel et le rendu imprimé).
          stroke: layer.strokeWidthMm > 0 ? layer.strokeColor : undefined,
          strokeWidth: layer.strokeWidthMm > 0 ? layer.strokeWidthMm * pxPerMm * 2 : 0,
          paintFirst: "stroke" as const,
          // Angles de la bordure, comme à l'impression (lib/pdf/textLayer.ts).
          strokeLineJoin: layer.strokeJoin ?? "round",
          strokeLineCap: (layer.strokeJoin ?? "round") === "round" ? ("round" as const) : ("butt" as const),
          strokeMiterLimit: 4,
        };
        if (!obj) {
          obj = new fabric.IText(layer.content, { ...props, ...controls }) as unknown as LayerObject;
          obj.setControlsVisibility({ mt: false, mb: false, ml: false, mr: false });
          obj.layerId = layer.id;
          objects.current.set(layer.id, obj);
          canvas.add(obj);
        } else {
          const editing = (obj as unknown as { isEditing?: boolean }).isEditing;
          obj.set({ ...props, ...(editing ? {} : { text: layer.content }) } as Partial<FabricObject>);
          (obj as unknown as { initDimensions?: () => void }).initDimensions?.();
        }
      } else if (layer.type === "image") {
        const url = imageUrls[layer.id];
        if (!url) return;
        if (obj && obj.imageUrl !== url) {
          canvas.remove(obj);
          objects.current.delete(layer.id);
          obj = undefined;
        }
        if (!obj) {
          // Chargement asynchrone : l'objet arrive au prochain passage.
          const placeholder = new fabric.Rect({ width: 1, height: 1, visible: false }) as unknown as LayerObject;
          placeholder.layerId = layer.id;
          placeholder.imageUrl = url;
          objects.current.set(layer.id, placeholder);
          fabric.FabricImage.fromURL(url).then((img) => {
            if (objects.current.get(layer.id) !== placeholder || !canvasRef.current) return;
            const imgObj = img as unknown as LayerObject;
            imgObj.layerId = layer.id;
            imgObj.imageUrl = url;
            imgObj.set(controls);
            imgObj.setControlsVisibility({ mt: false, mb: false, ml: false, mr: false });
            objects.current.set(layer.id, imgObj);
            canvasRef.current.add(imgObj);
            setFontsTick((t) => t + 1);
          });
          return;
        }
        if (!obj.visible && obj.type === "rect") return;
        const scale = (layer.widthRatio * width) / (obj.width || 1);
        obj.set({ ...common, scaleX: scale, scaleY: scale });
      } else {
        const w = layer.widthRatio * width;
        const h = layer.heightRatio * height;
        const strokeWidth = layer.strokeWidthMm > 0 ? layer.strokeWidthMm * pxPerMm : 0;
        const props = {
          ...common,
          fill: layer.fillEnabled ? layer.fillColor : "transparent",
          stroke: strokeWidth ? layer.strokeColor : undefined,
          strokeWidth,
          strokeUniform: true,
          scaleX: 1,
          scaleY: 1,
        };
        const isEllipse = layer.shape === "ellipse";
        if (obj && (obj.type === "ellipse") !== isEllipse) {
          canvas.remove(obj);
          objects.current.delete(layer.id);
          obj = undefined;
        }
        if (!obj) {
          obj = (isEllipse
            ? new fabric.Ellipse({ ...props, rx: w / 2, ry: h / 2, ...controls })
            : new fabric.Rect({ ...props, width: w, height: h, ...controls })) as unknown as LayerObject;
          obj.layerId = layer.id;
          objects.current.set(layer.id, obj);
          canvas.add(obj);
        } else {
          obj.set({ ...props, ...(isEllipse ? { rx: w / 2, ry: h / 2 } : { width: w, height: h }) } as Partial<FabricObject>);
        }
      }
      obj.setCoords();
      canvas.moveObjectTo(obj, index);
    });

    // Calques retirés.
    for (const [id, obj] of objects.current) {
      if (seen.has(id)) continue;
      canvas.remove(obj);
      objects.current.delete(id);
    }

    // Sélection : celle du panneau de calques.
    const active = canvas.getActiveObject() as LayerObject | undefined;
    syncing.current = true;
    if (!selectedLayerId) {
      if (active) canvas.discardActiveObject();
    } else if (active?.layerId !== selectedLayerId) {
      const target = objects.current.get(selectedLayerId);
      if (target && target.visible !== false) canvas.setActiveObject(target);
    }
    syncing.current = false;
    canvas.requestRenderAll();
  }, [ready, layers, width, height, pxPerMm, imageUrls, selectedLayerId, fontsTick]);

  return (
    <div className="absolute left-0 top-0" style={{ width, height }}>
      <canvas ref={canvasEl} />
    </div>
  );
}
