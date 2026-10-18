-- Run once in a NEW empty Supabase project. No existing client data is included.
begin;
create table public.contracts (
 id text primary key, user_id uuid not null default auth.uid() references auth.users(id),
 client_name text not null, phone text default '', item text default '',
 total_price numeric not null, down_payment numeric default 0,
 markup numeric default 0, markup_percent numeric default 0,
 term_months integer not null, start_date date not null,
 investor_id text default '', payments jsonb not null default '{}'::jsonb,
 comment text default '', guarantor_name text default '', guarantor_phone text default '',
 created_at timestamptz not null default now()
);
create table public.investors (
 id text primary key, user_id uuid not null default auth.uid() references auth.users(id),
 name text not null, amount numeric not null, monthly_payment numeric default 0,
 accrual_start_date date, created_at timestamptz not null default now()
);
create table public.withdrawals (
 id text primary key, user_id uuid not null default auth.uid() references auth.users(id),
 amount numeric not null, date date not null, investor_id text default '',
 purpose text default 'other', note text default '', created_at timestamptz not null default now()
);
alter table public.contracts enable row level security;
alter table public.investors enable row level security;
alter table public.withdrawals enable row level security;
create index on public.contracts(user_id);
create index on public.investors(user_id);
create index on public.withdrawals(user_id);
revoke all on public.contracts, public.investors, public.withdrawals from anon;
grant select, insert, update, delete on public.contracts, public.investors, public.withdrawals to authenticated;
create policy own_contracts on public.contracts for all to authenticated
 using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy own_investors on public.investors for all to authenticated
 using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy own_withdrawals on public.withdrawals for all to authenticated
 using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
insert into storage.buckets (id, name, public) values ('receipts', 'receipts', false);
create policy own_receipts on storage.objects for all to authenticated
 using (bucket_id = 'receipts' and exists (
 select 1 from public.contracts c where c.id = (storage.foldername(name))[1] and c.user_id = (select auth.uid())
 ))
 with check (bucket_id = 'receipts' and exists (
 select 1 from public.contracts c where c.id = (storage.foldername(name))[1] and c.user_id = (select auth.uid())
 ));
commit;
