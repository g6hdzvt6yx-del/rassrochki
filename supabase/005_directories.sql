-- Справочники веб-версии: товары, клиенты, карты и счета, кассы, сотрудники,
-- категории товаров, статьи доходов и расходов, поручители, способы оплаты.
-- Одна таблица: вид справочника (kind) + поля записи (data). Доступ только у
-- администратора, как у черновиков: оператор паспорта и цены не видит.
create table if not exists public.directory_items (
 id text primary key,
 owner_id uuid not null default public.my_owner() references auth.users(id),
 kind text not null check (kind in ('products','clients','accounts','cashboxes','employees',
  'categories','articles','guarantors','payment_methods')),
 data jsonb not null default '{}'::jsonb check (jsonb_typeof(data) = 'object'),
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now()
);
create index if not exists directory_items_owner_kind_idx on public.directory_items(owner_id, kind);
alter table public.directory_items enable row level security;
revoke all on public.directory_items from anon;
grant select, insert, update, delete on public.directory_items to authenticated;
drop policy if exists directory_items_admin on public.directory_items;
create policy directory_items_admin on public.directory_items for all to authenticated
 using (public.is_workspace_admin(owner_id)) with check (public.is_workspace_admin(owner_id));
