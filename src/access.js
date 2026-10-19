export function accessFor(profile) {
  if (!profile?.active) return 'blocked';
  return ['admin', 'operator'].includes(profile.role) ? profile.role : 'blocked';
}
export const callResults = {
  informed: 'Напомнил о платеже', no_answer: 'Не смог дозвониться', promised: 'Обещал оплатить',
  callback: 'Перезвонить', reported_paid: 'Сообщил об оплате — нужна проверка',
  wrong_number: 'Неверный номер', help: 'Нужна помощь администратора',
};
