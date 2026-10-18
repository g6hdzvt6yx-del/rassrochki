import { it, expect } from 'vitest';
import * as XLSX from 'xlsx';
import { buildFinancialReport, buildFinancialReportWorkbook } from './financialReport';
const args = { contracts: [{ id: 'a', investorId: 'i', totalPrice: 1000, downPayment: 200, markup: 200 }], investors: [{ id: 'i', name: 'Иван' }], withdrawals: [{ date: '2026-10-02', purpose: 'investor_payout', investorId: 'i', amount: 20 }, { date: '2026-10-03', purpose: 'owner', amount: 30 }], getStats: () => ({ paidSum: 500, remaining: 500, overdueSum: 100, rows: [{ n: 1, paidAmount: 500, paymentEvents: [{ date: '2026-09-30', amount: 200 }, { date: '2026-10-01', amount: 100 }, { date: '2026-10-14', amount: 200 }] }] }), from: '2026-10-01', to: '2026-10-14', asOf: '2026-10-14' };
it('includes boundary events, reconciles receipts, and separates current balances', () => {
 const r = buildFinancialReport(args);
 expect(r.received).toBe(300); expect(r.principalReturned).toBe(240); expect(r.profitReceived).toBe(60);
 expect(r.remaining).toBe(500); expect(r.capital).toBe(400); expect(r.ownerPayout).toBe(30);
});
it('isolates investor data and payouts', () => {
 const r = buildFinancialReport({ ...args, investorId: 'i', contracts: [...args.contracts, { ...args.contracts[0], id: 'other', investorId: '' }] });
 expect(r.portfolio.map(c => c.id)).toEqual(['a']); expect(r.outflows).toHaveLength(1); expect(r.ownerPayout).toBe(0);
});
it('rejects invalid inputs', () => {
 for (const change of [{ from: '2026-02-30' }, { from: '2026-10-15' }, { to: '2026-10-15' }, { investorId: 'missing' }]) expect(() => buildFinancialReport({ ...args, ...change })).toThrow();
});
it('flags undated receipts and handles empty data', () => {
 const r = buildFinancialReport({ ...args, getStats: () => ({ paidSum: 50, remaining: 950, overdueSum: 0, rows: [{ paidAmount: 50 }] }) });
 expect(r.undated).toBe(50); expect(r.received).toBe(0);
 expect(buildFinancialReport({ ...args, contracts: [], withdrawals: [] }).remaining).toBe(0);
});
it('round trips workbook with numeric totals and registers', () => {
 const wb = buildFinancialReportWorkbook(XLSX, buildFinancialReport(args));
 const read = XLSX.read(XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }), { type: 'buffer' });
 expect(read.SheetNames).toHaveLength(4); expect(read.Sheets['Итоги'].B6.v).toBe(300);
 expect(XLSX.utils.sheet_to_json(read.Sheets['Платежи'])).toHaveLength(2);
});

it('exports readable Cyrillic contract names in both registers', () => {
 const contracts = [{ ...args.contracts[0], clientName: 'Иван Иванов', item: 'Холодильник' }];
 const wb = buildFinancialReportWorkbook(XLSX, buildFinancialReport({ ...args, contracts }));
 const read = XLSX.read(XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }), { type: 'buffer' });
 for (const name of ['Платежи', 'Портфель на сегодня']) {
   expect(read.Sheets[name].A2.v).toBe('Иван Иванов — Холодильник');
   expect(read.Sheets[name].A2.t).toBe('s');
 }
 expect(read.Sheets['Портфель на сегодня'].B2.v).toBe(400);
});
it('uses clear labels for missing client or item', () => {
 const r = buildFinancialReport(args);
 expect(r.portfolio[0].contractName).toBe('Клиент не указан — Товар не указан');
 expect(r.payments[0].contractName).toBe(r.portfolio[0].contractName);
});
