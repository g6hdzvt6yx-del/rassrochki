import { describe, it, expect } from 'vitest';
import { guardedCloudClient, cloudWritePending } from './guardedCloudClient';
function fixture() {
  let rows = [{ id: 'c', payments: { 0: { paidAmount: 10 } }, comment: '', user_id: 'owner' }];
  const client = {
    auth: { onAuthStateChange() {} }, storage: {},
    from() {
      let filters = [], action = 'read', payload;
      const query = {
        select() { return query; }, order() { return query; },
        eq(k,v) { filters.push([k,v]); return query; },
        is(k,v) { filters.push([k,v]); return query; },
        update(v) { action = 'update'; payload = v; return query; },
        delete() { action = 'delete'; return query; },
        insert(v) { action = 'insert'; payload = v; return query; },
        then(resolve,reject) {
          return Promise.resolve().then(() => {
            let found = rows.filter(r => filters.every(([k,v]) => (r[k] && typeof r[k] === 'object' ? JSON.stringify(r[k]) : r[k]) === v));
            if (action === 'update') found.forEach(r => Object.assign(r,payload));
            if (action === 'delete') rows = rows.filter(r => !found.includes(r));
            if (action === 'insert') { found = [payload]; rows.push(payload); }
            return { data: structuredClone(found), error: null };
          }).then(resolve,reject);
        },
      }; return query;
    },
  };
  return { client: guardedCloudClient(client), remote: () => rows };
}
describe('защита редактирования сайта', () => {
  it('поддерживает сохранение справочника через in и select', async () => {
    const f = fixture();
    f.remote().push({ ...structuredClone(f.remote()[0]), id: 'd' });
    await f.client.from('contracts').select('*');
    const result = await f.client.from('contracts').update({ client_name: 'Новое имя' }).in('id', ['c', 'd']).select('id');
    expect(result.error).toBeNull(); expect(result.data).toHaveLength(2);
    expect(f.remote().every(r => r.client_name === 'Новое имя')).toBe(true);
  });
  it('не перезаписывает платёж, изменённый на Mac после открытия страницы', async () => {
    const f = fixture();
    await f.client.from('contracts').select('*').order('id');
    f.remote()[0].payments[0].paidAmount = 90;
    const result = await f.client.from('contracts').update({ payments: { 0: { paidAmount: 20 } } }).eq('id','c');
    expect(result.error.message).toContain('другом устройстве');
    expect(f.remote()[0].payments[0].paidAmount).toBe(90);
    expect(cloudWritePending()).toBe(false);
  });
  it('обновляет базу сравнения после успешного сохранения', async () => {
    const f = fixture();
    await f.client.from('contracts').select('*');
    expect((await f.client.from('contracts').update({ comment: 'one' }).eq('id','c')).error).toBeNull();
    expect((await f.client.from('contracts').update({ comment: 'two' }).eq('id','c')).error).toBeNull();
    expect(f.remote()[0].comment).toBe('two');
  });
  it('отклоняет удаление изменённой записи', async () => {
    const f = fixture();
    await f.client.from('contracts').select('*');
    f.remote()[0].comment = 'new';
    expect((await f.client.from('contracts').delete().eq('id','c')).error).toBeTruthy();
    expect(f.remote()).toHaveLength(1);
  });
});
