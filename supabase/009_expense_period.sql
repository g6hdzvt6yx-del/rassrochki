-- 009_expense_period.sql
-- «Период расхода» — месяц, к которому относится расход, отдельно от даты оплаты.
-- Хранится первым числом месяца (2026-10-01 = октябрь 2026).
-- Деньги (касса, «Свободно», журнал) считаются по date — дате оплаты;
-- аналитика расходов и чистая прибыль — по period.
-- Старые записи получают месяц даты оплаты; суммы и даты не меняются. Скрипт можно выполнять повторно.

begin;

alter table public.expenses add column if not exists period date;
update public.expenses set period = date_trunc('month', date)::date where period is null;

-- Если период не передан (старая версия сайта, восстановление из старой копии или корзины) —
-- подставляется месяц даты оплаты; любой день месяца приводится к первому числу.
create or replace function public.expense_fill_period()
returns trigger language plpgsql set search_path to '' as $function$
begin
 new.period := date_trunc('month', coalesce(new.period, new.date))::date;
 return new;
end $function$;

drop trigger if exists expenses_fill_period on public.expenses;
create trigger expenses_fill_period before insert or update on public.expenses
 for each row execute function public.expense_fill_period();

alter table public.expenses alter column period set not null;
alter table public.expenses drop constraint if exists expenses_period_first_day;
alter table public.expenses add constraint expenses_period_first_day check (extract(day from period) = 1);
create index if not exists expenses_period_idx on public.expenses(user_id, period);

commit;
