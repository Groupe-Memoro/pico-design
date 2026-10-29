import { serverError } from "@/lib/api";
import { NextResponse } from "next/server";
import { createAdminSupabaseClient } from "@/lib/supabase/server";
import {
  designIdOfLineItem,
  productIdOfLineItem,
  shopDomainOfOrder,
  verifyWebhookSignature,
  type ShopifyOrder,
} from "@/lib/shopify";

export const runtime = "nodejs";

/**
 * Webhook des commandes Shopify (`orders/create` et `orders/updated`).
 *
 * La signature est vérifiée sur le CORPS BRUT avant toute lecture : sans
 * elle, cette URL publique permettrait de fabriquer des commandes de toutes
 * pièces. Une charge non signée, mal signée, ou reçue alors qu'aucun secret
 * n'est configuré, est refusée.
 *
 * Réponses : 401 si la signature ne va pas, 200 dans tous les autres cas où
 * la charge a été traitée — Shopify réessaie sur toute réponse non-2xx, et
 * une commande dont une ligne est bancale ne doit pas provoquer une boucle
 * de réessais.
 */
export async function POST(request: Request) {
  const rawBody = await request.text();
  const signature = request.headers.get("x-shopify-hmac-sha256");
  if (!verifyWebhookSignature(rawBody, signature, await webhookSecrets(request.headers.get("x-shopify-shop-domain")))) {
    return NextResponse.json({ error: "Signature invalide." }, { status: 401 });
  }

  let order: ShopifyOrder;
  try {
    order = JSON.parse(rawBody) as ShopifyOrder;
  } catch {
    return NextResponse.json({ error: "Charge illisible." }, { status: 400 });
  }
  if (!order?.id) return NextResponse.json({ error: "Commande sans identifiant." }, { status: 400 });

  const admin = createAdminSupabaseClient();
  const shopifyOrderId = String(order.id);
  // Boutique d'origine : l'en-tête dit laquelle a envoyé la commande, là où
  // la variable d'environnement n'en décrit qu'une seule. À défaut d'en-tête
  // (notification de test, relais qui le supprime), on le retrouve dans
  // l'adresse de suivi de la commande.
  const shop = request.headers.get("x-shopify-shop-domain") ?? shopDomainOfOrder(order);

  // upsert : `orders/updated` repasse sur la même commande, et Shopify peut
  // renvoyer deux fois le même événement (livraison au moins une fois).
  const { data: saved, error } = await admin
    .from("orders")
    .upsert(
      {
        shopify_order_id: shopifyOrderId,
        order_number: order.name ?? (order.order_number ? `#${order.order_number}` : null),
        customer_email: order.email ?? order.contact_email ?? null,
        financial_status: order.financial_status ?? null,
        fulfillment_status: order.fulfillment_status ?? null,
        shop_domain: shop,
        raw: order,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "shopify_order_id" }
    )
    .select("id")
    .single();

  if (error) return serverError(error, "Impossible d'enregistrer la commande.");
  const orderId = (saved as { id: string }).id;

  // Les lignes sont réécrites à chaque réception : c'est la charge utile qui
  // fait foi, et ça évite les doublons sur un `orders/updated`.
  await admin.from("order_items").delete().eq("order_id", orderId);

  const items = (order.line_items ?? []).map((item) => ({
    order_id: orderId,
    design_submission_id: designIdOfLineItem(item),
    product_id: productIdOfLineItem(item),
    title: item.title ?? null,
    quantity: item.quantity ?? 1,
  }));

  if (items.length > 0) {
    // Un design référencé mais absent (lien forgé, base réinitialisée) ferait
    // échouer la clé étrangère : on ne garde que les identifiants existants.
    // Même chose pour un produit Pico (supprimé, ou id mal collé dans Shopify).
    const known = await existingIds(admin, "design_submissions", items.map((i) => i.design_submission_id));
    const knownProducts = await existingIds(admin, "products", items.map((i) => i.product_id));
    const { error: itemsError } = await admin.from("order_items").insert(
      items.map((i) => ({
        ...i,
        design_submission_id: i.design_submission_id && known.has(i.design_submission_id) ? i.design_submission_id : null,
        product_id: i.product_id && knownProducts.has(i.product_id) ? i.product_id : null,
      }))
    );
    if (itemsError) return serverError(itemsError, "Impossible d'enregistrer les articles de la commande.");
  }

  return NextResponse.json({ ok: true, lignes: items.length });
}

// Ceux des identifiants donnés qui existent dans la table.
async function existingIds(
  admin: ReturnType<typeof createAdminSupabaseClient>,
  table: "design_submissions" | "products",
  ids: (string | null)[]
): Promise<Set<string>> {
  const referenced = ids.filter((v): v is string => Boolean(v));
  const known = new Set<string>();
  if (referenced.length === 0) return known;
  const { data: rows } = await admin.from(table).select("id").in("id", referenced);
  for (const row of (rows as { id: string }[]) ?? []) known.add(row.id);
  return known;
}

/**
 * Clés à essayer pour vérifier la signature : celle enregistrée dans
 * Paramètres pour la boutique annoncée, et la variable d'environnement (la
 * boutique d'origine, configurée avant les Paramètres).
 *
 * L'en-tête X-Shopify-Shop-Domain n'est pas signé, mais il ne fait que CHOISIR
 * la clé : annoncer une autre boutique n'apprend rien de sa clé, et la
 * signature doit toujours correspondre. Sans en-tête, toutes les clés sont
 * essayées (quelques boutiques au plus).
 *
 * Shopify envoie toujours le domaine en .myshopify.com, alors qu'une boutique
 * peut avoir été enregistrée sous son domaine personnalisé (ex. picolabo.ca) :
 * sans clé pour le domaine annoncé, toutes les clés sont donc essayées aussi.
 */
async function webhookSecrets(shop: string | null): Promise<string[]> {
  const secrets = [process.env.SHOPIFY_WEBHOOK_SECRET ?? ""];
  const { data } = await createAdminSupabaseClient().from("shop_webhook_secrets").select("shop_domain, secret");
  const rows = (data as { shop_domain: string; secret: string }[] | null) ?? [];
  const forShop = shop ? rows.filter((row) => row.shop_domain === shop.toLowerCase()) : [];
  for (const row of forShop.length > 0 ? forShop : rows) secrets.push(row.secret);
  return secrets.filter(Boolean);
}
