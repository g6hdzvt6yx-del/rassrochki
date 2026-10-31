import React, { useState } from 'react';
import { ClipboardList, History, X } from 'lucide-react';
import { MARK_TONE, markLabel } from './operatorMarks';

const LONG_NOTE = 90;
const dateTime = (iso) => {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }).format(date);
};
const dayOnly = (iso) => {
  if (!iso) return '';
  const date = new Date(String(iso).length === 10 ? iso + 'T00:00:00' : iso);
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleDateString('ru-RU');
};
const rub = (n) => `${Math.round(+n || 0).toLocaleString('ru-RU')} ₽`;
const stop = (e) => e.stopPropagation();
const byLine = (mark) => [dateTime(mark.at), mark.authorName].filter(Boolean).join(' · ');

function MarkNote({ note }) {
  const [open, setOpen] = useState(false);
  if (!note) return null;
  const long = note.length > LONG_NOTE;
  return <span className="op-mark-note">
    <span className={long && !open ? 'clamped' : ''}>{note}</span>
    {long && <button type="button" className="op-mark-more" aria-expanded={open}
      onClick={(e) => { stop(e); setOpen((v) => !v); }} onKeyDown={stop}>{open ? 'Свернуть' : 'Показать полностью'}</button>}
  </span>;
}

function MarkMeta({ mark }) {
  const parts = [];
  if (mark.promisedDate || mark.promisedAmount > 0) parts.push(`обещал ${mark.promisedDate ? dayOnly(mark.promisedDate) : ''}${mark.promisedAmount > 0 ? ` · ${rub(mark.promisedAmount)}` : ''}`.trim());
  if (mark.nextContactAt) parts.push(`перезвонить ${String(mark.nextContactAt).length === 10 ? dayOnly(mark.nextContactAt) : dateTime(mark.nextContactAt)}`);
  return parts.length ? <small className="op-mark-extra">{parts.join(' · ')}</small> : null;
}

export const MarkTag = ({ mark }) => <span className={`op-mark-tag ${MARK_TONE[mark.result] || ''}`}>{markLabel(mark)}</span>;

// Последняя отметка оператора для карточки договора и строки таблицы.
export function OperatorMarkSummary({ marks = [], onHistory, compact = false }) {
  const latest = marks[0];
  if (!latest) return <span className={`op-mark empty ${compact ? 'compact' : ''}`}><ClipboardList size={13} /> Нет отметок</span>;
  return <span className={`op-mark ${compact ? 'compact' : ''}`}>
    <span className="op-mark-hd">
      <MarkTag mark={latest} />
      <span className="op-mark-by">{byLine(latest)}</span>
    </span>
    <MarkNote note={latest.note} key={latest.id} />
    <MarkMeta mark={latest} />
    {onHistory && <button type="button" className="op-mark-history" onClick={(e) => { stop(e); onHistory(); }} onKeyDown={stop}>
      <History size={12} /> История отметок{marks.length > 1 ? ` (${marks.length})` : ''}
    </button>}
  </span>;
}

// Компактная ячейка таблицы: статус, дата, автор и одна строка комментария. Нажатие — полная история.
export function OperatorMarkCell({ marks = [], onHistory }) {
  const latest = marks[0];
  if (!latest) return <span className="mark-cell is-empty">Нет отметок</span>;
  const shortDate = (() => { const d = new Date(latest.at); return Number.isNaN(d.getTime()) ? '' : new Intl.DateTimeFormat('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }).format(d); })();
  const title = [markLabel(latest), dateTime(latest.at), latest.authorName, latest.note].filter(Boolean).join('\n');
  const body = <>
    <span className="mark-cell-hd"><MarkTag mark={latest} />{marks.length > 1 && <span className="mark-cell-count" aria-label={`Всего отметок: ${marks.length}`}>{marks.length}</span>}</span>
    <span className="mark-cell-by">{[shortDate, latest.authorName].filter(Boolean).join(' · ')}</span>
    {latest.note && <span className="mark-cell-note">{latest.note}</span>}
  </>;
  return onHistory
    ? <button type="button" className="mark-cell" title={`${title}\n\nНажмите — история отметок`} aria-label={`История отметок: ${markLabel(latest)}`} onClick={onHistory}>{body}</button>
    : <span className="mark-cell" title={title}>{body}</span>;
}

// Дата следующего действия из структурированных полей отметки.
const shortWhen = (value) => {
  if (!value) return '';
  if (String(value).length === 10) return dayOnly(value).slice(0, 5);
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  const time = d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
  return `${d.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' })}${time === '00:00' ? '' : ' ' + time}`;
};
export function NextActionCell({ action }) {
  if (!action) return <span className="next-cell is-empty">—</span>;
  return <span className="next-cell">{action.items.map((item) => <span key={item.kind} className={`next-item ${item.state}`} title={`${item.label}: ${item.kind === 'callback' ? dateTime(item.at) || dayOnly(item.at) : dayOnly(item.at)}${item.amount ? ' · ' + rub(item.amount) : ''}${item.state === 'late' ? ' — срок прошёл' : ''}`}>
    <b>{shortWhen(item.at)}</b><small>{item.kind === 'callback' ? 'перезвонить' : `оплата${item.amount ? ' ' + rub(item.amount) : ''}`}</small>
  </span>)}</span>;
}

// Полная история отметок договора: автор, дата и время каждой записи.
export function OperatorMarksHistory({ contract, marks = [], error, onClose, onOpenContract }) {
  return <div className="overlay" onClick={onClose}>
    <div className="sheet" role="dialog" aria-modal="true" aria-label="История отметок оператора" onClick={stop}>
      <div className="sheet-hd">
        <div><div className="sheet-name">История отметок</div><small className="muted">{contract.clientName}{contract.item ? ` · ${contract.item}` : ''}</small></div>
        <button className="icon-btn" onClick={onClose} aria-label="Закрыть"><X size={18} /></button>
      </div>
      <div className="sheet-body">
        {error && <p className="op-marks-error" role="status">{error}</p>}
        {!marks.length ? <div className="empty">Нет отметок</div> : <ol className="op-marks-list">
          {marks.map((mark) => <li key={mark.id} className="op-marks-item">
            <div className="op-mark-hd"><MarkTag mark={mark} /><span className="op-mark-by">{byLine(mark)}</span></div>
            {mark.note ? <p>{mark.note}</p> : <p className="muted">Без комментария</p>}
            <MarkMeta mark={mark} />
          </li>)}
        </ol>}
        <p className="op-marks-foot muted">Записей: {marks.length}. Новые отметки добавляются в историю, предыдущие сохраняются.</p>
        {onOpenContract && <button type="button" className="btn ghost btn-sm" onClick={onOpenContract}>Открыть договор и добавить отметку</button>}
      </div>
    </div>
  </div>;
}
