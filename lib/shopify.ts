import { createHmac, timingSafeEqual } from "crypto";

/**
 * Pont avec Shopify (module Commande). Trois variables, toutes facultatives :
 * sans elles, pico-design fonctionne exactement comme avant, et le module
 * n'affiche que ce qui a déjà été reçu.
 *
 * - SHOPIFY_WEBHOOK_SECRET : signe les webhooks de commande d'une boutique ;
 *   les autres ont leur secret dans Paramètres (table shop_webhook_secrets) ;
 * - SHOPIFY_SHOP_DOMAIN + SHOPIFY_ADMIN_TOKEN : lecture de l'API Admin.
 */

export function shopDomain(): string | null {
  return process.env.SHOPIFY_SHOP_DOMAIN || null;
}

/**
 * Vérifie la signature d'un webhook Shopify : HMAC-SHA256 du CORPS BRUT,
 * encodé en base64, comparé en temps constant.
 *
 * Le corps brut est indispensable — un JSON.parse suivi d'un re-stringify
 * change les espaces et l'ordre des clés, et la signature ne correspondrait
 * plus. Sans cette vérification, n'importe qui pourrait fabriquer des
 * commandes en appelant l'URL du webhook.
 */
export function verifyWebhookSignature(rawBody: string, signature: string | null, secrets: string[]): boolean {
  if (!signature) return false;
  // Chaque boutique signe avec SA clé : la charge est valable si l'une des
  // clés candidates (celle de la boutique annoncée, la variable
  // d'environnement) en donne la signature.
  const a = Buffer.from(signature);
  return secrets.some((secret) => {
    if (!secret) return false;
    const b = Buffer.from(createHmac("sha256", secret).update(rawBody, "utf8").digest("base64"));
    return a.length === b.length && timingSafeEqual(a, b);
  });
}

// Une ligne de commande Shopify, réduite à ce dont le module a besoin.
export interface ShopifyLineItem {
  title?: string;
  quantity?: number;
  properties?: { name: string; value: string }[];
}

export interface ShopifyOrder {
  id: number | string;
  order_status_url?: string;
  name?: string;
  order_number?: number;
  email?: string;
  contact_email?: string;
  financial_status?: string;
  fulfillment_status?: string | null;
  line_items?: ShopifyLineItem[];
}

/**
 * Identifiant du design porté par une ligne de commande. Le thème Shopify le
 * pose en propriété de ligne `_design` au moment de l'ajout au panier — le
 * préfixe « _ » est la convention Shopify pour une propriété masquée au
 * client.
 */
export function designIdOfLineItem(item: ShopifyLineItem): string | null {
  const property = (item.properties ?? []).find((p) => p.name === "_design" || p.name === "design");
  const value = property?.value?.trim();
  // On n'accepte qu'un UUID : la valeur vient du panier, donc du client.
  return value && /^[0-9a-f-]{36}$/i.test(value) ? value : null;
}

/**
 * Produit Pico déjà fait porté par une ligne de commande, vendu tel quel
 * (sans passer par l'outil). Le thème Shopify pose l'id du produit, lu dans
 * le métachamp « Produit Pico », en propriété de ligne `_pico_product` à
 * l'ajout au panier — voir la page Aide.
 */
export function productIdOfLineItem(item: ShopifyLineItem): string | null {
  const property = (item.properties ?? []).find((p) => p.name === "_pico_product");
  const value = property?.value?.trim();
  // Même filtre que le design : la valeur vient du panier, donc du client.
  return value && /^[0-9a-f-]{36}$/i.test(value) ? value : null;
}

/**
 * Domaine de la boutique déduit de la charge utile, quand l'en-tête
 * X-Shopify-Shop-Domain manque : l'adresse de suivi de la commande le porte.
 */
export function shopDomainOfOrder(order: ShopifyOrder): string | null {
  if (!order.order_status_url) return null;
  try {
    return new URL(order.order_status_url).hostname.toLowerCase();
  } catch {
    return null;
  }
}

/**
 * L'adresse de retour après personnalisation est-elle acceptable ?
 *
 * Deux exigences. Elle doit être ABSOLUE : une adresse relative se résoudrait
 * sur le domaine de pico-design, et le client atterrirait ici au lieu de sa
 * boutique. Et son domaine doit être une boutique Shopify (ou celui
 * configuré en SHOPIFY_SHOP_DOMAIN) : sans ce filtre, n'importe qui pourrait se servir de
 * cette page comme d'une redirection ouverte vers le site de son choix.
 */
export function isAllowedReturnUrl(value: unknown): boolean {
  if (typeof value !== "string" || !value) return false;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false; // relative, ou illisible
  }
  if (url.protocol !== "https:") return false;
  const host = url.hostname.toLowerCase();
  const configured = shopDomain()?.toLowerCase();
  return host.endsWith(".myshopify.com") || (configured ? host === configured : false);
}
