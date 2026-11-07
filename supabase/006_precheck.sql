-- 006_precheck.sql — проверка перед миграцией 006 (ничего не меняет: всё внутри откатываемой транзакции).
-- Показывает договоры, у которых встроенный чек не фото/PDF или путь к файлу чека подозрительный.
-- Только номер договора и номер платежа — без содержимого чеков.
-- Пустой результат = миграцию 006 можно применять.

begin;

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

select c.id as contract_id, e.key as payment_index
  from public.contracts c, jsonb_each(case when jsonb_typeof(c.payments) = 'object' then c.payments else '{}'::jsonb end) e
 where jsonb_typeof(e.value) = 'object'
   and not public.receipts_are_safe(jsonb_build_object(e.key, e.value))
union all
select c.id, '(весь payments не объект)' from public.contracts c where jsonb_typeof(c.payments) <> 'object'
order by 1, 2;

rollback;
