import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { CalendarDays, ChevronLeft, ChevronRight, X } from 'lucide-react';

const iso = (date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
const dateLabel = (date) => new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' }).format(date);

export default function DateCalendar({ value, onChange }) {
  const [view, setView] = useState(null);
  const trigger = useRef(null);
  const panel = useRef(null);
  const close = (focus = false) => { setView(null); if (focus) trigger.current?.focus({ preventScroll: true }); };

  useEffect(() => {
    if (!view) return;
    const outside = (event) => {
      if (!panel.current?.contains(event.target) && !trigger.current?.contains(event.target)) close();
    };
    const escape = (event) => {
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(true); }
    };
    const reposition = (event) => { if (!panel.current?.contains(event.target)) close(); };
    document.addEventListener('pointerdown', outside);
    document.addEventListener('keydown', escape, true);
    window.addEventListener('resize', reposition);
    window.addEventListener('scroll', reposition, true);
    panel.current?.querySelector('[aria-pressed="true"]')?.focus({ preventScroll: true });
    return () => {
      document.removeEventListener('pointerdown', outside);
      document.removeEventListener('keydown', escape, true);
      window.removeEventListener('resize', reposition);
      window.removeEventListener('scroll', reposition, true);
    };
  }, [Boolean(view)]);

  const open = () => {
    if (view) { close(); return; }
    const parsed = value ? new Date(`${value}T00:00:00`) : new Date();
    const date = Number.isNaN(parsed.getTime()) ? new Date() : parsed;
    const rect = trigger.current.getBoundingClientRect();
    const width = Math.min(300, window.innerWidth - 16);
    const height = 344;
    setView({ year: date.getFullYear(), month: date.getMonth(), width,
      left: Math.max(8, Math.min(rect.right - width, window.innerWidth - width - 8)),
      top: rect.bottom + height + 8 <= window.innerHeight ? rect.bottom + 8 : Math.max(8, rect.top - height - 8),
    });
  };
  const select = (date) => { onChange(iso(date)); close(true); };
  const move = (delta) => setView((current) => {
    const date = new Date(current.year, current.month + delta, 1);
    return { ...current, year: date.getFullYear(), month: date.getMonth() };
  });
  const first = view ? (new Date(view.year, view.month, 1).getDay() + 6) % 7 : 0;
  const today = iso(new Date());

  return <>
    <button ref={trigger} type="button" className="date-picker-button" onClick={open}
      title="Выбрать дату в календаре" aria-label="Выбрать дату в календаре" aria-haspopup="dialog" aria-expanded={Boolean(view)}>
      <CalendarDays size={15}/>
    </button>
    {view && createPortal(<div ref={panel} className="date-calendar" role="dialog" aria-label="Выбор даты"
      style={{ top: view.top, left: view.left, width: view.width }} onClick={(event) => event.stopPropagation()}>
      <div className="date-calendar-head">
        <button type="button" aria-label="Предыдущий месяц" onClick={() => move(-1)}><ChevronLeft size={18}/></button>
        <strong aria-live="polite">{new Intl.DateTimeFormat('ru-RU', { month: 'long', year: 'numeric' }).format(new Date(view.year, view.month, 1))}</strong>
        <button type="button" aria-label="Следующий месяц" onClick={() => move(1)}><ChevronRight size={18}/></button>
        <button type="button" aria-label="Закрыть календарь" onClick={() => close(true)}><X size={17}/></button>
      </div>
      <div className="date-calendar-grid">
        {['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'].map((day) => <span key={day}>{day}</span>)}
        {Array.from({ length: 42 }, (_, index) => {
          const date = new Date(view.year, view.month, index - first + 1);
          const key = iso(date);
          return <button type="button" key={key} aria-label={dateLabel(date)} aria-pressed={key === value}
            aria-current={key === today ? 'date' : undefined}
            className={date.getMonth() !== view.month ? 'other-month' : ''} onClick={() => select(date)}>{date.getDate()}</button>;
        })}
      </div>
      <button type="button" className="date-calendar-today" onClick={() => select(new Date())}>Сегодня</button>
    </div>, document.body)}
  </>;
}
