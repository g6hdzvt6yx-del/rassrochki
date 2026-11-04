-- Вымышленные данные для проверки. Реальных клиентов здесь нет.
insert into auth.users(id, email, email_confirmed_at) values
 ('aaaaaaaa-0000-0000-0000-000000000001', 'owner@test.local', now()),
 ('dddddddd-0000-0000-0000-000000000004', 'owner-d@test.local', now()),
 ('00000000-0000-0000-0000-0000000000a1', 'operator@test.local', now()),
 ('00000000-0000-0000-0000-0000000000f1', 'free@test.local', now());

insert into public.app_members(user_id, owner_id, role, active, display_name) values
 ('aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-000000000001','admin',true,'Владелец A'),
 ('dddddddd-0000-0000-0000-000000000004','dddddddd-0000-0000-0000-000000000004','admin',true,'Владелец D'),
 ('00000000-0000-0000-0000-0000000000a1','aaaaaaaa-0000-0000-0000-000000000001','operator',true,'Оператор A');

set rassrochki.skip_audit = 'on';
insert into public.contracts(id, client_name, phone, item, total_price, down_payment, markup, term_months, start_date, payments, user_id) values
 ('T-1', 'Тестовый Клиент Один', '89990000001', 'Тестовый телефон', 60000, 0, 12000, 6, '2026-08-01',
  '{"0":{"paidDate":"2026-09-01","paidAmount":12000,"receipts":[{"name":"чек.png","dataUrl":"data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="}]}}',
  'aaaaaaaa-0000-0000-0000-000000000001'),
 ('T-2', 'Тестовый Клиент Два', '89990000002', 'Тестовый ноутбук', 90000, 10000, 16000, 8, '2026-07-15', '{}', 'aaaaaaaa-0000-0000-0000-000000000001'),
 ('D-1', 'Клиент владельца D', '89990000009', 'Товар D', 30000, 0, 5000, 5, '2026-06-01', '{}', 'dddddddd-0000-0000-0000-000000000004');
insert into public.operator_assignments values ('T-2', '00000000-0000-0000-0000-0000000000a1');
reset rassrochki.skip_audit;
