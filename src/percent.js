// Доля part от whole в процентах для подписей к показателям: «33,7%».
// Пустая строка, если база нулевая или данных нет — тогда процент не показываем.
export function percentOf(part, whole) {
  const p = Number(part) || 0;
  const w = Number(whole) || 0;
  if (w <= 0) return "";
  const value = (p / w) * 100;
  if (value > 0 && value < 0.1) return "<0,1%";
  const text = new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 1 }).format(Math.round(value * 10) / 10);
  return `${text}%`;
}
