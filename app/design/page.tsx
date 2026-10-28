import { loadIllustrations } from "@/lib/illustrationsData";
import {
  createAdminSupabaseClient,
  createServerSupabaseClient,
  loadAppSettingsCached,
  requireUser,
} from "@/lib/supabase/server";
import DesignTool from "@/components/DesignTool";
import { redirect } from "next/navigation";
import { createGrant, isValidPublicKey, verifyGrant } from "@/lib/publicDesign";
import { isAllowedReturnUrl } from "@/lib/shopify";
import AppSettingsStyle from "@/components/AppSettingsStyle";
import {
  assetUrl,
  shopScopeOf,
} from "@/lib/appSettings";
import type { Metadata } from "next";
import type { VisualWithUrl } from "@/components/VisualsGrid";
import type { ThemeWithOverlayUrl } from "@/components/ThemesTable";
import type {
  Category,
  Sku,
  Template,
  TemplateMockup,
  Theme,
  Visual,
} from "@/lib/types";
import { signedUrls } from "@/lib/storageUrls";

// Données de l'outil de design : modèles, catégories, SKUs (affiché au
// résumé), banque de visuels et thèmes (visuels préfaits, voir
// supabase/migrations/0046_themes.sql) — plus de notion de Produit (ni de
// collection) ici, l'outil ne fait que préparer un design (aperçu +
// téléchargement), il n'enregistre rien.
//
/**
 * Favicon de l'onglet. app/layout.tsx pose celui de l'administration pour
 * tout le site ; l'Outil Shopify le remplace ici, par celui de la boutique
 * d'où vient le client — et à défaut par celui du jeu « tool », comme le
 * logo de la barre de navigation le fait déjà.
 *
 * Lecture par le client admin : le visiteur public n'a pas de session, et la
 * RLS de app_settings ne lui ouvre rien. Seul `updated_at` est utilisé, pour
 * le `?v=` qui invalide le cache du navigateur quand le fichier change.
 *
 * Même contrôle strict que l'habillage plus bas : une adresse de retour
 * forgée retombe sur « tool », pour que les deux décisions prises ici
 * s'accordent. La barre de navigation, elle, est un composant client et ne
 * peut pas lire SHOPIFY_SHOP_DOMAIN — elle s'arrête à la forme du domaine.
 */
export async function generateMetadata({
  searchParams,
}: {
  searchParams?: { retour?: string; boutique?: string };
}): Promise<Metadata> {
  const scope = isAllowedReturnUrl(searchParams?.retour)
    ? (shopScopeOf(searchParams?.boutique, searchParams?.retour) ?? "tool")
    : "tool";
  const settings = await loadAppSettingsCached(scope, true);
  return { icons: { icon: assetUrl(scope, "favicon", settings.updatedAt) } };
}

// Deux entrées possibles :
// - interne, avec une session : tout le catalogue, galerie de modèles ;
// - publique, par un lien `?template=<id>&cle=<secret>` venant de Shopify :
//   pas de connexion, et STRICTEMENT le modèle demandé (voir
//   lib/publicDesign.ts). La lecture y passe par le client admin, faute de
//   session à autoriser côté RLS.
export default async function DesignPage({
  searchParams,
}: {
  searchParams?: {
    template?: string;
    cle?: string;
    jeton?: string;
    variant?: string;
    quantity?: string;
    retour?: string;
    boutique?: string;
  };
}) {
  const templateId = searchParams?.template;

  // Le secret est échangé contre un laissez-passer dès l'arrivée, puis
  // disparaît de l'adresse. Il ne traîne donc ni dans l'historique, ni dans
  // les en-têtes Referer, ni dans le code de la page — contrairement au
  // jeton, qui ne vaut que pour ce modèle et que douze heures.
  // Contexte de commande transmis par la fiche produit Shopify : variante,
  // quantité, adresse de retour et domaine public de la boutique. Conservé à travers l'échange clé →
  // laissez-passer, sinon le client perdrait son panier en route.
  const shopifyParams = new URLSearchParams();
  if (searchParams?.variant) shopifyParams.set("variant", searchParams.variant);
  if (searchParams?.quantity)
    shopifyParams.set("quantity", searchParams.quantity);
  if (searchParams?.retour) shopifyParams.set("retour", searchParams.retour);
  if (searchParams?.boutique)
    shopifyParams.set("boutique", searchParams.boutique);
  const suffix = shopifyParams.toString() ? `&${shopifyParams}` : "";

  if (templateId && isValidPublicKey(searchParams?.cle)) {
    const grant = createGrant(templateId);
    if (grant) {
      redirect(
        `/design?template=${encodeURIComponent(templateId)}&jeton=${encodeURIComponent(grant)}${suffix}`,
      );
    }
  }

  if (templateId && verifyGrant(searchParams?.jeton) === templateId) {
    return publicTool(templateId, searchParams!.jeton!, {
      variantId: searchParams?.variant ?? null,
      quantity: Math.max(1, Math.floor(Number(searchParams?.quantity)) || 1),
      // Adresse de retour : seulement une URL ABSOLUE vers la boutique.
      // Une adresse relative se résoudrait sur le domaine de pico-design (le
      // client atterrissait sur /products_preview ici même), et accepter
      // n'importe quel domaine ferait de cette page une redirection ouverte.
      returnUrl: isAllowedReturnUrl(searchParams?.retour)
        ? searchParams!.retour!
        : null,
      boutique: searchParams?.boutique ?? null,
    });
  }

  await requireUser();
  const supabase = createServerSupabaseClient();
  // Indépendant des requêtes suivantes : lancé tout de suite.
  const illustrationsPromise = loadIllustrations(supabase);
  const [
    { data: templates },
    { data: categories },
    { data: skus },
    { data: visuals },
    { data: themes },
    { data: mockups },
  ] = await Promise.all([
    supabase.from("templates").select("*").order("name", { ascending: true }),
    supabase
      .from("categories")
      .select("*")
      .order("sort_order", { ascending: true }),
    supabase.from("skus").select("*").order("sku", { ascending: true }),
    supabase.from("visuals").select("*").order("name", { ascending: true }),
    supabase.from("themes").select("*").order("name", { ascending: true }),
    supabase
      .from("template_mockups")
      .select("*")
      .order("sort_order", { ascending: true })
      .order("created_at", { ascending: true }),
  ]);

  // Adresses signées par lots (une requête par bucket, pas une par fichier).
  const visualRows = (visuals as Visual[]) ?? [];
  const themeRows = (themes as Theme[]) ?? [];
  const [visualUrls, overlayUrls] = await Promise.all([
    signedUrls(supabase, "visuals", visualRows.map((v) => v.file_path)),
    signedUrls(supabase, "overlays", themeRows.flatMap((t) => [t.overlay_path, t.background_path])),
  ]);
  const visualsWithUrls: VisualWithUrl[] = visualRows.map((v) => ({ ...v, fileUrl: visualUrls.get(v.file_path) ?? null }));
  const themesWithUrls: ThemeWithOverlayUrl[] = themeRows.map((t) => ({
    ...t,
    overlayUrl: overlayUrls.get(t.overlay_path) ?? null,
    backgroundUrl: (t.background_path && overlayUrls.get(t.background_path)) || null,
  }));

  const illustrations = await illustrationsPromise;

  return (
    <DesignTool
      templates={(templates as Template[]) ?? []}
      categories={(categories as Category[]) ?? []}
      skus={(skus as Sku[]) ?? []}
      visuals={visualsWithUrls}
      themes={themesWithUrls}
      illustrations={illustrations}
      mockups={(mockups as TemplateMockup[]) ?? []}
      // Lien de fiche produit ouvert par un employé connecté (sans clé
      // valable) : le modèle est déjà choisi, comme pour le client.
      initialTemplateId={templateId}
    />
  );
}

/**
 * Entrée publique : un seul modèle, ses thèmes et ses mockups. Rien d'autre
 * n'est envoyé au navigateur — ni les autres modèles, ni la banque de
 * visuels (commune à tous, elle fuirait bien au-delà du lien), ni le secret,
 * remplacé par un laissez-passer limité à ce modèle.
 */
async function publicTool(
  templateId: string,
  grant: string,
  shopify: {
    variantId: string | null;
    quantity: number;
    returnUrl: string | null;
    boutique: string | null;
  },
) {
  const admin = createAdminSupabaseClient();
  // Indépendant des requêtes suivantes : lancé tout de suite (la promesse est
  // attendue plus bas, ou ignorée si le modèle est introuvable).
  const illustrationsPromise = loadIllustrations(admin);
  illustrationsPromise.catch(() => {});

  const { data: template } = await admin
    .from("templates")
    .select("*")
    .eq("id", templateId)
    .maybeSingle();
  if (!template) {
    return (
      <main className="mx-auto max-w-lg px-4 py-16 text-center">
        <h1 className="font-display text-page-title text-text">
          Modèle introuvable
        </h1>
        <p className="mt-2 text-sm text-text-muted">
          Ce lien ne correspond à aucun produit. Vérifie l&apos;adresse, ou
          contacte-nous.
        </p>
      </main>
    );
  }

  const row = template as Template;
  const [
    { data: categories },
    { data: skus },
    { data: themes },
    { data: mockups },
  ] = await Promise.all([
    admin.from("categories").select("*").eq("id", row.category_id),
    row.sku_id
      ? admin.from("skus").select("*").eq("id", row.sku_id)
      : Promise.resolve({ data: [] }),
    admin
      .from("themes")
      .select("*")
      .eq("template_id", row.id)
      .order("name", { ascending: true }),
    admin
      .from("template_mockups")
      .select("*")
      .eq("template_id", row.id)
      .order("sort_order", { ascending: true })
      .order("created_at", { ascending: true }),
  ]);

  const publicThemes = (themes as Theme[]) ?? [];
  const publicOverlayUrls = await signedUrls(admin, "overlays", publicThemes.flatMap((t) => [t.overlay_path, t.background_path]));
  const themesWithUrls: ThemeWithOverlayUrl[] = publicThemes.map((t) => ({
    ...t,
    overlayUrl: publicOverlayUrls.get(t.overlay_path) ?? null,
    backgroundUrl: (t.background_path && publicOverlayUrls.get(t.background_path)) || null,
  }));

  // La banque d'illustrations, elle, est faite pour le client : contrairement
  // aux visuels, elle part aussi en mode public (en adresses signées).
  const illustrations = await illustrationsPromise;

  // Boutique d'origine du visiteur : son domaine public (`boutique`), sinon
  // celui de l'adresse de retour — validée plus haut par isAllowedReturnUrl,
  // et sans laquelle on ne vient pas d'une boutique. Ses réglages priment sur le
  // jeu « tool » posé par app/design/layout.tsx : ce bloc de style vient plus
  // loin dans le document, il l'emporte. Sans réglages propres à cette
  // boutique, il ne produit rien et le jeu par défaut s'applique.
  const boutique = shopify.returnUrl
    ? shopScopeOf(shopify.boutique, shopify.returnUrl)
    : null;

  return (
    <>
      {boutique && <AppSettingsStyle scope={boutique} />}
      <DesignTool
        templates={[row]}
        categories={(categories as Category[]) ?? []}
        skus={(skus as Sku[]) ?? []}
        visuals={[]}
        themes={themesWithUrls}
        illustrations={illustrations}
        mockups={(mockups as TemplateMockup[]) ?? []}
        publicTemplateId={row.id}
        grant={grant}
        brandScope={boutique ?? "tool"}
        // Sans variante NI adresse de retour valable, pas de parcours de
        // commande : on retombe sur le téléchargement du PDF, plutôt que de
        // proposer un bouton qui mènerait nulle part.
        shopify={
          shopify.variantId && shopify.returnUrl
            ? {
                variantId: shopify.variantId,
                quantity: shopify.quantity,
                returnUrl: shopify.returnUrl,
              }
            : undefined
        }
      />
    </>
  );
}
