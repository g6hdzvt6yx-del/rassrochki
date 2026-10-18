import { expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { createContractPdf, contractPdfFilename } from './contractPdf';
it('создаёт самостоятельный PDF с кириллицей и несколькими страницами', () => {
  const font = readFileSync(new URL('./assets/DejaVuSans.ttf', import.meta.url)).toString('base64');
  const contract = { clientName: 'Тестовый клиент', startDate: '2026-10-14', termMonths: 60 };
  const rows = Array.from({length:60}, (_,i) => ({n:i+1, dueDate:'2026-11-14', amountDue:1000, paidAmount:0, remainingDue:1000}));
  const bytes = createContractPdf(contract, {rows, financed:60000, paidSum:0, remaining:60000}, font);
  const text = Buffer.from(bytes).toString('latin1');
  expect(text.startsWith('%PDF-')).toBe(true);
  expect(text).toContain('/FontFile2');
  expect((text.match(/\/Type \/Page\b/g) || []).length).toBeGreaterThan(1);
});
it('очищает имя файла от разделителей пути', () => {
  expect(contractPdfFilename({clientName:'Иван/Петров: тест', startDate:'2026-10-14'})).toBe('Договор - Иван_Петров_ тест - 2026-10-14.pdf');
});
