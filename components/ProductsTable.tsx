"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import ProductTableRow from "@/components/ProductTableRow";
import ProductForm from "@/components/ProductForm";
import ProductMockupModal from "@/components/ProductMockupModal";
import ShopifyExportModal from "@/components/ShopifyExportModal";
import Pagination from "@/components/Pagination";
import CollectionsManager from "@/components/CollectionsManager";
import Modal from "@/components/Modal";
import BulkActionsBar from "@/components/BulkActionsBar";
import UpdatingBadge from "@/components/UpdatingBadge";
import { useSelection } from "@/components/useSelection";
import type { Category, Product, ProductCollection, Template } from "@/lib/types";
import type { VisualWithUrl } from "@/components/VisualsGrid";

export type ProductWithTemplate = Product & {
  imageUrl: string | null;
  backImageUrl: string | null;
  template: {
    name: string;
    category_id: string;
    width_mm: number;
    height_mm: number;
    mask_path: string | null;
    shading_path: string | null;
    beauty_shot_xml_path: string | null;
  } | null;
};

function SortIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" className="h-3.5 w-3.5">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 9l4-5 4 5M8 15l4 5 4-5" />
    </svg>
  );
}

const PAGE_SIZE = 100;

type ModalState =
  | { mode: "create" }
  | { mode: "edit"; product: ProductWithTemplate }
  | { mode: "collections" }
  | { mode: "mockup"; product: ProductWithTemplate }
  | { mode: "shopify"; productIds: string[] }
  | null;

export default function ProductsTable({
  products,
  templates,
  categories,
  visuals,
  collections,
  templateIdsWithMockups,
}: {
  products: ProductWithTemplate[];
  templates: Template[];
  categories: Category[];
  visuals: VisualWithUrl[];
  collections: ProductCollection[];
  // Modèles ayant au moins un mockup dans template_mockups — s'ajoute au
  // bundle hérité pour décider si le bouton « Mockup » s'affiche.
  templateIdsWithMockups: string[];
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [search, setSearch] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [collectionId, setCollectionId] = useState("");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [modal, setModal] = useState<ModalState>(null);
  const [formBusy, setFormBusy] = useState(false);
  // Création de plusieurs produits : « Création des produits 3/40 » dans le voile.
  const [formProgress, setFormProgress] = useState<{ done: number; total: number } | null>(null);
  const selection = useSelection();
  const [bulkDeleting, setBulkDeleting] = useState(false);

  function refresh() {
    startTransition(() => router.refresh());
  }

  const categoryName = useMemo(() => {
    const map = new Map(categories.map((c) => [c.id, c.name]));
    return (id: string | undefined) => (id ? map.get(id) ?? "—" : "—");
  }, [categories]);

  const collectionName = useMemo(() => {
    const map = new Map(collections.map((c) => [c.id, c.name]));
    return (id: string | null) => (id ? map.get(id) ?? null : null);
  }, [collections]);

  const mockupTemplateIds = useMemo(() => new Set(templateIdsWithMockups), [templateIdsWithMockups]);

  const filtered = useMemo(() => {
    return products
      .filter((p) => (categoryId ? p.template?.category_id === categoryId : true))
      .filter((p) => (collectionId ? p.collection_id === collectionId : true))
      .filter((p) => p.name.toLowerCase().includes(search.trim().toLowerCase()))
      .sort((a, b) => (sortDir === "asc" ? a.name.localeCompare(b.name) : b.name.localeCompare(a.name)));
  }, [products, search, categoryId, collectionId, sortDir]);

  // Pagination : 100 par page ; un filtre ou un tri ramène à la première.
  const [page, setPage] = useState(1);
  useEffect(() => setPage(1), [search, categoryId, collectionId, sortDir]);
  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const currentPage = Math.min(page, pageCount);
  const pageItems = filtered.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);

  function changePage(next: number) {
    setPage(next);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function handleSuccess() {
    setModal(null);
    refresh();
  }

  async function handleBulkDelete() {
    const ids = [...selection.selected];
    if (ids.length === 0) return;
    if (!confirm(`Supprimer ${ids.length} produit(s) ?`)) return;
    setBulkDeleting(true);
    const results = await Promise.all(
      ids.map((id) => fetch(`/api/products/${id}`, { method: "DELETE" }))
    );
    const failed = results.filter((r) => !r.ok).length;
    // Regroupés dans la même transition que le refresh : la barre reste
    // visible (avec son spinner) jusqu'à ce que les données rafraîchies
    // soient prêtes, au lieu de disparaître aussitôt en laissant les lignes
    // encore affichées un instant, sans indicateur.
    startTransition(() => {
      router.refresh();
      selection.clear();
      setBulkDeleting(false);
    });
    if (failed > 0) alert(`${failed} suppression(s) ont échoué.`);
  }

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="flex items-center gap-2 text-page-title font-semibold text-text">
            Produits
            <UpdatingBadge show={isPending} />
          </h1>
          <p className="text-sm text-neutral-500">
            {products.length} produit{products.length > 1 ? "s" : ""} au catalogue.
          </p>
        </div>
        <button
          onClick={() => setModal({ mode: "create" })}
          className="flex items-center gap-2 btn-primary"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" className="h-4 w-4">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 5v14m-7-7h14" />
          </svg>
          Nouveau produit
        </button>
      </div>

      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="relative flex-1 sm:max-w-xs">
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-neutral-400"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M21 21l-4.35-4.35M19 11a8 8 0 1 1-16 0 8 8 0 0 1 16 0Z"
            />
          </svg>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Rechercher (nom)..."
            className="w-full rounded-lg border border-neutral-300 bg-surface py-2 pl-9 pr-3 text-sm"
          />
        </div>
        <div className="flex items-end gap-3">
          <div>
            <label className="label">Catégorie</label>
            <select
              value={categoryId}
              onChange={(e) => setCategoryId(e.target.value)}
              className="mt-1 input"
            >
              <option value="">— Toutes —</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="label">Collection</label>
            <select
              value={collectionId}
              onChange={(e) => setCollectionId(e.target.value)}
              className="mt-1 input"
            >
              <option value="">— Toutes —</option>
              {collections.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>
          <button
            type="button"
            onClick={() => setModal({ mode: "collections" })}
            className="rounded-lg border border-neutral-300 px-3 py-2 text-sm text-neutral-600 hover:bg-neutral-50"
          >
            Gérer les collections
          </button>
        </div>
      </div>

      <BulkActionsBar
        count={selection.selected.size}
        label="produit"
        deleting={bulkDeleting}
        onDelete={handleBulkDelete}
        onClear={selection.clear}
      >
        <button
          type="button"
          onClick={() => setModal({ mode: "shopify", productIds: [...selection.selected] })}
          className="rounded-lg border border-pico-maroon bg-surface px-3 py-1.5 text-pico-maroon hover:bg-primary-subtle"
        >
          Exporter pour Shopify
        </button>
      </BulkActionsBar>

      <Pagination page={currentPage} pageSize={PAGE_SIZE} total={filtered.length} onChange={changePage} className="mb-3" />

      {filtered.length === 0 ? (
        <p className="card p-4 text-sm text-neutral-500">
          Aucun produit ne correspond.
        </p>
      ) : (
        <div className="overflow-x-auto card shadow-sm">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-sm font-semibold text-neutral-700">
                <th className="w-10 p-4">
                  <input
                    type="checkbox"
                    checked={pageItems.length > 0 && pageItems.every((p) => selection.selected.has(p.id))}
                    onChange={() => selection.toggleAll(pageItems.map((p) => p.id))}
                  />
                </th>
                <th className="p-4">Image</th>
                <th className="p-4">
                  <button
                    type="button"
                    onClick={() => setSortDir((d) => (d === "asc" ? "desc" : "asc"))}
                    className="flex items-center gap-1 hover:text-text"
                  >
                    Nom <SortIcon />
                  </button>
                </th>
                <th className="p-4">Modèle</th>
                <th className="p-4">Dimensions</th>
                <th className="p-4">Catégorie</th>
                <th className="p-4">Collection</th>
                <th className="p-4"></th>
              </tr>
            </thead>
            <tbody>
              {pageItems.map((p) => (
                <ProductTableRow
                  key={p.id}
                  product={p}
                  templateName={p.template?.name ?? "Modèle supprimé"}
                  dimensions={p.template}
                  categoryLabel={categoryName(p.template?.category_id)}
                  collectionLabel={collectionName(p.collection_id)}
                  imageUrl={p.imageUrl}
                  hasMockup={Boolean(
                    mockupTemplateIds.has(p.template_id) ||
                      p.template?.beauty_shot_xml_path ||
                      (p.template?.mask_path && p.template?.shading_path)
                  )}
                  selected={selection.selected.has(p.id)}
                  onToggleSelect={() => selection.toggle(p.id)}
                  onEdit={(prod) => setModal({ mode: "edit", product: prod as ProductWithTemplate })}
                  onViewMockup={() => setModal({ mode: "mockup", product: p })}
                  onRefresh={refresh}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}
      <Pagination page={currentPage} pageSize={PAGE_SIZE} total={filtered.length} onChange={changePage} />

      {modal?.mode === "collections" && (
        <Modal title="Gérer les collections" onClose={() => setModal(null)}>
          <CollectionsManager
            items={collections}
            apiBasePath="/api/product-collections"
            deleteWarning="Son contenu ne sera pas supprimé."
            onChanged={() => refresh()}
          />
        </Modal>
      )}

      {(modal?.mode === "create" || modal?.mode === "edit") && (
        <Modal
          title={modal.mode === "create" ? "Nouveau produit" : `Modifier « ${modal.product.name} »`}
          onClose={() => setModal(null)}
          wide
          busy={formBusy}
          busyDetail={formProgress ? `Création des produits ${formProgress.done}/${formProgress.total}` : null}
        >
          <ProductForm
            templates={templates}
            categories={categories}
            visuals={visuals}
            collections={collections}
            product={modal.mode === "edit" ? modal.product : undefined}
            currentImageUrl={modal.mode === "edit" ? modal.product.imageUrl : null}
            currentBackImageUrl={modal.mode === "edit" ? modal.product.backImageUrl : null}
            onSuccess={handleSuccess}
            onBusyChange={setFormBusy}
            onProgressChange={setFormProgress}
            initialCategoryId={categoryId}
          />
        </Modal>
      )}

      {modal?.mode === "shopify" && (
        <ShopifyExportModal productIds={modal.productIds} onClose={() => setModal(null)} />
      )}

      {modal?.mode === "mockup" && (
        <ProductMockupModal
          productId={modal.product.id}
          productName={modal.product.name}
          templateId={modal.product.template_id}
          onClose={() => setModal(null)}
        />
      )}
    </div>
  );
}
