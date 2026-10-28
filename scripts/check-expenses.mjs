// Проверка supabase/006_expenses.sql на локальной PGlite (рабочая база не затрагивается):
// node scripts/check-expenses.mjs /absolute/path/to/pglite/dist/index.js
import {readFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';
const {PGlite}=await import(pathToFileURL(process.argv[2]).href);
const db=new PGlite();
await db.exec(`create role anon; create role authenticated; create schema auth; create schema storage;
create table auth.users(id uuid primary key,email text);
create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
grant usage on schema auth,storage to authenticated,anon;
grant execute on function auth.uid() to authenticated,anon;
create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text);
alter table storage.objects enable row level security;
grant select,insert,update,delete on storage.objects to authenticated;
create function storage.foldername(text) returns text[] language sql immutable as $$select string_to_array($1,'/')$$;`);
await db.exec(await readFile(new URL('../supabase/001_schema.sql',import.meta.url),'utf8'));
await db.exec(await readFile(new URL('../supabase/002_roles.sql',import.meta.url),'utf8'));
// Есть в рабочей базе, но не в файлах репозитория: my_owner() и журнал action_log.
await db.exec(`create function public.my_owner() returns uuid language sql stable security definer set search_path='' as $$
 select owner_id from public.app_members where user_id=auth.uid() and role='admin' and active $$;
grant execute on function public.my_owner() to authenticated;
create table public.action_log(id bigserial primary key, owner_id uuid, actor_id uuid, occurred_at timestamptz default now(),
 action_type text, entity_type text, entity_id text, entity_name text, before_json jsonb, after_json jsonb, source text,
 result text default 'success', error_message text, contract_id text, investor_id text);`);
const admin='00000000-0000-0000-0000-000000000001', op='00000000-0000-0000-0000-000000000002', other='00000000-0000-0000-0000-000000000003';
await db.query(`insert into auth.users values ($1,'owner@example.test'),($2,'operator@example.test'),($3,'other@example.test')`,[admin,op,other]);
await db.query(`insert into public.app_members(user_id,owner_id,role,display_name) values($1,$1,'admin','Владелец'),($3,$3,'admin',''),($2,$1,'operator','Оператор')`,[admin,op,other]);
await db.exec(await readFile(new URL('../supabase/006_expenses.sql',import.meta.url),'utf8'));
await db.exec(await readFile(new URL('../supabase/006_expenses.sql',import.meta.url),'utf8')); // повторный запуск безопасен

async function asUser(id){await db.exec('reset role');await db.query(`select set_config('request.jwt.claim.sub',$1,false)`,[id]);await db.exec('set role authenticated');}
async function rejected(sql,params=[],text){let error;try{await db.query(sql,params);}catch(e){error=e;}assert.ok(error,'Expected denial: '+sql);if(text)assert.match(error.message,text);}
const balances=async()=>Object.fromEntries((await db.query('select id,balance from public.money_accounts order by id')).rows.map(r=>[r.id,Number(r.balance)]));

await asUser(admin);
await db.query(`insert into public.money_accounts(id,name,kind,balance) values('cash','Касса','cash',10000),('bank','Счёт','bank',50000)`);
await db.query(`insert into public.expense_categories(id,name) values('k1','Аренда')`);
// автор подставляется базой, присланное значение игнорируется
await db.query(`insert into public.expenses(id,amount,category,account_id,recipient,created_by_name) values('e1',1500,'purchase','cash','Поставщик','Подделка')`);
let row=(await db.query(`select * from public.expenses where id='e1'`)).rows[0];
assert.equal(row.created_by,admin);assert.equal(row.created_by_name,'Владелец');assert.equal(row.user_id,admin);
assert.deepEqual(await balances(),{bank:50000,cash:8500});
// изменение: старая сумма возвращается, новая списывается с нового источника
await db.query(`update public.expenses set amount=2000, account_id='bank' where id='e1'`);
assert.deepEqual(await balances(),{bank:48000,cash:10000});
row=(await db.query(`select * from public.expenses where id='e1'`)).rows[0];
assert.equal(row.updated_by_name,'Владелец');assert.equal(row.created_by_name,'Владелец');
// инкассация во внешнее место — только списание
await db.query(`insert into public.expenses(id,amount,category,account_id,recipient) values('e2',3000,'collection','cash','Владелец')`);
assert.deepEqual(await balances(),{bank:48000,cash:7000});
// перемещение в свой счёт — без повторного списания: сумма остатков не меняется
await db.query(`insert into public.expenses(id,amount,category,account_id,to_account_id) values('e3',4000,'collection','cash','bank')`);
assert.deepEqual(await balances(),{bank:52000,cash:3000});
await db.query(`update public.expenses set amount=1000 where id='e3'`);
assert.deepEqual(await balances(),{bank:49000,cash:6000});
await db.query(`delete from public.expenses where id='e3'`);
assert.deepEqual(await balances(),{bank:48000,cash:7000});
await db.query(`delete from public.expenses where id='e2'`);
assert.deepEqual(await balances(),{bank:48000,cash:10000});
// своя категория
await db.query(`insert into public.expenses(id,amount,category,account_id) values('e4',500,'k1','bank')`);
await rejected(`delete from public.expense_categories where id='k1'`,[],/есть операции/);
await rejected(`insert into public.expenses(id,amount,category,account_id) values('bad',1,'gift','cash')`,[],/Категория/);
await rejected(`insert into public.expenses(id,amount,category,account_id) values('bad',0,'other','cash')`);
await rejected(`insert into public.expenses(id,amount,category,account_id,to_account_id) values('bad',1,'other','cash','bank')`);
await rejected(`insert into public.expenses(id,amount,category,account_id,to_account_id) values('bad',1,'collection','cash','cash')`);
await rejected(`delete from public.money_accounts where id='bank'`); // есть операции
// журнал: операции и ручная правка остатка видны, автоматический пересчёт — нет
await db.query(`update public.money_accounts set balance=12345 where id='cash'`);
await db.exec('reset role');
const log=(await db.query(`select entity_type,action_type,entity_name from public.action_log order by id`)).rows;
assert.equal(log.filter(l=>l.entity_type==='money_accounts'&&l.action_type==='update').length,1);
assert.ok(log.some(l=>l.entity_type==='expenses'&&l.action_type==='create'&&l.entity_name==='1500 ₽ · Поставщик'));
assert.ok(log.some(l=>l.entity_type==='expenses'&&l.action_type==='permanent_delete'));

// оператор и чужой администратор ничего не видят и не меняют
for (const user of [op, other]) {
 await asUser(user);
 assert.equal((await db.query('select * from public.expenses')).rows.length,0);
 assert.equal((await db.query('select * from public.money_accounts')).rows.length,0);
 assert.equal((await db.query(`update public.money_accounts set balance=0 returning id`)).rows.length,0);
 assert.equal((await db.query(`delete from public.expenses returning id`)).rows.length,0);
 await rejected(`insert into storage.objects(bucket_id,name) values('expense-receipts',$1)`,[`${admin}/e1.jpg`]);
}
await asUser(other);
// чужая касса не принимается даже при подмене владельца
await db.query(`insert into public.money_accounts(id,name,kind) values('own','Своя','cash')`);
await rejected(`insert into public.expenses(id,amount,category,account_id) values('x',1,'other','cash')`,[],/не найдены/);
await rejected(`insert into public.expenses(id,user_id,amount,category,account_id) values('x',$1,1,'other','cash')`,[admin]);
await asUser(admin);
await db.query(`insert into storage.objects(bucket_id,name) values('expense-receipts',$1)`,[`${admin}/e1.jpg`]);
await rejected(`insert into storage.objects(bucket_id,name) values('expense-receipts',$1)`,[`${other}/e1.jpg`]);
assert.deepEqual(await balances(),{bank:47500,cash:12345});
console.log('expenses: ok');
