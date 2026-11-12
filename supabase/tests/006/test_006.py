"""Проверка миграции 006 на локальной копии схемы облака «rassrochki» (вымышленные данные).

Запуск: см. README.md рядом. python3 test_006.py <база> [начало названия проверки…]
Подключение берётся из PGHOST/PGPORT/PGUSER (по умолчанию localhost:5432, postgres).
Каждая проверка идёт в своей транзакции с откатом, база не меняется.
"""
import json, os, sys
import psycopg

DB = sys.argv[1]
OWNER, OWNER_D = 'aaaaaaaa-0000-0000-0000-000000000001', 'dddddddd-0000-0000-0000-000000000004'
OPER, FREE = '00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000f1'
PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='
results = []


def conn():
    return psycopg.connect(host=os.environ.get('PGHOST', 'localhost'), port=os.environ.get('PGPORT', '5432'),
                           user=os.environ.get('PGUSER', 'postgres'), dbname=DB, autocommit=False)


def as_user(cur, uid):
    cur.execute('reset role')
    if uid is None:
        cur.execute("select set_config('request.jwt.claims', '', true)")
        cur.execute('set local role anon')
    else:
        cur.execute("select set_config('request.jwt.claims', %s, true)", (json.dumps({'sub': uid, 'role': 'authenticated'}),))
        cur.execute('set local role authenticated')


def as_admin(cur):
    cur.execute('reset role')
    cur.execute("select set_config('request.jwt.claims', '', true)")


def check(name, fn):
    with conn() as c:
        cur = c.cursor()
        try:
            ok, detail = fn(cur)
        except Exception as e:  # noqa: BLE001
            ok, detail = False, f'исключение: {e}'.split('\n')[0]
        finally:
            c.rollback()
    results.append((ok, name, detail))
    print(('ПРОЙДЕНО ' if ok else 'ОШИБКА   ') + name + (f' — {detail}' if detail else ''))


def expect_error(cur, sql, params=(), contains=''):
    cur.execute('savepoint s')
    try:
        cur.execute(sql, params)
        rows = cur.rowcount
        cur.execute('release savepoint s')
        return False, f'запрос прошёл (строк: {rows})'
    except psycopg.Error as e:
        cur.execute('rollback to savepoint s')
        msg = (e.diag.message_primary or str(e))
        return (contains in msg), msg[:160]


def payments_with(receipt=None, receipts=None):
    rec = {'paidDate': '2026-10-01', 'paidAmount': 100}
    if receipt is not None: rec['receipt'] = receipt
    if receipts is not None: rec['receipts'] = receipts
    return json.dumps({'0': rec})


# ---------- 1. Чеки ----------
def bad_receipt(kind):
    def run(cur):
        as_user(cur, OWNER)
        variants = {
            'javascript в receipts[]': payments_with(receipts=[{'name': 'x', 'dataUrl': 'javascript:alert(1)'}]),
            'javascript в старом receipt': payments_with(receipt={'name': 'x', 'dataUrl': ' JavaScript:alert(1)'}),
            'HTML в data:': payments_with(receipts=[{'name': 'x', 'dataUrl': 'data:text/html;base64,PGI+'}]),
            'SVG в data:': payments_with(receipts=[{'name': 'x', 'dataUrl': 'data:image/svg+xml;base64,PHN2Zz4='}]),
            'путь ../': payments_with(receipts=[{'name': 'x', 'path': '../other/x.png'}]),
            'путь-ссылка': payments_with(receipts=[{'name': 'x', 'path': 'https://evil.example/x'}]),
            'dataUrl не строка': payments_with(receipts=[{'name': 'x', 'dataUrl': {'a': 1}}]),
            'receipts не массив': payments_with(receipts={'0': {'dataUrl': 'javascript:x'}}),
        }
        return expect_error(cur, 'update public.contracts set payments = %s::jsonb where id = %s', (variants[kind], 'T-2'), 'contracts_receipts_safe')
    return run


def good_receipts(cur):
    as_user(cur, OWNER)
    cur.execute('update public.contracts set payments = %s::jsonb where id = %s',
                (payments_with(receipt={'name': 'a', 'dataUrl': PNG}, receipts=[{'name': 'b', 'path': 'T-2/0-1730.jpg', 'type': 'image/jpeg'},
                                                                             {'name': 'c', 'dataUrl': 'data:application/pdf;base64,JVBERi0x\nLjQK'}]), 'T-2'))
    cur.execute("update public.contracts set payments = payments || '{\"__contacts\": [{\"id\": \"c1\", \"note\": \"звонок\"}]}' where id = 'T-2'")
    return cur.rowcount == 1, 'фото, PDF, путь в хранилище, контакты — приняты'


def bad_receipt_insert(cur):
    as_user(cur, OWNER)
    return expect_error(cur, "insert into public.contracts(id, client_name, start_date, payments) values ('N-1', 'Новый', '2026-11-01', %s::jsonb)",
                        (payments_with(receipts=[{'dataUrl': 'javascript:alert(1)'}]),), 'contracts_receipts_safe')


def bad_receipt_via_trash(cur):
    as_user(cur, OWNER)
    cur.execute("select public.trash_receipt('T-2', '0', %s::jsonb)", (json.dumps({'path': 'T-2/0-1.png', 'dataUrl': 'javascript:alert(1)'}),))
    item = cur.fetchone()[0]
    return expect_error(cur, 'select public.restore_trash_item(%s)', (item,), 'contracts_receipts_safe')


# ---------- 2. Версия строки ----------
def version_changes(cur):
    as_user(cur, OWNER)
    cur.execute("select updated_at from public.contracts where id = 'T-2'"); v1 = cur.fetchone()[0]
    cur.execute("update public.contracts set comment = 'перезвонить' where id = 'T-2' returning updated_at"); v2 = cur.fetchone()[0]
    cur.execute("update public.contracts set comment = 'перезвонить' where id = 'T-2' returning updated_at"); v3 = cur.fetchone()[0]
    cur.execute("update public.contracts set updated_at = '2000-01-01' where id = 'T-2' returning updated_at"); v4 = cur.fetchone()[0]
    ok = v2 > v1 and v3 == v2 and v4 == v2
    return ok, f'изменение сдвигает версию: {v2 > v1}; пустое изменение — нет: {v3 == v2}; присланная версия игнорируется: {v4 == v2}'


def stale_write_rejected(cur):
    # Два устройства прочли одну версию; второе пишет после первого с условием на версию.
    as_user(cur, OWNER)
    cur.execute("select updated_at, payments from public.contracts where id = 'T-2'"); seen, pay = cur.fetchone()
    pay_a = dict(pay); pay_a['0'] = {'paidDate': '2026-10-01', 'paymentEvents': [{'date': '2026-10-01', 'amount': 12000}]}
    pay_b = dict(pay); pay_b['1'] = {'paidDate': '2026-11-01', 'paymentEvents': [{'date': '2026-11-01', 'amount': 12000}]}
    cur.execute("update public.contracts set payments = %s where id = 'T-2' and updated_at = %s", (json.dumps(pay_a), seen)); first = cur.rowcount
    cur.execute("update public.contracts set payments = %s where id = 'T-2' and updated_at = %s", (json.dumps(pay_b), seen)); second = cur.rowcount
    cur.execute("select payments ? '0', payments ? '1' from public.contracts where id = 'T-2'"); kept = cur.fetchone()
    return first == 1 and second == 0 and kept == (True, False), f'первое устройство: {first} строка, второе (устаревшая версия): {second}; платёж первого сохранён: {kept[0]}'


def all_tables_versioned(cur):
    as_user(cur, OWNER)
    cur.execute("insert into public.investors(id, name) values ('I-1', 'Вкладчик') returning updated_at"); a = cur.fetchone()[0]
    cur.execute("insert into public.withdrawals(id, amount, date) values ('W-1', 100, '2026-11-01') returning updated_at"); b = cur.fetchone()[0]
    return a is not None and b is not None, 'investors и withdrawals тоже получают версию'


# ---------- 3. Журнал ----------
def log_failure_blocks_change(cur):
    as_admin(cur)
    # Имитируем отказ журнала (например, переполнение или сбой): запрещаем запись в action_log.
    cur.execute("alter table public.action_log add constraint test_fail check (action_type <> 'update')")
    as_user(cur, OWNER)
    ok, msg = expect_error(cur, "update public.contracts set comment = 'без следа' where id = 'T-2'", (), 'журнал')
    as_admin(cur)
    cur.execute("select comment from public.contracts where id = 'T-2'"); comment = cur.fetchone()[0]
    return ok and comment != 'без следа', f'{msg} | комментарий в базе: «{comment}»'


def payment_update_kind(cur):
    as_user(cur, OWNER)
    cur.execute("update public.contracts set payments = payments || '{\"3\": {\"paidDate\": \"2026-11-01\"}}' where id = 'T-2'")
    as_admin(cur)
    cur.execute("select action_type, entity_type, before_json ? 'updated_at', after_json ? 'updated_at' from public.action_log order by id desc limit 1")
    row = cur.fetchone()
    return row == ('update_payment', 'payments', False, False), f'запись журнала: {row}'


def restore_backup_per_row(cur):
    as_user(cur, OWNER)
    cur.execute('select public.create_backup(%s)', ('тест',)); backup = cur.fetchone()[0]
    cur.execute("update public.contracts set total_price = 99999 where id = 'T-2'")
    cur.execute("insert into public.contracts(id, client_name, start_date) values ('N-2', 'Появился после копии', '2026-11-01')")
    as_admin(cur); cur.execute('select max(id) from public.action_log'); start = cur.fetchone()[0]
    as_user(cur, OWNER)
    cur.execute('select public.restore_backup(%s)', (backup,))
    as_admin(cur)
    cur.execute('select action_type, entity_id, source from public.action_log where id > %s order by id', (start,))
    rows = cur.fetchall()
    per_row = [(a, e) for a, e, s in rows if s.startswith('Восстановление копии')]
    cur.execute("select total_price from public.contracts where id = 'T-2'"); price = cur.fetchone()[0]
    want = {('update', 'T-2'), ('move_to_trash', 'N-2'), ('restore_backup', str(backup))}
    got = {(a, e) for a, e in per_row} | {(a, e) for a, e, s in rows if a == 'restore_backup'}
    return want <= got and price == 90000, f'записи: {per_row}; цена восстановлена: {price}'


def restore_backup_expenses(cur):
    """Расходы (008/009): копия с расходами восстанавливается, расход после копии уходит в корзину."""
    as_user(cur, OWNER)
    cur.execute("insert into public.expenses(id, date, amount, category, note) values ('E-1', '2026-11-05', 15000, 'Аренда', 'Аренда за ноябрь')")
    cur.execute('select public.create_backup(%s)', ('тест расходов',)); backup = cur.fetchone()[0]
    cur.execute("update public.expenses set amount = 1 where id = 'E-1'")
    cur.execute("insert into public.expenses(id, date, amount, category) values ('E-2', '2026-11-06', 500, 'Прочее')")
    as_admin(cur); cur.execute('select max(id) from public.action_log'); start = cur.fetchone()[0]
    as_user(cur, OWNER)
    cur.execute('select public.restore_backup(%s)', (backup,))
    as_admin(cur)
    cur.execute('select id, amount, period from public.expenses order by id'); now = cur.fetchall()
    cur.execute("select count(*) from public.trash_items where entity_type = 'expenses' and entity_id = 'E-2'"); trashed = cur.fetchone()[0]
    cur.execute("select action_type, entity_id from public.action_log where id > %s and source like 'Восстановление копии%%' order by id", (start,))
    rows = set(cur.fetchall())
    ok = [(i, int(a), str(p)) for i, a, p in now] == [('E-1', 15000, '2026-11-01')] and trashed == 1 \
        and {('update', 'E-1'), ('move_to_trash', 'E-2')} <= rows
    return ok, f'расходы после восстановления: {[(i, int(a)) for i, a, p in now]}; E-2 в корзине: {trashed == 1}; журнал: {sorted(rows)}'


def restore_old_backup_keeps_expenses(cur):
    """Старая копия (без расходов) расходы не трогает."""
    as_user(cur, OWNER)
    cur.execute('select public.create_backup(%s)', ('старая',)); backup = cur.fetchone()[0]
    as_admin(cur); cur.execute("update public.backups set data = data - 'expenses' where id = %s", (backup,))
    as_user(cur, OWNER)
    cur.execute("insert into public.expenses(id, date, amount, category) values ('E-3', '2026-11-07', 700, 'Прочее')")
    cur.execute('select public.restore_backup(%s)', (backup,))
    cur.execute("select count(*) from public.expenses where id = 'E-3'"); kept = cur.fetchone()[0]
    return kept == 1, f'расход сохранён: {kept == 1}'


def restore_expense_from_trash(cur):
    as_user(cur, OWNER)
    cur.execute("insert into public.expenses(id, date, amount, category, note) values ('E-4', '2026-11-08', 900, 'Реклама', 'Листовки')")
    cur.execute("delete from public.expenses where id = 'E-4'")
    as_admin(cur); cur.execute("select id from public.trash_items where entity_id = 'E-4'"); item = cur.fetchone()[0]
    cur.execute('select max(id) from public.action_log'); start = cur.fetchone()[0]
    as_user(cur, OWNER)
    cur.execute('select public.restore_trash_item(%s)', (item,))
    as_admin(cur)
    cur.execute('select action_type, entity_type, entity_id, source from public.action_log where id > %s order by id', (start,))
    rows = cur.fetchall()
    cur.execute("select amount from public.expenses where id = 'E-4'"); back = cur.fetchone()
    return rows == [('restore', 'expenses', 'E-4', 'Корзина')] and back and int(back[0]) == 900, f'записи: {rows}'


def restore_trash_per_row(cur):
    as_user(cur, OWNER)
    cur.execute("delete from public.contracts where id = 'T-2'")
    as_admin(cur); cur.execute("select id from public.trash_items where entity_id = 'T-2'"); item = cur.fetchone()[0]
    cur.execute('select max(id) from public.action_log'); start = cur.fetchone()[0]
    as_user(cur, OWNER)
    cur.execute('select public.restore_trash_item(%s)', (item,))
    as_admin(cur)
    cur.execute("select action_type, entity_id, source, after_json ->> 'client_name' from public.action_log where id > %s order by id", (start,))
    rows = cur.fetchall()
    return rows == [('restore', 'T-2', 'Корзина', 'Тестовый Клиент Два')], f'записи: {rows}'


def restore_receipt_logged(cur):
    as_user(cur, OWNER)
    cur.execute("select public.trash_receipt('T-2', '0', %s::jsonb)", (json.dumps({'name': 'чек.jpg', 'path': 'T-2/0-1.jpg'}),)); item = cur.fetchone()[0]
    as_admin(cur); cur.execute('select max(id) from public.action_log'); start = cur.fetchone()[0]
    as_user(cur, OWNER); cur.execute('select public.restore_trash_item(%s)', (item,))
    as_admin(cur); cur.execute('select action_type, entity_type, source from public.action_log where id > %s', (start,))
    rows = cur.fetchall()
    return rows == [('restore_receipt', 'receipts', 'Корзина')], f'записи: {rows}'


# ---------- 4. Операторы ----------
def set_operator_no_leak(cur):
    as_user(cur, OWNER)
    ok1, m1 = expect_error(cur, "select public.set_operator('free@test.local', 'Новый', true)", (), 'Такого оператора нет')
    ok2, m2 = expect_error(cur, "select public.set_operator('nobody@test.local', 'Новый', true)", (), 'Такого оператора нет')
    as_admin(cur); cur.execute(f"select count(*) from public.app_members where user_id = '{FREE}'"); n = cur.fetchone()[0]
    return ok1 and ok2 and m1 == m2 and n == 0, f'зарегистрированная и несуществующая почта дают одинаковый ответ: {m1 == m2}; свободную учётку забрать нельзя: {n == 0}'


def set_operator_existing(cur):
    as_user(cur, OWNER)
    cur.execute("select public.set_operator('operator@test.local', 'Оператор A', false)")
    as_admin(cur); cur.execute(f"select active from public.app_members where user_id = '{OPER}'")
    return cur.fetchone()[0] is False, 'принятого оператора по-прежнему можно отключить'


def invite_flow(cur):
    as_user(cur, OWNER)
    cur.execute("select public.invite_operator('Free@Test.local ', 'Мадина')"); inv = cur.fetchone()[0]
    code = inv['code']
    # Чужая учётная запись не может принять приглашение, даже зная ссылку.
    as_user(cur, OWNER_D); wrong = expect_error(cur, 'select public.accept_operator_invite(%s)', (code,), 'недействительно')
    # Владелец почты без подтверждения почты — отказ.
    as_admin(cur); cur.execute(f"update auth.users set email_confirmed_at = null where id = '{FREE}'")
    as_user(cur, FREE); unconfirmed = expect_error(cur, 'select public.accept_operator_invite(%s)', (code,), 'не подтверждена')
    as_admin(cur); cur.execute(f"update auth.users set email_confirmed_at = now() where id = '{FREE}'")
    as_user(cur, FREE); cur.execute('select public.accept_operator_invite(%s)', (code,))
    as_admin(cur); cur.execute(f"select role, owner_id::text, active, display_name from public.app_members where user_id = '{FREE}'"); member = cur.fetchone()
    as_user(cur, FREE); reuse = expect_error(cur, 'select public.accept_operator_invite(%s)', (code,), 'недействительно')
    guess = expect_error(cur, 'select public.accept_operator_invite(%s)', ('0' * 64,), 'недействительно')
    ok = wrong[0] and unconfirmed[0] and member == ('operator', OWNER, True, 'Мадина') and reuse[0] and guess[0]
    return ok, f'чужой — отказ: {wrong[0]}; без подтверждения — отказ: {unconfirmed[0]}; принял сам — {member}; повтор — отказ: {reuse[0]}'


def invite_revoke_expire(cur):
    as_user(cur, OWNER)
    cur.execute("select public.invite_operator('free@test.local', '')"); first = cur.fetchone()[0]
    cur.execute("select public.invite_operator('free@test.local', '')"); second = cur.fetchone()[0]
    as_user(cur, FREE); old = expect_error(cur, 'select public.accept_operator_invite(%s)', (first['code'],), 'недействительно')
    as_user(cur, OWNER); cur.execute('select public.revoke_operator_invite(%s)', (second['id'],))
    as_user(cur, FREE); revoked = expect_error(cur, 'select public.accept_operator_invite(%s)', (second['code'],), 'недействительно')
    as_user(cur, OWNER); cur.execute("select public.invite_operator('free@test.local', '')"); third = cur.fetchone()[0]
    as_admin(cur); cur.execute("update public.operator_invites set expires_at = now() - interval '1 minute' where id = %s", (third['id'],))
    as_user(cur, FREE); expired = expect_error(cur, 'select public.accept_operator_invite(%s)', (third['code'],), 'недействительно')
    return old[0] and revoked[0] and expired[0], f'старое после нового — отказ: {old[0]}; отозванное — отказ: {revoked[0]}; просроченное — отказ: {expired[0]}'


def invite_other_workspace(cur):
    as_user(cur, OWNER_D)
    cur.execute("select public.invite_operator('operator@test.local', '')"); code = cur.fetchone()[0]['code']
    as_user(cur, OPER)
    return expect_error(cur, 'select public.accept_operator_invite(%s)', (code,), 'другом кабинете')


def invite_permissions(cur):
    as_user(cur, OPER)
    a = expect_error(cur, "select public.invite_operator('x@test.local', '')", (), 'Access denied')
    as_user(cur, None)
    b = expect_error(cur, "select public.accept_operator_invite('x')", (), 'permission denied')
    as_user(cur, OWNER)
    c = expect_error(cur, 'select code_hash from public.operator_invites', (), 'permission denied')
    d = expect_error(cur, "insert into public.operator_invites(owner_id, email, code_hash) values (%s, 'x@test.local', 'h')", (OWNER,), 'permission denied')
    as_user(cur, OWNER_D); cur.execute("select public.invite_operator('someone@test.local', '')")
    as_user(cur, OWNER); cur.execute('select count(*) from public.operator_invites'); seen = cur.fetchone()[0]
    ok = a[0] and b[0] and c[0] and d[0] and seen == 0
    return ok, f'оператор не приглашает: {a[0]}; гость не вызывает: {b[0]}; отпечаток кода не читается: {c[0]}; вставка напрямую запрещена: {d[0]}; чужие приглашения не видны: {seen == 0}'


# ---------- Прежние права не сломаны ----------
def rls_unchanged(cur):
    as_user(cur, OPER); cur.execute('select count(*) from public.contracts'); op = cur.fetchone()[0]
    cur.execute("update public.contracts set comment='x' where id='T-2'"); op_upd = cur.rowcount
    as_user(cur, OWNER_D); cur.execute("select count(*) from public.contracts where id like 'T-%'"); other = cur.fetchone()[0]
    as_user(cur, OWNER); cur.execute('select count(*) from public.contracts'); own = cur.fetchone()[0]
    a = expect_error(cur, "insert into public.action_log(action_type, entity_type) values ('x','y')", (), 'permission denied')
    return op == 0 and op_upd == 0 and other == 0 and own == 2 and a[0], f'оператор видит договоров: {op}; чужой владелец: {other}; свой: {own}; запись в журнал напрямую запрещена: {a[0]}'


TESTS = [
    ('1. Чек javascript: в receipts[] отклонён базой', bad_receipt('javascript в receipts[]')),
    ('1. Чек javascript: в старом поле receipt отклонён', bad_receipt('javascript в старом receipt')),
    ('1. HTML под видом чека отклонён', bad_receipt('HTML в data:')),
    ('1. SVG под видом чека отклонён', bad_receipt('SVG в data:')),
    ('1. Путь «../» отклонён', bad_receipt('путь ../')),
    ('1. Путь-ссылка отклонён', bad_receipt('путь-ссылка')),
    ('1. dataUrl не строкой отклонён', bad_receipt('dataUrl не строка')),
    ('1. receipts не массивом отклонён', bad_receipt('receipts не массив')),
    ('1. Настоящие чеки принимаются', good_receipts),
    ('1. Подложный чек в новом договоре отклонён', bad_receipt_insert),
    ('1. Подложный чек не вернуть через корзину', bad_receipt_via_trash),
    ('2. updated_at ставит база', version_changes),
    ('2. Запись по устаревшей версии не проходит', stale_write_rejected),
    ('2. Вкладчики и выводы тоже с версией', all_tables_versioned),
    ('3а. Сбой журнала отменяет изменение', log_failure_blocks_change),
    ('3. Изменение платежа по-прежнему «Изменение платежа», без updated_at', payment_update_kind),
    ('3б. Восстановление копии — запись по каждой строке', restore_backup_per_row),
    ('3б. Восстановление копии с расходами', restore_backup_expenses),
    ('3б. Старая копия без расходов расходы не трогает', restore_old_backup_keeps_expenses),
    ('3б. Восстановление расхода из корзины', restore_expense_from_trash),
    ('3б. Восстановление из корзины — запись по строке', restore_trash_per_row),
    ('3б. Восстановление чека из корзины в журнале', restore_receipt_logged),
    ('4. set_operator не выдаёт почту и не забирает учётку', set_operator_no_leak),
    ('4. set_operator управляет принятыми операторами', set_operator_existing),
    ('4. Приглашение принимает только владелец почты', invite_flow),
    ('4. Старое, отозванное, просроченное приглашение не работает', invite_revoke_expire),
    ('4. Нельзя переманить оператора другого кабинета', invite_other_workspace),
    ('4. Права на приглашения', invite_permissions),
    ('Права RLS прежние', rls_unchanged),
]

if __name__ == '__main__':
    only = sys.argv[2:] or None
    for name, fn in TESTS:
        if only and not any(name.startswith(o) for o in only): continue
        check(name, fn)
    failed = [r for r in results if not r[0]]
    print(f'\nИтого: {len(results) - len(failed)} из {len(results)} пройдено')
    sys.exit(1 if failed else 0)
