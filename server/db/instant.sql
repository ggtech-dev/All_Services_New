-- ⚡ Instant Delivery: "anything within 15 minutes". Re-runnable. Runs after delivery.sql.
-- One service shows the products of other shops live (Kirana + Vegetables — services.source_service_ids) plus an
-- "Others" tab where the customer writes anything they need. Orders placed through it are marked with
-- orders.via_service_id, skip the daily time windows (vegetables 6–10 AM) and go only to the service's own agent
-- type ('instant'), never to regular agents. The order logic itself is in fn_place_order (orders.sql).

ALTER TABLE services ADD COLUMN IF NOT EXISTS source_service_ids INT[];
ALTER TABLE orders   ADD COLUMN IF NOT EXISTS via_service_id INT;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'orders_via_service_fk') THEN
    ALTER TABLE orders ADD CONSTRAINT orders_via_service_fk FOREIGN KEY (via_service_id) REFERENCES services(id) ON DELETE SET NULL;
  END IF;
END $$;

-- Is this an "instant" style service (shows other shops' products)?
CREATE OR REPLACE FUNCTION fn_is_multi_shop(p_service_id INT) RETURNS BOOLEAN
LANGUAGE sql STABLE SET search_path FROM CURRENT AS $$
  SELECT EXISTS (SELECT 1 FROM services WHERE id = p_service_id AND coalesce(cardinality(source_service_ids), 0) > 0)
$$;

-- Checkout quote for an instant order: the instant service's own delivery charge, no time window.
CREATE OR REPLACE FUNCTION fn_instant_quote(p_customer_id INT, p_via_service_id INT) RETURNS JSONB
LANGUAGE sql STABLE SET search_path FROM CURRENT AS $$
  SELECT jsonb_build_object(
    'base_fee', s.delivery_fee,
    'delivery_fee', fn_delivery_fee_for(p_customer_id, s.delivery_fee),
    'free_left', greatest(0, fn_setting_num('free_delivery_orders', 3)
                   - (SELECT count(*) FROM orders WHERE customer_id = p_customer_id AND status <> 'cancelled'))::int,
    'on_bill', true,
    'instant', true,
    'eta_minutes', s.eta_minutes,
    'window', NULL, 'window_conflict', false, 'slots', NULL)
    FROM services s WHERE s.id = p_via_service_id AND s.is_active AND coalesce(cardinality(s.source_service_ids), 0) > 0
$$;
