// «Скачать копию»: все данные с сайта одним файлом Excel на компьютер (Mac).
// Только чтение — в базе ничего не меняется.

const PAGE = 1000;

// Supabase отдаёт не больше 1000 строк за запрос, поэтому читаем частями.
async function readAll(supabase, table, orderBy, { optional = false, limit = 50000 } = {}) {
  const rows = [];
  for (let from = 0; from < limit; from += PAGE) {
    const { data, error } = await supabase.from(table).select("*").order(orderBy, { ascending: false }).range(from, from + PAGE - 1);
    if (error) {
      if (optional) return null;
      throw new Error(`Не удалось прочитать «${table}»: ${error.message}`);
    }
    rows.push(...(data || []));
    if (!data || data.length < PAGE) break;
  }
  return rows;
}

// Строки сайта приводим к виду, который понимает buildFullExcelBackupWorkbook:
// { id, data, deleted_at, deleted_by }; записи из корзины попадают в те же листы с отметкой «Удалён».
export function cloudSnapshot({ contracts = [], investors = [], withdrawals = [], expenses = null, trash = [], actions = [], drafts = [] }, createdAt = new Date().toISOString()) {
  const live = (rows) => rows.map((r) => ({ id: r.id, data: r }));
  const trashed = (type) => trash.filter((t) => t.entity_type === type)
    .map((t) => ({ id: t.entity_id, data: t.data || {}, deleted_at: t.deleted_at, deleted_by: t.deleted_by || "" }));
  return {
    createdAt,
    note: "Копия всех данных сайта на момент скачивания. Сайт также сам делает ежедневные копии на сервере — из них данные можно восстановить в «Истории».",
    contracts: [...live(contracts), ...trashed("contracts")],
    investors: [...live(investors), ...trashed("investors")],
    withdrawals: [...live(withdrawals), ...trashed("withdrawals")],
    ...(expenses ? { expenses: [...live(expenses), ...trashed("expenses")] } : {}),
    actions,
    drafts,
    deletedReceipts: trash.filter((t) => t.entity_type === "receipts").map((t) => ({
      id: t.id, contract_id: t.contract_id, payment_index: t.payment_index, data: t.data, deleted_at: t.deleted_at, deleted_by: t.deleted_by || "",
    })),
  };
}

export const backupFileName = (date = new Date()) => {
  const p = (n) => String(n).padStart(2, "0");
  return `Eppaz_копия_${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())}_${p(date.getHours())}-${p(date.getMinutes())}.xlsx`;
};

export async function downloadCloudBackup(supabase) {
  const [contracts, investors, withdrawals, expenses, trash, actions, drafts] = await Promise.all([
    readAll(supabase, "contracts", "created_at"),
    readAll(supabase, "investors", "created_at"),
    readAll(supabase, "withdrawals", "created_at"),
    readAll(supabase, "expenses", "date", { optional: true }),
    readAll(supabase, "trash_items", "deleted_at", { optional: true }),
    readAll(supabase, "action_log", "occurred_at", { optional: true, limit: 20000 }),
    readAll(supabase, "drafts", "updated_at", { optional: true }),
  ]);
  const XLSX = await import("xlsx");
  const { buildFullExcelBackupWorkbook } = await import("./excelBackup");
  const snapshot = cloudSnapshot({ contracts, investors, withdrawals, expenses, trash: trash || [], actions: actions || [], drafts: drafts || [] });
  XLSX.writeFile(buildFullExcelBackupWorkbook(XLSX, snapshot), backupFileName(), { compression: true });
  return { contracts: contracts.length, expenses: expenses ? expenses.length : 0 };
}
