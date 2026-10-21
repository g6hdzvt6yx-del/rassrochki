import { checkedWrite, syncTables } from './syncModel';
let pending = 0;
export const cloudWritePending = () => pending > 0;

// Each loaded row is the version the user actually saw in this browser tab.
// Refuse a stale edit even when it would otherwise be accepted by RLS.
export function guardedCloudClient(client) {
  if (!client) return null;
  const rows = new Map();
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
                  const before = rows.get(`${table}:${id}`);
                  const row = await checkedWrite(client, table, id, before, value);
                  if (value) rows.set(`${table}:${id}`, structuredClone(row));
                  else rows.delete(`${table}:${id}`);
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
