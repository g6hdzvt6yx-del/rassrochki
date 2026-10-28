import React, { useMemo, useState } from 'react';
import {
  kindInfo, DIRECTORY_DEFAULTS, PASSPORT_FIELDS, validateDirectoryData, findDuplicate, itemLabel,
  itemReferences, candidatesFromContracts, insertDirectoryItems, updateDirectoryItem, deleteDirectoryItem,
} from './directoryCatalog';
import { normalizePhone } from './phone';

const money = (n) => `${new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 2 }).format(+n || 0)} ₽`;
const norm = (v) => String(v ?? '').trim().toLocaleLowerCase('ru');

// Значение поля для строки списка: подпись варианта, имя связанной записи, сумма.
function displayValue(field, value, items) {
  if (value == null || value === '') return '';
  if (field.type === 'select') return field.options.find(([v]) => v === value)?.[1] || value;
  if (field.type === 'ref') return itemLabel(items.find((i) => i.id === value)) || 'запись удалена';
  if (field.type === 'money') return money(value);
  if (field.type === 'last4') return `•• ${value}`;
  if (field.type === 'passport') {
    const p = value || {};
    return [p.series || p.number ? `${p.series || ''} ${p.number || ''}`.trim() : '', p.issueDate && `выдан ${p.issueDate}`].filter(Boolean).join(', ') || 'заполнены';
  }
  return String(value);
}

const contractsOfClient = (client, contracts) => contracts.filter((c) => (
  normalizePhone(client.data.phone) && normalizePhone(c.phone)
    ? normalizePhone(c.phone) === normalizePhone(client.data.phone)
    : norm(c.clientName) === norm(client.data.name)
));

export default function DirectoryCatalog({ kind, items, contracts, onItemsChange, db }) {
  const info = kindInfo(kind);
  const [query, setQuery] = useState('');
  const [editing, setEditing] = useState(null); // null | { item?: запись, values: {} }
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const list = useMemo(() => items.filter((i) => i.kind === kind), [items, kind]);
  const q = norm(query);
  const digits = query.replace(/\D/g, '');
  const shown = list
    .filter((i) => !q || Object.values(i.data).some((v) => typeof v === 'string' && norm(v).includes(q))
      || (digits.length > 2 && String(i.data.phone || '').replace(/\D/g, '').includes(digits)))
    .sort((a, b) => String(a.data.name || '').localeCompare(String(b.data.name || ''), 'ru'));

  const defaults = (DIRECTORY_DEFAULTS[kind] || []).filter((d) => !findDuplicate(list, kind, d));
  const fromContracts = useMemo(() => candidatesFromContracts(kind, contracts, items), [kind, contracts, items]);

  const run = async (action, success) => {
    setBusy(true); setError(''); setNotice('');
    try { await action(); if (success) setNotice(success); return true; }
    catch (err) { setError(err.message || String(err)); return false; }
    finally { setBusy(false); }
  };

  const addMany = (list, success) => run(async () => {
    const saved = await insertDirectoryItems(db, kind, list);
    onItemsChange((prev) => [...prev, ...saved]);
  }, success);

  const save = (e) => {
    e.preventDefault();
    const { item, values } = editing;
    run(async () => {
      const data = validateDirectoryData(kind, values);
      const twin = findDuplicate(list, kind, data, item?.id);
      if (twin && !window.confirm(`В справочнике уже есть «${itemLabel(twin)}». Всё равно сохранить?`)) throw new Error('Сохранение отменено.');
      if (item) {
        const saved = await updateDirectoryItem(db, item, data);
        onItemsChange((prev) => prev.map((i) => (i.id === saved.id ? saved : i)));
      } else {
        const saved = await insertDirectoryItems(db, kind, [data]);
        onItemsChange((prev) => [...prev, ...saved]);
      }
      setEditing(null);
    }, item ? 'Изменения сохранены.' : 'Запись добавлена.');
  };

  const remove = (item) => {
    const refs = itemReferences(items, item);
    const msg = refs.length
      ? `Удалить «${itemLabel(item)}»? На запись ссылаются: ${refs.length} (например, «${itemLabel(refs[0])}»). У них связь станет «запись удалена».`
      : `Удалить «${itemLabel(item)}»?`;
    if (!window.confirm(msg)) return;
    run(async () => {
      await deleteDirectoryItem(db, item.id);
      onItemsChange((prev) => prev.filter((i) => i.id !== item.id));
      if (editing?.item?.id === item.id) setEditing(null);
    }, 'Запись удалена.');
  };

  const setValue = (key, value) => setEditing((prev) => ({ ...prev, values: { ...prev.values, [key]: value } }));
  const listFields = info.fields.filter((f) => f.key !== 'name' && f.type !== 'textarea');

  return (
    <div className="directory-catalog">
      <div className="directory-toolbar">
        <h2>{info.title}</h2>
        <button className="btn primary" disabled={busy} onClick={() => { setEditing({ values: {} }); setError(''); setNotice(''); }}>
          Добавить {info.one}
        </button>
        {defaults.length > 0 && (
          <button className="btn ghost" disabled={busy} onClick={() => addMany(defaults, `Добавлено стандартных записей: ${defaults.length}.`)}>
            Добавить стандартные: {defaults.map((d) => d.name).join(', ')}
          </button>
        )}
        {fromContracts.length > 0 && (
          <button
            className="btn ghost" disabled={busy}
            onClick={() => window.confirm(`Перенести из договоров записей: ${fromContracts.length}? Совпадающие с уже внесёнными пропускаются.`)
              && addMany(fromContracts, `Перенесено из договоров: ${fromContracts.length}.`)}
          >
            Перенести из договоров · {fromContracts.length}
          </button>
        )}
      </div>

      {notice && <p role="status" className="directory-notice">{notice}</p>}
      {error && !editing && <p role="alert">{error}</p>}

      {editing && (
        <form className="panel directory-editor" onSubmit={save}>
          <h2>{editing.item ? `Изменить: ${itemLabel(editing.item)}` : `Новая запись — ${info.title.toLocaleLowerCase('ru')}`}</h2>
          <div className="directory-form-grid">
            {info.fields.map((field) => (
              <DirectoryField key={field.key} field={field} value={editing.values[field.key]} items={items} disabled={busy} onChange={(v) => setValue(field.key, v)} />
            ))}
          </div>
          {error && <p role="alert">{error}</p>}
          <div className="directory-actions">
            <button className="btn primary" disabled={busy}>{busy ? 'Сохранение…' : 'Сохранить'}</button>
            <button className="btn ghost" type="button" disabled={busy} onClick={() => { setEditing(null); setError(''); }}>Отмена</button>
          </div>
        </form>
      )}

      <label className="directory-search">Поиск<input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Начните вводить…" /></label>
      <p className="muted">Найдено: {shown.length}{shown.length !== list.length ? ` из ${list.length}` : ''}</p>

      <section className="panel directory-list">
        {!shown.length ? <p>{list.length ? 'Ничего не найдено.' : 'Справочник пока пуст.'}</p> : shown.map((item, index) => {
          const facts = listFields.map((f) => [f, displayValue(f, item.data[f.key], items)]).filter(([, v]) => v);
          const linked = kind === 'clients' ? contractsOfClient(item, contracts).length : null;
          const guarantors = kind === 'clients' ? itemReferences(items, item).filter((i) => i.kind === 'guarantors').length : 0;
          return (
            <article className="directory-row" key={item.id}>
              <div>
                <strong>{index + 1}. {itemLabel(item)}</strong>
                {facts.length > 0 && (
                  <dl className="directory-facts">
                    {facts.map(([f, v]) => <div key={f.key}><dt>{f.label}</dt><dd>{v}</dd></div>)}
                  </dl>
                )}
                {item.data.note && <p className="directory-note">{item.data.note}</p>}
                {linked !== null && <small>Договоров: {linked}{guarantors ? ` · Поручителей: ${guarantors}` : ''}</small>}
              </div>
              <div className="directory-row-actions">
                <button className="btn ghost btn-sm" disabled={busy} onClick={() => { setEditing({ item, values: { ...item.data } }); setError(''); setNotice(''); }}>Изменить</button>
                <button className="btn ghost btn-sm" disabled={busy} onClick={() => remove(item)}>Удалить</button>
              </div>
            </article>
          );
        })}
      </section>
    </div>
  );
}

function DirectoryField({ field, value, items, disabled, onChange }) {
  if (field.type === 'passport') {
    const passport = value || {};
    return (
      <fieldset className="directory-passport" disabled={disabled}>
        <legend>{field.label}</legend>
        {PASSPORT_FIELDS.map(([key, label]) => (
          <label key={key}>{label}<input value={passport[key] || ''} onChange={(e) => onChange({ ...passport, [key]: e.target.value })} /></label>
        ))}
      </fieldset>
    );
  }
  const label = `${field.label}${field.required ? ' *' : ''}`;
  if (field.type === 'select' || field.type === 'ref') {
    const options = field.type === 'select'
      ? field.options
      : items.filter((i) => i.kind === field.ref).map((i) => [i.id, itemLabel(i)]).sort((a, b) => a[1].localeCompare(b[1], 'ru'));
    return (
      <label>{label}
        <select value={value || ''} disabled={disabled} required={field.required} onChange={(e) => onChange(e.target.value)}>
          <option value="">{field.type === 'ref' && !options.length ? 'Справочник пуст' : 'Не выбрано'}</option>
          {options.map(([v, text]) => <option key={v} value={v}>{text}</option>)}
          {value && !options.some(([v]) => v === value) && <option value={value}>запись удалена</option>}
        </select>
      </label>
    );
  }
  if (field.type === 'textarea') {
    return <label className="directory-wide">{label}<textarea rows={2} value={value || ''} disabled={disabled} onChange={(e) => onChange(e.target.value)} /></label>;
  }
  const inputProps = field.type === 'money' ? { inputMode: 'decimal' }
    : field.type === 'tel' ? { type: 'tel' }
    : field.type === 'last4' ? { inputMode: 'numeric', maxLength: 4, pattern: '\\d{4}' } : {};
  return (
    <label>{label}
      <input {...inputProps} value={value ?? ''} disabled={disabled} required={field.required} placeholder={field.placeholder}
        onChange={(e) => onChange(e.target.value)} />
    </label>
  );
}
