-- Preserve the amount paid for each receipt item row (not a per-unit price).
ALTER TABLE food_items
  ADD COLUMN IF NOT EXISTS receipt_line_total NUMERIC(12, 2);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM pg_constraint
     WHERE conname = 'food_items_receipt_line_total_nonnegative'
       AND conrelid = 'food_items'::regclass
  ) THEN
    ALTER TABLE food_items
      ADD CONSTRAINT food_items_receipt_line_total_nonnegative
      CHECK (receipt_line_total IS NULL OR receipt_line_total >= 0);
  END IF;
END $$;
