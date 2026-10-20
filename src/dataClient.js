import { supabase as cloudClient, supabaseConfigured as cloudConfigured } from "./supabaseClient";
import { guardedCloudClient } from "./guardedCloudClient";
import { runLocalTask } from "./localTasks";

export const isDesktopApp = Boolean(window.__TAURI_INTERNALS__);

let databasePromise;
const getDatabase = async () => {
  if (!databasePromise) {
    databasePromise = import("@tauri-apps/plugin-sql").then(({ default: Database }) =>
      Database.load("sqlite:rassrochki.db").then(async (db) => {
        // Replay durable draft intents left by an interrupted write or a crash.
        for (const key of Object.keys(localStorage).filter((key) => key.startsWith('rassrochki-draft:'))) {
          const serialized = localStorage.getItem(key);
          const intent = JSON.parse(serialized);
          if (intent.remove) await db.execute('DELETE FROM drafts WHERE id=$1', [intent.id]);
          else await writeDraft(db, intent);
          if (localStorage.getItem(key) === serialized) localStorage.removeItem(key);
        }
        return db;
      })
    );
  }
  return databasePromise;
};

const writeDraft = (db, draft) => db.execute(
  `INSERT INTO drafts (id,draft_type,title,data,completion,updated_at) VALUES ($1,$2,$3,$4,$5,CURRENT_TIMESTAMP)
   ON CONFLICT(id) DO UPDATE SET draft_type=$2,title=$3,data=$4,completion=$5,updated_at=CURRENT_TIMESTAMP`,
  [draft.id, draft.draftType, draft.title || 'Без названия', JSON.stringify(draft.data || {}), draft.completion || 0],
);

let currentActionSource = "Mac";
export const setActionSource = (source = "Mac") => { currentActionSource = source; };
let suppressNextAutomaticLog = false;
export const suppressNextActionLog = () => { if (isDesktopApp) suppressNextAutomaticLog = true; };

const entityName = (item = {}) =>
  item.client_name || item.clientName || item.name || item.note || item.item || item.id || "";

const safeSnapshot = (value) => {
  if (value == null) return null;
  const blocked = /password|secret|token|anon.?key|api.?key/i;
  if (Array.isArray(value)) return value.map(safeSnapshot);
  if (typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value)
    .filter(([key]) => !blocked.test(key))
    .map(([key, child]) => [key, safeSnapshot(child)]));
};

const writeActionLog = async (db, entry) => {
  await db.execute(
    `INSERT INTO action_log
      (action_type, entity_type, entity_id, entity_name, before_json, after_json, source, result, error_message, contract_id, investor_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
    [
      entry.actionType, entry.entityType, entry.entityId || null, entry.entityName || null,
      entry.before ? JSON.stringify(safeSnapshot(entry.before)) : null,
      entry.after ? JSON.stringify(safeSnapshot(entry.after)) : null,
      entry.source || currentActionSource, entry.result || "success", entry.errorMessage || null,
      entry.contractId || (entry.entityType === "contracts" ? entry.entityId : null),
      entry.investorId || (entry.entityType === "investors" ? entry.entityId : null),
    ]
  );
};

class LocalQuery {
  constructor(table) {
    if (!["contracts", "investors", "withdrawals"].includes(table)) throw new Error("Недопустимая таблица локальной базы");
    this.table = table;
    this.action = "select";
    this.payload = null;
    this.filter = null;
  }

  select() { this.action = "select"; return this; }
  order() { return this; }
  insert(value) { this.action = "insert"; this.payload = value; return this; }
  update(value) { this.action = "update"; this.payload = value; return this; }
  delete() { this.action = "delete"; return this; }
  eq(column, value) { this.filter = { column, value }; return this; }
  then(resolve, reject) { runLocalTask(() => this.run(), this.action !== 'select').then(resolve, reject); }

  async run() {
    try {
      const db = await getDatabase();
      if (this.action === "select") {
        const rows = await db.select(`SELECT data FROM ${this.table} WHERE deleted_at IS NULL ORDER BY created_at DESC`);
        return { data: rows.map((row) => JSON.parse(row.data)), error: null };
      }

      if (this.action === "insert") {
        const items = Array.isArray(this.payload) ? this.payload : [this.payload];
        for (const item of items) {
          await db.execute(
            `INSERT OR REPLACE INTO ${this.table} (id, data) VALUES ($1, $2)`,
            [item.id, JSON.stringify(item)]
          );
          await writeActionLog(db, {
            actionType: "create", entityType: this.table, entityId: item.id,
            entityName: entityName(item), after: item,
          });
        }
        return { data: items, error: null };
      }

      if (!this.filter || this.filter.column !== "id") throw new Error("Локальная база поддерживает изменение только по id");
      const id = this.filter.value;
      if (this.action === "delete") {
        const rows = await db.select(`SELECT data FROM ${this.table} WHERE id = $1`, [id]);
        const previous = rows.length ? JSON.parse(rows[0].data) : null;
        const deletedAt = new Date().toISOString();
        await db.execute(
          `UPDATE ${this.table} SET deleted_at = $1, deleted_by = 'local-mac-user' WHERE id = $2`,
          [deletedAt, id]
        );
        await writeActionLog(db, {
          actionType: "move_to_trash", entityType: this.table, entityId: id,
          entityName: entityName(previous), before: previous,
        });
        return { data: null, error: null };
      }

      const rows = await db.select(`SELECT data FROM ${this.table} WHERE id = $1`, [id]);
      if (!rows.length) throw new Error("Запись в локальной базе не найдена");
      const updated = { ...JSON.parse(rows[0].data), ...this.payload, id };
      const previous = JSON.parse(rows[0].data);
      await db.execute(`UPDATE ${this.table} SET data = $1 WHERE id = $2`, [JSON.stringify(updated), id]);
      const skipLog = suppressNextAutomaticLog;
      suppressNextAutomaticLog = false;
      if (!skipLog) await writeActionLog(db, {
          actionType: this.table === "contracts" && this.payload?.payments ? "update_payment" : "update",
          entityType: this.table, entityId: id, entityName: entityName(updated), before: previous, after: updated,
          investorId: updated.investor_id || null,
        });
      return { data: updated, error: null };
    } catch (error) {
      suppressNextAutomaticLog = false;
      try {
        const db = await getDatabase();
        await writeActionLog(db, {
          actionType: this.action, entityType: this.table, entityId: this.filter?.value,
          result: "error", errorMessage: error?.message || String(error),
        });
      } catch { /* исходная ошибка важнее ошибки журналирования */ }
      return { data: null, error: { message: error?.message || String(error) } };
    }
  }
}

export const localData = {
  async createBackup(reason = "Ручная копия") {
    if (!isDesktopApp) return null;
    const db = await getDatabase();
    const integrity = await db.select("PRAGMA quick_check");
    const integrityResult = integrity?.[0]?.quick_check || integrity?.[0]?.integrity_check || "";
    if (integrityResult !== "ok") throw new Error(`Локальная база не прошла проверку: ${integrityResult || "неизвестная ошибка"}`);
    const { copyFile, mkdir, readDir, exists, stat, writeTextFile } = await import("@tauri-apps/plugin-fs");
    const { invoke } = await import("@tauri-apps/api/core");
    const { BaseDirectory } = await import("@tauri-apps/api/path");
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const root = `backups/${stamp}`;
    await mkdir(root, { baseDir: BaseDirectory.AppData, recursive: true });
    await invoke('create_database_snapshot', { backupName: stamp });
    const copyDirectory = async (source, target) => {
      await mkdir(target, { baseDir: BaseDirectory.AppData, recursive: true });
      if (!await exists(source, { baseDir: BaseDirectory.AppData })) return;
      const entries = await readDir(source, { baseDir: BaseDirectory.AppData });
      for (const entry of entries) {
        const from = `${source}/${entry.name}`, to = `${target}/${entry.name}`;
        if (entry.isDirectory) await copyDirectory(from, to);
        else if (entry.isFile) await copyFile(from, to, { fromPathBaseDir: BaseDirectory.AppData, toPathBaseDir: BaseDirectory.AppData });
      }
    };
    await copyDirectory("receipts", `${root}/receipts`);
    await copyDirectory("receipt-trash", `${root}/receipt-trash`);
    await invoke('verify_backup', { backupName: stamp });
    const backupInfo = await stat(`${root}/rassrochki.db`, { baseDir: BaseDirectory.AppData });
    await writeTextFile(`${root}/manifest.json`, JSON.stringify({
      createdAt: new Date().toISOString(), reason, databaseSize: backupInfo.size,
      integrity: integrityResult, formatVersion: 2,
    }, null, 2), { baseDir: BaseDirectory.AppData });
    await db.execute(
      "INSERT INTO app_settings (key,value,updated_at) VALUES ('last_backup_at',$1,CURRENT_TIMESTAMP) ON CONFLICT(key) DO UPDATE SET value=$1,updated_at=CURRENT_TIMESTAMP",
      [new Date().toISOString()]
    );
    await writeActionLog(db, { actionType: "backup", entityType: "backup", entityName: reason, after: { path: root } });
    window.dispatchEvent(new CustomEvent('rassrochki-backup', { detail: { at: new Date().toISOString() } }));
    return root;
  },
  async ensureDailyBackup() {
    if (!isDesktopApp) return null;
    const db = await getDatabase();
    const rows = await db.select("SELECT value FROM app_settings WHERE key = 'last_backup_at'");
    const previousDay = rows?.[0]?.value ? new Date(rows[0].value).toLocaleDateString('sv-SE') : '';
    const today = new Date().toLocaleDateString('sv-SE');
    return previousDay === today ? null : this.createBackup("Автоматическая ежедневная копия");
  },
  async createExcelBackup(reason = "Автоматическая ежедневная Excel-копия") {
    if (!isDesktopApp) return null;
    const db = await getDatabase();
    const integrity = await db.select("PRAGMA quick_check");
    const integrityResult = integrity?.[0]?.quick_check || integrity?.[0]?.integrity_check || "";
    if (integrityResult !== "ok") throw new Error(`Локальная база не прошла проверку: ${integrityResult || "неизвестная ошибка"}`);
    const [contracts, investors, withdrawals, actions, drafts, deletedReceipts] = await Promise.all([
      db.select("SELECT id,data,deleted_at,deleted_by FROM contracts ORDER BY created_at DESC"),
      db.select("SELECT id,data,deleted_at,deleted_by FROM investors ORDER BY created_at DESC"),
      db.select("SELECT id,data,deleted_at,deleted_by FROM withdrawals ORDER BY created_at DESC"),
      db.select("SELECT * FROM action_log ORDER BY occurred_at DESC"),
      db.select("SELECT * FROM drafts ORDER BY updated_at DESC"),
      db.select("SELECT * FROM deleted_receipts ORDER BY deleted_at DESC"),
    ]);
    const XLSX = await import("xlsx");
    const { buildFullExcelBackupWorkbook } = await import("./excelBackup");
    const workbook = buildFullExcelBackupWorkbook(XLSX, {
      createdAt: new Date().toISOString(), contracts, investors, withdrawals, actions, drafts, deletedReceipts,
    });
    const bytes = new Uint8Array(XLSX.write(workbook, { type: "array", bookType: "xlsx", compression: true }));
    const { mkdir, readDir, remove, stat, writeFile } = await import("@tauri-apps/plugin-fs");
    const { BaseDirectory } = await import("@tauri-apps/api/path");
    const now = new Date();
    const day = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
    const directory = "excel-backups";
    const path = `${directory}/Рассрочки-${day}.xlsx`;
    await mkdir(directory, { baseDir: BaseDirectory.AppData, recursive: true });
    await writeFile(path, bytes, { baseDir: BaseDirectory.AppData });
    const info = await stat(path, { baseDir: BaseDirectory.AppData });
    if (!info.size) throw new Error("Excel-копия получилась пустой");
    await db.execute(
      "INSERT INTO app_settings (key,value,updated_at) VALUES ('last_excel_backup_at',$1,CURRENT_TIMESTAMP) ON CONFLICT(key) DO UPDATE SET value=$1,updated_at=CURRENT_TIMESTAMP",
      [new Date().toISOString()]
    );
    const files = (await readDir(directory, { baseDir: BaseDirectory.AppData }))
      .filter((entry) => entry.isFile && /^Рассрочки-\d{4}-\d{2}-\d{2}\.xlsx$/.test(entry.name))
      .sort((left, right) => right.name.localeCompare(left.name));
    for (const old of files.slice(90)) await remove(`${directory}/${old.name}`, { baseDir: BaseDirectory.AppData });
    await writeActionLog(db, {
      actionType: "excel_backup", entityType: "backup", entityName: reason,
      after: { path, size: info.size, sheets: workbook.SheetNames.length },
    });
    return path;
  },
  async ensureDailyExcelBackup() {
    if (!isDesktopApp) return null;
    const db = await getDatabase();
    const rows = await db.select("SELECT value FROM app_settings WHERE key = 'last_excel_backup_at'");
    const previous = rows?.[0]?.value ? new Date(rows[0].value) : null;
    const now = new Date();
    const sameDay = previous && !Number.isNaN(previous.getTime())
      && previous.getFullYear() === now.getFullYear()
      && previous.getMonth() === now.getMonth()
      && previous.getDate() === now.getDate();
    return sameDay ? null : this.createExcelBackup();
  },
  async revealExcelBackups() {
    const { mkdir } = await import("@tauri-apps/plugin-fs");
    const { BaseDirectory, appDataDir, join } = await import("@tauri-apps/api/path");
    const { revealItemInDir } = await import("@tauri-apps/plugin-opener");
    await mkdir("excel-backups", { baseDir: BaseDirectory.AppData, recursive: true });
    await revealItemInDir(await join(await appDataDir(), "excel-backups"));
  },
  async listBackups() {
    if (!isDesktopApp) return [];
    const { readDir, readTextFile, stat } = await import("@tauri-apps/plugin-fs");
    const { BaseDirectory } = await import("@tauri-apps/api/path");
    let entries = [];
    try { entries = await readDir("backups", { baseDir: BaseDirectory.AppData }); } catch { return []; }
    const rows = [];
    for (const entry of entries.filter((item) => item.isDirectory).sort((a, b) => b.name.localeCompare(a.name))) {
      try {
        const info = await stat(`backups/${entry.name}/rassrochki.db`, { baseDir: BaseDirectory.AppData });
        let manifest = {};
        try { manifest = JSON.parse(await readTextFile(`backups/${entry.name}/manifest.json`, { baseDir: BaseDirectory.AppData })); } catch { /* старая копия */ }
        rows.push({ name: entry.name, size: info.size, createdAt: manifest.createdAt || entry.name, reason: manifest.reason || "Старая резервная копия", verified: manifest.integrity === "ok" });
      } catch { /* неполная папка не считается резервной копией */ }
    }
    return rows;
  },
  async revealBackups() {
    const { appDataDir, join } = await import("@tauri-apps/api/path");
    const { revealItemInDir } = await import("@tauri-apps/plugin-opener");
    await revealItemInDir(await join(await appDataDir(), "backups"));
  },
  async exportBackup(backupName, destinationDirectory) {
    if (!/^\d{4}-\d{2}-\d{2}T[\w-]+Z$/.test(backupName)) throw new Error("Некорректное имя резервной копии");
    const { copyFile, mkdir, readDir } = await import("@tauri-apps/plugin-fs");
    const { BaseDirectory, join } = await import("@tauri-apps/api/path");
    const targetRoot = await join(destinationDirectory, `Рассрочки-копия-${backupName}`);
    const copyDirectory = async (source, target) => {
      await mkdir(target, { recursive: true });
      const entries = await readDir(source, { baseDir: BaseDirectory.AppData });
      for (const entry of entries) {
        const from = `${source}/${entry.name}`, to = await join(target, entry.name);
        if (entry.isDirectory) await copyDirectory(from, to);
        else if (entry.isFile) await copyFile(from, to, { fromPathBaseDir: BaseDirectory.AppData });
      }
    };
    await copyDirectory(`backups/${backupName}`, targetRoot);
    await writeActionLog(await getDatabase(), { actionType: "export_backup", entityType: "backup", entityName: backupName, after: { destination: targetRoot } });
    return targetRoot;
  },
  async stageBackupRestore(backupName) {
    if (!/^\d{4}-\d{2}-\d{2}T[\w-]+Z$/.test(backupName)) throw new Error("Некорректное имя резервной копии");
    const copies = await this.listBackups();
    if (!copies.some((backup) => backup.name === backupName)) throw new Error("Резервная копия не найдена");
    const { invoke } = await import('@tauri-apps/api/core');
    await invoke('verify_backup', { backupName });
    await this.createBackup("Контрольная копия перед восстановлением");
    const { writeTextFile } = await import("@tauri-apps/plugin-fs");
    const { BaseDirectory } = await import("@tauri-apps/api/path");
    await writeTextFile("restore-pending.txt", backupName, { baseDir: BaseDirectory.AppData });
    await writeActionLog(await getDatabase(), { actionType: "stage_restore", entityType: "backup", entityName: backupName, after: { restartRequired: true } });
  },
  async importBatch(investorRows, contractRows, contractPaymentRows, summary) {
    await getDatabase();
    const { invoke } = await import('@tauri-apps/api/core');
    await invoke('import_rows', { investors: investorRows, contracts: contractRows, payments: contractPaymentRows, summary });
  },
  async listActions(filters = {}) {
    if (!isDesktopApp) return [];
    const db = await getDatabase();
    const clauses = [], params = [];
    const add = (sql, value) => { params.push(value); clauses.push(sql.replace("?", `$${params.length}`)); };
    if (filters.entityType) add("entity_type = ?", filters.entityType);
    if (filters.actionType) add("action_type = ?", filters.actionType);
    if (filters.onlyErrors) clauses.push("result = 'error'");
    if (filters.from) add("occurred_at >= ?", filters.from);
    if (filters.to) add("occurred_at <= ?", filters.to);
    const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
    return db.select(`SELECT * FROM action_log ${where} ORDER BY occurred_at DESC LIMIT 1000`, params);
  },
  async listTrash() {
    if (!isDesktopApp) return [];
    const db = await getDatabase();
    const result = [];
    for (const table of ["contracts", "investors", "withdrawals"]) {
      const rows = await db.select(`SELECT id, data, deleted_at, deleted_by, deletion_reason FROM ${table} WHERE deleted_at IS NOT NULL ORDER BY deleted_at DESC`);
      rows.forEach((row) => result.push({ ...row, entityType: table, item: JSON.parse(row.data) }));
    }
    const receiptRows = await db.select("SELECT id, contract_id, payment_index, data, deleted_at, deleted_by FROM deleted_receipts ORDER BY deleted_at DESC");
    receiptRows.forEach((row) => result.push({ ...row, entityType: "receipts", item: JSON.parse(row.data) }));
    return result.sort((a, b) => String(b.deleted_at).localeCompare(String(a.deleted_at)));
  },
  async restore(entityType, id) {
    const db = await getDatabase();
    if (entityType === "receipts") {
      const rows = await db.select("SELECT * FROM deleted_receipts WHERE id = $1", [id]);
      if (!rows.length) throw new Error("Чек не найден в корзине");
      const row = rows[0], receipt = JSON.parse(row.data);
      const contracts = await db.select("SELECT data FROM contracts WHERE id = $1", [row.contract_id]);
      if (!contracts.length) throw new Error("Договор для чека не найден");
      const contract = JSON.parse(contracts[0].data);
      const payments = { ...(contract.payments || {}) };
      payments[row.payment_index] = { ...(payments[row.payment_index] || {}), receipt };
      contract.payments = payments;
      const { rename } = await import("@tauri-apps/plugin-fs");
      const { BaseDirectory } = await import("@tauri-apps/api/path");
      await rename(`receipt-trash/${receipt.path}`, `receipts/${receipt.path}`, { oldPathBaseDir: BaseDirectory.AppData, newPathBaseDir: BaseDirectory.AppData });
      try {
        await db.execute("BEGIN IMMEDIATE");
        await db.execute("UPDATE contracts SET data = $1 WHERE id = $2", [JSON.stringify(contract), row.contract_id]);
        await db.execute("DELETE FROM deleted_receipts WHERE id = $1", [id]);
        await writeActionLog(db, { actionType: "restore_receipt", entityType, entityId: id, entityName: receipt.name, contractId: row.contract_id, after: receipt });
        await db.execute("COMMIT");
      } catch (error) {
        try { await db.execute("ROLLBACK"); } catch { /* сохраняем исходную ошибку */ }
        try { await rename(`receipts/${receipt.path}`, `receipt-trash/${receipt.path}`, { oldPathBaseDir: BaseDirectory.AppData, newPathBaseDir: BaseDirectory.AppData }); } catch { /* журнал покажет исходную ошибку */ }
        throw error;
      }
      return;
    }
    const rows = await db.select(`SELECT data FROM ${entityType} WHERE id = $1`, [id]);
    if (!rows.length) throw new Error("Запись не найдена в корзине");
    const item = JSON.parse(rows[0].data);
    await db.execute(`UPDATE ${entityType} SET deleted_at = NULL, deleted_by = NULL, deletion_reason = NULL WHERE id = $1`, [id]);
    await writeActionLog(db, { actionType: "restore", entityType, entityId: id, entityName: entityName(item), after: item });
  },
  async permanentlyDelete(entityType, id) {
    const db = await getDatabase();
    if (entityType === "receipts") {
      const rows = await db.select("SELECT * FROM deleted_receipts WHERE id = $1", [id]);
      if (!rows.length) throw new Error("Чек не найден в корзине");
      const receipt = JSON.parse(rows[0].data);
      const { remove } = await import("@tauri-apps/plugin-fs");
      const { BaseDirectory } = await import("@tauri-apps/api/path");
      try { await remove(`receipt-trash/${receipt.path}`, { baseDir: BaseDirectory.AppData }); } catch { /* уже отсутствует */ }
      await db.execute("DELETE FROM deleted_receipts WHERE id = $1", [id]);
      await writeActionLog(db, { actionType: "permanent_delete_receipt", entityType, entityId: id, entityName: receipt.name, before: receipt });
      return;
    }
    const rows = await db.select(`SELECT data, deleted_at FROM ${entityType} WHERE id = $1`, [id]);
    if (!rows.length || !rows[0].deleted_at) throw new Error("Сначала переместите запись в корзину");
    const item = JSON.parse(rows[0].data);
    if (entityType === "investors") {
      const contracts = await db.select("SELECT data FROM contracts WHERE deleted_at IS NULL");
      const hasActive = contracts.some((row) => JSON.parse(row.data).investor_id === id);
      if (hasActive) throw new Error("Нельзя удалить вкладчика со связанными активными договорами");
    }
    await db.execute(`DELETE FROM ${entityType} WHERE id = $1`, [id]);
    await writeActionLog(db, { actionType: "permanent_delete", entityType, entityId: id, entityName: entityName(item), before: item });
  },
  async saveDraft(draft) {
    const db = await getDatabase();
    await writeDraft(db, draft);
  },
  async trashReceipt(receipt, contractId, paymentIndex) {
    const db = await getDatabase();
    const { rename, mkdir } = await import("@tauri-apps/plugin-fs");
    const { BaseDirectory } = await import("@tauri-apps/api/path");
    await mkdir(`receipt-trash/${receipt.path.slice(0, receipt.path.lastIndexOf("/"))}`, { baseDir: BaseDirectory.AppData, recursive: true });
    await rename(`receipts/${receipt.path}`, `receipt-trash/${receipt.path}`, { oldPathBaseDir: BaseDirectory.AppData, newPathBaseDir: BaseDirectory.AppData });
    try {
      await db.execute(
        "INSERT OR REPLACE INTO deleted_receipts (id, contract_id, payment_index, data) VALUES ($1,$2,$3,$4)",
        [receipt.path, contractId, paymentIndex, JSON.stringify(receipt)]
      );
      await writeActionLog(db, { actionType: "remove_receipt", entityType: "receipts", entityId: receipt.path, entityName: receipt.name, contractId, before: receipt });
    } catch (error) {
      try { await rename(`receipt-trash/${receipt.path}`, `receipts/${receipt.path}`, { oldPathBaseDir: BaseDirectory.AppData, newPathBaseDir: BaseDirectory.AppData }); } catch { /* сохраняем исходную ошибку */ }
      throw error;
    }
  },
  async listDrafts() {
    if (!isDesktopApp) return [];
    const db = await getDatabase();
    const rows = await db.select("SELECT * FROM drafts ORDER BY updated_at DESC");
    return rows.map((row) => ({ ...row, data: JSON.parse(row.data) }));
  },
  async deleteDraft(id) {
    const db = await getDatabase();
    await db.execute("DELETE FROM drafts WHERE id = $1", [id]);
  },
  async deleteOldDrafts(days = 30) {
    const db = await getDatabase();
    const rows = await db.select("SELECT id,title,updated_at FROM drafts WHERE updated_at < datetime('now', $1)", [`-${Math.max(1, days)} days`]);
    if (!rows.length) return 0;
    await db.execute("BEGIN IMMEDIATE");
    try {
      await db.execute("DELETE FROM drafts WHERE updated_at < datetime('now', $1)", [`-${Math.max(1, days)} days`]);
      await writeActionLog(db, { actionType: "delete_old_drafts", entityType: "drafts", entityName: `Удалено черновиков: ${rows.length}`, before: { drafts: rows } });
      await db.execute("COMMIT");
      return rows.length;
    } catch (error) {
      try { await db.execute("ROLLBACK"); } catch { /* исходная ошибка важнее */ }
      throw error;
    }
  },
  async log(entry) {
    if (!isDesktopApp) return;
    await writeActionLog(await getDatabase(), entry);
  },
  async backupStatus() {
    const rows = await (await getDatabase()).select("SELECT value FROM app_settings WHERE key='last_backup_at'");
    return rows[0]?.value || null;
  },
  async saveContract(record, creating) {
    await getDatabase();
    const { invoke } = await import('@tauri-apps/api/core');
    await invoke('save_contract', { record, creating });
    return { error: null };
  },
};

// Keep compound operations exclusive. Internal calls use the unwrapped methods.
const rawLocalData = { ...localData };
for (const name of Object.keys(rawLocalData)) {
  localData[name] = (...args) => {
    let key, intent;
    if (name === 'saveDraft' || name === 'deleteDraft') {
      intent = JSON.stringify(name === 'saveDraft' ? args[0] : { id: args[0], remove: true });
      key = `rassrochki-draft:${name === 'saveDraft' ? args[0].id : args[0]}`;
      try { localStorage.setItem(key, intent); } catch { /* SQLite write is still attempted; its failure is surfaced. */ }
    }
    return runLocalTask(async () => {
      const result = await rawLocalData[name].apply(rawLocalData, args);
      if (key && localStorage.getItem(key) === intent) localStorage.removeItem(key);
      return result;
    }, name === 'saveContract' || name === 'importBatch');
  };
}

const localStorageApi = {
  from() {
    const storage = {
      async upload(path, file) {
        try {
          const { writeFile, mkdir } = await import("@tauri-apps/plugin-fs");
          const { BaseDirectory } = await import("@tauri-apps/api/path");
          const folder = `receipts/${path.slice(0, path.lastIndexOf("/"))}`;
          await mkdir(folder, { baseDir: BaseDirectory.AppData, recursive: true });
          await writeFile(`receipts/${path}`, new Uint8Array(await file.arrayBuffer()), { baseDir: BaseDirectory.AppData });
          return { data: { path }, error: null };
        } catch (error) { return { data: null, error: { message: error?.message || String(error) } }; }
      },
      async remove(paths) {
        const { remove } = await import("@tauri-apps/plugin-fs");
        const { BaseDirectory } = await import("@tauri-apps/api/path");
        for (const path of paths) {
          try { await remove(`receipts/${path}`, { baseDir: BaseDirectory.AppData }); } catch { /* файл уже отсутствует */ }
        }
        return { data: null, error: null };
      },
      async createSignedUrl(path) {
        try {
          const { appDataDir, join } = await import("@tauri-apps/api/path");
          const { convertFileSrc } = await import("@tauri-apps/api/core");
          return { data: { signedUrl: convertFileSrc(await join(await appDataDir(), "receipts", path)) }, error: null };
        } catch (error) { return { data: null, error: { message: error?.message || String(error) } }; }
      },
    };
    return Object.fromEntries(Object.entries(storage).map(([name, method]) => [name, (...args) => runLocalTask(() => method(...args))]));
  },
};

const localSession = { user: { id: "local-mac-user", email: "Локальное хранилище Mac" } };
const localClient = {
  from: (table) => new LocalQuery(table),
  storage: localStorageApi,
  auth: {
    getSession: async () => ({ data: { session: localSession } }),
    onAuthStateChange: (callback) => {
      queueMicrotask(() => callback("SIGNED_IN", localSession));
      return { data: { subscription: { unsubscribe() {} } } };
    },
    signInWithPassword: async () => ({ data: { session: localSession }, error: null }),
    signOut: async () => ({ error: null }),
  },
};

export const supabase = isDesktopApp ? localClient : guardedCloudClient(cloudClient);
export const supabaseConfigured = isDesktopApp || cloudConfigured;
