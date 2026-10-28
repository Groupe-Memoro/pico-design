import { createServerSupabaseClient, requireUser } from "@/lib/supabase/server";
import OrdersTable, { type OrderRow, type ProductionBatch } from "@/components/OrdersTable";
import { shopDomain } from "@/lib/shopify";

// Module Commande : les commandes Shopify reçues par webhook, rapprochées du
// design que le client a préparé dans l'Outil Shopify (voir
// supabase/migrations/0055_orders.sql).
export default async function OrdersPage() {
  await requireUser();
  const supabase = createServerSupabaseClient();

  const [{ data }, { data: batches }] = await Promise.all([
    supabase
      .from("orders")
      .select(
        "id, shopify_order_id, order_number, customer_email, financial_status, fulfillment_status, pico_status, shop_domain, archived_at, viewed_at, created_at, order_items(id, title, quantity, design_submission_id, product_id)"
      )
      .order("created_at", { ascending: false })
      .limit(200),
    // Mises en production récentes : leurs PDF imposés, rattachés aux commandes.
    supabase
      .from("production_batches")
      .select("id, order_ids, files, created_at")
      .order("created_at", { ascending: false })
      .limit(200),
  ]);

  return (
    <OrdersTable
      orders={(data as OrderRow[]) ?? []}
      shopDomain={shopDomain()}
      batches={(batches as ProductionBatch[]) ?? []}
    />
  );
}
