-- Existing legacy schema only. Run in the SAME transaction as 002_roles.sql.
-- Caller must set app.bootstrap_owner to the verified owner's auth.users UUID.
do $$
declare owner uuid := current_setting('app.bootstrap_owner')::uuid;
begin
 if not exists(select 1 from auth.users where id=owner) then raise exception 'Verified owner required'; end if;
end $$;
alter table public.contracts add column user_id uuid references auth.users(id);
alter table public.investors add column user_id uuid references auth.users(id);
alter table public.withdrawals add column user_id uuid references auth.users(id);
update public.contracts set user_id=current_setting('app.bootstrap_owner')::uuid where user_id is null;
update public.investors set user_id=current_setting('app.bootstrap_owner')::uuid where user_id is null;
update public.withdrawals set user_id=current_setting('app.bootstrap_owner')::uuid where user_id is null;
alter table public.contracts alter column user_id set default auth.uid(), alter column user_id set not null;
alter table public.investors alter column user_id set default auth.uid(), alter column user_id set not null;
alter table public.withdrawals alter column user_id set default auth.uid(), alter column user_id set not null;
alter table public.investors add column monthly_payment numeric not null default 0, add column accrual_start_date date;
alter table public.contracts enable row level security;
alter table public.investors enable row level security;
alter table public.withdrawals enable row level security;
create index contracts_user_id_idx on public.contracts(user_id);
create index investors_user_id_idx on public.investors(user_id);
create index withdrawals_user_id_idx on public.withdrawals(user_id);
revoke all on public.contracts,public.investors,public.withdrawals from anon;
