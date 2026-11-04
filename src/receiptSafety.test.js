import { describe, expect, it } from 'vitest';
import { isCloudReceiptUrl, isOpenableReceiptHref, isSafeReceipt, isSafeReceiptDataUrl, isSafeReceiptPath, parseReceiptDataUrl, receiptBlobUrl, UnsafeReceiptError } from './receiptSafety';
import { makePlan } from './backupImport';

const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const PROJECT = 'https://xaikgjgtqcgiwsayhssi.supabase.co';

describe('встроенный чек (receipt.dataUrl)', () => {
  it('принимает фото и PDF в base64', () => {
    expect(isSafeReceiptDataUrl(PNG)).toBe(true);
    expect(isSafeReceiptDataUrl('data:application/pdf;base64,JVBERi0xLjQK')).toBe(true);
    expect(isSafeReceiptDataUrl('data:image/jpg;base64,/9j/4AAQ')).toBe(true);
    expect(parseReceiptDataUrl('data:image/JPEG;base64,/9j/\n4AAQ').mime).toBe('image/jpeg');
  });
  it('отклоняет javascript:, html, svg и всё не-base64', () => {
    for (const bad of [
      'javascript:alert(1)', ' javascript:alert(1)', 'JaVaScRiPt:fetch(1)',
      'data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==',
      'data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=',
      'data:image/png,<script>', 'data:image/png;base64,abc"onload=x', 'https://evil.example/x.png',
      '', null, 42, {},
    ]) expect(isSafeReceiptDataUrl(bad), String(bad)).toBe(false);
  });
  it('открывает только через Blob и бросает понятную ошибку на подделке', () => {
    const url = receiptBlobUrl(PNG);
    expect(url.startsWith('blob:')).toBe(true);
    URL.revokeObjectURL(url);
    expect(() => receiptBlobUrl('javascript:alert(1)')).toThrow(UnsafeReceiptError);
  });
});

describe('ссылка на файл в хранилище', () => {
  it('пропускает только подписанные ссылки бакета receipts нашего проекта', () => {
    expect(isCloudReceiptUrl(`${PROJECT}/storage/v1/object/sign/receipts/T-1/0-1.png?token=a`, PROJECT)).toBe(true);
    expect(isCloudReceiptUrl(`${PROJECT}/storage/v1/object/sign/other/T-1/0-1.png?token=a`, PROJECT)).toBe(false);
    expect(isCloudReceiptUrl(`${PROJECT}/storage/v1/object/sign/receipts/../other/x?token=a`, PROJECT)).toBe(false);
    expect(isCloudReceiptUrl('https://evil.supabase.co/storage/v1/object/sign/receipts/x', PROJECT)).toBe(false);
    expect(isCloudReceiptUrl(`https://user:pw@xaikgjgtqcgiwsayhssi.supabase.co/storage/v1/object/sign/receipts/x`, PROJECT)).toBe(false);
    expect(isCloudReceiptUrl('javascript:alert(1)', PROJECT)).toBe(false);
    expect(isCloudReceiptUrl(`http://xaikgjgtqcgiwsayhssi.supabase.co/storage/v1/object/sign/receipts/x`, PROJECT)).toBe(false);
  });
  it('http разрешён только для облака на этом же компьютере', () => {
    expect(isCloudReceiptUrl('http://127.0.0.1:54321/storage/v1/object/sign/receipts/x?t=1', 'http://127.0.0.1:54321')).toBe(true);
    expect(isCloudReceiptUrl('http://example.com/storage/v1/object/sign/receipts/x', 'http://example.com')).toBe(false);
  });
  it('путь к файлу — только относительный, без выхода из папки', () => {
    expect(isSafeReceiptPath('T-1/0-1730000000000.jpg')).toBe(true);
    expect(isSafeReceiptPath('T-1/mac-import/abc.pdf')).toBe(true);
    for (const bad of ['', '/etc/x', '../x', 'a/../../b', 'a//b', 'https://evil/x', 'a\\b', 'javascript:x', null])
      expect(isSafeReceiptPath(bad), String(bad)).toBe(false);
  });
  it('окно чека получает только Blob этого сайта или ссылку облака', () => {
    expect(isOpenableReceiptHref('blob:https://site.example/123', 'https://site.example', PROJECT)).toBe(true);
    expect(isOpenableReceiptHref('blob:https://evil.example/123', 'https://site.example', PROJECT)).toBe(false);
    expect(isOpenableReceiptHref('javascript:alert(1)', 'https://site.example', PROJECT)).toBe(false);
    expect(isOpenableReceiptHref('data:text/html,x', 'https://site.example', PROJECT)).toBe(false);
    expect(isOpenableReceiptHref('https://evil.example/x', 'https://site.example', PROJECT)).toBe(false);
  });
});

describe('чек целиком и перенос с Mac', () => {
  it('isSafeReceipt проверяет и встроенную копию, и путь', () => {
    expect(isSafeReceipt({ name: 'a', dataUrl: PNG })).toBe(true);
    expect(isSafeReceipt({ name: 'a', path: 'T-1/0-1.png' })).toBe(true);
    expect(isSafeReceipt({ name: 'a', path: 'T-1/0-1.png', dataUrl: 'javascript:x' })).toBe(false);
    expect(isSafeReceipt({ name: 'a' })).toBe(false);
    expect(isSafeReceipt('javascript:x')).toBe(false);
  });
  const contract = (payments) => ({ id: 'T-1', client_name: 'Клиент', total_price: 1000, down_payment: 0, markup: 0, markup_percent: 0, term_months: 2, start_date: '2026-01-01', payments });
  const plan = (payments) => makePlan({ investors: [], withdrawals: [], contracts: [contract(payments)], assets: new Map() }, { investors: [], withdrawals: [], contracts: [] });
  it('блокирует перенос договора с подложным чеком (старый и новый формат)', () => {
    const legacy = plan({ 0: { paidDate: '2026-01-01', receipt: { name: 'x', dataUrl: 'javascript:alert(1)' } } });
    expect(legacy[0].kind).toBe('blocked');
    expect(legacy[0].problem).toMatch(/недопустимом формате/);
    const list = plan({ 0: { paidDate: '2026-01-01', receipts: [{ name: 'ok', dataUrl: PNG }, { name: 'x', dataUrl: 'data:text/html;base64,PGI+' }] } });
    expect(list[0].kind).toBe('blocked');
  });
  it('переносит договор с настоящим встроенным чеком', () => {
    const ok = plan({ 0: { paidDate: '2026-01-01', receipt: { name: 'ok', dataUrl: PNG } } });
    expect(ok[0].kind).toBe('new');
  });
});
