"use client";

import { useEffect, useState } from "react";
import Modal from "@/components/Modal";
import MockupGallery, { type MockupView } from "@/components/MockupGallery";
import type { TemplateMockup } from "@/lib/types";

/**
 * Aperçu mockup d'un produit. Un modèle peut avoir plusieurs mockups (le
 * même produit sous plusieurs angles, voir
 * supabase/migrations/0049_template_mockups.sql) : ils sont alors tous
 * générés et navigables (voir MockupGallery). Avec un seul — ou avec un
 * modèle encore sur son bundle hérité — l'affichage est celui d'avant.
 */
export default function ProductMockupModal({
  productId,
  productName,
  templateId,
  onClose,
}: {
  productId: string;
  productName: string;
  // Absent = on demande simplement le mockup par défaut du modèle.
  templateId?: string | null;
  onClose: () => void;
}) {
  const [views, setViews] = useState<MockupView[]>([{ key: "default", label: productName, loading: true, url: null }]);
  const [activeKey, setActiveKey] = useState("default");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const objectUrls: string[] = [];

    function update(key: string, patch: Partial<MockupView>) {
      setViews((prev) => prev.map((v) => (v.key === key ? { ...v, ...patch } : v)));
    }

    async function loadOne(key: string, mockupId: string | null) {
      const query = mockupId ? `?mockupId=${encodeURIComponent(mockupId)}` : "";
      const res = await fetch(`/api/products/${productId}/mockup${query}`);
      if (cancelled) return;
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        // Une erreur sur un mockup ne doit pas masquer les autres : on ne
        // remonte le message que s'il n'y a rien d'autre à montrer.
        setError((prev) => prev ?? data.error ?? "Erreur lors de la génération du mockup.");
        update(key, { loading: false, url: null });
        return;
      }
      const blob = await res.blob();
      if (cancelled) return;
      const url = URL.createObjectURL(blob);
      objectUrls.push(url);
      update(key, { loading: false, url });
    }

    async function load() {
      let mockups: TemplateMockup[] = [];
      if (templateId) {
        const res = await fetch(`/api/template-mockups?templateId=${encodeURIComponent(templateId)}`);
        if (res.ok) mockups = (await res.json()).mockups ?? [];
      }
      if (cancelled) return;

      if (mockups.length > 0) {
        setViews(mockups.map((m) => ({ key: m.id, label: m.name, loading: true, url: null })));
        setActiveKey(mockups[0].id);
        await Promise.all(mockups.map((m) => loadOne(m.id, m.id)));
      } else {
        await loadOne("default", null);
      }
    }
    load();

    return () => {
      cancelled = true;
      for (const url of objectUrls) URL.revokeObjectURL(url);
    };
  }, [productId, templateId, productName]);

  const nothingToShow = views.every((v) => !v.loading && !v.url);

  return (
    <Modal title={`Mockup — ${productName}`} onClose={onClose}>
      {nothingToShow && error ? (
        <p className="text-sm text-danger">{error}</p>
      ) : (
        <MockupGallery views={views} activeKey={activeKey} onActiveKeyChange={setActiveKey} />
      )}
    </Modal>
  );
}
