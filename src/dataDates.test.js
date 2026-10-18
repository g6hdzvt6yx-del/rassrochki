import { expect, it } from 'vitest';
import { parseDataDate, formatDataDateTime } from './dataDates';

it('renders legacy backup folder dates identically to their ISO timestamps', () => {
  for (const [folder, iso] of [
    ['2026-08-19T21-10-08-385Z', '2026-08-19T21:10:08.385Z'],
    ['2026-08-18T15-23-49-485Z', '2026-08-18T15:23:49.485Z'],
  ]) {
    expect(parseDataDate(folder).toISOString()).toBe(iso);
    expect(formatDataDateTime(folder)).toBe(formatDataDateTime(iso));
  }
});

it('preserves SQL UTC timestamps and explicit timezone offsets', () => {
  expect(parseDataDate('2026-10-18 11:14:21').toISOString()).toBe('2026-10-18T11:14:21.000Z');
  expect(parseDataDate('2026-10-18T14:14:21+03:00').toISOString()).toBe('2026-10-18T11:14:21.000Z');
});

it('does not crash the data panel on absent or malformed metadata', () => {
  for (const value of [null, undefined, '', 'bad', {}, [], new Date(NaN)]) {
    expect(formatDataDateTime(value)).toBe('Дата не указана');
  }
});
