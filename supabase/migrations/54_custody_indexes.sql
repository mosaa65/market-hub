-- ═══════════════════
-- Indizes für custody_ledger (Audit-Bericht Punkt 3)
--
-- Die bestehenden Indizes decken zwei Abfrageformulare ab:
--   (customer_id, item_id)           → Bilanz ohne Lagerort
--   (warehouse_id, created_at DESC)  → Bewegungen nach Lagerort
--
-- Was fehlte:
--   1. (customer_id, warehouse_id, item_id)
--      → Alle Offen-Bildschirme filtern nach Kunde + Lagerort
--        (balances, Kundenkonto, Schnellformulare) — ohne Index
--        war ein vollständiger Tabellenscan die Folge.
--   2. (created_at)
--      → Leistungsbericht: created_at >= cutoff + entry_type =
--        'MILLING' + Kunde — keiner der vorhandenen Indizes
--        konnte diese Abfrage alleine tragen.
--   3. doc_number (btree, absteigend)
--      → Suche nach Belegnummer im Dokumentenregister; varchar(50)
--        ohne Unique-Beschränkung könnte Duplikate zulassen
--        (wird hier bewusst NICHT erzwungen, da alte Belege
--        manuell Duplikate enthalten könnten — Suche zuerst).
-- ═══════════════════════════════════

CREATE INDEX IF NOT EXISTS idx_custody_customer_wh_item
  ON public.custody_ledger USING btree (customer_id, warehouse_id, item_id);

CREATE INDEX IF NOT EXISTS idx_custody_created_entry
  ON public.custody_ledger USING btree (created_at DESC, entry_type);

CREATE INDEX IF NOT EXISTS idx_custody_doc_number
  ON public.custody_ledger USING btree (doc_number);
