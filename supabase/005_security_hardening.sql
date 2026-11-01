-- 005_security_hardening.sql
-- Усиление защиты по итогам аудита безопасности (31.10.2026).
-- Скрипт безопасно запускать повторно. Выполнять целиком в Supabase → SQL Editor.
-- Работу сайта не меняет: администратор продолжает делать всё то же самое.

begin;

-- 1. Чеки (файлы в хранилище).
--    Сейчас доступ фактически закрыт ограничивающей политикой receipts_admin_only,
--    но рядом остались три старые слишком широкие политики ("любой вошедший").
--    Заменяем их одной узкой: только администратор и только чеки своих договоров.
drop policy if exists "authenticated read receipts"   on storage.objects;
drop policy if exists "authenticated upload receipts" on storage.objects;
drop policy if exists "authenticated delete receipts" on storage.objects;
drop policy if exists receipts_admin_access           on storage.objects;

create policy receipts_admin_access on storage.objects
  for all to authenticated
  using (
    bucket_id = 'receipts' and exists (
      select 1 from public.contracts c
       where c.id = (storage.foldername(name))[1]
         and public.is_workspace_admin(c.user_id)))
  with check (
    bucket_id = 'receipts' and exists (
      select 1 from public.contracts c
       where c.id = (storage.foldername(name))[1]
         and public.is_workspace_admin(c.user_id)));

-- 2. Ограничения на загружаемые файлы: до 10 МБ, только фото и PDF.
--    Защищает от заливки огромных или опасных файлов (html, exe и т.п.).
update storage.buckets
   set file_size_limit = 10485760,
       allowed_mime_types = array['image/jpeg','image/png','image/webp','image/heic','image/heif','application/pdf']
 where id = 'receipts';

-- 3. Журнал действий только для чтения.
--    Записи в него делают серверные триггеры; сайту писать туда напрямую не нужно.
--    Даже если кто-то украдёт сессию администратора, подделать историю он не сможет.
drop policy if exists action_log_write on public.action_log;
revoke insert on public.action_log from authenticated;

-- 4. Дубли политик на таблицах (наведение порядка, на доступ не влияет:
--    ограничивающие *_admin_only остаются и продолжают действовать).
--    "admin access" оставляем — это единственная разрешающая политика.

commit;

-- Проверка после запуска (должно вернуть 2 строки по storage.objects):
-- select policyname, permissive from pg_policies where schemaname = 'storage';
