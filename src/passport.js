// Паспортные данные клиента хранятся в договоре: payments.__passport.
// Оператору они не отдаются (operator_clients выдаёт только платежи с числовыми ключами).
export const PASSPORT_FIELDS = [
  ['series', 'Серия'],
  ['number', 'Номер'],
  ['issuedBy', 'Кем выдан'],
  ['issueDate', 'Дата выдачи'],
  ['divisionCode', 'Код подразделения'],
  ['birthDate', 'Дата рождения'],
  ['birthPlace', 'Место рождения'],
  ['address', 'Адрес регистрации'],
];

export const emptyPassport = () => Object.fromEntries(PASSPORT_FIELDS.map(([key]) => [key, '']));

// Возвращает очищенные данные или null, если ничего не заполнено.
export function normalizePassport(value) {
  if (!value || typeof value !== 'object') return null;
  const clean = {};
  let filled = false;
  for (const [key] of PASSPORT_FIELDS) {
    const text = String(value[key] ?? '').replace(/\s+/g, ' ').trim();
    clean[key] = text;
    if (text) filled = true;
  }
  return filled ? clean : null;
}

export const passportOf = (contract) => normalizePassport(contract?.payments?.__passport);
export const guarantorPassportOf = (contract) => normalizePassport(contract?.payments?.__guarantorPassport);

// Записывает (или убирает) паспорт в payments, не трогая платежи и прочие служебные ключи.
// key: '__passport' — клиент, '__guarantorPassport' — поручитель.
export function withPassport(payments, passport, key = '__passport') {
  const next = { ...(payments || {}) };
  const clean = normalizePassport(passport);
  if (clean) next[key] = clean; else delete next[key];
  return next;
}

const isoToRu = (value) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value || '');
  return m ? `${m[3]}.${m[2]}.${m[1]}` : value || '';
};

// Строки «подпись — значение» для карточки, печати и PDF.
export function passportLines(passport) {
  const p = normalizePassport(passport);
  if (!p) return [];
  const lines = [];
  const doc = [p.series, p.number].filter(Boolean).join(' ');
  if (doc) lines.push(['Паспорт', doc]);
  if (p.issuedBy || p.issueDate) lines.push(['Выдан', [p.issuedBy, p.issueDate && `${isoToRu(p.issueDate)}`].filter(Boolean).join(', ')]);
  if (p.divisionCode) lines.push(['Код подразделения', p.divisionCode]);
  if (p.birthDate || p.birthPlace) lines.push(['Дата и место рождения', [isoToRu(p.birthDate), p.birthPlace].filter(Boolean).join(', ')]);
  if (p.address) lines.push(['Адрес регистрации', p.address]);
  return lines;
}

export const passportSummary = (passport) => passportLines(passport).map(([label, value]) => `${label}: ${value}`).join('; ');

// Строки паспорта клиента и поручителя для карточки, печати и PDF.
export const contractPassportLines = (contract) => [
  ...passportLines(passportOf(contract)),
  ...passportLines(guarantorPassportOf(contract)).map(([label, value]) => [`Поручитель — ${label.toLocaleLowerCase('ru')}`, value]),
];

// Поиск клиента/товара: по словам в названии и по цифрам телефона.
export function matchesPickerQuery(option, rawQuery) {
  const query = String(rawQuery || '').trim().toLocaleLowerCase('ru');
  if (!query) return true;
  const name = String(option.name || '').toLocaleLowerCase('ru');
  const words = query.split(/\s+/);
  if (words.every((word) => name.includes(word))) return true;
  const digits = query.replace(/\D/g, '');
  return digits.length >= 3 && String(option.phone || '').replace(/\D/g, '').includes(digits);
}
