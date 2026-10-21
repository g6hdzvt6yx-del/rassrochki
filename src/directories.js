import { normalizePhone, formatPhone } from './phone';
const normalized = value => String(value || '').trim().toLocaleLowerCase('ru');
export function directoryClients(contracts) {
 const groups = new Map();
 for (const c of contracts) {
  const key = normalizePhone(c.phone) || `name:${normalized(c.clientName)}`;
  if (!groups.has(key)) groups.set(key, {key, name:c.clientName, phone:c.phone || '', contracts:[]});
  groups.get(key).contracts.push(c);
 }
 return [...groups.values()].sort((a,b)=>a.name.localeCompare(b.name,'ru'));
}
export function directoryProducts(contracts) {
 const groups = new Map();
 for (const c of contracts) {
  const name = String(c.item || '').trim();
  if (!name) continue;
  const key = normalized(name);
  if (!groups.has(key)) groups.set(key,{key,name,contracts:[]});
  groups.get(key).contracts.push(c);
 }
 return [...groups.values()].sort((a,b)=>a.name.localeCompare(b.name,'ru'));
}
export async function saveDirectoryClient(db, ids, values) {
 const name = values.name.trim(), phone = values.phone.trim();
 if (!name) throw new Error('Укажите ФИО клиента.');
 if (phone && !normalizePhone(phone)) throw new Error('Укажите корректный российский номер телефона или оставьте поле пустым.');
 if (!ids.length) throw new Error('Договоры клиента не найдены. Обновите страницу.');
 const patch = {client_name:name, phone:formatPhone(phone)};
 const {data,error} = await db.from('contracts').update(patch).in('id',ids).select('id');
 if (error) throw new Error(error.message || 'Не удалось сохранить данные клиента. Обновите страницу.');
 if (!data || data.length !== ids.length) throw new Error('Не все договоры доступны для изменения. Обновите страницу и проверьте данные.');
 return {clientName:patch.client_name,phone:patch.phone};
}
