import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';
import MobileContracts from './MobileContracts';

const contracts = [
  { id: 'a', clientName: 'Иванов Иван', item: 'Холодильник' },
  { id: 'b', clientName: 'Петров Пётр', item: 'Телефон' },
  { id: 'c', clientName: 'Сидоров Сидор', item: '' },
];
const due = new Date(2030, 0, 15);
const stats = {
  a: { remaining: 54000, overdueSum: 18000, paidSum: 0, done: false, deferrals: [], next: { index: 0, dueDate: new Date(2020, 0, 1), remainingDue: 18000, amountDue: 18000, status: 'overdue' },
    rows: [{ status: 'overdue', dueDate: new Date(2020, 0, 1), remainingDue: 18000 }] },
  b: { remaining: 30000, overdueSum: 0, paidSum: 10000, done: false, deferrals: [], next: { index: 1, dueDate: due, remainingDue: 10000, amountDue: 10000, status: 'pending' }, rows: [] },
  c: { remaining: 0, overdueSum: 0, paidSum: 50000, done: true, deferrals: [], next: null, rows: [] },
};
const f = {
  search: '', setSearch() {}, statusFilter: 'all', setStatusFilter() {}, workView: null, chooseWorkView() {},
  sortBy: 'remaining', setSortBy() {}, sortDir: 'desc', setSortDir() {},
  investorFilter: 'all', setInvestorFilter() {}, contactFilter: 'all', setContactFilter() {}, notificationFilter: 'all', setNotificationFilter() {},
  deferralFilter: 'all', setDeferralFilter() {}, markStatuses: [], setMarkStatuses() {}, markAuthor: 'all', setMarkAuthor() {}, markAuthorOptions: [],
  reset() {}, anyActive: false,
};
const render = (initialView) => renderToStaticMarkup(
  <MobileContracts total={3} list={contracts} groups={contracts.map((c) => ({ key: c.id, list: [c], remaining: stats[c.id].remaining }))}
    getStats={(c) => stats[c.id]} investors={[]} counts={{ all: 3, active: 2, overdue: 1, done: 1 }}
    summary={{ remaining: 84000, overdue: 18000, financed: 0, profitReceived: 0, profitExpected: 0 }} f={f} marks={{}} onMarksHistory={() => {}}
    selection={{ selectedIds: new Set(), toggleSelected() {}, setSelectedIds() {}, visibleSelected: [], reminderFor: () => false, beginReminders() {} }}
    onOpen={() => {}} onPay={() => {}} onRemind={() => {}} onExport={() => {}} onAdd={() => {}} initialView={initialView} />,
);

it('shows contracts as a compact table with one row per contract', () => {
  const html = render('table');
  expect(html).toContain('m-ctable');
  expect((html.match(/<tbody>.*<\/tbody>/s)[0].match(/<tr /g) || []).length).toBe(3);
  expect(html).toContain('Холодильник');
  expect(html).toMatch(/54\s000 ₽/);
  expect(html).toContain('Закрыт');
  expect(html).toContain('aria-sort="descending"');
  // Кнопка «Принять платёж» только у незакрытых договоров.
  expect((html.match(/Принять платёж: /g) || []).length).toBe(2);
  expect(html).not.toContain('m-ccard');
});

it('keeps the card view by default and offers the table switch', () => {
  const html = render();
  expect(html).toContain('m-ccard');
  expect(html).not.toContain('m-ctable');
  expect(html).toContain('Показать таблицей');
});
