// Изолированный стенд для проверки вида: вымышленные данные, никаких запросов в сеть.
// Подменяет ./supabaseClient, ./dataClient и ./guardedCloudClient только в этом стенде.
const pad = (n) => String(n).padStart(2, "0");
const iso = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const today = new Date(); today.setHours(0, 0, 0, 0);
const shift = (days) => { const d = new Date(today); d.setDate(d.getDate() + days); return d; };
const monthsBack = (months, days = 0) => { const d = new Date(today); d.setDate(1); d.setMonth(d.getMonth() - months); d.setDate(Math.min(today.getDate(), 28)); d.setDate(d.getDate() + days); return iso(d); };
// Платёж № k (с 0) приходится на startDate + k месяцев. Чтобы платёж №(m) выпал на «сегодня + days»,
// дата начала = (сегодня + days) − m месяцев.
const startFor = (paidMonths, days) => {
  const target = shift(days); const d = new Date(target); d.setMonth(d.getMonth() - paidMonths);
  if (d.getDate() !== target.getDate()) d.setDate(0);
  return iso(d);
};
const split = (total, n) => { const base = Math.floor(total / n); return Array.from({ length: n }, (_, i) => (i === n - 1 ? total - base * (n - 1) : base)); };
const paidRecords = (amounts, count, start, partialLast = 0) => {
  const out = {};
  for (let i = 0; i < count; i += 1) {
    const d = new Date(`${start}T00:00:00`); d.setMonth(d.getMonth() + i);
    // Без суммы: приложение само засчитает платёж полностью по своему графику (без копеечных остатков).
    out[i] = { paidDate: iso(d) };
  }
  if (partialLast) out[count] = { paidDate: iso(today), paidAmount: partialLast, paymentEvents: [{ date: iso(shift(-1)), amount: partialLast }] };
  return out;
};

const people = [
  ["Руслан Арсаев", "Смартфон Galaxy A55 256 ГБ", 64000, 12, 0, 0],
  ["Мадина Хасанова", "Холодильник двухкамерный", 82000, 10, 3, 0],
  ["Ибрагим Тестов", "Ноутбук 15,6″ для учёбы", 71000, 8, 2, 0],
  ["Луиза Магомедова", "Стиральная машина 7 кг", 54000, 6, 4, 1],
  ["Адам Примеров", "Телевизор 55″", 59000, 10, 5, 1],
  ["Зарема Ахмадова", "Диван угловой с механизмом", 96000, 12, 1, 3],
  ["Шамиль Вымышленный", "Кондиционер 12 BTU с установкой", 47000, 6, 2, 5],
  ["Хеда Демоева", "Посудомоечная машина", 43000, 6, 1, 6],
  ["Тимур Образцов", "Шины и диски, комплект", 68000, 8, 3, -9],
  ["Седа Условная", "Кухонный гарнитур 2,4 м", 120000, 12, 2, -38],
  ["Магомед Пробный", "Смартфон iPhone 15 128 ГБ", 98000, 10, 6, 14],
  ["Айшат Тестова-Длиннофамильная", "Шкаф-купе трёхстворчатый с зеркалом и подсветкой", 76000, 8, 3, 20],
  ["Ахмед Пример", "Электросамокат", 38000, 6, 6, -200],
];

const contracts = people.map(([name, item, price, term, paidMonths, days], i) => {
  const markup = Math.round(price * 0.22 / 1000) * 1000;
  const start = days === -200 ? monthsBack(7) : startFor(paidMonths, days);
  const amounts = split(price + markup, term);
  const partial = i === 3 ? Math.round(amounts[0] / 2) : 0;
  const payments = days === -200 ? paidRecords(amounts, term, start) : paidRecords(amounts, paidMonths, start, partial);
  if (i === 1) payments.__contacts = [{ id: "c1", date: iso(shift(-2)), note: "Обещала оплатить после зарплаты", promisedDate: iso(today), promisedAmount: amounts[3] }];
  if (i === 9) payments.__contacts = [{ id: "c2", date: iso(shift(-5)), note: "Не берёт трубку, перезвонить", nextContactDate: iso(shift(1)) }];
  if (i === 0) payments.__cashCards = ["Сбербанк · Иван · 1234", "Т-Банк · Пётр · 5678", "Альфа · Мария · 9012"];
  if (i === 4) payments[paidMonths] = { ...(payments[paidMonths] || {}), notifiedAt: new Date().toISOString() };
  return {
    id: `qa-${i + 1}`, client_name: name, phone: `+7 999 000-${pad(10 + i)}-${pad(40 + i)}`, item,
    total_price: price, down_payment: 0, markup, markup_percent: 22, term_months: term,
    start_date: start, investor_id: i % 3 === 0 ? "inv-2" : "inv-1", payments, comment: "",
    guarantor_name: "", guarantor_phone: "", contract_date: start, created_at: `${start}T09:00:00Z`,
  };
});
const investors = [
  { id: "inv-1", name: "Собственные средства", amount: 900000, monthly_payment: 0, accrual_start_date: "" },
  { id: "inv-2", name: "Вкладчик Пример", amount: 400000, monthly_payment: 12000, accrual_start_date: monthsBack(6) },
];
const withdrawals = [{ id: "w-1", amount: 60000, date: monthsBack(1), investor_id: "inv-2", purpose: "investor_payout", note: "" }];
const tables = { contracts, investors, withdrawals, drafts: [], call_log: [], operator_assignments: [], app_members: [] };
const member = { user_id: "qa-owner", owner_id: "qa-owner", role: "admin", active: true, display_name: "Владелец (тест)" };
const session = { user: { id: "qa-owner", email: "qa@example.invalid" } };

const query = (table) => {
  let single = false;
  const result = () => {
    if (table === "app_members" && single) return { data: member, error: null };
    return { data: tables[table] ? tables[table].slice() : [], error: null };
  };
  const q = {
    select: () => q, order: () => q, range: () => q, eq: () => q, in: () => q, neq: () => q, limit: () => q,
    update: () => q, insert: () => q, upsert: () => q, delete: () => q,
    maybeSingle: () => { single = true; return q; }, single: () => { single = true; return q; },
    then: (resolve, reject) => Promise.resolve(result()).then(resolve, reject),
  };
  return q;
};
export const supabase = {
  auth: {
    getSession: async () => ({ data: { session }, error: null }),
    onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
    signOut: async () => ({ error: null }),
  },
  rpc: async (name) => ({ data: name === "action_log_people" ? [{ user_id: "qa-owner", display_name: "Владелец (тест)" }] : [], error: null }),
  from: query,
  storage: { from: () => ({ upload: async () => ({ error: null }), createSignedUrl: async () => ({ data: { signedUrl: "#" }, error: null }), remove: async () => ({ error: null }) }) },
};
export const supabaseConfigured = true;
export const isDesktopApp = false;
export const localData = { log: async () => {}, getSetting: async () => null, listActions: async () => [], listDrafts: async () => [] };
export const setActionSource = () => {};
export const suppressNextActionLog = () => {};
export const cloudWritePending = () => false;
export const guardedCloudClient = (client) => client;
