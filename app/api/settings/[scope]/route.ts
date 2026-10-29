import { serverError } from "@/lib/api";
import { NextResponse } from "next/server";
import { createAdminSupabaseClient, createServerSupabaseClient, getAuthorizedAdmin } from "@/lib/supabase/server";
import {
  ASSET_SLOTS,
  assetPathFor,
  BASE_SCOPES,
  COLOR_FIELDS,
  fromRow,
  isSettingsScope,
  isHexColor,
  loadAppSettings,
  parseTypography,
  type AppSettingsRow,
  type ColorKey,
  type SettingsScope,
} from "@/lib/appSettings";

export const runtime = "nodejs";

// Fichiers acceptés par emplacement. Les polices d'interface sont servies
// telles quelles au navigateur (voir la route asset), d'où des formats web.
const UPLOADS: { field: string; column: string; extensions: string[] }[] = [
  { field: "logo", column: "logo_path", extensions: ["svg", "png", "webp", "jpg", "jpeg"] },
  { field: "favicon", column: "favicon_path", extensions: ["svg", "png", "ico"] },
  { field: "share", column: "share_image_path", extensions: ["png", "jpg", "jpeg", "webp"] },
  { field: "fontBody", column: "font_body_path", extensions: ["woff2", "woff", "otf", "ttf"] },
  { field: "fontHeading", column: "font_heading_path", extensions: ["woff2", "woff", "otf", "ttf"] },
];

function validScope(scope: string): scope is SettingsScope {
  return isSettingsScope(scope);
}

export async function GET(_request: Request, { params }: { params: { scope: string } }) {
  if (!validScope(params.scope)) return NextResponse.json({ error: "Jeu inconnu." }, { status: 404 });
  const settings = await loadAppSettings(createServerSupabaseClient(), params.scope);
  return NextResponse.json({ settings });
}

/**
 * Enregistre un jeu de réglages. Réservé aux administrateurs : un réglage
 * ici change l'interface de tout le monde (la RLS l'impose aussi, voir la
 * migration 0054 — la garde ici donne surtout un message clair).
 */
export async function PATCH(request: Request, { params }: { params: { scope: string } }) {
  if (!validScope(params.scope)) return NextResponse.json({ error: "Jeu inconnu." }, { status: 404 });
  const scope = params.scope;

  // getAuthorizedAdmin plutôt que requireAdmin : ce dernier redirige, ce qui
  // ne fonctionne pas dans une route API (voir lib/supabase/server.ts).
  const supabase = createServerSupabaseClient();
  const { user, isAdmin } = await getAuthorizedAdmin(supabase);
  if (!user) return NextResponse.json({ error: "Non authentifié." }, { status: 401 });
  if (!isAdmin) return NextResponse.json({ error: "Réservé aux administrateurs." }, { status: 403 });

  const formData = await request.formData();
  const update: Record<string, unknown> = { updated_at: new Date().toISOString(), updated_by: user.id };

  // Couleurs : on n'enregistre que ce qui est valide et réellement fourni.
  // Une couleur remise à vide retourne à la valeur par défaut du thème.
  if (formData.has("colors")) {
    const raw = formData.get("colors");
    let parsed: unknown;
    try {
      parsed = JSON.parse(String(raw ?? "{}"));
    } catch {
      return NextResponse.json({ error: "Couleurs illisibles." }, { status: 400 });
    }
    const source = (parsed ?? {}) as Record<string, unknown>;
    const colors: Partial<Record<ColorKey, string>> = {};
    for (const field of COLOR_FIELDS) {
      const value = source[field.key];
      if (value === null || value === undefined || value === "") continue;
      if (!isHexColor(value)) {
        return NextResponse.json({ error: `Couleur invalide pour « ${field.label} ».` }, { status: 400 });
      }
      colors[field.key] = value;
    }
    update.colors = colors;
  }

  if (formData.has("typography")) {
    try {
      update.typography = parseTypography(JSON.parse(String(formData.get("typography") ?? "{}")));
    } catch {
      return NextResponse.json({ error: "Typographie illisible." }, { status: 400 });
    }
  }

  const admin = createAdminSupabaseClient();
  for (const upload of UPLOADS) {
    // Champ « <nom>Clear » à "true" : revenir au fichier d'origine.
    if (formData.get(`${upload.field}Clear`) === "true") {
      update[upload.column] = null;
      continue;
    }
    const file = formData.get(upload.field);
    if (!(file instanceof File) || file.size === 0) continue;

    const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
    if (!upload.extensions.includes(ext)) {
      return NextResponse.json(
        { error: `Format non accepté pour « ${upload.field} » (${upload.extensions.join(", ")}).` },
        { status: 400 }
      );
    }

    // Chemin daté : le bucket est en cache long côté navigateur, un nom
    // stable ferait resservir l'ancien fichier malgré le remplacement.
    const storagePath = `settings/${scope}/${upload.field}-${Date.now()}.${ext}`;
    const { error } = await admin.storage
      .from("assets")
      .upload(storagePath, Buffer.from(await file.arrayBuffer()), { contentType: file.type, upsert: true });
    if (error) return serverError(error, "Impossible d'enregistrer les réglages.");
    update[upload.column] = storagePath;
  }

  // upsert et non update : seules les lignes « admin » et « tool » sont
  // créées par la migration 0054. Une boutique n'en a aucune tant qu'on ne
  // lui a rien enregistré, et l'update ne touchait alors AUCUNE ligne — d'où
  // le « Cannot coerce the result to a single JSON object » du .single().
  // Les colonnes absentes de `update` prennent leurs valeurs par défaut :
  // une ligne vide rend exactement le jeu « tool », dont elle hérite.
  const { data, error } = await supabase
    .from("app_settings")
    .upsert({ scope, ...update }, { onConflict: "scope" })
    .select()
    .single();
  if (error) return serverError(error, "Impossible d'enregistrer les réglages.");
  return NextResponse.json({ settings: data });
}

/**
 * Retire le jeu de réglages d'une boutique (voir la migration 0060).
 *
 * Seulement une boutique : « admin » et « tool » sont les deux jeux de
 * l'outil lui-même, et l'interface n'aurait plus de quoi se peindre.
 *
 * Les fichiers téléversés partent avec la ligne. Sans ça, chaque suppression
 * laisserait derrière elle un logo et un favicon que plus rien ne référence,
 * dans un bucket que personne ne regarde.
 *
 * La boutique peut réapparaître dans la liste au rechargement si des
 * commandes en proviennent : elle est alors une boutique connue, simplement
 * revenue à l'habillage par défaut. C'est voulu — le module Paramètres ne
 * décide pas de quelles boutiques existent.
 */
export async function DELETE(_request: Request, { params }: { params: { scope: string } }) {
  if (!validScope(params.scope)) return NextResponse.json({ error: "Jeu inconnu." }, { status: 404 });
  const scope = params.scope;

  // L'authentification d'abord : un appelant non connecté n'a aucune raison
  // d'apprendre quels jeux existent, ni d'obtenir autre chose qu'un 401.
  const supabase = createServerSupabaseClient();
  const { user, isAdmin } = await getAuthorizedAdmin(supabase);
  if (!user) return NextResponse.json({ error: "Non authentifié." }, { status: 401 });
  if (!isAdmin) return NextResponse.json({ error: "Réservé aux administrateurs." }, { status: 403 });

  if ((BASE_SCOPES as readonly string[]).includes(scope)) {
    return NextResponse.json(
      { error: "Les jeux « Administration » et « Outil Shopify » ne peuvent pas être supprimés." },
      { status: 400 }
    );
  }

  // Une boutique ajoutée dans l'interface mais jamais enregistrée n'a pas de
  // ligne. Il n'y a alors rien à supprimer, et surtout rien d'anormal : sans
  // cette distinction, le contrôle plus bas accuserait à tort la migration.
  const { data: existante } = await supabase
    .from("app_settings")
    .select("*")
    .eq("scope", scope)
    .maybeSingle();
  if (!existante) return NextResponse.json({ ok: true, fichiersSupprimés: 0 });

  const settings = fromRow(existante as AppSettingsRow);
  const fichiers = ASSET_SLOTS.map((slot) => assetPathFor(settings, slot)).filter(
    (p): p is string => Boolean(p)
  );

  // La ligne d'abord : si la suppression des fichiers échoue, il reste des
  // orphelins dans le bucket, ce qui est sans conséquence. L'inverse — des
  // réglages pointant sur des fichiers disparus — casserait l'affichage.
  //
  // `.select()` n'est pas décoratif : un refus de la RLS ne lève PAS d'erreur
  // sur un delete, il ne touche simplement aucune ligne. Sans cette
  // vérification, une migration 0060 non exécutée ferait répondre « supprimé »
  // à une suppression qui n'a rien fait.
  const { data: supprimées, error } = await supabase
    .from("app_settings")
    .delete()
    .eq("scope", scope)
    .select("scope");
  if (error) return serverError(error, "Impossible d'enregistrer les réglages.");
  if (!supprimées || supprimées.length === 0) {
    return NextResponse.json(
      {
        error:
          "Suppression refusée par la base : la migration 0060 n'a probablement pas été exécutée.",
      },
      { status: 500 }
    );
  }
  if (fichiers.length > 0) {
    await createAdminSupabaseClient().storage.from("assets").remove(fichiers);
  }

  return NextResponse.json({ ok: true, fichiersSupprimés: fichiers.length });
}
