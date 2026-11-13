-- 017_fix_undone_claims.sql — repair claims undone before the fix in groupSafety.undoClaim.
--
-- Undo used to move back only what existed at the moment of the claim. Bills and payments
-- added for the person *while* they held the placeholder's name stayed on their account.
-- For every undone claim whose placeholder is back, move rows created during the claim
-- window (claim → undo) from the claimer to the placeholder. Idempotent: once moved,
-- nothing matches again.

with fix as (
  select c.group_id, c.placeholder_id as ph, c.claimed_by as who, c.created_at as since, c.undone_at as until
  from "MemberClaim" c join "User" u on u.id = c.placeholder_id
  where c.undone_at is not null and u.deleted_at is null
)
update "ExpensePayer" ep set user_id = f.ph
from fix f, "Expense" e
where e.id = ep.expense_id and e.group_id = f.group_id and ep.user_id = f.who
  and e.created_at >= f.since and e.created_at <= f.until
  and not exists (select 1 from "ExpensePayer" x where x.expense_id = ep.expense_id and x.user_id = f.ph);

with fix as (
  select c.group_id, c.placeholder_id as ph, c.claimed_by as who, c.created_at as since, c.undone_at as until
  from "MemberClaim" c join "User" u on u.id = c.placeholder_id
  where c.undone_at is not null and u.deleted_at is null
)
update "ExpenseSplit" es set user_id = f.ph
from fix f, "Expense" e
where e.id = es.expense_id and e.group_id = f.group_id and es.user_id = f.who
  and e.created_at >= f.since and e.created_at <= f.until
  and not exists (select 1 from "ExpenseSplit" x where x.expense_id = es.expense_id and x.user_id = f.ph);

with fix as (
  select c.group_id, c.placeholder_id as ph, c.claimed_by as who, c.created_at as since, c.undone_at as until
  from "MemberClaim" c join "User" u on u.id = c.placeholder_id
  where c.undone_at is not null and u.deleted_at is null
)
update "Expense" e
set receipt_data = replace(e.receipt_data::text, f.who::text, f.ph::text)::jsonb
from fix f
where e.group_id = f.group_id and e.created_at >= f.since and e.created_at <= f.until
  and e.receipt_data is not null and e.receipt_data::text like '%' || f.who::text || '%';

with fix as (
  select c.group_id, c.placeholder_id as ph, c.claimed_by as who, c.created_at as since, c.undone_at as until
  from "MemberClaim" c join "User" u on u.id = c.placeholder_id
  where c.undone_at is not null and u.deleted_at is null
)
update "Expense" e set created_by = f.ph
from fix f
where e.group_id = f.group_id and e.created_by = f.who
  and e.created_at >= f.since and e.created_at <= f.until;

with fix as (
  select c.group_id, c.placeholder_id as ph, c.claimed_by as who, c.created_at as since, c.undone_at as until
  from "MemberClaim" c join "User" u on u.id = c.placeholder_id
  where c.undone_at is not null and u.deleted_at is null
)
update "Settlement" s set
  from_user    = case when s.from_user    = f.who then f.ph else s.from_user end,
  to_user      = case when s.to_user      = f.who then f.ph else s.to_user end,
  initiated_by = case when s.initiated_by = f.who then f.ph else s.initiated_by end,
  confirmed_by = case when s.confirmed_by = f.who then f.ph else s.confirmed_by end
from fix f
where s.group_id = f.group_id and s.created_at >= f.since and s.created_at <= f.until
  and f.who in (s.from_user, s.to_user, s.initiated_by, s.confirmed_by);
