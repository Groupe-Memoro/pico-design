"use client";

import { useState } from "react";
import { DownloadIcon, EyeIcon, RefreshCcwIcon, SpinnerIcon, TrashIcon } from "@/components/icons";

export interface OrderRow {
  id: string;
  shopify_order_id: string;
  order_number: string | null;
  customer_email: string | null;
  financial_status: string | null;
  fulfillment_status: string | null;
  pico_status: string;
  shop_domain: string | null;
  // Date du retrait de l'outil (null = commande visible), voir 0063_orders_archived.sql.
  archived_at: string | null;
  // Date à laquelle quelqu'un l'a regardée (null = nouvelle), voir 0077_orders_viewed.sql.
  viewed_at?: string | null;
  created_at: string;
  order_items: {
    id: string;
    title: string | null;
    quantity: number;
    design_submission_id: string | null;
    // Produit Pico vendu tel quel (voir 0070_order_items_product.sql).
    product_id: string | null;
  }[];
}

/**
 * Pastilles calquées sur les badges de Shopify (Polaris) : même forme, mêmes
 * tons, mêmes mots — l'équipe passe de l'admin Shopify à cet écran sans
 * changer de langage visuel.
 *
 * Les teintes reproduisent la logique de Polaris (fond pastel, texte foncé de
 * la même famille) sans prétendre au code hexadécimal exact.
 *
 * Style inline plutôt que classes Tailwind : ces teintes n'existent pas dans
 * le thème, et une classe ajoutée à la configuration n'apparaît qu'après
 * régénération du CSS — un serveur déjà lancé garde la sienne en mémoire.
 */
type Ton = "succes" | "attention" | "info" | "critique" | "neutre";

const TONS: Record<Ton, { fond: string; texte: string }> = {
  succes: { fond: "#cdfee1", texte: "#0c5132" },
  attention: { fond: "#ffeb9a", texte: "#3d2800" },
  info: { fond: "#d6f0fd", texte: "#00527c" },
  critique: { fond: "#ffd6d6", texte: "#8e1f0b" },
  neutre: { fond: "#e3e3e3", texte: "#4a4a4a" },
};

function badgeStyle(ton: Ton) {
  return {
    backgroundColor: TONS[ton].fond,
    color: TONS[ton].texte,
    borderColor: "transparent",
  };
}

/**
 * Suivi en atelier. Les tons suivent la même progression que le traitement
 * des commandes dans Shopify : à faire en jaune, terminé en vert.
 */
const PICO_STATUSES: { value: string; label: string; ton: Ton }[] = [
  { value: "recue", label: "Non traitée", ton: "attention" },
  { value: "en_production", label: "En production", ton: "info" },
  { value: "imprimee", label: "Imprimée", ton: "info" },
  { value: "expediee", label: "Traitée", ton: "succes" },
];

function picoTon(value: string): Ton {
  return PICO_STATUSES.find((s) => s.value === value)?.ton ?? "neutre";
}

// Statut de paiement, avec les mots de l'admin Shopify.
const PAIEMENTS: Record<string, { label: string; ton: Ton }> = {
  paid: { label: "Payée", ton: "succes" },
  pending: { label: "En attente", ton: "attention" },
  authorized: { label: "Autorisée", ton: "attention" },
  partially_paid: { label: "Partiellement payée", ton: "attention" },
  refunded: { label: "Remboursée", ton: "neutre" },
  partially_refunded: { label: "Partiellement remboursée", ton: "neutre" },
  voided: { label: "Annulée", ton: "critique" },
};

function paiementBadge(status: string | null): { label: string; ton: Ton } {
  if (!status) return { label: "—", ton: "neutre" };
  return PAIEMENTS[status] ?? { label: status, ton: "neutre" };
}

/** Sélecteur de filtre : même allure pour les quatre. */
function Filtre({
  value,
  onChange,
  label,
  children,
}: {
  value: string;
  onChange: (v: string) => void;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      aria-label={label}
      className="rounded-lg border border-border bg-surface px-2 py-1 text-xs text-text-muted"
    >
      {children}
    </select>
  );
}

/**
 * Les commandes Shopify et leurs designs. Le statut « Pico » suit
 * l'avancement en atelier : il est volontairement distinct des statuts
 * Shopify, qui décrivent le paiement et l'expédition.
 */
export default function OrdersTable({
  orders,
  shopDomain,
}: {
  orders: OrderRow[];
  shopDomain: string | null;
}) {
  const [rows, setRows] = useState(orders);
  const [busy, setBusy] = useState<string | null>(null);

  // PDF des tirages d'une commande : fabriqué par le serveur (voir
  // app/api/orders/[id]/prints), puis téléchargé par son adresse signée.
  async function downloadPrints(orderId: string) {
    setBusy(`prints-${orderId}`);
    const res = await fetch(`/api/orders/${orderId}/prints`, { method: "POST" }).catch(() => null);
    const data = res ? await res.json().catch(() => ({})) : {};
    setBusy(null);
    if (!res?.ok || !data.url) {
      alert(data.error ?? (res?.status === 504 ? "La génération a pris trop de temps." : "Le PDF des tirages n'a pas pu être fabriqué."));
      return;
    }
    window.location.href = data.url;
  }
  const [boutique, setBoutique] = useState("toutes");
  const [suivi, setSuivi] = useState("tous");
  const [paiement, setPaiement] = useState("tous");
  const [periode, setPeriode] = useState("toutes");
  const [recherche, setRecherche] = useState("");
  // Commandes retirées de l'outil : masquées, consultables à part pour les y remettre.
  const [voirRetirees, setVoirRetirees] = useState(false);
  // Par défaut, les plus récentes d'abord — l'ordre utile au quotidien.
  const [tri, setTri] = useState<{
    champ: "date" | "numero";
    sens: "asc" | "desc";
  }>({
    champ: "date",
    sens: "desc",
  });

  // Les options ne listent que ce qui existe réellement dans les commandes :
  // proposer « Remboursée » alors qu'aucune ne l'est ne ferait qu'encombrer.
  const boutiqueDe = (o: OrderRow) => o.shop_domain ?? shopDomain;
  const boutiques = Array.from(
    new Set(rows.map(boutiqueDe).filter((d): d is string => Boolean(d))),
  ).sort();
  const paiements = Array.from(
    new Set(
      rows
        .map((o) => o.financial_status)
        .filter((v): v is string => Boolean(v)),
    ),
  ).sort();

  const PERIODES: { value: string; label: string; jours: number | null }[] = [
    { value: "toutes", label: "Toutes les dates", jours: null },
    { value: "7", label: "7 derniers jours", jours: 7 },
    { value: "30", label: "30 derniers jours", jours: 30 },
    { value: "90", label: "3 derniers mois", jours: 90 },
  ];

  // Les commandes de la vue courante (dans l'outil, ou retirées), avant les filtres.
  const deLaVue = rows.filter((o) => Boolean(o.archived_at) === voirRetirees);
  const nbRetirees = rows.filter((o) => o.archived_at).length;

  const visibles = deLaVue.filter((o) => {
    if (boutique !== "toutes" && boutiqueDe(o) !== boutique) return false;
    if (suivi !== "tous" && o.pico_status !== suivi) return false;
    if (paiement !== "tous" && o.financial_status !== paiement) return false;
    const jours = PERIODES.find((p) => p.value === periode)?.jours ?? null;
    if (jours !== null) {
      const limite = Date.now() - jours * 24 * 60 * 60 * 1000;
      if (new Date(o.created_at).getTime() < limite) return false;
    }
    if (recherche.trim()) {
      // Numéro, client, boutique et intitulés d'articles : ce qu'on a sous
      // les yeux dans le tableau.
      const q = recherche.trim().toLowerCase();
      const champs = [
        o.order_number,
        o.shopify_order_id,
        o.customer_email,
        boutiqueDe(o),
        ...o.order_items.map((i) => i.title),
      ];
      if (!champs.some((c) => c?.toLowerCase().includes(q))) return false;
    }
    return true;
  });

  // Le numéro se trie sur sa valeur numérique : « #99 » vient avant « #100 »,
  // ce qu'un tri alphabétique ferait l'inverse.
  const numeroDe = (o: OrderRow) =>
    parseInt((o.order_number ?? o.shopify_order_id).replace(/\D/g, ""), 10) ||
    0;

  visibles.sort((a, b) => {
    const ecart =
      tri.champ === "numero"
        ? numeroDe(a) - numeroDe(b)
        : new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
    return tri.sens === "asc" ? ecart : -ecart;
  });

  function trierPar(champ: "date" | "numero") {
    setTri((t) =>
      t.champ === champ
        ? { champ, sens: t.sens === "asc" ? "desc" : "asc" }
        : { champ, sens: "asc" },
    );
  }

  const filtresActifs =
    boutique !== "toutes" ||
    suivi !== "tous" ||
    paiement !== "tous" ||
    periode !== "toutes";

  function reinitialiser() {
    setBoutique("toutes");
    setSuivi("tous");
    setPaiement("tous");
    setPeriode("toutes");
    setRecherche("");
  }

  // La pastille du menu (voir Nav) se met à jour aussitôt.
  const notifyMenu = () => window.dispatchEvent(new Event("pico:orders-changed"));

  // Une commande regardée (ouverte dans Shopify, PDF, suivi, retrait…) n'est
  // plus « nouvelle » : pour toute l'équipe.
  async function marquerVue(order: OrderRow, vue = true) {
    if (vue === Boolean(order.viewed_at)) return;
    const now = vue ? new Date().toISOString() : null;
    setRows((all) => all.map((o) => (o.id === order.id ? { ...o, viewed_at: now } : o)));
    await fetch(`/api/orders/${order.id}/viewed`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ viewed: vue }),
    }).catch(() => null);
    notifyMenu();
  }

  async function archiver(order: OrderRow, archived: boolean) {
    const numero = order.order_number ?? order.shopify_order_id;
    if (
      archived &&
      !confirm(
        `Retirer la commande ${numero} de l'outil ?\n\nElle reste dans Shopify, et vous pourrez la remettre depuis « Commandes retirées ».`,
      )
    ) {
      return;
    }
    const before = order.archived_at;
    const now = archived ? new Date().toISOString() : null;
    setRows((all) =>
      all.map((o) => (o.id === order.id ? { ...o, archived_at: now, viewed_at: archived ? now : o.viewed_at } : o))
    );
    const res = await fetch(`/api/orders/${order.id}/archive`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ archived }),
    }).catch(() => null);
    if (!res?.ok) {
      setRows((all) => all.map((o) => (o.id === order.id ? { ...o, archived_at: before } : o)));
      const data = res ? await res.json().catch(() => ({})) : {};
      alert(data.error ?? "L'opération a échoué.");
    }
    notifyMenu();
  }

  async function changeStatus(orderId: string, picoStatus: string) {
    setRows((all) =>
      all.map((o) =>
        o.id === orderId ? { ...o, pico_status: picoStatus, viewed_at: o.viewed_at ?? new Date().toISOString() } : o,
      ),
    );
    await fetch(`/api/orders/${orderId}/status`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ picoStatus }),
    });
    notifyMenu();
  }

  if (rows.length === 0) {
    return (
      <div>
        <h1 className="font-display text-page-title text-text">Commandes</h1>
        <p className="mt-4 rounded-xl border border-border bg-surface-muted p-4 text-sm text-text-muted">
          Aucune commande reçue. Les commandes arrivent par le webhook Shopify ;
          tant qu&apos;il n&apos;est pas configuré (variable{" "}
          <code>SHOPIFY_WEBHOOK_SECRET</code>), cet écran reste vide.
        </p>
      </div>
    );
  }

  return (
    <div>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h1 className="font-display text-page-title text-text">
          {voirRetirees ? "Commandes retirées" : "Commandes"}
        </h1>
        {(voirRetirees || nbRetirees > 0) && (
          <button
            type="button"
            onClick={() => setVoirRetirees((v) => !v)}
            className="text-xs text-text-subtle underline hover:text-text"
          >
            {voirRetirees ? "← Retour aux commandes" : `Commandes retirées (${nbRetirees})`}
          </button>
        )}
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
        <input
          type="search"
          value={recherche}
          onChange={(e) => setRecherche(e.target.value)}
          placeholder="Rechercher un numéro, un client, un article…"
          aria-label="Rechercher dans les commandes"
          className="min-w-[16rem] flex-1 rounded-lg border border-border bg-surface px-3 py-1.5 text-xs"
        />

        <Filtre value={periode} onChange={setPeriode} label="Date">
          {PERIODES.map((p) => (
            <option key={p.value} value={p.value}>
              {p.label}
            </option>
          ))}
        </Filtre>

        <Filtre value={boutique} onChange={setBoutique} label="Boutique">
          <option value="toutes">Toutes les boutiques</option>
          {boutiques.map((d) => (
            <option key={d} value={d}>
              {d}
            </option>
          ))}
        </Filtre>

        <Filtre value={paiement} onChange={setPaiement} label="Paiement">
          <option value="tous">Tous les paiements</option>
          {paiements.map((v) => (
            <option key={v} value={v}>
              {paiementBadge(v).label}
            </option>
          ))}
        </Filtre>

        <Filtre value={suivi} onChange={setSuivi} label="Suivi Pico">
          <option value="tous">Tout le suivi</option>
          {PICO_STATUSES.map((st) => (
            <option key={st.value} value={st.value}>
              {st.label}
            </option>
          ))}
        </Filtre>

        <span className="text-text-subtle">
          {visibles.length} commande{visibles.length > 1 ? "s" : ""}
          {filtresActifs && ` sur ${deLaVue.length}`}
        </span>

        {filtresActifs && (
          <button
            type="button"
            onClick={reinitialiser}
            className="text-text-subtle underline hover:text-text"
          >
            Réinitialiser
          </button>
        )}
      </div>

      <div className="mt-4 overflow-x-auto rounded-xl border border-border bg-surface">
        <table className="w-full text-sm">
          <thead className="border-b border-border text-left text-xs uppercase text-text-subtle">
            <tr>
              <th className="px-4 py-3">
                <button
                  type="button"
                  onClick={() => trierPar("numero")}
                  className="uppercase hover:text-text"
                  aria-label="Trier par numéro de commande"
                >
                  Commande{" "}
                  {tri.champ === "numero"
                    ? tri.sens === "asc"
                      ? "↑"
                      : "↓"
                    : "↕"}
                </button>
              </th>
              <th className="px-4 py-3">
                <button
                  type="button"
                  onClick={() => trierPar("date")}
                  className="uppercase hover:text-text"
                  aria-label="Trier par date"
                >
                  Date{" "}
                  {tri.champ === "date"
                    ? tri.sens === "asc"
                      ? "↑"
                      : "↓"
                    : "↕"}
                </button>
              </th>
              <th className="px-4 py-3">Boutique</th>
              <th className="px-4 py-3">Client</th>
              <th className="px-4 py-3">Paiement</th>
              <th className="px-4 py-3">Suivi Pico</th>
              <th className="px-4 py-3">Designs</th>
              <th className="px-4 py-3">
                <span className="sr-only">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {visibles.map((order) => (
              <tr
                key={order.id}
                className="border-b border-border last:border-0"
              >
                <td className="px-4 py-3">
                  {order.shop_domain || shopDomain ? (
                    <a
                      href={`https://${order.shop_domain ?? shopDomain}/admin/orders/${order.shopify_order_id}`}
                      target="_blank"
                      rel="noreferrer"
                      onClick={() => marquerVue(order)}
                      className="font-medium text-primary underline"
                    >
                      {order.order_number ?? order.shopify_order_id}
                    </a>
                  ) : (
                    <span className="font-medium">
                      {order.order_number ?? order.shopify_order_id}
                    </span>
                  )}
                  {!order.viewed_at && !order.archived_at && (
                    <span className="ml-2 rounded-full bg-primary px-2 py-0.5 text-[11px] font-semibold text-text-on-brand">
                      Nouvelle
                    </span>
                  )}
                </td>
                <td className="whitespace-nowrap px-4 py-3 text-text-muted">
                  {new Date(order.created_at).toLocaleDateString("fr-CA")}
                </td>
                <td className="px-4 py-3 text-text-muted">
                  {order.shop_domain ?? shopDomain ?? "—"}
                </td>
                <td className="px-4 py-3 text-text-muted">
                  {order.customer_email ?? "—"}
                </td>
                <td className="px-4 py-3">
                  <span
                    style={badgeStyle(
                      paiementBadge(order.financial_status).ton,
                    )}
                    className="inline-block rounded-full px-2.5 py-1 text-xs font-medium"
                  >
                    {paiementBadge(order.financial_status).label}
                  </span>
                </td>
                <td className="px-4 py-3">
                  <select
                    value={order.pico_status}
                    onChange={(e) => changeStatus(order.id, e.target.value)}
                    style={badgeStyle(picoTon(order.pico_status))}
                    className="rounded-full border px-2.5 py-1 text-xs font-medium"
                  >
                    {PICO_STATUSES.map((s) => (
                      <option key={s.value} value={s.value}>
                        {s.label}
                      </option>
                    ))}
                  </select>
                </td>
                <td className="px-4 py-3">
                  <div className="flex flex-col gap-1">
                    {order.order_items.map((item) => (
                      <div key={item.id} className="flex items-center gap-2">
                        <span className="text-text-muted">
                          {item.quantity} × {item.title ?? "Article"}
                        </span>
                        {item.design_submission_id || item.product_id ? (
                          <a
                            // Design du client, sinon le PDF déjà fabriqué du produit Pico.
                            href={
                              item.design_submission_id
                                ? `/api/orders/${item.design_submission_id}/pdf`
                                : `/api/products/${item.product_id}/pdf`
                            }
                            onClick={() => {
                              setBusy(item.id);
                              void marquerVue(order);
                            }}
                            className="inline-flex items-center gap-1 rounded-lg border border-border px-2 py-1 text-xs text-text-muted hover:text-text"
                          >
                            {busy === item.id ? (
                              <SpinnerIcon className="h-3.5 w-3.5" />
                            ) : (
                              <DownloadIcon className="h-3.5 w-3.5" />
                            )}
                            PDF
                          </a>
                        ) : (
                          <span className="text-xs text-text-subtle">
                            sans design
                          </span>
                        )}
                      </div>
                    ))}
                    {/* Toutes les lignes, une page par tirage (selon les
                        quantités) : le fichier à envoyer à l'Imposition. */}
                    {order.order_items.filter((i) => i.design_submission_id || i.product_id).length > 0 &&
                      (order.order_items.length > 1 || order.order_items.some((i) => i.quantity > 1)) && (
                        <button
                          type="button"
                          onClick={() => {
                            void marquerVue(order);
                            downloadPrints(order.id);
                          }}
                          disabled={busy === `prints-${order.id}`}
                          className="inline-flex w-fit items-center gap-1 rounded-lg border border-border px-2 py-1 text-xs text-text-muted hover:text-text disabled:opacity-60"
                        >
                          {busy === `prints-${order.id}` ? <SpinnerIcon className="h-3.5 w-3.5" /> : <DownloadIcon className="h-3.5 w-3.5" />}
                          PDF des tirages ({order.order_items.reduce((n, i) => n + (i.design_submission_id || i.product_id ? i.quantity : 0), 0)})
                        </button>
                      )}
                  </div>
                </td>
                <td className="whitespace-nowrap px-4 py-3 text-right">
                  {!order.archived_at && (
                    <button
                      type="button"
                      onClick={() => marquerVue(order, !order.viewed_at)}
                      title={order.viewed_at ? "Remettre en nouvelle commande" : "Marquer comme vue"}
                      aria-label={order.viewed_at ? "Remettre en nouvelle commande" : "Marquer comme vue"}
                      className="inline-flex rounded-lg p-1.5 text-text-muted hover:bg-surface-muted hover:text-text"
                    >
                      <EyeIcon className={`h-4 w-4 ${order.viewed_at ? "opacity-40" : ""}`} />
                    </button>
                  )}
                  {order.archived_at ? (
                    <button
                      type="button"
                      onClick={() => archiver(order, false)}
                      title="Remettre la commande dans l'outil"
                      aria-label="Remettre la commande dans l'outil"
                      className="inline-flex rounded-lg p-1.5 text-text-muted hover:bg-surface-muted hover:text-text"
                    >
                      <RefreshCcwIcon className="h-4 w-4" />
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => archiver(order, true)}
                      title="Retirer la commande de l'outil"
                      aria-label="Retirer la commande de l'outil"
                      className="inline-flex rounded-lg p-1.5 text-text-muted hover:bg-danger-subtle hover:text-danger"
                    >
                      <TrashIcon className="h-4 w-4" />
                    </button>
                  )}
                </td>
              </tr>
            ))}
            {visibles.length === 0 && (
              <tr>
                <td colSpan={8} className="px-4 py-6 text-center text-sm text-text-subtle">
                  {voirRetirees ? "Aucune commande retirée." : "Aucune commande ne correspond."}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
