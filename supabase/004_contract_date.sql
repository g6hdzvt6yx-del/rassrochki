-- Дата составления (подписания) договора, отдельно от даты первого платежа.
alter table public.contracts add column if not exists contract_date date;
comment on column public.contracts.contract_date is 'Дата составления (подписания) договора; может отличаться от даты первого платежа';
