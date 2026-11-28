# T-30 Vendors and purchase orders, receiving

Tier: sonnet. Review: N. Branch: feat/T-30-purchase-orders. Depends: T-02.

## Contracts
- `vendors(id, org_id, name, email, phone, external_source NULL, external_id NULL)`, unique (org_id, external_source, external_id).
- `purchase_orders(id, org_id, number, vendor_id, status draft|sent|partly_received|received|closed|cancelled, expected_at, created_at)`; `purchase_order_lines(id, org_id, po_id, product_id, variant_id NULL, qty_ordered, qty_received, unit_cost_cents, external_source, external_id)`.
- `product_variants.unit_cost_cents NULL` (or products when no variants).
Migration `044_purchase_orders.sql`. Table's inventory model (`InventoryItem.quantityOnHand`, `StockMovement` kinds) is the sync target; keep names mappable.

## Files
- Routes `backend/src/api/routes/purchaseOrders.ts` under `inventory`; receiving `POST /:id/receive { lines: [{lineId, qty, unitCostCents?}] }` updates stock through the existing stock update path (grep `low_stock` / stock in the adapters) and sets unit cost; status moves automatically.
- Events: `purchase_order.sent`, `purchase_order.received`.

## Tests
Partial receive moves status and stock; over-receive refused; cancelled cannot receive.
