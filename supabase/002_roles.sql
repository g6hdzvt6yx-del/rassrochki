-- Apply AFTER 001_schema.sql in a NEW database. Existing databases need schema review first.
begin;
create table public.app_members (
 user_id uuid primary key references auth.users(id), owner_id uuid not null references auth.users(id),
 role text not null check(role in ('admin','operator')), active boolean not null default true,
 display_name text not null default '', check(role <> 'admin' or user_id=owner_id)
);
create table public.operator_assignments (
 contract_id text primary key references public.contracts(id) on delete cascade,
 operator_id uuid not null references public.app_members(user_id)
);
create table public.call_log (
 id uuid primary key default gen_random_uuid(), contract_id text not null references public.contracts(id),
 actor_id uuid not null default auth.uid() references auth.users(id),
 result text not null check(result in ('informed','no_answer','promised','callback','reported_paid','wrong_number','help')),
 note text not null default '' check(length(note)<=2000), next_contact_at timestamptz,
 promised_date date, promised_amount numeric check(promised_amount>0), created_at timestamptz not null default now(),
 check(result <> 'callback' or next_contact_at is not null),
 check(result <> 'promised' or (promised_date is not null and promised_amount is not null))
);
create function public.is_workspace_admin(owner uuid) returns boolean
language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.app_members where user_id=auth.uid() and owner_id=owner and role='admin' and active)
$$;
create function public.can_call(cid text) returns boolean
language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.contracts c join public.operator_assignments a on a.contract_id=c.id
 join public.app_members m on m.user_id=a.operator_id
 where c.id=cid and m.user_id=auth.uid() and m.role='operator' and m.active and m.owner_id=c.user_id)
$$;
alter table public.app_members enable row level security;
alter table public.operator_assignments enable row level security;
alter table public.call_log enable row level security;
revoke all on public.app_members, public.operator_assignments, public.call_log from anon, authenticated;
grant select on public.app_members, public.operator_assignments, public.call_log to authenticated;
create policy members_read on public.app_members for select to authenticated using(user_id=auth.uid() or public.is_workspace_admin(owner_id));
create policy assignments_read on public.operator_assignments for select to authenticated using(public.can_call(contract_id) or exists(select 1 from public.contracts c where c.id=contract_id and public.is_workspace_admin(c.user_id)));
create policy calls_read on public.call_log for select to authenticated using(public.can_call(contract_id) or exists(select 1 from public.contracts c where c.id=contract_id and public.is_workspace_admin(c.user_id)));
-- RESTRICTIVE policies are ANDed with existing ownership policies.
create policy contracts_admin_only on public.contracts as restrictive for all to authenticated using(public.is_workspace_admin(user_id)) with check(public.is_workspace_admin(user_id));
create policy investors_admin_only on public.investors as restrictive for all to authenticated using(public.is_workspace_admin(user_id)) with check(public.is_workspace_admin(user_id));
create policy withdrawals_admin_only on public.withdrawals as restrictive for all to authenticated using(public.is_workspace_admin(user_id)) with check(public.is_workspace_admin(user_id));
create policy receipts_admin_only on storage.objects as restrictive for all to authenticated
 using(bucket_id <> 'receipts' or exists(select 1 from public.contracts c where c.id=(storage.foldername(name))[1] and public.is_workspace_admin(c.user_id)))
 with check(bucket_id <> 'receipts' or exists(select 1 from public.contracts c where c.id=(storage.foldername(name))[1] and public.is_workspace_admin(c.user_id)));
-- A narrow RPC exposes only calling data; no markup, investors, receipts or private notes.
create function public.operator_clients() returns jsonb language sql stable security definer set search_path='' as $$
 select coalesce(jsonb_agg(jsonb_build_object('id',c.id,'clientName',c.client_name,'phone',c.phone,'item',c.item,
 'financed',greatest(0,c.total_price-c.down_payment+c.markup),'termMonths',c.term_months,'startDate',c.start_date,
 'payments',(select coalesce(jsonb_object_agg(p.key,jsonb_build_object('paidDate',p.value->'paidDate','paidAmount',p.value->'paidAmount','deferredUntil',p.value->'deferredUntil','paymentEvents',
 (select coalesce(jsonb_agg(jsonb_build_object('date',e->'date','amount',e->'amount')),'[]'::jsonb) from jsonb_array_elements(case when jsonb_typeof(p.value->'paymentEvents')='array' then p.value->'paymentEvents' else '[]'::jsonb end) e))),'{}'::jsonb)
 from jsonb_each(c.payments) p where p.key ~ '^[0-9]+$'))),'[]'::jsonb)
 from public.contracts c where public.can_call(c.id)
$$;
create function public.record_call(cid text, outcome text, message text default '', next_at timestamptz default null, promise_date date default null, promise_amount numeric default null)
returns uuid language plpgsql security definer set search_path='' as $$
declare new_id uuid;
begin
 if not public.can_call(cid) then raise exception 'Access denied'; end if;
 insert into public.call_log(contract_id,actor_id,result,note,next_contact_at,promised_date,promised_amount)
 values(cid,auth.uid(),outcome,coalesce(message,''),next_at,promise_date,promise_amount) returning id into new_id;
 return new_id;
end $$;
create function public.set_operator(email_address text, member_name text, enabled boolean default true)
returns void language plpgsql security definer set search_path='' as $$
declare target uuid;
begin
 if not public.is_workspace_admin(auth.uid()) then raise exception 'Access denied'; end if;
 select id into target from auth.users where lower(email)=lower(trim(email_address));
 if target is null then raise exception 'Сначала создайте учётную запись в Authentication'; end if;
 if target=auth.uid() or exists(select 1 from public.app_members where user_id=target and (owner_id<>auth.uid() or role='admin')) then raise exception 'Недопустимая учётная запись'; end if;
 insert into public.app_members(user_id,owner_id,role,active,display_name) values(target,auth.uid(),'operator',enabled,member_name)
 on conflict(user_id) do update set active=excluded.active,display_name=excluded.display_name;
end $$;
create function public.assign_operator(cid text, operator_user uuid default null)
returns void language plpgsql security definer set search_path='' as $$
begin
 if not exists(select 1 from public.contracts where id=cid and public.is_workspace_admin(user_id)) then raise exception 'Access denied'; end if;
 if operator_user is null then delete from public.operator_assignments where contract_id=cid; return; end if;
 if not exists(select 1 from public.app_members where user_id=operator_user and owner_id=auth.uid() and role='operator' and active) then raise exception 'Оператор недоступен'; end if;
 insert into public.operator_assignments values(cid,operator_user) on conflict(contract_id) do update set operator_id=excluded.operator_id;
end $$;
revoke all on function public.is_workspace_admin(uuid),public.can_call(text),public.operator_clients(),public.record_call(text,text,text,timestamptz,date,numeric),public.set_operator(text,text,boolean),public.assign_operator(text,uuid) from public,anon;
grant execute on function public.is_workspace_admin(uuid),public.can_call(text),public.operator_clients(),public.record_call(text,text,text,timestamptz,date,numeric),public.set_operator(text,text,boolean),public.assign_operator(text,uuid) to authenticated;
commit;
-- Bootstrap the owner manually through SQL Editor after creating their Auth account:
-- insert into public.app_members(user_id,owner_id,role,display_name)
-- select id,id,'admin','Администратор' from auth.users where email = '<OWNER EMAIL>';
