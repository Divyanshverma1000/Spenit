-- 021_bill_prints.sql — remember what a scanned personal bill looked like (screenshot hash,
-- order number, contents hash), so scanning the same bill again can say "you added this on 5 Nov".
-- Group bills keep the same fields inside Expense.receipt_data, so they need no column.
alter table "PersonalExpense" add column if not exists bill_meta jsonb null;
