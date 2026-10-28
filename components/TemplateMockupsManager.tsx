"use client";

import { useEffect, useRef, useState } from "react";
import FileDropZone from "@/components/FileDropZone";
import { ChevronDownIcon, ChevronUpIcon, SpinnerIcon, TrashIcon } from "@/components/icons";
import { rangeFillStyle } from "@/components/ui/rangeFill";
import type { TemplateMockup } from "@/lib/types";

// Les surcouches déclarées par le XML du bundle, renvoyées par
// /api/template-mockups : leur ordre est celui des opacités enregistrées.
type MockupOverlay = { name: string; blendMode: string };
// Bords du produit mesurés dans son masque, renvoyés par la même route :
// de quoi proposer les marges d'un clic (voir maskHorizontalBounds).
type MaskBounds = { left: number; right: number; top: number; bottom: number };
type MockupWithOverlays = TemplateMockup & { overlays?: MockupOverlay[]; maskBounds?: MaskBounds | null };

// Ce que fait chaque mode de fusion, en clair — « multiply » assombrit
// (ombres), « overlay » contraste (reflets, matière).
const BLEND_LABELS: Record<string, string> = {
  multiply: "Ombres (multiply)",
  overlay: "Reflets (overlay)",
  screen: "Éclaircissement (screen)",
  over: "Superposition",
};

/**
 * Préréglages d'angle de prise de vue, c.-à-d. quelle tranche horizontale du
 * visuel la caméra montre (voir TemplateMockup.position_x) : sur un produit
 * dont le design fait le tour (une tasse), une vue de droite montre le bord
 * gauche du visuel, une vue de face son centre. Le curseur permet ensuite
 * n'importe quelle valeur intermédiaire.
 */
const POSITION_X_PRESETS = [
  { value: 0, label: "Vue de droite" },
  { value: 0.5, label: "De face" },
  { value: 1, label: "Vue de gauche" },
];

// Le cadrage est exposé en pourcentages (c'est ce qui se lit sur un mockup),
// mais stocké en ratios 0-1 pour les positions et en facteur pour l'échelle.
type Framing = {
  positionX: number;
  positionY: number;
  zoom: number;
  marginLeft: number;
  marginRight: number;
  marginTop: number;
  marginBottom: number;
};

// Number() explicite : une colonne numeric peut revenir en « 0.50 ». Le repli
// couvre aussi une base pas encore migrée, où le champ est absent.
function numberOr(value: unknown, fallback: number): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function framingOf(mockup: MockupWithOverlays): Framing {
  return {
    positionX: numberOr(mockup.position_x, 0.5),
    positionY: numberOr(mockup.position_y, 0.5),
    zoom: numberOr(mockup.zoom, 1),
    marginLeft: numberOr(mockup.margin_left, 0),
    marginRight: numberOr(mockup.margin_right, 0),
    marginTop: numberOr(mockup.margin_top, 0),
    marginBottom: numberOr(mockup.margin_bottom, 0),
  };
}

/**
 * Gestion des mockups d'un modèle : un modèle peut en avoir plusieurs (le
 * même produit sous plusieurs angles, voir
 * supabase/migrations/0049_template_mockups.sql), chacun étant un bundle
 * « beauty shot » complet — son XML plus les images qu'il référence.
 *
 * Volontairement à part de TemplateForm : celui-ci envoie tout son
 * formulaire d'un bloc, ce qui se prête mal à N bundles. Ici chaque mockup
 * est créé/modifié/supprimé par son propre appel à /api/template-mockups,
 * comme les Thèmes.
 */
export default function TemplateMockupsManager({ templateId }: { templateId: string }) {
  const [mockups, setMockups] = useState<MockupWithOverlays[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // Quel mockup montre son panneau de cadrage (un seul à la fois, pour que la
  // liste reste lisible quand un modèle en a plusieurs).
  const [openFraming, setOpenFraming] = useState<string | null>(null);

  const [name, setName] = useState("");
  const [positionX, setPositionX] = useState("0.5");
  const [xmlFile, setXmlFile] = useState<File | null>(null);
  const [imageFiles, setImageFiles] = useState<File[]>([]);
  const [assetNames, setAssetNames] = useState<string[]>([]);
  const imagesInputRef = useRef<HTMLInputElement>(null);
  // Un PATCH en attente par réglage (clé « id:cadrage » / « id:surcouches ») :
  // glisser un curseur produit une rafale d'événements, on n'envoie que la
  // dernière valeur — sans qu'un réglage annule l'enregistrement de l'autre.
  const pendingPatch = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  async function load() {
    const res = await fetch(`/api/template-mockups?templateId=${encodeURIComponent(templateId)}`);
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(data.error ?? "Impossible de charger les mockups.");
      setMockups([]);
      return;
    }
    setMockups((await res.json()).mockups ?? []);
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [templateId]);

  // Même extraction que TemplateForm : les noms d'assets déclarés dans le
  // XML, pour annoncer à l'avance quelles images sont attendues.
  async function handleXmlChange(file: File | null) {
    setXmlFile(file);
    if (!file) {
      setAssetNames([]);
      return;
    }
    const text = await file.text();
    setAssetNames(Array.from(text.matchAll(/<asset\s+name="([^"]+)"/g)).map((m) => m[1]));
  }

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim() || !xmlFile) return;
    setBusy(true);
    setError(null);

    const body = new FormData();
    body.append("templateId", templateId);
    body.append("name", name.trim());
    body.append("positionX", positionX);
    body.append("beautyShotXml", xmlFile);
    for (const f of imageFiles) body.append("beautyShotImages", f);

    const res = await fetch("/api/template-mockups", { method: "POST", body });
    setBusy(false);
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(data.error ?? "Erreur lors de l'ajout du mockup.");
      return;
    }
    setName("");
    setPositionX("0.5");
    setXmlFile(null);
    setImageFiles([]);
    setAssetNames([]);
    if (imagesInputRef.current) imagesInputRef.current.value = "";
    load();
  }

  async function handleRename(mockup: MockupWithOverlays, nextName: string) {
    if (!nextName.trim() || nextName === mockup.name) return;
    const body = new FormData();
    body.append("name", nextName.trim());
    await fetch(`/api/template-mockups/${mockup.id}`, { method: "PATCH", body });
    load();
  }

  // Enregistre après une courte pause, en ne gardant que le dernier appel
  // pour cette clé. La liste locale, elle, a déjà été mise à jour : le
  // curseur doit suivre le doigt sans attendre le réseau.
  function schedulePatch(key: string, mockupId: string, fields: Record<string, string>, what: string) {
    const previous = pendingPatch.current.get(key);
    if (previous) clearTimeout(previous);
    pendingPatch.current.set(
      key,
      setTimeout(async () => {
        pendingPatch.current.delete(key);
        const res = await fetch(`/api/template-mockups/${mockupId}`, { method: "PATCH", body: formDataOf(fields) });
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          setError(data.error ?? `Erreur lors de l'enregistrement ${what}.`);
          load(); // remet la liste sur ce qu'a réellement la base.
        }
      }, 400)
    );
  }

  /** Cadrage du visuel : seuls les champs touchés partent, la route ne
   * modifie que ceux-là. */
  function handleFraming(mockup: MockupWithOverlays, patch: Partial<Framing>) {
    setMockups((list) =>
      (list ?? []).map((m) =>
        m.id === mockup.id
          ? {
              ...m,
              ...(patch.positionX !== undefined && { position_x: patch.positionX }),
              ...(patch.positionY !== undefined && { position_y: patch.positionY }),
              ...(patch.zoom !== undefined && { zoom: patch.zoom }),
              ...(patch.marginLeft !== undefined && { margin_left: patch.marginLeft }),
              ...(patch.marginRight !== undefined && { margin_right: patch.marginRight }),
              ...(patch.marginTop !== undefined && { margin_top: patch.marginTop }),
              ...(patch.marginBottom !== undefined && { margin_bottom: patch.marginBottom }),
            }
          : m
      )
    );

    const fields: Record<string, string> = {};
    if (patch.positionX !== undefined) fields.positionX = String(patch.positionX);
    if (patch.positionY !== undefined) fields.positionY = String(patch.positionY);
    if (patch.zoom !== undefined) fields.zoom = String(patch.zoom);
    if (patch.marginLeft !== undefined) fields.marginLeft = String(patch.marginLeft);
    if (patch.marginRight !== undefined) fields.marginRight = String(patch.marginRight);
    if (patch.marginTop !== undefined) fields.marginTop = String(patch.marginTop);
    if (patch.marginBottom !== undefined) fields.marginBottom = String(patch.marginBottom);
    schedulePatch(`${mockup.id}:cadrage`, mockup.id, fields, "du cadrage");
  }

  /**
   * Intensité d'une surcouche (l'ombre en « multiply », les reflets en
   * « overlay »…). Le tableau est POSITIONNEL, dans l'ordre des <overlay> du
   * XML : on renvoie donc toujours la liste complète, jamais la seule valeur
   * modifiée — une case manquante vaut 100 %.
   */
  function handleOverlayOpacity(mockup: MockupWithOverlays, index: number, value: number) {
    const count = mockup.overlays?.length ?? 0;
    const next = Array.from({ length: count }, (_, i) =>
      i === index ? value : mockup.overlay_opacities?.[i] ?? 100
    );

    setMockups((list) => (list ?? []).map((m) => (m.id === mockup.id ? { ...m, overlay_opacities: next } : m)));
    schedulePatch(
      `${mockup.id}:surcouches`,
      mockup.id,
      { beautyShotOverlayOpacities: JSON.stringify(next) },
      "des surcouches"
    );
  }

  // Échange l'ordre avec le voisin — même principe que les chevrons des
  // calques (LayersPanel), plus précis qu'un glisser-déposer ici.
  async function handleMove(index: number, direction: -1 | 1) {
    if (!mockups) return;
    const target = mockups[index + direction];
    const current = mockups[index];
    if (!target || !current) return;
    await Promise.all([
      fetch(`/api/template-mockups/${current.id}`, {
        method: "PATCH",
        body: formDataOf({ sortOrder: String(target.sort_order) }),
      }),
      fetch(`/api/template-mockups/${target.id}`, {
        method: "PATCH",
        body: formDataOf({ sortOrder: String(current.sort_order) }),
      }),
    ]);
    load();
  }

  async function handleDelete(mockup: MockupWithOverlays) {
    if (!confirm(`Supprimer le mockup « ${mockup.name} » ?`)) return;
    const res = await fetch(`/api/template-mockups/${mockup.id}`, { method: "DELETE" });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(data.error ?? "Erreur lors de la suppression.");
      return;
    }
    load();
  }

  return (
    <div className="space-y-6">
      {error && <p className="rounded-lg border border-warning bg-warning-subtle p-3 text-sm text-text">⚠ {error}</p>}

      {mockups === null ? (
        <div className="flex items-center justify-center gap-2 py-8 text-text-muted">
          <SpinnerIcon className="h-5 w-5" />
          Chargement...
        </div>
      ) : mockups.length === 0 ? (
        <p className="rounded-xl border border-border bg-surface-muted p-4 text-sm text-text-muted">
          Aucun mockup pour ce modèle. Ajoute un bundle ci-dessous pour en créer un ; tu peux en mettre plusieurs (le
          même produit sous différents angles).
        </p>
      ) : (
        <ul className="space-y-2">
          {mockups.map((mockup, index) => (
            <li key={mockup.id} className="rounded-xl border border-border bg-surface p-3 text-sm">
              <div className="flex items-center gap-2">
                <span className="w-6 shrink-0 text-center text-xs text-text-subtle">{index + 1}</span>
                <input
                  defaultValue={mockup.name}
                  onBlur={(e) => handleRename(mockup, e.target.value)}
                  aria-label="Nom du mockup"
                  className="min-w-0 flex-1 rounded-lg border border-border px-2 py-1.5"
                />
                <button
                  type="button"
                  onClick={() => setOpenFraming((id) => (id === mockup.id ? null : mockup.id))}
                  aria-expanded={openFraming === mockup.id}
                  className="shrink-0 rounded-lg border border-border px-2 py-1.5 text-xs text-text-muted hover:text-text"
                >
                  Réglages
                </button>
                <button
                  type="button"
                  onClick={() => handleMove(index, -1)}
                  disabled={index === 0}
                  aria-label="Monter"
                  className="text-text-subtle hover:text-text disabled:opacity-30"
                >
                  <ChevronUpIcon className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  onClick={() => handleMove(index, 1)}
                  disabled={index === mockups.length - 1}
                  aria-label="Descendre"
                  className="text-text-subtle hover:text-text disabled:opacity-30"
                >
                  <ChevronDownIcon className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  onClick={() => handleDelete(mockup)}
                  aria-label={`Supprimer ${mockup.name}`}
                  className="text-text-subtle hover:text-danger"
                >
                  <TrashIcon className="h-4 w-4" />
                </button>
              </div>

              {openFraming === mockup.id && (
                <FramingPanel
                  framing={framingOf(mockup)}
                  onChange={(patch) => handleFraming(mockup, patch)}
                  maskBounds={mockup.maskBounds ?? null}
                  overlays={mockup.overlays ?? []}
                  opacities={mockup.overlay_opacities}
                  onOpacityChange={(index, value) => handleOverlayOpacity(mockup, index, value)}
                />
              )}
            </li>
          ))}
        </ul>
      )}

      <form onSubmit={handleAdd} className="space-y-3 rounded-xl border border-border p-4">
        <p className="text-sm font-semibold text-text">Ajouter un mockup</p>

        <div>
          <label className="block text-sm font-medium">Nom</label>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Vue de gauche"
            required
            className="mt-1 w-full rounded-lg border border-border px-3 py-2 text-sm"
          />
        </div>

        <div>
          <label className="block text-sm font-medium">Angle de prise de vue</label>
          <select
            value={positionX}
            onChange={(e) => setPositionX(e.target.value)}
            className="mt-1 w-full rounded-lg border border-border px-3 py-2 text-sm"
          >
            {POSITION_X_PRESETS.map((o) => (
              <option key={o.value} value={String(o.value)}>
                {o.label}
              </option>
            ))}
          </select>
          <p className="mt-1 text-xs text-text-subtle">
            Détermine la partie du visuel visible sur ce mockup. Une fois le mockup créé, « Cadrage du visuel » permet
            d’affiner la position et l’échelle au pourcentage près.
          </p>
        </div>

        <div>
          <label className="block text-sm font-medium">Fichier XML du bundle</label>
          <div className="mt-1">
            <FileDropZone file={xmlFile} onFileChange={handleXmlChange} accept=".xml,application/xml,text/xml" />
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium">Images du bundle</label>
          <input
            ref={imagesInputRef}
            type="file"
            accept="image/png,image/jpeg,image/webp"
            multiple
            onChange={(e) => setImageFiles(Array.from(e.target.files ?? []))}
            className="mt-1 w-full text-sm"
          />
          {assetNames.length > 0 && (
            <p className="mt-1 text-xs text-text-subtle">
              Assets attendus (le nom du fichier, sans extension, doit correspondre) : {assetNames.join(", ")}.
            </p>
          )}
          {imageFiles.length > 0 && (
            <p className="mt-1 text-xs text-text-subtle">
              {imageFiles.length} fichier{imageFiles.length > 1 ? "s" : ""} sélectionné
              {imageFiles.length > 1 ? "s" : ""}.
            </p>
          )}
        </div>

        <button
          type="submit"
          disabled={busy || !name.trim() || !xmlFile}
          className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-text-on-brand hover:bg-primary-hover disabled:opacity-40"
        >
          {busy && <SpinnerIcon className="h-4 w-4" />}
          Ajouter
        </button>
      </form>
    </div>
  );
}

/**
 * Réglages d'un mockup : d'un côté la position et l'échelle du visuel dans la
 * zone (en pourcentages), de l'autre l'intensité de chaque surcouche du
 * bundle. Le cadrage prime sur celui choisi par le client dans l'Outil
 * Shopify (ou enregistré sur le produit) : c'est l'angle de prise de vue qui
 * décide quelle partie du visuel est visible.
 */
function FramingPanel({
  framing,
  onChange,
  maskBounds,
  overlays,
  opacities,
  onOpacityChange,
}: {
  framing: Framing;
  onChange: (patch: Partial<Framing>) => void;
  maskBounds: MaskBounds | null;
  overlays: MockupOverlay[];
  opacities: number[] | null;
  onOpacityChange: (index: number, value: number) => void;
}) {
  return (
    <div className="mt-3 space-y-3 rounded-lg bg-surface-muted p-3">
      <div>
        <div className="flex items-center justify-between text-xs font-medium text-text">
          <span>Étendue du visuel sur le produit</span>
        </div>
        <p className="mt-0.5 text-[11px] text-text-subtle">
          Le mesh du bundle couvre souvent toute l’image alors que le produit n’en occupe qu’une partie : sans marge,
          le visuel s’étale d’un bord à l’autre de l’image, ce qui le décale et l’agrandit.
        </p>
        <div className="mt-1.5 grid grid-cols-2 gap-2">
          {([
            ["marginLeft", "Gauche", framing.marginLeft],
            ["marginRight", "Droite", framing.marginRight],
            ["marginTop", "Haut", framing.marginTop],
            ["marginBottom", "Bas", framing.marginBottom],
          ] as const).map(([key, label, value]) => (
            <div key={key}>
              <div className="flex items-center justify-between text-[11px] text-text-muted">
                <span>{label}</span>
                <span>{Math.round(value * 100)} %</span>
              </div>
              <input
                type="range"
                min={0}
                max={45}
                step={1}
                value={Math.round(value * 100)}
                onChange={(e) => onChange({ [key]: Number(e.target.value) / 100 })}
                aria-label={label}
                className="pico-range mt-1 w-full"
                style={rangeFillStyle(value, 0, 0.45)}
              />
            </div>
          ))}
        </div>
        {maskBounds && (
          <button
            type="button"
            onClick={() =>
              // Arrondi vers l'extérieur (le pour cent du dessous) : le visuel
              // déborde un peu du produit, et le masque le recoupe. Arrondi au
              // plus proche, il pouvait commencer quelques pixels en dedans et
              // laisser un liseré blanc le long du rebord.
              onChange({
                marginLeft: Math.floor(maskBounds.left * 100) / 100,
                marginRight: Math.floor(maskBounds.right * 100) / 100,
                marginTop: Math.floor(maskBounds.top * 100) / 100,
                marginBottom: Math.floor(maskBounds.bottom * 100) / 100,
              })
            }
            className="mt-1.5 rounded-full border border-border px-2.5 py-1 text-[11px] text-text-muted hover:text-text"
          >
            Caler sur le produit ({Math.floor(maskBounds.left * 100)} · {Math.floor(maskBounds.right * 100)} ·{" "}
            {Math.floor(maskBounds.top * 100)} · {Math.floor(maskBounds.bottom * 100)} %)
          </button>
        )}
      </div>

      <div>
        <div className="flex items-center justify-between text-xs font-medium text-text">
          <span>Position horizontale</span>
          <span className="text-text-muted">{Math.round(framing.positionX * 100)} %</span>
        </div>
        <input
          type="range"
          min={0}
          max={100}
          step={1}
          value={Math.round(framing.positionX * 100)}
          onChange={(e) => onChange({ positionX: Number(e.target.value) / 100 })}
          aria-label="Position horizontale du visuel"
          className="pico-range mt-1 w-full"
          style={rangeFillStyle(framing.positionX, 0, 1)}
        />
        <div className="mt-1 flex gap-1.5">
          {POSITION_X_PRESETS.map((preset) => (
            <button
              key={preset.value}
              type="button"
              onClick={() => onChange({ positionX: preset.value })}
              className={`rounded-full border px-2 py-1 text-[11px] ${
                framing.positionX === preset.value
                  ? "border-primary bg-primary text-text-on-brand"
                  : "border-border text-text-muted hover:text-text"
              }`}
            >
              {preset.label}
            </button>
          ))}
        </div>
      </div>

      <div>
        <div className="flex items-center justify-between text-xs font-medium text-text">
          <span>Position verticale</span>
          <span className="text-text-muted">{Math.round(framing.positionY * 100)} %</span>
        </div>
        <input
          type="range"
          min={0}
          max={100}
          step={1}
          value={Math.round(framing.positionY * 100)}
          onChange={(e) => onChange({ positionY: Number(e.target.value) / 100 })}
          aria-label="Position verticale du visuel"
          className="pico-range mt-1 w-full"
          style={rangeFillStyle(framing.positionY, 0, 1)}
        />
        <p className="mt-1 text-[11px] text-text-subtle">
          0 % = haut du visuel, 100 % = bas. Sans effet si le visuel n’a pas de marge verticale à cette échelle (il ne
          déborde alors qu’en largeur) : augmente l’échelle pour dégager du jeu.
        </p>
      </div>

      <div>
        <div className="flex items-center justify-between text-xs font-medium text-text">
          <span>Échelle du visuel</span>
          <span className="text-text-muted">{Math.round(framing.zoom * 100)} %</span>
        </div>
        <input
          type="range"
          min={100}
          max={500}
          step={5}
          value={Math.round(framing.zoom * 100)}
          onChange={(e) => onChange({ zoom: Number(e.target.value) / 100 })}
          aria-label="Échelle du visuel"
          className="pico-range mt-1 w-full"
          style={rangeFillStyle(framing.zoom, 1, 5)}
        />
        <p className="mt-1 text-[11px] text-text-subtle">
          100 % = le visuel remplit tout juste la zone du mockup ; au-delà, il est agrandi puis recadré.
        </p>
      </div>

      {overlays.length > 0 && (
        <div className="border-t border-border pt-3">
          <p className="text-xs font-medium text-text">Intensité des surcouches</p>
          <p className="mt-0.5 text-[11px] text-text-subtle">
            Les effets posés par-dessus le visuel : ombres, reflets, matière du produit. 100 % = l’effet tel que le
            bundle le définit, 0 % = supprimé.
          </p>
          <div className="mt-2 space-y-2">
            {overlays.map((overlay, index) => {
              const value = opacities?.[index] ?? 100;
              return (
                <div key={`${overlay.name}-${index}`}>
                  <div className="flex items-center justify-between text-[11px] text-text">
                    <span>{BLEND_LABELS[overlay.blendMode] ?? overlay.blendMode}</span>
                    <span className="text-text-muted">{value} %</span>
                  </div>
                  <input
                    type="range"
                    min={0}
                    max={100}
                    step={1}
                    value={value}
                    onChange={(e) => onOpacityChange(index, Number(e.target.value))}
                    aria-label={`Intensité : ${BLEND_LABELS[overlay.blendMode] ?? overlay.blendMode}`}
                    className="pico-range mt-1 w-full"
                    style={rangeFillStyle(value, 0, 100)}
                  />
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

function formDataOf(fields: Record<string, string>): FormData {
  const body = new FormData();
  for (const [key, value] of Object.entries(fields)) body.append(key, value);
  return body;
}
