import { it, expect, vi } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  DIRECTORY_KINDS, validateDirectoryData, findDuplicate, candidatesFromContracts, itemReferences,
  accountCardLabel, insertDirectoryItems, updateDirectoryItem,
} from './directoryCatalog';
import Directories from './Directories.jsx';

it('covers every requested directory', () => {
  expect(DIRECTORY_KINDS.map((k) => k.title)).toEqual([
    'Товары', 'Клиенты', 'Карты и счета', 'Кассы', 'Сотрудники', 'Категории товаров',
    'Статьи доходов и расходов', 'Поручители', 'Способы оплаты',
  ]);
});

it('cleans and validates fields', () => {
  expect(validateDirectoryData('products', { name: '  iPhone   15 ', purchasePrice: '70 000', salePrice: '89999,5', categoryId: '' }))
    .toEqual({ name: 'iPhone 15', purchasePrice: 70000, salePrice: 89999.5 });
  expect(validateDirectoryData('clients', { name: 'Иванов', phone: '+7 999 123 45 67', passport: { series: '1234', number: '' } }))
    .toEqual({ name: 'Иванов', phone: '8-999-123-45-67', passport: expect.objectContaining({ series: '1234', number: '' }) });
  expect(validateDirectoryData('clients', { name: 'Иванов', passport: { series: ' ' } })).toEqual({ name: 'Иванов' });
  expect(() => validateDirectoryData('products', { name: ' ' })).toThrow('Название');
  expect(() => validateDirectoryData('products', { name: 'А', salePrice: '-5' })).toThrow('сумму');
  expect(() => validateDirectoryData('accounts', { name: 'Сбер', last4: '12345' })).toThrow('4 цифры');
  expect(() => validateDirectoryData('employees', { name: 'Пётр', phone: '123' })).toThrow('номер');
  expect(() => validateDirectoryData('articles', { name: 'Аренда' })).toThrow('Вид');
  expect(() => validateDirectoryData('articles', { name: 'Аренда', type: 'gift' })).toThrow('из списка');
});

it('finds duplicates by name, and by name with phone for people', () => {
  const items = [{ id: '1', kind: 'clients', data: { name: 'Анна', phone: '8-999-123-45-67' } }, { id: '2', kind: 'categories', data: { name: 'Мебель' } }];
  expect(findDuplicate(items, 'categories', { name: ' мебель ' })?.id).toBe('2');
  expect(findDuplicate(items, 'clients', { name: 'анна', phone: '89991234567' })?.id).toBe('1');
  expect(findDuplicate(items, 'clients', { name: 'Анна', phone: '89990000000' })).toBe(null);
  expect(findDuplicate(items, 'categories', { name: 'Мебель' }, '2')).toBe(null);
});

it('builds import candidates from contracts without duplicates', () => {
  const contracts = [
    { id: 'a', clientName: 'Анна', phone: '89991234567', item: 'Диван', totalPrice: 30000, guarantorName: 'Олег', guarantorPhone: '89995554433',
      payments: { __passport: { series: '1111', number: '222222', address: 'ул. Мира, 1' } } },
    { id: 'b', clientName: 'Анна', phone: '+7 999 123-45-67', item: 'диван', totalPrice: 31000, guarantorName: 'Олег', guarantorPhone: '89995554433' },
    { id: 'c', clientName: 'Борис', phone: '', item: 'Телефон', totalPrice: 0 },
  ];
  const items = [{ id: 'cl1', kind: 'clients', data: { name: 'Анна', phone: '8-999-123-45-67' } }];
  expect(candidatesFromContracts('clients', contracts, items)).toEqual([{ name: 'Борис' }]);
  expect(candidatesFromContracts('clients', contracts, [])[0]).toMatchObject({ name: 'Анна', address: 'ул. Мира, 1', passport: { series: '1111' } });
  expect(candidatesFromContracts('products', contracts, [])).toEqual([{ name: 'Диван', salePrice: 30000 }, { name: 'Телефон' }]);
  expect(candidatesFromContracts('guarantors', contracts, items)).toEqual([{ name: 'Олег', phone: '8-999-555-44-33', clientId: 'cl1' }]);
  expect(candidatesFromContracts('cashboxes', contracts, items)).toEqual([]);
});

it('lists references and card labels', () => {
  const cat = { id: 'k', kind: 'categories', data: { name: 'Техника' } };
  const items = [cat, { id: 'p', kind: 'products', data: { name: 'ТВ', categoryId: 'k' } }, { id: 'q', kind: 'products', data: { name: 'Стол' } }];
  expect(itemReferences(items, cat).map((i) => i.id)).toEqual(['p']);
  expect(accountCardLabel({ data: { name: 'Основная', bank: 'Сбер', owner: 'Иван', last4: '1234' } })).toBe('Сбер · Иван · 1234');
});

it('writes validated rows to directory_items', async () => {
  const select = vi.fn().mockResolvedValue({ data: [{ id: 'd1', kind: 'categories', data: { name: 'Мебель' }, updated_at: 't' }], error: null });
  const insert = vi.fn(() => ({ select }));
  const db = { from: vi.fn(() => ({ insert })) };
  const saved = await insertDirectoryItems(db, 'categories', [{ name: ' Мебель ' }]);
  expect(db.from).toHaveBeenCalledWith('directory_items');
  expect(insert.mock.calls[0][0]).toEqual([{ id: expect.stringMatching(/^d/), kind: 'categories', data: { name: 'Мебель' } }]);
  expect(saved).toEqual([{ id: 'd1', kind: 'categories', data: { name: 'Мебель' }, updatedAt: 't' }]);

  const denied = { from: () => ({ update: () => ({ eq: () => ({ select: async () => ({ data: [], error: null }) }) }) }) };
  await expect(updateDirectoryItem(denied, { id: 'x', kind: 'categories' }, { name: 'А' })).rejects.toThrow('не найдена');
});

it('renders directory sections with records', () => {
  const html = renderToStaticMarkup(React.createElement(Directories, {
    contracts: [], onSaveClient: () => {}, onItemsChange: () => {}, db: null,
    items: [{ id: 'p', kind: 'products', data: { name: 'Холодильник', salePrice: 50000 } }],
  }));
  expect(html).toContain('Способы оплаты');
  expect(html).toContain('Холодильник');
  expect(html).toMatch(/50\s000 ₽/);
});
