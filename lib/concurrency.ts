/**
 * Comme `Promise.all(items.map(fn))`, mais avec au plus `limit` appels en vol.
 * Les résultats gardent l'ordre des éléments. À la première erreur, plus aucun
 * nouvel élément n'est lancé, les appels déjà en cours sont attendus (pour
 * ne pas laisser de rendu tourner après la réponse), puis la première erreur
 * est relancée — comme une boucle séquentielle qui s'arrête à l'échec.
 */
export async function mapLimit<T, R>(items: readonly T[], limit: number, fn: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  let failed = false;
  const worker = async () => {
    while (!failed && next < items.length) {
      const i = next++;
      try {
        results[i] = await fn(items[i], i);
      } catch (err) {
        failed = true;
        throw err;
      }
    }
  };
  const settled = await Promise.allSettled(Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, worker));
  const rejected = settled.find((s): s is PromiseRejectedResult => s.status === "rejected");
  if (rejected) throw rejected.reason;
  return results;
}
