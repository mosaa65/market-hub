REVOKE EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.is_staff(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_staff(uuid) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.create_sale(uuid, uuid, text, numeric, numeric, text, jsonb) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.create_purchase(uuid, uuid, text, numeric, numeric, text, jsonb) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.create_sales_return(uuid, uuid, uuid, text, text, jsonb) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.create_purchase_return(uuid, uuid, uuid, text, text, jsonb) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.create_stock_transfer(uuid, uuid, text, jsonb) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.adjust_loyalty(uuid, numeric, text, text) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.create_sale(uuid, uuid, text, numeric, numeric, text, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_purchase(uuid, uuid, text, numeric, numeric, text, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_sales_return(uuid, uuid, uuid, text, text, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_purchase_return(uuid, uuid, uuid, text, text, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_stock_transfer(uuid, uuid, text, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.adjust_loyalty(uuid, numeric, text, text) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.next_invoice_number() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.next_purchase_number() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.next_sales_return_number() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.next_purchase_return_number() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.next_transfer_number() FROM PUBLIC, anon, authenticated;