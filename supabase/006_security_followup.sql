-- =====================================================================
--  006_security_followup.sql — Eppaz (облако «rassrochki»)
--  Продолжение аудита безопасности от 03.11.2026. Обновлено 10.11.2026 под реестр расходов.
--  Применять ПОСЛЕ 009_expense_period (то есть после 005, 007, 008 и 009).
--
--  Что меняет (подробно — в docs/006_security_followup.md):
--   1. Чеки: база не примет договор, где встроенный чек (receipt.dataUrl) — не фото и не PDF
--      в base64, а путь к файлу (receipt.path) — не относительный путь в хранилище.
--      Так «javascript:…» не попадёт в историю платежей ни с сайта, ни прямым запросом. (находка 1)
--   2. Версия строки: у contracts, investors, withdrawals появляется updated_at, его ставит
--      сама база (триггер touch_row). Сайт пишет с условием «updated_at = прочитанная версия»,
--      поэтому одно устройство не затрёт платёж другого. (находка 8)
--   3. Журнал: если запись в журнал не удалась, изменение тоже не сохраняется (раньше
--      сохранялось молча). Восстановление копии и восстановление из корзины теперь пишут
--      в журнал каждую изменённую строку, а не только сводную запись. (находка 2)
--   4. Операторы — только по приглашению с подтверждением. set_operator больше не показывает,
--      есть ли такая почта, и не может «забрать» чужую свободную учётную запись. (находка 10)
--
--  Данные клиентов скрипт не меняет. Новое поле updated_at заполняется временем применения.
--  Скрипт идёт одной транзакцией: при любой ошибке не меняется ничего.
--  Если запуск остановится на шаге 0 — в базе уже есть недопустимый чек; см. сообщение.
--  Откат: supabase/006_security_followup_rollback.sql
-- =====================================================================

begin;

-- ---------------------------------------------------------------------
-- 1. Серверная проверка чеков в contracts.payments
-- ---------------------------------------------------------------------
-- Как устроены платежи: payments — объект { "0": {...}, "1": {...}, "__contacts": [...] }.
-- У платежа чеки лежат в receipts (массив, новый формат) и/или в receipt (один, старый формат).
-- Чек — { name, type, path, addedAt } (файл в бакете receipts) или { name, dataUrl } (встроенный, с Mac).

create or replace function public.receipt_is_safe(r jsonb)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select case
    when r is null or jsonb_typeof(r) = 'null' then true
    when jsonb_typeof(r) <> 'object' then false
    else
      (case coalesce(jsonb_typeof(r -> 'dataUrl'), 'null')
         when 'null' then true
         when 'string' then (r ->> 'dataUrl')
           ~* '^\s*data:(image/(jpeg|jpg|pjpeg|png|webp|heic|heif)|application/pdf);base64,[A-Za-z0-9+/\s]+={0,2}\s*$'
         else false
       end)
      and
      (case coalesce(jsonb_typeof(r -> 'path'), 'null')
         when 'null' then true
         -- относительный путь в бакете: без «/» в начале, «..», «\», «:» и «//»
         when 'string' then (r ->> 'path') <> ''
           and (r ->> 'path') !~ '(^/|\\|:|//|(^|/)\.\.?(/|$))'
           and length(r ->> 'path') <= 1024
         else false
       end)
  end
$$;

create or replace function public.receipts_are_safe(p jsonb)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select case
    when p is null or jsonb_typeof(p) <> 'object' then false
    else coalesce((
      select bool_and(
        public.receipt_is_safe(e.value -> 'receipt')
        and case coalesce(jsonb_typeof(e.value -> 'receipts'), 'null')
              when 'null' then true
              when 'array' then coalesce((select bool_and(public.receipt_is_safe(x))
                                            from jsonb_array_elements(e.value -> 'receipts') x), true)
              else false
            end)
      from jsonb_each(p) as e
      where jsonb_typeof(e.value) = 'object'
    ), true)
  end
$$;

-- 0. Предварительная проверка: есть ли уже недопустимые чеки (показывает только количество).
do $$
declare bad integer;
begin
  select count(*) into bad from public.contracts where not public.receipts_are_safe(payments);
  if bad > 0 then
    raise exception 'Найдено договоров с недопустимым чеком: %. Миграция остановлена, ничего не изменено.', bad
      using hint = 'Найти их: запустите supabase/006_precheck.sql (только читает, ничего не меняет). '
                || 'Удалите или замените такие чеки и запустите миграцию снова.';
  end if;
end $$;

alter table public.contracts drop constraint if exists contracts_receipts_safe;
alter table public.contracts add constraint contracts_receipts_safe check (public.receipts_are_safe(payments));

-- ---------------------------------------------------------------------
-- 2. Версия строки: updated_at + touch_row (находка 8)
-- ---------------------------------------------------------------------
-- Время ставит база (clock_timestamp — точность до микросекунды, разное у каждой записи).
-- Изменение, которое ничего не меняет, версию не сдвигает.
-- Значение, присланное с сайта или прямым запросом, игнорируется.
create or replace function public.touch_row()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' and (to_jsonb(new) - 'updated_at') = (to_jsonb(old) - 'updated_at') then
    new.updated_at := old.updated_at;
  else
    new.updated_at := clock_timestamp();
  end if;
  return new;
end $$;

alter table public.contracts   add column if not exists updated_at timestamptz not null default clock_timestamp();
alter table public.investors   add column if not exists updated_at timestamptz not null default clock_timestamp();
alter table public.withdrawals add column if not exists updated_at timestamptz not null default clock_timestamp();

drop trigger if exists contracts_touch on public.contracts;
drop trigger if exists investors_touch on public.investors;
drop trigger if exists withdrawals_touch on public.withdrawals;
create trigger contracts_touch   before insert or update on public.contracts   for each row execute function public.touch_row();
create trigger investors_touch   before insert or update on public.investors   for each row execute function public.touch_row();
create trigger withdrawals_touch before insert or update on public.withdrawals for each row execute function public.touch_row();

revoke all on function public.touch_row() from public, anon, authenticated;
revoke all on function public.receipt_is_safe(jsonb), public.receipts_are_safe(jsonb) from public, anon;
grant execute on function public.receipt_is_safe(jsonb), public.receipts_are_safe(jsonb) to authenticated;

-- ---------------------------------------------------------------------
-- 3. Журнал (остаточные риски находки 2)
-- ---------------------------------------------------------------------
-- 3а. Ошибка записи в журнал отменяет изменение. Раньше: exception when others → warning,
--     и договор менялся без следа. Теперь: ошибка поднимается дальше, вся операция откатывается,
--     сайт показывает «Изменение не сохранено…».
-- 3б. Восстановление копии и восстановление из корзины больше не выключают журнал
--     (rassrochki.skip_audit), а помечают записи источником (rassrochki.audit_source):
--     каждая восстановленная, изменённая или убранная строка получает свою запись.
-- updated_at в журнал не попадает: это служебное поле, иначе каждое изменение платежа
-- выглядело бы как «изменение договора».
create or replace function public.audit_row_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
 o jsonb; n jsonb; b jsonb; a jsonb; rec jsonb; k text; kind text; etype text := tg_table_name; ename text;
 ctx text := coalesce(current_setting('rassrochki.audit_context', true), '');
 src text := nullif(current_setting('rassrochki.audit_source', true), '');
begin
 -- Служебное выключение журнала оставлено только для ручного обслуживания базы (SQL Editor);
 -- функции сайта его больше не используют, а сайт сам не может его включить.
 if coalesce(current_setting('rassrochki.skip_audit', true), '') = 'on' then return null; end if;
 if tg_op = 'INSERT' then
  rec := to_jsonb(new); kind := 'create'; a := rec - 'user_id' - 'updated_at';
 elsif tg_op = 'DELETE' then
  rec := to_jsonb(old); b := rec - 'user_id' - 'updated_at';
  kind := case when coalesce(current_setting('rassrochki.purge', true), '') = 'on' then 'permanent_delete' else 'move_to_trash' end;
 else
  o := to_jsonb(old) - 'updated_at'; n := to_jsonb(new) - 'updated_at'; rec := to_jsonb(new);
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
 -- Восстановление из корзины: вставка — «Восстановление», возврат чека в платёж — «Восстановление чека».
 if ctx = 'restore_trash' then
  if tg_op = 'INSERT' then kind := 'restore';
  elsif tg_op = 'UPDATE' and etype = 'payments' then kind := 'restore_receipt'; etype := 'receipts';
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
          left(coalesce(src, case when auth.uid() is null then 'Сервер' else 'Сайт' end), 200),
          case when tg_table_name = 'contracts' then rec->>'id' end,
          case when tg_table_name = 'investors' then rec->>'id' else nullif(rec->>'investor_id', '') end);
 exception when others then
  -- Без записи в журнале изменение не сохраняем: вся операция откатывается.
  raise exception 'Изменение не сохранено: не удалось записать его в журнал (%). Повторите действие; если ошибка повторится — сообщите разработчику.', sqlerrm
    using errcode = sqlstate;
 end;
 return null;
end $$;

-- 3б. restore_backup: журнал по каждой строке + сводная запись (как раньше).
create or replace function public.restore_backup(backup_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare b public.backups; owner uuid; control_id uuid; tbl text; sets text; kept integer := 0; label text; tables text[];
begin
 select * into b from public.backups where id=backup_id;
 if not found or not public.is_workspace_admin(b.owner_id) then raise exception 'Копия не найдена'; end if;
 owner := b.owner_id;
 label := 'Восстановление копии от ' || to_char(b.created_at at time zone 'Europe/Moscow', 'DD.MM.YYYY HH24:MI');
 perform set_config('rassrochki.audit_context', 'restore_backup', true);
 perform set_config('rassrochki.audit_source', label, true);
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
 -- Расходы восстанавливаются только из копий, в которых они есть (см. 008_expenses.sql):
 -- старые копии расходы не трогают.
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
  -- updated_at из копии не переносим: версию ставит база (touch_row).
  select string_agg(format('%I = excluded.%I', column_name, column_name), ', ') into sets
    from information_schema.columns where table_schema='public' and table_name=tbl and column_name not in ('id', 'updated_at');
  execute format('insert into public.%I select * from jsonb_populate_recordset(null::public.%I, $1) '
              || 'on conflict (id) do update set %s where public.%I.user_id = $2', tbl, tbl, sets, tbl)
   using coalesce(b.data->tbl, '[]'::jsonb), owner;
 end loop;
 insert into public.operator_assignments(contract_id, operator_id)
 select x.contract_id, x.operator_id from jsonb_populate_recordset(null::public.operator_assignments, coalesce(b.data->'assignments', '[]'::jsonb)) x
  where exists(select 1 from public.contracts c where c.id=x.contract_id and c.user_id=owner)
    and exists(select 1 from public.app_members m where m.user_id=x.operator_id and m.owner_id=owner and m.role='operator' and m.active)
 on conflict (contract_id) do nothing;

 perform public.log_server_action(owner, 'restore_backup', 'backup', b.id::text, label, null,
  jsonb_build_object('controlBackup', control_id, 'keptWithCalls', kept), null);
 perform set_config('rassrochki.audit_context', '', true);
 perform set_config('rassrochki.audit_source', '', true);
 return jsonb_build_object('controlBackup', control_id, 'keptWithCalls', kept);
end $function$;

-- 3б. restore_trash_item: запись в журнале делает триггер по самой восстановленной строке
--     (с полными данными), отдельная сводная запись больше не нужна.
create or replace function public.restore_trash_item(item_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $function$
declare t public.trash_items; ename text;
begin
 select * into t from public.trash_items where id=item_id for update;
 if not found or not public.is_workspace_admin(t.owner_id) then raise exception 'Запись не найдена в корзине'; end if;
 perform set_config('rassrochki.audit_context', 'restore_trash', true);
 perform set_config('rassrochki.audit_source', 'Корзина', true);
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
 perform set_config('rassrochki.audit_context', '', true);
 perform set_config('rassrochki.audit_source', '', true);
end $function$;

-- ---------------------------------------------------------------------
-- 4. Операторы по приглашению (находка 10)
-- ---------------------------------------------------------------------
-- Было: руководитель вводит почту → set_operator сразу делает эту учётную запись оператором
--   и по тексту ошибки видно, зарегистрирована ли почта.
-- Стало:
--   • руководитель создаёт приглашение на почту (invite_operator) и получает одноразовую ссылку;
--     ответ одинаковый, есть такая учётная запись или нет;
--   • оператором учётная запись становится, только когда её владелец сам вошёл и нажал
--     «Принять приглашение» (accept_operator_invite): почта должна совпадать и быть подтверждённой;
--   • ссылка действует 7 дней, используется один раз, её можно отозвать; в базе хранится
--     только отпечаток (sha256), сама ссылка — нет;
--   • set_operator теперь только включает/выключает и переименовывает уже принятых операторов.

create table if not exists public.operator_invites (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  email text not null check (email = lower(btrim(email)) and length(email) between 3 and 320),
  display_name text not null default '' check (length(display_name) <= 200),
  code_hash text not null unique,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '7 days',
  accepted_at timestamptz,
  accepted_by uuid references auth.users(id) on delete set null,
  revoked_at timestamptz
);
create index if not exists operator_invites_owner_idx on public.operator_invites(owner_id, created_at desc);
alter table public.operator_invites enable row level security;
revoke all on public.operator_invites from anon, authenticated;
-- Руководитель видит свои приглашения (без отпечатка кода); менять их можно только функциями ниже.
grant select (id, owner_id, email, display_name, created_at, expires_at, accepted_at, accepted_by, revoked_at)
  on public.operator_invites to authenticated;
drop policy if exists operator_invites_read on public.operator_invites;
create policy operator_invites_read on public.operator_invites for select to authenticated
  using (public.is_workspace_admin(owner_id));

create or replace function public.invite_operator(email_address text, member_name text default '')
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  owner uuid := auth.uid();
  mail text := lower(btrim(coalesce(email_address, '')));
  code text := replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');
  invite public.operator_invites;
begin
  if owner is null or not public.is_workspace_admin(owner) then raise exception 'Access denied'; end if;
  if mail !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception 'Укажите почту оператора'; end if;
  if (select count(*) from public.operator_invites where owner_id = owner and created_at > now() - interval '1 day') >= 20 then
    raise exception 'Слишком много приглашений за сутки. Попробуйте завтра.';
  end if;
  -- Прежнее неиспользованное приглашение на эту почту отзываем: действует только последнее.
  update public.operator_invites set revoked_at = now()
   where owner_id = owner and email = mail and accepted_at is null and revoked_at is null;
  insert into public.operator_invites(owner_id, email, display_name, code_hash)
  values (owner, mail, left(btrim(coalesce(member_name, '')), 200), encode(sha256(convert_to(code, 'UTF8')), 'hex'))
  returning * into invite;
  perform public.log_server_action(owner, 'invite_operator', 'operator_invites', invite.id::text, mail, null,
    jsonb_build_object('email', mail, 'displayName', invite.display_name, 'expiresAt', invite.expires_at), null);
  -- Код возвращается один раз — сайт собирает из него ссылку. В базе его нет.
  return jsonb_build_object('id', invite.id, 'code', code, 'email', mail, 'expiresAt', invite.expires_at);
end $$;

create or replace function public.revoke_operator_invite(invite_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare invite public.operator_invites;
begin
  select * into invite from public.operator_invites where id = invite_id for update;
  if not found or not public.is_workspace_admin(invite.owner_id) then raise exception 'Приглашение не найдено'; end if;
  if invite.accepted_at is not null then raise exception 'Приглашение уже принято. Отключите оператора в списке.'; end if;
  update public.operator_invites set revoked_at = coalesce(revoked_at, now()) where id = invite_id;
  perform public.log_server_action(invite.owner_id, 'revoke_operator_invite', 'operator_invites', invite.id::text, invite.email, null, null, null);
end $$;

create or replace function public.accept_operator_invite(invite_code text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid := auth.uid();
  my_mail text; confirmed timestamptz;
  invite public.operator_invites;
  member public.app_members;
  generic constant text := 'Приглашение недействительно: оно истекло, отозвано, уже использовано или выдано на другую почту. Попросите руководителя прислать новое.';
begin
  if me is null then raise exception 'Сначала войдите в свою учётную запись'; end if;
  select lower(email), email_confirmed_at into my_mail, confirmed from auth.users where id = me;
  select * into invite from public.operator_invites
   where code_hash = encode(sha256(convert_to(coalesce(invite_code, ''), 'UTF8')), 'hex')
   for update;
  if not found or invite.revoked_at is not null or invite.accepted_at is not null
     or invite.expires_at < now() or invite.email <> my_mail then
    raise exception '%', generic;
  end if;
  if confirmed is null then raise exception 'Почта учётной записи не подтверждена. Подтвердите её по письму и откройте ссылку снова.'; end if;
  select * into member from public.app_members where user_id = me;
  if found and (member.owner_id <> invite.owner_id or member.role <> 'operator') then
    raise exception 'Эта учётная запись уже работает в другом кабинете. Войдите под другой почтой.';
  end if;
  insert into public.app_members(user_id, owner_id, role, active, display_name)
  values (me, invite.owner_id, 'operator', true, invite.display_name)
  on conflict (user_id) do update set active = true,
    display_name = case when excluded.display_name <> '' then excluded.display_name else public.app_members.display_name end;
  update public.operator_invites set accepted_at = now(), accepted_by = me where id = invite.id;
  perform public.log_server_action(invite.owner_id, 'accept_operator_invite', 'operator_invites', invite.id::text, invite.email, null,
    jsonb_build_object('userId', me, 'displayName', invite.display_name), null);
  return jsonb_build_object('ownerId', invite.owner_id, 'role', 'operator');
end $$;

-- set_operator: только уже принятые операторы этого руководителя. Ответ не зависит от того,
-- существует ли почта вообще: чужие и незарегистрированные адреса дают одну и ту же ошибку.
create or replace function public.set_operator(email_address text, member_name text, enabled boolean default true)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare target uuid;
begin
  if not public.is_workspace_admin(auth.uid()) then raise exception 'Access denied'; end if;
  select m.user_id into target
    from public.app_members m join auth.users u on u.id = m.user_id
   where m.owner_id = auth.uid() and m.role = 'operator' and lower(u.email) = lower(btrim(email_address));
  if target is null then
    raise exception 'Такого оператора нет в вашем списке. Чтобы добавить нового, отправьте приглашение.';
  end if;
  update public.app_members set active = enabled, display_name = coalesce(member_name, display_name)
   where user_id = target and owner_id = auth.uid() and role = 'operator';
  perform public.log_server_action(auth.uid(), case when enabled then 'update_operator' else 'disable_operator' end,
    'app_members', target::text, lower(btrim(email_address)), null, jsonb_build_object('active', enabled, 'displayName', member_name), null);
end $$;

-- Права на функции: ничего для anon; новым функциям — только вошедшим.
revoke all on function public.invite_operator(text, text), public.revoke_operator_invite(uuid),
  public.accept_operator_invite(text), public.set_operator(text, text, boolean),
  public.restore_backup(uuid), public.restore_trash_item(uuid), public.audit_row_change() from public, anon;
grant execute on function public.invite_operator(text, text), public.revoke_operator_invite(uuid),
  public.accept_operator_invite(text), public.set_operator(text, text, boolean),
  public.restore_backup(uuid), public.restore_trash_item(uuid) to authenticated;
revoke all on function public.audit_row_change() from authenticated;

commit;

-- Проверка после запуска (все запросы только читают настройки, не данные клиентов):
-- select column_name from information_schema.columns where table_name in ('contracts','investors','withdrawals') and column_name = 'updated_at';  -- 3 строки
-- select tgname from pg_trigger where tgname like '%_touch';                                                                                       -- 3 строки
-- select conname from pg_constraint where conname = 'contracts_receipts_safe';                                                                    -- 1 строка
-- select proname from pg_proc where proname in ('invite_operator','accept_operator_invite','revoke_operator_invite');                            -- 3 строки
