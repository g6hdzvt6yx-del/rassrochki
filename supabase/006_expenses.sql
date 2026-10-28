-- Раздел «Расходы» (веб-версия): кассы и счета с остатком, свои категории,
-- операции расходов, инкассация и перемещения между кассами/счетами.
--
-- Остатки пересчитывает сама база (триггер expenses_apply) при добавлении,
-- изменении и удалении операции — сайт никогда не пишет balance сам по себе,
-- кроме явной ручной корректировки остатка.
-- Перемещение = операция с to_account_id: списывается из одной кассы/счёта
-- и зачисляется в другую, повторного списания нет; в прибыль не входит.
-- Доступ — только администратор рабочего пространства, как у договоров.
begin;

create table if not exists public.money_accounts (
 id text primary key,
 user_id uuid not null default public.my_owner() references auth.users(id),
 name text not null check (length(btrim(name)) between 1 and 100),
 kind text not null check (kind in ('cash','bank')),
 balance numeric not null default 0,
 archived boolean not null default false,
 created_at timestamptz not null default now()
);

create table if not exists public.expense_categories (
 id text primary key,
 user_id uuid not null default public.my_owner() references auth.users(id),
 name text not null check (length(btrim(name)) between 1 and 60),
 created_at timestamptz not null default now()
);

create table if not exists public.expenses (
 id text primary key,
 user_id uuid not null default public.my_owner() references auth.users(id),
 amount numeric not null check (amount > 0 and amount < 1000000000),
 -- purchase | salary | collection | other | id из expense_categories
 category text not null,
 occurred_at timestamptz not null default now(),
 account_id text not null references public.money_accounts(id),
 to_account_id text references public.money_accounts(id),
 recipient text not null default '' check (length(recipient) <= 200),
 comment text not null default '' check (length(comment) <= 2000),
 receipt jsonb check (receipt is null or jsonb_typeof(receipt) = 'object'),
 created_by uuid,
 created_by_name text not null default '',
 updated_by uuid,
 updated_by_name text not null default '',
 updated_at timestamptz,
 created_at timestamptz not null default now(),
 check (to_account_id is null or to_account_id <> account_id),
 -- перемещение внутри программы оформляется как инкассация в свою кассу/счёт
 check (to_account_id is null or category = 'collection')
);

create index if not exists money_accounts_user_idx on public.money_accounts(user_id);
create index if not exists expense_categories_user_idx on public.expense_categories(user_id);
create index if not exists expenses_user_time_idx on public.expenses(user_id, occurred_at desc);
create index if not exists expenses_account_idx on public.expenses(account_id);
create index if not exists expenses_to_account_idx on public.expenses(to_account_id);

alter table public.money_accounts enable row level security;
alter table public.expense_categories enable row level security;
alter table public.expenses enable row level security;
revoke all on public.money_accounts, public.expense_categories, public.expenses from anon;
grant select, insert, update, delete on public.money_accounts, public.expense_categories, public.expenses to authenticated;

drop policy if exists money_accounts_admin on public.money_accounts;
create policy money_accounts_admin on public.money_accounts for all to authenticated
 using (public.is_workspace_admin(user_id)) with check (public.is_workspace_admin(user_id));
drop policy if exists expense_categories_admin on public.expense_categories;
create policy expense_categories_admin on public.expense_categories for all to authenticated
 using (public.is_workspace_admin(user_id)) with check (public.is_workspace_admin(user_id));
drop policy if exists expenses_admin on public.expenses;
create policy expenses_admin on public.expenses for all to authenticated
 using (public.is_workspace_admin(user_id)) with check (public.is_workspace_admin(user_id));

-- Проверка операции, автор и пересчёт остатков — в одной транзакции с записью.
create or replace function public.expenses_apply() returns trigger
language plpgsql security definer set search_path='' as $$
declare who text;
begin
 perform set_config('rassrochki.balance_auto', 'on', true);
 if tg_op in ('UPDATE','DELETE') then
  update public.money_accounts set balance = balance + old.amount where id = old.account_id;
  if old.to_account_id is not null then
   update public.money_accounts set balance = balance - old.amount where id = old.to_account_id;
  end if;
 end if;
 if tg_op = 'DELETE' then
  perform set_config('rassrochki.balance_auto', 'off', true);
  return old;
 end if;

 if tg_op = 'UPDATE' then new.user_id := old.user_id; end if;
 if not exists (select 1 from public.money_accounts where id = new.account_id and user_id = new.user_id) then
  raise exception 'Касса или счёт списания не найдены';
 end if;
 if new.to_account_id is not null and not exists (
  select 1 from public.money_accounts where id = new.to_account_id and user_id = new.user_id) then
  raise exception 'Касса или счёт зачисления не найдены';
 end if;
 if new.category not in ('purchase','salary','collection','other') and not exists (
  select 1 from public.expense_categories where id = new.category and user_id = new.user_id) then
  raise exception 'Категория расхода не найдена';
 end if;

 select coalesce(nullif(m.display_name, ''), u.email::text) into who
   from auth.users u left join public.app_members m on m.user_id = u.id
  where u.id = auth.uid();
 if tg_op = 'INSERT' then
  new.created_by := auth.uid(); new.created_by_name := coalesce(who, '');
  new.created_at := now(); new.updated_by := null; new.updated_by_name := ''; new.updated_at := null;
 else
  new.created_by := old.created_by; new.created_by_name := old.created_by_name; new.created_at := old.created_at;
  new.updated_by := auth.uid(); new.updated_by_name := coalesce(who, ''); new.updated_at := now();
 end if;

 update public.money_accounts set balance = balance - new.amount where id = new.account_id;
 if new.to_account_id is not null then
  update public.money_accounts set balance = balance + new.amount where id = new.to_account_id;
 end if;
 perform set_config('rassrochki.balance_auto', 'off', true);
 return new;
end $$;
revoke all on function public.expenses_apply() from public, anon, authenticated;
drop trigger if exists expenses_apply on public.expenses;
create trigger expenses_apply before insert or update or delete on public.expenses
 for each row execute function public.expenses_apply();

-- Свою категорию, по которой уже есть операции, удалить нельзя.
create or replace function public.expense_category_guard() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if exists (select 1 from public.expenses where category = old.id) then
  raise exception 'По категории «%» есть операции — сначала измените или удалите их', old.name;
 end if;
 return old;
end $$;
revoke all on function public.expense_category_guard() from public, anon, authenticated;
drop trigger if exists expense_category_guard on public.expense_categories;
create trigger expense_category_guard before delete on public.expense_categories
 for each row execute function public.expense_category_guard();

-- Журнал «История»: операции расходов и ручные изменения касс/счетов.
-- Автоматический пересчёт остатка операцией в журнал не дублируется.
create or replace function public.audit_money_change() returns trigger
language plpgsql security definer set search_path='' as $$
declare rec jsonb; b jsonb; a jsonb; kind text; ename text;
begin
 if tg_table_name = 'money_accounts' and tg_op = 'UPDATE'
    and coalesce(current_setting('rassrochki.balance_auto', true), '') = 'on' then return null; end if;
 if tg_op = 'INSERT' then rec := to_jsonb(new); kind := 'create'; a := rec - 'user_id';
 elsif tg_op = 'DELETE' then rec := to_jsonb(old); kind := 'permanent_delete'; b := rec - 'user_id';
 else
  rec := to_jsonb(new); kind := 'update'; b := to_jsonb(old) - 'user_id'; a := rec - 'user_id';
  if a = b then return null; end if;
 end if;
 ename := case tg_table_name
  when 'expenses' then concat(rec->>'amount', ' ₽', nullif(concat(' · ', nullif(rec->>'recipient', '')), ' · '))
  else rec->>'name' end;
 begin
  insert into public.action_log(owner_id, actor_id, action_type, entity_type, entity_id, entity_name,
                                before_json, after_json, source)
  values ((rec->>'user_id')::uuid, auth.uid(), kind, tg_table_name, rec->>'id', left(ename, 300), b, a,
          case when auth.uid() is null then 'Сервер' else 'Сайт' end);
 exception when others then
  raise warning 'action_log write failed: %', sqlerrm;
 end;
 return null;
end $$;
revoke all on function public.audit_money_change() from public, anon, authenticated;
drop trigger if exists expenses_audit on public.expenses;
drop trigger if exists money_accounts_audit on public.money_accounts;
create trigger expenses_audit after insert or update or delete on public.expenses
 for each row execute function public.audit_money_change();
create trigger money_accounts_audit after insert or update or delete on public.money_accounts
 for each row execute function public.audit_money_change();

-- Чеки и фото расходов: отдельное приватное хранилище, папка = владелец.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('expense-receipts', 'expense-receipts', false, 10485760,
        array['image/jpeg','image/png','image/webp','image/heic','image/heif','application/pdf'])
on conflict (id) do nothing;
drop policy if exists expense_receipts_admin on storage.objects;
create policy expense_receipts_admin on storage.objects for all to authenticated
 using (bucket_id = 'expense-receipts' and (storage.foldername(name))[1] = public.my_owner()::text)
 with check (bucket_id = 'expense-receipts' and (storage.foldername(name))[1] = public.my_owner()::text);

commit;
