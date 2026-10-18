// Older backups encode ISO punctuation in the folder name for filesystem safety.
export function parseDataDate(value) {
  if (value == null || value === '') return null;
  let normalized = value;
  if (typeof value === 'string') {
    normalized = value.trim().replace(
      /^(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})(?:-(\d{3}))?Z$/,
      (_, day, hour, minute, second, millis) => `${day}T${hour}:${minute}:${second}${millis ? `.${millis}` : ''}Z`,
    ).replace(' ', 'T');
    if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(normalized) && !/(Z|[+-]\d{2}:?\d{2})$/i.test(normalized)) normalized += 'Z';
  } else if (!(value instanceof Date) && typeof value !== 'number') return null;
  const date = new Date(normalized);
  return Number.isFinite(date.getTime()) ? date : null;
}

export function formatDataDateTime(value) {
  const date = parseDataDate(value);
  return date ? new Intl.DateTimeFormat('ru-RU', {
    day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).format(date) : 'Дата не указана';
}
