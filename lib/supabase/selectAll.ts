// L'API de Supabase (PostgREST) renvoie au plus 1000 lignes par requête, sans
// erreur : le reste est simplement omis. Pour une liste complète, on lit
// donc par tranches jusqu'à la dernière.
const PAGE = 1000;

type PageResult<T> = PromiseLike<{ data: T[] | null; error: { message: string } | null }>;

/**
 * Toutes les lignes d'une requête, tranche par tranche. `page(from, to)`
 * construit la requête avec `.range(from, to)` ; son tri doit être stable
 * (finir par une colonne unique, ex. `id`) pour ne rien sauter entre deux
 * tranches.
 */
export async function selectAll<T>(page: (from: number, to: number) => PageResult<T>): Promise<T[]> {
  const rows: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await page(from, from + PAGE - 1);
    if (error) throw new Error(error.message);
    rows.push(...(data ?? []));
    if (!data || data.length < PAGE) return rows;
  }
}
