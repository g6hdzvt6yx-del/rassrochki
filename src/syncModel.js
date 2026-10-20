// Three-way comparison. A missing baseline is deliberately different from a
// baseline containing null (a deletion already observed by both devices).
export const syncTables = ['investors', 'contracts', 'withdrawals'];
export const syncFields = {
  investors: ['id', 'name', 'amount', 'monthly_payment', 'accrual_start_date'],
  contracts: ['id', 'client_name', 'phone', 'item', 'total_price', 'down_payment', 'markup', 'markup_percent', 'term_months', 'start_date', 'investor_id', 'payments', 'comment', 'guarantor_name', 'guarantor_phone'],
  withdrawals: ['id', 'amount', 'date', 'investor_id', 'purpose', 'note'],
};
export function stable(value) {
  if (Array.isArray(value)) return JSON.stringify(value.map(v => JSON.parse(stable(v))));
  if (value && typeof value === 'object') return JSON.stringify(Object.fromEntries(Object.keys(value).sort().filter(k => value[k] !== undefined).map(k => [k, JSON.parse(stable(value[k]))])));
  return JSON.stringify(value ?? null);
}
export function syncRow(table, row) {
  if (!row) return null;
  const numbers = new Set(['amount', 'monthly_payment', 'total_price', 'down_payment', 'markup', 'markup_percent', 'term_months']);
  return Object.fromEntries(syncFields[table].map(key => {
    let value = row[key];
    if (key === 'monthly_payment') value ??= row.monthlyPayment;
    if (key === 'accrual_start_date') value ??= row.accrualStartDate;
    if (numbers.has(key)) {
      value = Number(value ?? 0);
      if (!Number.isFinite(value)) throw new Error('Некорректная сумма в записи ' + row.id);
    } else if (key === 'payments') value ??= {};
    else if (key === 'accrual_start_date') value ||= null;
    else value ??= '';
    return [key, value];
  }));
}
export const equal = (a, b) => stable(a) === stable(b);
export function syncDecision(local, remote, base, known) {
  if (equal(local, remote)) return 'same';
  if (!known) return local && remote ? 'conflict' : local ? 'push' : 'pull';
  if (equal(local, base)) return 'pull';
  if (equal(remote, base)) return 'push';
  return 'conflict';
}
export function identity(table, row) {
  if (!row) return '';
  const fields = table === 'investors' ? ['name'] : table === 'contracts' ? ['client_name', 'item', 'start_date'] : ['date', 'amount', 'investor_id', 'purpose', 'note'];
  return stable(fields.map(k => String(row[k] ?? '').trim().toLocaleLowerCase('ru').replace(/\s+/g, ' ')));
}
export function planSync(local, remote, bases) {
  const plan = [];
  for (const table of syncTables) {
    const l = new Map(local[table].map(r => [r.id, syncRow(table, r.deleted_at ? null : r.data)]));
    const r = new Map(remote[table].map(row => [row.id, syncRow(table, row)]));
    const raw = new Map(remote[table].map(row => [row.id, row]));
    const baseline = bases[table] || {};
    for (const id of new Set([...l.keys(), ...r.keys(), ...Object.keys(baseline)])) {
      const left = l.get(id) || null, right = r.get(id) || null;
      const known = Object.hasOwn(baseline, id);
      let action = syncDecision(left, right, baseline[id], known);
      let problem = '';
      if (!known && !left && right && l.has(id)) {
        action = 'conflict'; problem = 'На Mac запись в корзине, на сайте она действующая.';
      }
      // Never silently duplicate records imported earlier with different IDs.
      if (!known && ((left && !right) || (right && !left))) {
        const other = left ? r : l, row = left || right;
        const matches = [...other].filter(([otherId, otherRow]) => otherId !== id && otherRow && identity(table, otherRow) === identity(table, row));
        if (matches.length) {
          action = 'blocked';
          problem = 'Похожая запись имеет другой ID. Нужна сверка перед объединением: ' + matches.map(([key]) => key).join(', ');
        }
      }
      plan.push({ table, id, local: left, remote: right, before: raw.get(id) || null, action, problem });
    }
  }
  return plan;
}

// PostgreSQL rechecks these predicates while taking the row lock. Include every
// originally read column, including JSON, rather than trusting a timestamp.
export async function checkedWrite(client, table, id, before, next) {
  if (!syncTables.includes(table)) throw new Error('Недопустимая таблица');
  let query;
  if (!before) {
    if (!next) return;
    query = client.from(table).insert(next);
  } else {
    query = next ? client.from(table).update(next) : client.from(table).delete();
    query = query.eq('id', id);
    for (const [key, value] of Object.entries(before)) {
      if (key === 'id') continue;
      query = value == null ? query.is(key, null) : query.eq(key, typeof value === 'object' ? JSON.stringify(value) : value);
    }
  }
  const { data, error } = await query.select('*');
  if (error) throw new Error(error.message);
  if (data?.length !== 1) throw new Error('Запись уже изменена на другом устройстве. Обновите данные и повторите действие.');
  return data[0];
}
