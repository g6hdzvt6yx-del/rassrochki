-- Отметки оператора: статус «Отказ от оплаты» и мгновенное обновление списка договоров.
-- Новых таблиц и полей не создаётся: отметки по-прежнему хранятся в public.call_log
-- (каждая отметка — отдельная строка, старые не изменяются и не удаляются).
-- Скрипт можно выполнять повторно.
begin;

-- 1. Разрешить результат звонка 'refused' («Отказ от оплаты»).
do $$
declare c record;
begin
 for c in
  select conname from pg_constraint
   where conrelid = 'public.call_log'::regclass and contype = 'c'
     and pg_get_constraintdef(oid) ilike '%informed%wrong_number%'
 loop
  execute format('alter table public.call_log drop constraint %I', c.conname);
 end loop;
end $$;
alter table public.call_log add constraint call_log_result_check
 check (result in ('informed','no_answer','promised','callback','reported_paid','wrong_number','help','refused'));

-- 2. Рассылка новых отметок в открытые окна администратора (Supabase Realtime).
--    Права чтения не меняются: события получают только те, кому call_log доступен по RLS.
do $$
begin
 if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
    and not exists (select 1 from pg_publication_tables
                     where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'call_log') then
  execute 'alter publication supabase_realtime add table public.call_log';
 end if;
end $$;

commit;
