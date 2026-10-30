import { checkedWrite, equal, syncTables } from './syncModel';
let pending = 0;
const conflictMessage = 'Запись уже изменена на другом устройстве. Обновите данные и повторите действие.';

// Three-way merge of a partial update onto the current database row. Returns
// null when this tab and the other device changed the same field (or the same
// key inside payments), otherwise the update to apply on top of `current`.
export function mergeUpdate(before, value, current) {
  const merged = {};
  for (const [key, next] of Object.entries(value)) {
    const base = before[key], now = current[key];
    if (equal(now, base) || equal(now, next)) { merged[key] = next; continue; }
    const isMap = v => v && typeof v === 'object' && !Array.isArray(v);
    if (key !== 'payments' || !isMap(base) || !isMap(next) || !isMap(now)) return null;
    const out = { ...now };
    for (const k of new Set([...Object.keys(base), ...Object.keys(next)])) {
      if (equal(base[k], next[k])) continue;
      if (!equal(now[k], base[k]) && !equal(now[k], next[k])) return null;
      if (next[k] === undefined) delete out[k]; else out[k] = next[k];
    }
    merged[key] = out;
  }
  return merged;
}
export const cloudWritePending = () => pending > 0;

// Each loaded row is the version the user actually saw in this browser tab.
// Refuse a stale edit even when it would otherwise be accepted by RLS.
export function guardedCloudClient(client) {
  if (!client) return null;
  const rows = new Map();
  const queues = new Map();
  // Writes to one row run one after another, so a double click or two quick
  // actions are compared against the version the previous write produced.
  function serial(key, task) {
    const run = (queues.get(key) || Promise.resolve()).then(task, task);
    const tail = run.catch(() => {});
    queues.set(key, tail);
    tail.then(() => { if (queues.get(key) === tail) queues.delete(key); });
    return run;
  }
  async function write(table, id, value) {
    const key = `${table}:${id}`;
    const before = rows.get(key);
    let row;
    try { row = await checkedWrite(client, table, id, before, value); }
    catch (error) {
      if (error.message !== conflictMessage || !value) throw error;
      const { data, error: readError } = await client.from(table).select('*').eq('id', id);
      if (readError || data?.length !== 1) throw error;
      const current = data[0];
      const merged = mergeUpdate(before, value, current);
      if (!merged) throw error;
      row = Object.entries(merged).every(([k, v]) => equal(current[k], v)) ? current : await checkedWrite(client, table, id, current, merged);
      // The page still shows the old version of the other device's changes;
      // keep comparing against what it saw so they are merged, not overwritten.
      rows.set(key, structuredClone({ ...before, ...value }));
      return row;
    }
    rows.set(key, structuredClone(row));
    return row;
  }
  client.auth.onAuthStateChange(event => {
    if (event === 'SIGNED_OUT') rows.clear();
  });
  function remember(table, result) {
    if (!result.error && Array.isArray(result.data)) for (const row of result.data) rows.set(`${table}:${row.id}`, structuredClone(row));
    return result;
  }
  const wrapRead = (query, table) => new Proxy(query, {
    get(target, key) {
      if (key === 'then') return (resolve, reject) => Promise.resolve(target).then(result => remember(table, result)).then(resolve, reject);
      const value = target[key];
      return typeof value === 'function' ? (...args) => wrapRead(value.apply(target, args), table) : value;
    },
  });
  return {
    auth: client.auth, storage: client.storage,
    from(table) {
      if (!syncTables.includes(table)) return client.from(table);
      return {
        select(...args) { return wrapRead(client.from(table).select(...args), table); },
        insert(value) {
          pending++;
          return Promise.resolve(client.from(table).insert(value).select('*')).then(result => remember(table, result)).finally(() => { pending--; });
        },
        update(value) { return mutation(value); },
        delete() { return mutation(null); },
      };
      function mutation(value) {
        let ids = [], invalid = false;
        const query = {
          eq(column, id) { invalid ||= column !== 'id'; ids = [id]; return query; },
          in(column, values) { invalid ||= column !== 'id'; ids = [...new Set(values)]; return query; },
          select() { return query; },
          then(resolve, reject) {
            return (async () => {
              pending++;
              const saved = [];
              try {
                if (invalid || !ids.length) throw new Error('Укажите номера записей для изменения.');
                for (const id of ids) if (!rows.has(`${table}:${id}`)) throw new Error('Сначала обновите данные страницы.');
                for (const id of ids) {
                  const row = await serial(`${table}:${id}`, async () => {
                    if (!rows.has(`${table}:${id}`)) throw new Error('Сначала обновите данные страницы.');
                    if (value) return write(table, id, value);
                    const deleted = await checkedWrite(client, table, id, rows.get(`${table}:${id}`), null);
                    rows.delete(`${table}:${id}`);
                    return deleted;
                  });
                  saved.push(row);
                }
                return { data: saved, error: null };
              } catch (error) { return { data: saved, error: { message: `${error.message}${saved.length ? ` Уже сохранено записей: ${saved.length}. Обновите страницу и проверьте остальные.` : ''}` } }; }
              finally { pending--; }
            })().then(resolve, reject);
          },
        };
        return query;
      }
    },
  };
}
