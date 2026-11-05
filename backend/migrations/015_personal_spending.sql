-- 015_personal_spending.sql — when a personal expense happened (so older ones can be
-- logged), and an optional monthly budget per person.
alter table "PersonalExpense" add column if not exists spent_at timestamptz null;
update "PersonalExpense" set spent_at = created_at where spent_at is null;
alter table "PersonalExpense" alter column spent_at set default now();
alter table "PersonalExpense" alter column spent_at set not null;
create index if not exists idx_personal_expense_user_spent on "PersonalExpense"(user_id, spent_at desc) where deleted_at is null;

alter table "User" add column if not exists monthly_budget numeric(12, 2) null;

-- Quick-commerce orders are groceries, not shopping (matches the import screen from now on).
update "Expense" set category = 'Groceries'
where split_type = 'itemized' and category = 'Shopping'
  and receipt_data->>'platform' in ('blinkit', 'zepto', 'instamart', 'bigbasket', 'jiomart', 'dmart');
