-- تنفيذ يدوي فقط — أرشفة الحسابات التاريخية وتوحيد مراجعها.
--
-- الشرط: طبّق ترحيلات البنية 63–67 أولًا، وخذ نسخة احتياطية قابلة للاستعادة.
-- ينقل القيود والمراجع فقط بعد حفظها في جداول الأرشيف. لا يحذف دفعات أو قيودًا.
-- نفّذه في جلسة مالك قاعدة البيانات / SQL editor، ولا تشغّله على الإنتاج قبل
-- مراجعة أعداد الحسابات والطرق التي سيؤثر عليها.

BEGIN;

-- Preserve retired configuration before removing it from the active settings
-- table. This is a single-installation catalogue, so method ID is the key.
INSERT INTO public.payment_method_settings_archive (
  payment_method_id, settings_snapshot
)
SELECT payment_method_id, to_jsonb(s)
  FROM public.payment_method_settings s
 WHERE payment_method_id NOT IN ('cash','credit','bank_transfer','mobile_money')
ON CONFLICT (payment_method_id) DO UPDATE
  SET settings_snapshot = EXCLUDED.settings_snapshot,
      archived_at = now(), archived_by = auth.uid();

DELETE FROM public.payment_method_settings
 WHERE payment_method_id NOT IN ('cash','credit','bank_transfer','mobile_money');

INSERT INTO public.payment_method_settings (
  payment_method_id, enabled, sort_order, enabled_contexts
)
SELECT id, true, sort_order, allowed_contexts
  FROM public.payment_methods
 WHERE id IN ('cash','credit','bank_transfer','mobile_money')
ON CONFLICT (payment_method_id) DO NOTHING;

-- Keep the legacy catalogue rows to label existing documents, but prevent them
-- from appearing in new pickers or being written by RPCs.
UPDATE public.payment_methods
   SET is_active = (id IN ('cash','credit','bank_transfer','mobile_money','split')),
       default_account_code = CASE id
         WHEN 'cash' THEN '1101'
         WHEN 'credit' THEN '1211'
         WHEN 'bank_transfer' THEN '1111'
         WHEN 'mobile_money' THEN '1131'
         WHEN 'kuraimi_bank' THEN '1111'
         WHEN 'yemen_kuwait_bank' THEN '1111'
         WHEN 'jawali' THEN '1131'
         WHEN 'jaib' THEN '1131'
         WHEN 'floosak' THEN '1131'
         WHEN 'one_cash' THEN '1131'
         WHEN 'card' THEN '1111'
         WHEN 'cheque' THEN '1111'
         ELSE default_account_code
       END,
       updated_at = now()
 WHERE id IN (
   'cash','credit','bank_transfer','mobile_money','split',
   'kuraimi_bank','yemen_kuwait_bank','jawali','jaib','floosak','one_cash','card','cheque'
 );

DO $operation$
DECLARE
  v_fk record;
  v_missing text;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.accounts
     WHERE code = '1111' AND is_active AND is_postable
  ) THEN
    RAISE EXCEPTION 'Required active, postable bank account 1111 is missing';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.accounts
     WHERE code = '1131' AND is_active AND is_postable
  ) THEN
    RAISE EXCEPTION 'Required active, postable wallet account 1131 is missing';
  END IF;

  INSERT INTO public.payment_account_archive (
    archived_account_id, account_code, target_account_id,
    target_account_code, account_snapshot
  )
  SELECT old.id, old.code, target.id, target.code, to_jsonb(old)
    FROM public.accounts old
    JOIN public.accounts target ON target.code = CASE
      WHEN old.code IN ('1112','1121') THEN '1111'
      WHEN old.code IN ('1132','1133','1134','1139') THEN '1131'
    END
   WHERE old.code IN ('1112','1121','1132','1133','1134','1139')
  ON CONFLICT (archived_account_id) DO NOTHING;

  SELECT string_agg(code, ', ' ORDER BY code) INTO v_missing
    FROM public.accounts a
   WHERE a.code IN ('1112','1121','1132','1133','1134','1139')
     AND NOT EXISTS (
       SELECT 1 FROM public.payment_account_archive ar
        WHERE ar.archived_account_id = a.id
     );
  IF v_missing IS NOT NULL THEN
    RAISE EXCEPTION 'Could not archive payment accounts: %', v_missing;
  END IF;

  INSERT INTO public.payment_account_journal_archive (
    journal_line_id, entry_id, archived_account_id, target_account_id,
    debit, credit, memo, partner_type, partner_id, line_created_at
  )
  SELECT jl.id, jl.entry_id, jl.account_id, ar.target_account_id,
         jl.debit, jl.credit, jl.memo, jl.partner_type, jl.partner_id, jl.created_at
    FROM public.journal_lines jl
    JOIN public.payment_account_archive ar ON ar.archived_account_id = jl.account_id
  ON CONFLICT (journal_line_id) DO NOTHING;

  -- Repoint every single-column FK to accounts, including journals, treasury,
  -- expense mappings, payment settings and chart hierarchy references.
  FOR v_fk IN
    SELECT DISTINCT c.conrelid::regclass AS relation_name, a.attname AS column_name
      FROM pg_constraint c
      CROSS JOIN LATERAL unnest(c.conkey) WITH ORDINALITY AS k(attnum, ord)
      JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = k.attnum
     WHERE c.contype = 'f'
       AND c.confrelid = 'public.accounts'::regclass
       AND c.confkey = ARRAY[(SELECT attnum FROM pg_attribute
                               WHERE attrelid='public.accounts'::regclass AND attname='id')]
  LOOP
    EXECUTE format($sql$
      INSERT INTO public.payment_account_reference_archive (
        relation_name, column_name, row_snapshot, archived_account_id, target_account_id
      )
      SELECT $1, $2, to_jsonb(ref), ref.%I, ar.target_account_id
        FROM %s AS ref
        JOIN public.payment_account_archive ar ON ar.archived_account_id = ref.%I
    $sql$, v_fk.column_name, v_fk.relation_name, v_fk.column_name)
    USING v_fk.relation_name::text, v_fk.column_name;

    EXECUTE format($sql$
      UPDATE %s AS ref
         SET %I = ar.target_account_id
        FROM public.payment_account_archive ar
       WHERE ref.%I = ar.archived_account_id
    $sql$, v_fk.relation_name, v_fk.column_name, v_fk.column_name);
  END LOOP;

  -- Historical account references have been archived and repointed. The four
  -- canonical methods now settle to the consolidated chart accounts.
  UPDATE public.accounts SET name_ar = 'البنوك' WHERE code = '1111';
  UPDATE public.accounts SET name_ar = 'المحافظ الإلكترونية' WHERE code = '1131';
  DELETE FROM public.accounts
   WHERE code IN ('1112','1121','1132','1133','1134','1139');
END
$operation$;

COMMIT;

-- Rollback guidance:
-- Restore old account rows from payment_account_archive.account_snapshot, then
-- use payment_account_journal_archive to restore each original journal_lines
-- account_id. Do not drop the archive tables until rollback is no longer needed.
