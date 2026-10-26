export function accessFor(profile) {
  if (!profile?.active) return 'blocked';
  return ['admin', 'operator'].includes(profile.role) ? profile.role : 'blocked';
}
export const callResults = {
  informed: 'Напомнил о платеже', no_answer: 'Не смог дозвониться', promised: 'Обещал оплатить',
  callback: 'Перезвонить', reported_paid: 'Сообщил об оплате — нужна проверка',
  wrong_number: 'Неверный номер', help: 'Нужна помощь администратора',
};
// Последняя отметка оператора по каждому договору: { [contractId]: result }.
export function latestCallResults(logs = []) {
  const latest = {};
  const at = {};
  for (const log of logs) {
    if (!log?.contract_id || !log.result) continue;
    const time = String(log.created_at || '');
    if (!(log.contract_id in at) || time > at[log.contract_id]) {
      at[log.contract_id] = time;
      latest[log.contract_id] = log.result;
    }
  }
  return latest;
}
// filter: 'all' — без фильтра, 'none' — оператор ещё не отмечал, иначе ключ из callResults.
export function matchesCallResultFilter(filter, latest) {
  if (!filter || filter === 'all') return true;
  if (filter === 'none') return !latest;
  return latest === filter;
}
