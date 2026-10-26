-- История изменений для веб-версии.
-- База сама записывает в action_log каждое создание, изменение и удаление
-- договоров, платежей, вкладчиков и выводов — независимо от того, какой
-- клиент (сайт, обмен с Mac, SQL) внёс изменение. Сами данные не меняются.

create or replace function public.audit_row_change() returns trigger
language plpgsql security definer set search_path='' as $$
declare
 o jsonb; n jsonb; b jsonb; a jsonb; rec jsonb; k text; kind text; etype text := tg_table_name; ename text;
begin
 -- Восстановление из корзины и из копии пишут в журнал одну итоговую запись сами.
 if coalesce(current_setting('rassrochki.skip_audit', true), '') = 'on' then return null; end if;
 if tg_op = 'INSERT' then
  rec := to_jsonb(new); kind := 'create'; a := rec - 'user_id';
 elsif tg_op = 'DELETE' then
  rec := to_jsonb(old); b := rec - 'user_id';
  kind := case when coalesce(current_setting('rassrochki.purge', true), '') = 'on' then 'permanent_delete' else 'move_to_trash' end;
 else
  o := to_jsonb(old); n := to_jsonb(new); rec := n;
  if o = n then return null; end if;
  -- Храним только изменившиеся поля: «было» и «стало».
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
 -- Ошибка журнала не должна мешать сохранению договора или платежа.
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
end $$;

revoke all on function public.audit_row_change() from public, anon, authenticated;

drop trigger if exists contracts_audit on public.contracts;
drop trigger if exists investors_audit on public.investors;
drop trigger if exists withdrawals_audit on public.withdrawals;
create trigger contracts_audit after insert or update or delete on public.contracts
 for each row execute function public.audit_row_change();
create trigger investors_audit after insert or update or delete on public.investors
 for each row execute function public.audit_row_change();
create trigger withdrawals_audit after insert or update or delete on public.withdrawals
 for each row execute function public.audit_row_change();

-- Восстановление из корзины и из резервной копии уже пишет одну итоговую
-- запись («Восстановление», «Восстановление копии»). Отключаем построчный
-- журнал только внутри этих функций, чтобы не плодить сотни дублей.
do $$
declare fn text; def text; patched text;
begin
 foreach fn in array array['public.restore_trash_item(uuid)', 'public.restore_backup(uuid)'] loop
  def := pg_get_functiondef(fn::regprocedure);
  if position('rassrochki.skip_audit' in def) > 0 then continue; end if;
  patched := regexp_replace(def, '\mbegin\M', 'begin' || chr(10) || ' perform set_config(''rassrochki.skip_audit'', ''on'', true);');
  if patched = def then raise exception 'Не удалось дополнить %', fn; end if;
  execute patched;
 end loop;
end $$;

-- Подписи сотрудников в журнале: администратор видит имена своей команды.
create or replace function public.action_log_people() returns table(user_id uuid, display_name text)
language sql stable security definer set search_path='' as $$
 select m.user_id, coalesce(nullif(m.display_name, ''), u.email::text)
   from public.app_members m left join auth.users u on u.id = m.user_id
  where m.owner_id = public.my_owner()
$$;
revoke all on function public.action_log_people() from public, anon, authenticated;
grant execute on function public.action_log_people() to authenticated;
