-- Откат 006_security_followup.sql — возвращает облако к состоянию после 005.
-- Нужен только если после применения 006 что-то пошло не так. Данные договоров не меняет;
-- удаляет поле updated_at и таблицу приглашений (уже принятые операторы остаются операторами).

begin;

alter table public.contracts drop constraint if exists contracts_receipts_safe;
drop trigger if exists contracts_touch on public.contracts;
drop trigger if exists investors_touch on public.investors;
drop trigger if exists withdrawals_touch on public.withdrawals;
alter table public.contracts   drop column if exists updated_at;
alter table public.investors   drop column if exists updated_at;
alter table public.withdrawals drop column if exists updated_at;
drop function if exists public.touch_row();
drop function if exists public.receipts_are_safe(jsonb);
drop function if exists public.receipt_is_safe(jsonb);

drop function if exists public.invite_operator(text, text);
drop function if exists public.revoke_operator_invite(uuid);
drop function if exists public.accept_operator_invite(text);
drop table if exists public.operator_invites;

-- Прежние версии функций (как в облаке на 04.11.2026).
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

revoke all on function public.restore_backup(uuid), public.restore_trash_item(uuid), public.set_operator(text, text, boolean) from public, anon;
grant execute on function public.restore_backup(uuid), public.restore_trash_item(uuid), public.set_operator(text, text, boolean) to authenticated;
revoke all on function public.audit_row_change() from public, anon, authenticated;

commit;
