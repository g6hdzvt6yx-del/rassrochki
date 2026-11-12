-- 008_expenses.sql
-- Реестр расходов (оплаты аренды, зарплаты, рекламы и т. п.).
-- Расходы вычитаются из прибыли собственника (не вкладчиков) и уменьшают «Свободно» в «Капитале».
-- Удаление уходит в корзину, изменения пишутся в журнал, расходы входят в серверные копии.
-- Скрипт можно выполнять повторно.

begin;

-- 1. Таблица
create table if not exists public.expenses (
 id text primary key,
 user_id uuid not null default auth.uid() references auth.users(id),
 date date not null,
 amount numeric not null check (amount > 0),
 category text not null default 'Прочее' check (length(category) between 1 and 100),
 paid_from text not null default '' check (length(paid_from) <= 100),
 note text not null default '' check (length(note) <= 2000),
 created_at timestamptz not null default now()
);
create index if not exists expenses_user_id_idx on public.expenses(user_id);
create index if not exists expenses_date_idx on public.expenses(user_id, date desc);

-- 2. Доступ: только администратор своей рабочей области (как у выводов)
alter table public.expenses enable row level security;
revoke all on public.expenses from anon;
grant select, insert, update, delete on public.expenses to authenticated;
drop policy if exists "admin access" on public.expenses;
drop policy if exists expenses_admin_only on public.expenses;
create policy "admin access" on public.expenses for all to authenticated
 using (public.is_workspace_admin(user_id)) with check (public.is_workspace_admin(user_id));
create policy expenses_admin_only on public.expenses as restrictive for all to authenticated
 using (public.is_workspace_admin(user_id)) with check (public.is_workspace_admin(user_id));

-- 3. Журнал и корзина — те же функции, что у остальных таблиц
alter table public.trash_items drop constraint if exists trash_items_entity_type_check;
alter table public.trash_items add constraint trash_items_entity_type_check
 check (entity_type = any (array['contracts','investors','withdrawals','expenses','receipts']));
drop trigger if exists expenses_audit on public.expenses;
create trigger expenses_audit after insert or update or delete on public.expenses
 for each row execute function public.audit_row_change();
drop trigger if exists expenses_to_trash on public.expenses;
create trigger expenses_to_trash before delete on public.expenses
 for each row execute function public.move_to_trash();

-- 4. Серверная резервная копия теперь включает расходы
create or replace function public.make_backup(owner uuid, why text, is_automatic boolean)
returns uuid language plpgsql security definer set search_path to '' as $function$
declare snap jsonb; counts jsonb; new_id uuid;
begin
 snap := jsonb_build_object(
  'format', 'rassrochki-cloud-backup', 'version', 1, 'createdAt', now(),
  'contracts', (select coalesce(jsonb_agg(to_jsonb(c) order by c.created_at, c.id), '[]'::jsonb) from public.contracts c where c.user_id=owner),
  'investors', (select coalesce(jsonb_agg(to_jsonb(i) order by i.created_at, i.id), '[]'::jsonb) from public.investors i where i.user_id=owner),
  'withdrawals', (select coalesce(jsonb_agg(to_jsonb(w) order by w.created_at, w.id), '[]'::jsonb) from public.withdrawals w where w.user_id=owner),
  'expenses', (select coalesce(jsonb_agg(to_jsonb(x) order by x.created_at, x.id), '[]'::jsonb) from public.expenses x where x.user_id=owner),
  'drafts', (select coalesce(jsonb_agg(to_jsonb(d) order by d.updated_at), '[]'::jsonb) from public.drafts d where d.owner_id=owner),
  'trash', (select coalesce(jsonb_agg(to_jsonb(t) order by t.deleted_at), '[]'::jsonb) from public.trash_items t where t.owner_id=owner),
  'assignments', (select coalesce(jsonb_agg(to_jsonb(a)), '[]'::jsonb) from public.operator_assignments a
                   join public.contracts c on c.id=a.contract_id where c.user_id=owner)
 );
 counts := jsonb_build_object(
  'contracts', jsonb_array_length(snap->'contracts'), 'investors', jsonb_array_length(snap->'investors'),
  'withdrawals', jsonb_array_length(snap->'withdrawals'), 'expenses', jsonb_array_length(snap->'expenses'),
  'drafts', jsonb_array_length(snap->'drafts'), 'trash', jsonb_array_length(snap->'trash'));
 insert into public.backups(owner_id, reason, automatic, counts, size_bytes, data)
 values (owner, why, is_automatic, counts, octet_length(snap::text), snap) returning id into new_id;
 delete from public.backups where owner_id=owner and automatic and created_at < now() - interval '90 days';
 perform public.log_server_action(owner, 'backup', 'backup', new_id::text, why, null, counts, null);
 return new_id;
end $function$;

-- 5. Восстановление расхода из корзины
create or replace function public.restore_trash_item(item_id uuid)
returns void language plpgsql security definer set search_path to '' as $function$
declare t public.trash_items; ename text;
begin
 perform set_config('rassrochki.skip_audit', 'on', true);
 select * into t from public.trash_items where id=item_id for update;
 if not found or not public.is_workspace_admin(t.owner_id) then raise exception 'Запись не найдена в корзине'; end if;
 ename := coalesce(t.data->>'client_name', t.data->>'name', t.data->>'note', t.entity_id);
 if t.entity_type = 'contracts' then
  if exists(select 1 from public.contracts where id=t.entity_id) then raise exception 'Договор с таким номером уже существует'; end if;
  insert into public.contracts select * from jsonb_populate_record(null::public.contracts, t.data);
  insert into public.operator_assignments(contract_id, operator_id)
  select t.entity_id, m.user_id from public.app_members m
   where m.user_id = (t.extra->>'operator_id')::uuid and m.owner_id=t.owner_id and m.role='operator' and m.active
  on conflict (contract_id) do nothing;
 elsif t.entity_type = 'investors' then
  if exists(select 1 from public.investors where id=t.entity_id) then raise exception 'Вкладчик с таким номером уже существует'; end if;
  insert into public.investors select * from jsonb_populate_record(null::public.investors, t.data);
 elsif t.entity_type = 'withdrawals' then
  if exists(select 1 from public.withdrawals where id=t.entity_id) then raise exception 'Вывод с таким номером уже существует'; end if;
  insert into public.withdrawals select * from jsonb_populate_record(null::public.withdrawals, t.data);
 elsif t.entity_type = 'expenses' then
  if exists(select 1 from public.expenses where id=t.entity_id) then raise exception 'Расход с таким номером уже существует'; end if;
  insert into public.expenses select * from jsonb_populate_record(null::public.expenses, t.data);
 else
  if not exists(select 1 from public.contracts where id=t.contract_id and user_id=t.owner_id) then
   raise exception 'Договор этого чека не найден. Сначала восстановите договор.';
  end if;
  if exists(select 1 from public.contracts where id=t.contract_id and payments->t.payment_index ? 'receipt') then
   raise exception 'У этого платежа уже прикреплён другой чек';
  end if;
  update public.contracts
     set payments = jsonb_set(payments, array[t.payment_index], coalesce(payments->t.payment_index, '{}'::jsonb) || jsonb_build_object('receipt', t.data))
   where id=t.contract_id;
 end if;
 delete from public.trash_items where id=item_id;
 perform public.log_server_action(t.owner_id, case when t.entity_type='receipts' then 'restore_receipt' else 'restore' end,
  t.entity_type, t.entity_id, ename, null, t.data, t.contract_id);
end $function$;

-- 6. Восстановление серверной копии. Расходы восстанавливаются только из копий,
--    в которых они есть: старые копии (до этого скрипта) расходы не трогают.
create or replace function public.restore_backup(backup_id uuid)
returns jsonb language plpgsql security definer set search_path to '' as $function$
declare b public.backups; owner uuid; control_id uuid; tbl text; sets text; kept integer := 0; tables text[];
begin
 perform set_config('rassrochki.skip_audit', 'on', true);
 select * into b from public.backups where id=backup_id;
 if not found or not public.is_workspace_admin(b.owner_id) then raise exception 'Копия не найдена'; end if;
 owner := b.owner_id;
 control_id := public.make_backup(owner, 'Контрольная копия перед восстановлением', false);

 select count(*) into kept from public.contracts c
  where c.user_id=owner and not exists(select 1 from jsonb_array_elements(b.data->'contracts') e where e->>'id'=c.id)
    and exists(select 1 from public.call_log l where l.contract_id=c.id);
 delete from public.contracts c
  where c.user_id=owner and not exists(select 1 from jsonb_array_elements(b.data->'contracts') e where e->>'id'=c.id)
    and not exists(select 1 from public.call_log l where l.contract_id=c.id);
 delete from public.investors i
  where i.user_id=owner and not exists(select 1 from jsonb_array_elements(b.data->'investors') e where e->>'id'=i.id);
 delete from public.withdrawals w
  where w.user_id=owner and not exists(select 1 from jsonb_array_elements(b.data->'withdrawals') e where e->>'id'=w.id);
 tables := array['investors','contracts','withdrawals'];
 if b.data ? 'expenses' then
  delete from public.expenses x
   where x.user_id=owner and not exists(select 1 from jsonb_array_elements(b.data->'expenses') e where e->>'id'=x.id);
  tables := array_append(tables, 'expenses');
 end if;

 foreach tbl in array tables loop
  delete from public.trash_items t
   where t.owner_id=owner and t.entity_type=tbl
     and exists(select 1 from jsonb_array_elements(b.data->tbl) e where e->>'id'=t.entity_id);
  select string_agg(format('%I = excluded.%I', column_name, column_name), ', ') into sets
    from information_schema.columns where table_schema='public' and table_name=tbl and column_name <> 'id';
  execute format('insert into public.%I select * from jsonb_populate_recordset(null::public.%I, $1) '
              || 'on conflict (id) do update set %s where public.%I.user_id = $2', tbl, tbl, sets, tbl)
   using coalesce(b.data->tbl, '[]'::jsonb), owner;
 end loop;
 insert into public.operator_assignments(contract_id, operator_id)
 select x.contract_id, x.operator_id from jsonb_populate_recordset(null::public.operator_assignments, coalesce(b.data->'assignments', '[]'::jsonb)) x
  where exists(select 1 from public.contracts c where c.id=x.contract_id and c.user_id=owner)
    and exists(select 1 from public.app_members m where m.user_id=x.operator_id and m.owner_id=owner and m.role='operator' and m.active)
 on conflict (contract_id) do nothing;

 perform public.log_server_action(owner, 'restore_backup', 'backup', b.id::text,
  'Копия от ' || to_char(b.created_at at time zone 'Europe/Moscow', 'DD.MM.YYYY HH24:MI'), null,
  jsonb_build_object('controlBackup', control_id, 'keptWithCalls', kept), null);
 return jsonb_build_object('controlBackup', control_id, 'keptWithCalls', kept);
end $function$;

commit;
