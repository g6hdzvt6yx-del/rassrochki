import { overdueDays } from './contractWorkbench';

// Сортировка списка договоров. Только порядок строк — суммы и договоры не меняются.
// dir: 'desc' | 'asc' — для просрочки, остатка и даты последней отметки.
export const SORT_OPTIONS = [
  ['created', 'Сначала новые'],
  ['dueDate', 'По ближайшему платежу'],
  ['name', 'По имени (А-Я)'],
  ['remaining', 'По остатку долга'],
  ['overdue', 'По просрочке'],
  ['lastMark', 'По дате последней отметки'],
];
export const DIRECTIONAL_SORTS = new Set(['remaining', 'overdue', 'lastMark']);

export function sortContracts(list, sortBy, dir = 'desc', getStats, marks = {}) {
  if (sortBy === 'created' || !sortBy) return list;
  const sign = dir === 'asc' ? -1 : 1;
  const keyed = list.map((contract, index) => ({ contract, index, stats: getStats(contract) }));
  const byIndex = (a, b) => a.index - b.index;
  let compare;
  if (sortBy === 'name') compare = (a, b) => a.contract.clientName.localeCompare(b.contract.clientName, 'ru') || byIndex(a, b);
  else if (sortBy === 'dueDate') compare = (a, b) => ((a.stats.next ? a.stats.next.dueDate.getTime() : Infinity) - (b.stats.next ? b.stats.next.dueDate.getTime() : Infinity)) || byIndex(a, b);
  else if (sortBy === 'remaining') compare = (a, b) => sign * (b.stats.remaining - a.stats.remaining) || byIndex(a, b);
  else if (sortBy === 'overdue') {
    const days = new Map(keyed.map((k) => [k.contract.id, k.stats.overdueSum > 0 ? overdueDays(k.stats.rows) : -1]));
    compare = (a, b) => sign * ((days.get(b.contract.id) - days.get(a.contract.id)) || (b.stats.overdueSum - a.stats.overdueSum)) || byIndex(a, b);
  } else if (sortBy === 'lastMark') {
    // Договоры без отметок всегда в конце списка.
    const at = (k) => String(marks[k.contract.id]?.[0]?.at || '');
    compare = (a, b) => {
      const x = at(a), y = at(b);
      if (!x || !y) return (x ? -1 : y ? 1 : 0) || byIndex(a, b);
      return sign * y.localeCompare(x) || byIndex(a, b);
    };
  } else return list;
  return keyed.sort(compare).map((k) => k.contract);
}
