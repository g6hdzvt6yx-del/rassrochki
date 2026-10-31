import { describe, it, expect } from 'vitest';
import { marksByContract, markAuthors, matchesMarkFilter, markCategory, contactResult, toggleMarkStatus, LEGACY_ADMIN_AUTHOR } from './operatorMarks';

const contract = (id, contacts) => ({ id, clientName: id, payments: contacts ? { 0: { paidDate: '2026-10-01' }, __contacts: contacts } : {} });
const people = { op1: 'Аминат', op2: 'Ислам', owner: 'Владелец' };
const logs = [
  { id: '1', contract_id: 'a', actor_id: 'op1', result: 'no_answer', note: '', created_at: '2026-10-20T10:00:00Z' },
  { id: '2', contract_id: 'a', actor_id: 'op2', result: 'promised', note: 'Оплатит в пятницу', created_at: '2026-10-25T10:00:00Z', promised_date: '2026-10-31', promised_amount: 5000 },
  { id: '3', contract_id: 'b', actor_id: 'op1', result: 'refused', note: 'Отказывается платить', created_at: '2026-10-24T09:00:00Z' },
  { id: '4', contract_id: 'c', actor_id: 'op2', result: 'wrong_number', note: '', created_at: '2026-10-23T09:00:00Z' },
  { id: '5', contract_id: 'gone', actor_id: 'op2', result: 'promised', created_at: '2026-10-23T09:00:00Z' },
];
const contracts = [
  contract('a'), contract('b'), contract('c'), contract('none'),
  contract('d', [
    { id: 'old', type: 'call', occurredAt: '2026-10-01T09:00:00Z', note: 'Старая запись', nextContactDate: '2026-10-05' },
    { id: 'new', type: 'whatsapp', occurredAt: '2026-10-26T09:00:00Z', note: 'Не отвечает', result: 'no_answer', authorId: 'owner', authorName: 'Владелец' },
  ]),
];
const map = marksByContract(contracts, logs, people);
const ids = (filter) => contracts.filter((c) => matchesMarkFilter(map[c.id], filter)).map((c) => c.id);

describe('отметки оператора', () => {
  it('собирает историю без потерь: все отметки, новые сверху, с автором и временем', () => {
    expect(map.a.map((m) => m.id)).toEqual(['operator:2', 'operator:1']);
    expect(map.a[0]).toMatchObject({ authorName: 'Ислам', at: '2026-10-25T10:00:00Z', result: 'promised', promisedAmount: 5000 });
    expect(map.d.map((m) => m.id)).toEqual(['new', 'old']);
    expect(map.d[1]).toMatchObject({ authorKey: LEGACY_ADMIN_AUTHOR, authorName: 'Администратор', result: 'callback' });
    expect(map.none).toEqual([]);
    expect(map.gone).toBeUndefined();
  });
  it('не меняет данные договоров', () => {
    expect(contracts[4].payments.__contacts).toHaveLength(2);
    expect(contracts[4].payments[0]).toEqual({ paidDate: '2026-10-01' });
    expect(contracts[4].payments.__contacts[0].authorKey).toBeUndefined();
  });
  it('относит статусы к вариантам фильтра', () => {
    expect(['promised', 'no_answer', 'callback', 'refused', 'informed', 'help', ''].map(markCategory))
      .toEqual(['promised', 'no_answer', 'callback', 'refused', 'other', 'other', 'other']);
    expect(contactResult({ promisedAmount: 100 })).toBe('promised');
    expect(contactResult({ result: 'refused', promisedAmount: 100 })).toBe('refused');
    expect(contactResult({ note: 'просто запись' })).toBe('');
  });
  it('«Все», «Есть отметки», «Нет отметок» и отдельные статусы по последней отметке', () => {
    expect(ids({})).toEqual(['a', 'b', 'c', 'none', 'd']);
    expect(ids({ statuses: ['has'] })).toEqual(['a', 'b', 'c', 'd']);
    expect(ids({ statuses: ['none'] })).toEqual(['none']);
    expect(ids({ statuses: ['promised'] })).toEqual(['a']);
    expect(ids({ statuses: ['no_answer'] })).toEqual(['d']);
    expect(ids({ statuses: ['refused'] })).toEqual(['b']);
    expect(ids({ statuses: ['callback'] })).toEqual([]);
    expect(ids({ statuses: ['other'] })).toEqual(['c']);
  });
  it('несколько статусов одновременно объединяются', () => {
    expect(ids({ statuses: ['promised', 'refused', 'none'] })).toEqual(['a', 'b', 'none']);
  });
  it('фильтр по сотруднику учитывает только его отметки и сочетается со статусом', () => {
    expect(ids({ author: 'op1' })).toEqual(['a', 'b']);
    expect(ids({ author: 'op1', statuses: ['no_answer'] })).toEqual(['a']);
    expect(ids({ author: 'op2', statuses: ['promised'] })).toEqual(['a']);
    expect(ids({ author: 'op1', statuses: ['none'] })).toEqual(['c', 'none', 'd']);
    expect(ids({ author: 'owner' })).toEqual(['d']);
  });
  it('список сотрудников для фильтра', () => {
    expect(markAuthors(map)).toEqual([
      { key: LEGACY_ADMIN_AUTHOR, name: 'Администратор', count: 1 },
      { key: 'owner', name: 'Владелец', count: 1 },
      { key: 'op2', name: 'Ислам', count: 2 },
      { key: 'op1', name: 'Аминат', count: 2 },
    ].sort((x, y) => x.name.localeCompare(y.name, 'ru')));
  });
  it('переключение статусов в фильтре', () => {
    expect(toggleMarkStatus([], 'promised')).toEqual(['promised']);
    expect(toggleMarkStatus(['promised', 'none'], 'promised')).toEqual(['none']);
    expect(toggleMarkStatus(['promised'], 'all')).toEqual([]);
  });
});
