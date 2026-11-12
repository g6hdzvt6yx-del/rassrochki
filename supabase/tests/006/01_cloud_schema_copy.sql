-- Копия схемы облака «rassrochki» (xaikgjgtqcgiwsayhssi) на 04.11.2026, после 005_security_hardening.
-- Собрана из каталога PostgreSQL (pg_proc, pg_policies, pg_constraint, grants). Без данных.
set check_function_bodies = off;

-- ---------- функции ----------
CREATE OR REPLACE FUNCTION public.my_owner()
 RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO ''
AS $function$
 select owner_id from public.app_members where user_id=auth.uid() and role='admin' and active
$function$;

CREATE OR REPLACE FUNCTION public.is_workspace_admin(owner uuid)
 RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO ''
AS $function$
 select exists(select 1 from public.app_members where user_id=auth.uid() and owner_id=owner and role='admin' and active)
$function$;

CREATE OR REPLACE FUNCTION public.can_call(cid text)
 RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO ''
AS $function$
 select exists(select 1 from public.contracts c join public.operator_assignments a on a.contract_id=c.id
 join public.app_members m on m.user_id=a.operator_id
 where c.id=cid and m.user_id=auth.uid() and m.role='operator' and m.active and m.owner_id=c.user_id)
$function$;

CREATE OR REPLACE FUNCTION public.action_log_people()
 RETURNS TABLE(user_id uuid, display_name text) LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO ''
AS $function$
 select m.user_id, coalesce(nullif(m.display_name, ''), u.email::text)
   from public.app_members m left join auth.users u on u.id = m.user_id
  where m.owner_id = public.my_owner()
$function$;

CREATE OR REPLACE FUNCTION public.assign_operator(cid text, operator_user uuid DEFAULT NULL::uuid)
 RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $function$
begin
 if not exists(select 1 from public.contracts where id=cid and public.is_workspace_admin(user_id)) then raise exception 'Access denied'; end if;
 if operator_user is null then delete from public.operator_assignments where contract_id=cid; return; end if;
 if not exists(select 1 from public.app_members where user_id=operator_user and owner_id=auth.uid() and role='operator' and active) then raise exception 'Оператор недоступен'; end if;
 insert into public.operator_assignments values(cid,operator_user) on conflict(contract_id) do update set operator_id=excluded.operator_id;
end $function$;

CREATE OR REPLACE FUNCTION public.audit_row_change()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $function$
declare
 o jsonb; n jsonb; b jsonb; a jsonb; rec jsonb; k text; kind text; etype text := tg_table_name; ename text;
begin
 if coalesce(current_setting('rassrochki.skip_audit', true), '') = 'on' then return null; end if;
 if tg_op = 'INSERT' then
  rec := to_jsonb(new); kind := 'create'; a := rec - 'user_id';
 elsif tg_op = 'DELETE' then
  rec := to_jsonb(old); b := rec - 'user_id';
  kind := case when coalesce(current_setting('rassrochki.purge', true), '') = 'on' then 'permanent_delete' else 'move_to_trash' end;
 else
  o := to_jsonb(old); n := to_jsonb(new); rec := n;
  if o = n then return null; end if;
  b := '{}'::jsonb; a := '{}'::jsonb;
  for k in select jsonb_object_keys(n) loop
   if (o -> k) is distinct from (n -> k) then
    b := b || jsonb_build_object(k, o -> k);
    a := a || jsonb_build_object(k, n -> k);
   end if;
  end loop;
  if tg_table_name = 'contracts' and a ? 'payments' and (select count(*) from jsonb_object_keys(a)) = 1 then
   kind := 'update_payment'; etype := 'payments';
  else
   kind := 'update';
  end if;
 end if;
 ename := case tg_table_name
  when 'contracts' then coalesce(nullif(rec->>'client_name', ''), rec->>'id')
  when 'investors' then coalesce(nullif(rec->>'name', ''), rec->>'id')
  else coalesce(nullif(rec->>'note', ''), concat(rec->>'amount', ' ₽ · ', rec->>'date')) end;
 begin
  insert into public.action_log(owner_id, actor_id, action_type, entity_type, entity_id, entity_name,
                                before_json, after_json, source, contract_id, investor_id)
  values ((rec->>'user_id')::uuid, auth.uid(), kind, etype, rec->>'id', left(ename, 300), b, a,
          case when auth.uid() is null then 'Сервер' else 'Сайт' end,
          case when tg_table_name = 'contracts' then rec->>'id' end,
          case when tg_table_name = 'investors' then rec->>'id' else nullif(rec->>'investor_id', '') end);
 exception when others then
  raise warning 'action_log write failed: %', sqlerrm;
 end;
 return null;
end $function$;

CREATE OR REPLACE FUNCTION public.log_server_action(owner uuid, kind text, entity text, eid text, ename text, before_value jsonb, after_value jsonb, cid text)
 RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path TO ''
AS $function$
 insert into public.action_log(owner_id, actor_id, action_type, entity_type, entity_id, entity_name, before_json, after_json, contract_id)
 values (owner, auth.uid(), kind, entity, eid, ename, before_value, after_value, cid)
$function$;

CREATE OR REPLACE FUNCTION public.make_backup(owner uuid, why text, is_automatic boolean)
 RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $function$
declare snap jsonb; counts jsonb; new_id uuid;
begin
 snap := jsonb_build_object(
  'format', 'rassrochki-cloud-backup', 'version', 1, 'createdAt', now(),
  'contracts', (select coalesce(jsonb_agg(to_jsonb(c) order by c.created_at, c.id), '[]'::jsonb) from public.contracts c where c.user_id=owner),
  'investors', (select coalesce(jsonb_agg(to_jsonb(i) order by i.created_at, i.id), '[]'::jsonb) from public.investors i where i.user_id=owner),
  'withdrawals', (select coalesce(jsonb_agg(to_jsonb(w) order by w.created_at, w.id), '[]'::jsonb) from public.withdrawals w where w.user_id=owner),
  'drafts', (select coalesce(jsonb_agg(to_jsonb(d) order by d.updated_at), '[]'::jsonb) from public.drafts d where d.owner_id=owner),
  'trash', (select coalesce(jsonb_agg(to_jsonb(t) order by t.deleted_at), '[]'::jsonb) from public.trash_items t where t.owner_id=owner),
  'assignments', (select coalesce(jsonb_agg(to_jsonb(a)), '[]'::jsonb) from public.operator_assignments a
                   join public.contracts c on c.id=a.contract_id where c.user_id=owner)
 );
 counts := jsonb_build_object(
  'contracts', jsonb_array_length(snap->'contracts'), 'investors', jsonb_array_length(snap->'investors'),
  'withdrawals', jsonb_array_length(snap->'withdrawals'), 'drafts', jsonb_array_length(snap->'drafts'),
  'trash', jsonb_array_length(snap->'trash'));
 insert into public.backups(owner_id, reason, automatic, counts, size_bytes, data)
 values (owner, why, is_automatic, counts, octet_length(snap::text), snap) returning id into new_id;
 delete from public.backups where owner_id=owner and automatic and created_at < now() - interval '90 days';
 perform public.log_server_action(owner, 'backup', 'backup', new_id::text, why, null, counts, null);
 return new_id;
end $function$;

CREATE OR REPLACE FUNCTION public.create_backup(why text DEFAULT 'Ручная копия'::text)
 RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $function$
declare owner uuid := public.my_owner();
begin
 if owner is null then raise exception 'Access denied'; end if;
 return public.make_backup(owner, left(coalesce(nullif(trim(why), ''), 'Ручная копия'), 200), false);
end $function$;

CREATE OR REPLACE FUNCTION public.ensure_daily_backup()
 RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $function$
declare owner uuid := public.my_owner();
begin
 if owner is null then raise exception 'Access denied'; end if;
 perform pg_advisory_xact_lock(hashtext('rassrochki-daily-backup:' || owner::text));
 if exists(select 1 from public.backups where owner_id=owner and automatic
           and (created_at at time zone 'Europe/Moscow')::date = (now() at time zone 'Europe/Moscow')::date) then
  return null;
 end if;
 return public.make_backup(owner, 'Автоматическая ежедневная копия', true);
end $function$;

CREATE OR REPLACE FUNCTION public.move_to_trash()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $function$
begin
 if coalesce(current_setting('rassrochki.purge', true), '') = 'on' then return old; end if;
 insert into public.trash_items(owner_id, entity_type, entity_id, data, contract_id, extra)
 values (old.user_id, tg_table_name, old.id, to_jsonb(old), case when tg_table_name='contracts' then old.id end,
  case when tg_table_name='contracts' then coalesce((select jsonb_build_object('operator_id', a.operator_id)
   from public.operator_assignments a where a.contract_id=old.id), '{}'::jsonb) else '{}'::jsonb end);
 return old;
end $function$;

CREATE OR REPLACE FUNCTION public.operator_clients()
 RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO ''
AS $function$
 select coalesce(jsonb_agg(jsonb_build_object('id',c.id,'clientName',c.client_name,'phone',c.phone,'item',c.item,
 'financed',greatest(0,c.total_price-c.down_payment+c.markup),'termMonths',c.term_months,'startDate',c.start_date,
 'payments',(select coalesce(jsonb_object_agg(p.key,jsonb_build_object('paidDate',p.value->'paidDate','paidAmount',p.value->'paidAmount','deferredUntil',p.value->'deferredUntil','paymentEvents',
 (select coalesce(jsonb_agg(jsonb_build_object('date',e->'date','amount',e->'amount')),'[]'::jsonb) from jsonb_array_elements(case when jsonb_typeof(p.value->'paymentEvents')='array' then p.value->'paymentEvents' else '[]'::jsonb end) e))),'{}'::jsonb)
 from jsonb_each(c.payments) p where p.key ~ '^[0-9]+$'))),'[]'::jsonb)
 from public.contracts c where public.can_call(c.id)
$function$;

CREATE OR REPLACE FUNCTION public.purge_trash_item(item_id uuid)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $function$
declare t public.trash_items;
begin
 select * into t from public.trash_items where id=item_id for update;
 if not found or not public.is_workspace_admin(t.owner_id) then raise exception 'Запись не найдена в корзине'; end if;
 if t.entity_type = 'investors' and exists(select 1 from public.contracts where user_id=t.owner_id and investor_id=t.entity_id) then
  raise exception 'Нельзя удалить вкладчика со связанными активными договорами';
 end if;
 delete from public.trash_items where id=item_id;
 perform public.log_server_action(t.owner_id, case when t.entity_type='receipts' then 'permanent_delete_receipt' else 'permanent_delete' end,
  t.entity_type, t.entity_id, coalesce(t.data->>'client_name', t.data->>'name', t.data->>'note', t.entity_id), t.data, null, t.contract_id);
 return case when t.entity_type='receipts' then jsonb_build_array(t.data->>'path') else '[]'::jsonb end;
end $function$;

CREATE OR REPLACE FUNCTION public.record_call(cid text, outcome text, message text DEFAULT ''::text, next_at timestamp with time zone DEFAULT NULL::timestamp with time zone, promise_date date DEFAULT NULL::date, promise_amount numeric DEFAULT NULL::numeric)
 RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $function$
declare new_id uuid;
begin
 if not public.can_call(cid) then raise exception 'Access denied'; end if;
 insert into public.call_log(contract_id,actor_id,result,note,next_contact_at,promised_date,promised_amount)
 values(cid,auth.uid(),outcome,coalesce(message,''),next_at,promise_date,promise_amount) returning id into new_id;
 return new_id;
end $function$;

CREATE OR REPLACE FUNCTION public.restore_backup(backup_id uuid)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $function$
declare b public.backups; owner uuid; control_id uuid; tbl text; sets text; kept integer := 0;
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

 foreach tbl in array array['investors','contracts','withdrawals'] loop
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

CREATE OR REPLACE FUNCTION public.restore_trash_item(item_id uuid)
 RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $function$
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

CREATE OR REPLACE FUNCTION public.run_scheduled_backups()
 RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $function$
declare o uuid;
begin
  for o in select distinct owner_id from public.app_members where role='admin' and active loop
    if not exists(select 1 from public.backups where owner_id=o and automatic
                  and (created_at at time zone 'Europe/Moscow')::date = (now() at time zone 'Europe/Moscow')::date) then
      perform public.make_backup(o, 'Автоматическая ежедневная копия', true);
    end if;
  end loop;
end $function$;

CREATE OR REPLACE FUNCTION public.set_operator(email_address text, member_name text, enabled boolean DEFAULT true)
 RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $function$
declare target uuid;
begin
 if not public.is_workspace_admin(auth.uid()) then raise exception 'Access denied'; end if;
 select id into target from auth.users where lower(email)=lower(trim(email_address));
 if target is null then raise exception 'Сначала создайте учётную запись в Authentication'; end if;
 if target=auth.uid() or exists(select 1 from public.app_members where user_id=target and (owner_id<>auth.uid() or role='admin')) then raise exception 'Недопустимая учётная запись'; end if;
 insert into public.app_members(user_id,owner_id,role,active,display_name) values(target,auth.uid(),'operator',enabled,member_name)
 on conflict(user_id) do update set active=excluded.active,display_name=excluded.display_name;
end $function$;

CREATE OR REPLACE FUNCTION public.trash_receipt(cid text, idx text, receipt jsonb)
 RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $function$
declare owner uuid; ename text; new_id uuid;
begin
 select user_id, client_name into owner, ename from public.contracts where id=cid;
 if owner is null or not public.is_workspace_admin(owner) then raise exception 'Access denied'; end if;
 if coalesce(receipt->>'path','') = '' then raise exception 'У чека нет файла'; end if;
 insert into public.trash_items(owner_id, entity_type, entity_id, data, contract_id, payment_index)
 values (owner, 'receipts', receipt->>'path', receipt, cid, idx) returning id into new_id;
 perform public.log_server_action(owner, 'remove_receipt', 'receipts', receipt->>'path', coalesce(receipt->>'name', ename), receipt, null, cid);
 return new_id;
end $function$;

-- ---------- таблицы ----------
create table public.action_log (id bigint generated always as identity not null, owner_id uuid not null default public.my_owner(), actor_id uuid default auth.uid(), occurred_at timestamp with time zone not null default now(), action_type text not null, entity_type text not null, entity_id text, entity_name text, before_json jsonb, after_json jsonb, source text not null default 'Сайт'::text, result text not null default 'success'::text, error_message text, contract_id text, investor_id text);
create table public.app_members (user_id uuid not null, owner_id uuid not null, role text not null, active boolean not null default true, display_name text not null default ''::text);
create table public.backups (id uuid not null default gen_random_uuid(), owner_id uuid not null, created_at timestamp with time zone not null default now(), reason text not null, automatic boolean not null default false, counts jsonb not null, size_bytes integer not null, data jsonb not null);
create table public.call_log (id uuid not null default gen_random_uuid(), contract_id text not null, actor_id uuid not null default auth.uid(), result text not null, note text not null default ''::text, next_contact_at timestamp with time zone, promised_date date, promised_amount numeric, created_at timestamp with time zone not null default now());
create table public.contracts (id text not null, client_name text not null, phone text default ''::text, item text default ''::text, total_price numeric not null default 0, down_payment numeric not null default 0, markup numeric not null default 0, markup_percent numeric not null default 0, term_months integer not null default 1, start_date date not null, investor_id text default ''::text, payments jsonb not null default '{}'::jsonb, created_at timestamp with time zone not null default now(), comment text default ''::text, guarantor_name text default ''::text, guarantor_phone text default ''::text, user_id uuid not null default auth.uid(), contract_date date);
create table public.drafts (id text not null, owner_id uuid not null default public.my_owner(), draft_type text not null default ''::text, title text not null default 'Без названия'::text, data jsonb not null default '{}'::jsonb, completion integer not null default 0, updated_at timestamp with time zone not null default now());
create table public.investors (id text not null, name text not null, amount numeric not null default 0, created_at timestamp with time zone not null default now(), user_id uuid not null default auth.uid(), monthly_payment numeric not null default 0, accrual_start_date date);
create table public.operator_assignments (contract_id text not null, operator_id uuid not null);
create table public.trash_items (id uuid not null default gen_random_uuid(), owner_id uuid not null, entity_type text not null, entity_id text not null, data jsonb not null, contract_id text, payment_index text, extra jsonb not null default '{}'::jsonb, deleted_at timestamp with time zone not null default now(), deleted_by uuid default auth.uid());
create table public.withdrawals (id text not null, amount numeric not null default 0, date date not null, investor_id text default ''::text, purpose text default 'other'::text, note text default ''::text, created_at timestamp with time zone not null default now(), user_id uuid not null default auth.uid());

alter table public.action_log add constraint action_log_action_type_check CHECK ((length(action_type) <= 100));
alter table public.action_log add constraint action_log_entity_type_check CHECK ((length(entity_type) <= 100));
alter table public.action_log add constraint action_log_pkey PRIMARY KEY (id);
alter table public.action_log add constraint action_log_result_check CHECK ((result = ANY (ARRAY['success'::text, 'error'::text])));
alter table public.app_members add constraint app_members_check CHECK (((role <> 'admin'::text) OR (user_id = owner_id)));
alter table public.app_members add constraint app_members_pkey PRIMARY KEY (user_id);
alter table public.app_members add constraint app_members_role_check CHECK ((role = ANY (ARRAY['admin'::text, 'operator'::text])));
alter table public.backups add constraint backups_pkey PRIMARY KEY (id);
alter table public.call_log add constraint call_log_check CHECK (((result <> 'callback'::text) OR (next_contact_at IS NOT NULL)));
alter table public.call_log add constraint call_log_check1 CHECK (((result <> 'promised'::text) OR ((promised_date IS NOT NULL) AND (promised_amount IS NOT NULL))));
alter table public.call_log add constraint call_log_note_check CHECK ((length(note) <= 2000));
alter table public.call_log add constraint call_log_pkey PRIMARY KEY (id);
alter table public.call_log add constraint call_log_promised_amount_check CHECK ((promised_amount > (0)::numeric));
alter table public.call_log add constraint call_log_result_check CHECK ((result = ANY (ARRAY['informed'::text, 'no_answer'::text, 'promised'::text, 'callback'::text, 'reported_paid'::text, 'wrong_number'::text, 'help'::text, 'refused'::text])));
alter table public.contracts add constraint contracts_pkey PRIMARY KEY (id);
alter table public.drafts add constraint drafts_pkey PRIMARY KEY (id);
alter table public.investors add constraint investors_pkey PRIMARY KEY (id);
alter table public.operator_assignments add constraint operator_assignments_pkey PRIMARY KEY (contract_id);
alter table public.trash_items add constraint trash_items_entity_type_check CHECK ((entity_type = ANY (ARRAY['contracts'::text, 'investors'::text, 'withdrawals'::text, 'receipts'::text])));
alter table public.trash_items add constraint trash_items_pkey PRIMARY KEY (id);
alter table public.withdrawals add constraint withdrawals_pkey PRIMARY KEY (id);
alter table public.action_log add constraint action_log_actor_id_fkey FOREIGN KEY (actor_id) REFERENCES auth.users(id);
alter table public.action_log add constraint action_log_owner_id_fkey FOREIGN KEY (owner_id) REFERENCES auth.users(id);
alter table public.app_members add constraint app_members_owner_id_fkey FOREIGN KEY (owner_id) REFERENCES auth.users(id);
alter table public.app_members add constraint app_members_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id);
alter table public.backups add constraint backups_owner_id_fkey FOREIGN KEY (owner_id) REFERENCES auth.users(id);
alter table public.call_log add constraint call_log_actor_id_fkey FOREIGN KEY (actor_id) REFERENCES auth.users(id);
alter table public.call_log add constraint call_log_contract_id_fkey FOREIGN KEY (contract_id) REFERENCES public.contracts(id) ON DELETE CASCADE;
alter table public.contracts add constraint contracts_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id);
alter table public.drafts add constraint drafts_owner_id_fkey FOREIGN KEY (owner_id) REFERENCES auth.users(id);
alter table public.investors add constraint investors_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id);
alter table public.operator_assignments add constraint operator_assignments_contract_id_fkey FOREIGN KEY (contract_id) REFERENCES public.contracts(id) ON DELETE CASCADE;
alter table public.operator_assignments add constraint operator_assignments_operator_id_fkey FOREIGN KEY (operator_id) REFERENCES public.app_members(user_id);
alter table public.trash_items add constraint trash_items_owner_id_fkey FOREIGN KEY (owner_id) REFERENCES auth.users(id);
alter table public.withdrawals add constraint withdrawals_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id);

create index action_log_owner_time_idx ON public.action_log USING btree (owner_id, occurred_at DESC);
create index backups_owner_time_idx ON public.backups USING btree (owner_id, created_at DESC);
create index contracts_user_id_idx ON public.contracts USING btree (user_id);
create index drafts_owner_time_idx ON public.drafts USING btree (owner_id, updated_at DESC);
create index investors_user_id_idx ON public.investors USING btree (user_id);
create index trash_items_owner_time_idx ON public.trash_items USING btree (owner_id, deleted_at DESC);
create index withdrawals_user_id_idx ON public.withdrawals USING btree (user_id);

-- ---------- триггеры ----------
CREATE TRIGGER contracts_audit AFTER INSERT OR DELETE OR UPDATE ON public.contracts FOR EACH ROW EXECUTE FUNCTION public.audit_row_change();
CREATE TRIGGER contracts_to_trash BEFORE DELETE ON public.contracts FOR EACH ROW EXECUTE FUNCTION public.move_to_trash();
CREATE TRIGGER investors_audit AFTER INSERT OR DELETE OR UPDATE ON public.investors FOR EACH ROW EXECUTE FUNCTION public.audit_row_change();
CREATE TRIGGER investors_to_trash BEFORE DELETE ON public.investors FOR EACH ROW EXECUTE FUNCTION public.move_to_trash();
CREATE TRIGGER withdrawals_audit AFTER INSERT OR DELETE OR UPDATE ON public.withdrawals FOR EACH ROW EXECUTE FUNCTION public.audit_row_change();
CREATE TRIGGER withdrawals_to_trash BEFORE DELETE ON public.withdrawals FOR EACH ROW EXECUTE FUNCTION public.move_to_trash();

-- ---------- RLS и политики ----------
alter table public.action_log enable row level security;
alter table public.app_members enable row level security;
alter table public.backups enable row level security;
alter table public.call_log enable row level security;
alter table public.contracts enable row level security;
alter table public.drafts enable row level security;
alter table public.investors enable row level security;
alter table public.operator_assignments enable row level security;
alter table public.trash_items enable row level security;
alter table public.withdrawals enable row level security;
create policy "admin access" on public.contracts as PERMISSIVE for ALL to authenticated using (public.is_workspace_admin(user_id)) with check (public.is_workspace_admin(user_id));
create policy "admin access" on public.investors as PERMISSIVE for ALL to authenticated using (public.is_workspace_admin(user_id)) with check (public.is_workspace_admin(user_id));
create policy "admin access" on public.withdrawals as PERMISSIVE for ALL to authenticated using (public.is_workspace_admin(user_id)) with check (public.is_workspace_admin(user_id));
create policy action_log_read on public.action_log as PERMISSIVE for SELECT to authenticated using (public.is_workspace_admin(owner_id));
create policy assignments_read on public.operator_assignments as PERMISSIVE for SELECT to authenticated using ((public.can_call(contract_id) OR (EXISTS ( SELECT 1 FROM public.contracts c WHERE ((c.id = operator_assignments.contract_id) AND public.is_workspace_admin(c.user_id))))));
create policy backups_read on public.backups as PERMISSIVE for SELECT to authenticated using (public.is_workspace_admin(owner_id));
create policy calls_read on public.call_log as PERMISSIVE for SELECT to authenticated using ((public.can_call(contract_id) OR (EXISTS ( SELECT 1 FROM public.contracts c WHERE ((c.id = call_log.contract_id) AND public.is_workspace_admin(c.user_id))))));
create policy contracts_admin_only on public.contracts as RESTRICTIVE for ALL to authenticated using (public.is_workspace_admin(user_id)) with check (public.is_workspace_admin(user_id));
create policy drafts_all on public.drafts as PERMISSIVE for ALL to authenticated using (public.is_workspace_admin(owner_id)) with check (public.is_workspace_admin(owner_id));
create policy investors_admin_only on public.investors as RESTRICTIVE for ALL to authenticated using (public.is_workspace_admin(user_id)) with check (public.is_workspace_admin(user_id));
create policy members_read on public.app_members as PERMISSIVE for SELECT to authenticated using (((user_id = auth.uid()) OR public.is_workspace_admin(owner_id)));
create policy receipts_admin_access on storage.objects as PERMISSIVE for ALL to authenticated using (((bucket_id = 'receipts'::text) AND (EXISTS ( SELECT 1 FROM public.contracts c WHERE ((c.id = (storage.foldername(objects.name))[1]) AND public.is_workspace_admin(c.user_id)))))) with check (((bucket_id = 'receipts'::text) AND (EXISTS ( SELECT 1 FROM public.contracts c WHERE ((c.id = (storage.foldername(objects.name))[1]) AND public.is_workspace_admin(c.user_id))))));
create policy receipts_admin_only on storage.objects as RESTRICTIVE for ALL to authenticated using (((bucket_id <> 'receipts'::text) OR (EXISTS ( SELECT 1 FROM public.contracts c WHERE ((c.id = (storage.foldername(objects.name))[1]) AND public.is_workspace_admin(c.user_id)))))) with check (((bucket_id <> 'receipts'::text) OR (EXISTS ( SELECT 1 FROM public.contracts c WHERE ((c.id = (storage.foldername(objects.name))[1]) AND public.is_workspace_admin(c.user_id))))));
create policy trash_read on public.trash_items as PERMISSIVE for SELECT to authenticated using (public.is_workspace_admin(owner_id));
create policy withdrawals_admin_only on public.withdrawals as RESTRICTIVE for ALL to authenticated using (public.is_workspace_admin(user_id)) with check (public.is_workspace_admin(user_id));

-- ---------- права ----------
revoke all on all tables in schema public from anon, authenticated;
grant DELETE,INSERT,SELECT,UPDATE on public.contracts, public.investors, public.withdrawals, public.drafts to authenticated;
grant SELECT on public.action_log, public.app_members, public.backups, public.call_log, public.operator_assignments, public.trash_items to authenticated;
revoke all on all functions in schema public from public, anon, authenticated;
grant execute on function public.action_log_people(), public.assign_operator(text, uuid), public.can_call(text),
  public.create_backup(text), public.ensure_daily_backup(), public.is_workspace_admin(uuid), public.my_owner(),
  public.operator_clients(), public.purge_trash_item(uuid), public.record_call(text, text, text, timestamptz, date, numeric),
  public.restore_backup(uuid), public.restore_trash_item(uuid), public.set_operator(text, text, boolean),
  public.trash_receipt(text, text, jsonb) to authenticated;
