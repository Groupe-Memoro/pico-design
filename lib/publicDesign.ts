import { createHmac, timingSafeEqual } from "crypto";

/**
 * Accès public à l'Outil Shopify : un lien
 * `/design?template=<id>&cle=<secret>` ouvre l'éditeur sans connexion, pour
 * un client venant de Shopify.
 *
 * Le secret vit dans DESIGN_LINK_KEY. Le nom évite volontairement tout
 * préfixe « PUBLIC » : Next n'expose au navigateur que NEXT_PUBLIC_, mais
 * d'autres outils de la chaîne (Vercel, Vite, Astro) traitent `PUBLIC_`
 * comme une valeur publiable — un nom qui invite à la confusion sur un
 * secret n'a rien à faire ici. Variable absente = mode public désactivé,
 * donc fermé par défaut.
 *
 * Le secret ne quitte pas le serveur. Une fois la clé validée, la page
 * fabrique un LAISSEZ-PASSER à sa place, transmis au navigateur et renvoyé
 * à chaque appel d'API. Il ne vaut que pour un modèle et qu'un temps.
 */

const GRANT_TTL_MS = 12 * 60 * 60 * 1000;

function secret(): string | null {
  const key = process.env.DESIGN_LINK_KEY;
  return key && key.length >= 16 ? key : null;
}

function sign(payload: string, key: string): string {
  return createHmac("sha256", key).update(payload).digest("base64url");
}

/**
 * Compare deux chaînes sans fuite de temps. Les longueurs différentes sont
 * écartées d'abord : timingSafeEqual lève sur des tampons de tailles
 * différentes.
 */
function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  return bufA.length === bufB.length && timingSafeEqual(bufA, bufB);
}

/**
 * La clé du lien est-elle la bonne ? Comparée en temps constant : une
 * comparaison naïve laisserait deviner le secret caractère par caractère.
 */
export function isValidPublicKey(value: unknown): boolean {
  const key = secret();
  if (!key || typeof value !== "string" || value.length === 0) return false;
  return safeEqual(value, key);
}

/** Laissez-passer pour UN modèle : « <templateId>.<expiration>.<signature> ». */
export function createGrant(templateId: string): string | null {
  const key = secret();
  if (!key) return null;
  const expiresAt = Date.now() + GRANT_TTL_MS;
  const payload = `${templateId}.${expiresAt}`;
  return `${payload}.${sign(payload, key)}`;
}

/**
 * Vérifie un laissez-passer et retourne le modèle qu'il autorise, ou null.
 * L'appelant DOIT comparer ce modèle à celui de la requête : c'est ce qui
 * empêche un laissez-passer obtenu pour un modèle d'en rendre un autre.
 */
export function verifyGrant(token: unknown): string | null {
  const key = secret();
  if (!key || typeof token !== "string") return null;

  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [templateId, expiresAtRaw, signature] = parts;

  const expiresAt = Number(expiresAtRaw);
  if (!Number.isFinite(expiresAt) || expiresAt < Date.now()) return null;
  if (!safeEqual(signature, sign(`${templateId}.${expiresAtRaw}`, key))) return null;

  return templateId;
}

/**
 * Autorisation d'une route d'API appelée par l'outil : soit une session,
 * soit un laissez-passer valable POUR CE MODÈLE.
 */
export function grantAllows(token: unknown, templateId: string): boolean {
  const granted = verifyGrant(token);
  return granted !== null && granted === templateId;
}
