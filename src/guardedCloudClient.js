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
        return {
          eq(column, id) {
            return (async () => {
              pending++;
              try {
                if (column !== 'id') throw new Error('Изменение поддерживается только по номеру записи.');
                const before = rows.get(`${table}:${id}`);
                if (!before) throw new Error('Сначала обновите данные страницы.');
                const row = await checkedWrite(client, table, id, before, value);
                if (value) rows.set(`${table}:${id}`, structuredClone(row));
                else rows.delete(`${table}:${id}`);
                return { data: row, error: null };
              } catch (error) { return { data: null, error: { message: error.message } }; }
              finally { pending--; }
            })();
          },
        };
      }
    },
  };
}
