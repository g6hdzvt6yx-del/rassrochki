import React, { useId, useRef, useState } from 'react';
import { matchesPickerQuery } from './passport';

// Обычное поле ввода с подсказками из базы: набранный текст сразу сохраняется в форму,
// а нажатие на подсказку подставляет готовую запись (клиента или товар).
export default function AutocompleteField({ label, value, onChange, options, onPick, renderOption, placeholder, newHint, limit = 8 }) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const blurTimer = useRef(null);
  const inputRef = useRef(null);
  const listId = useId();
  const query = String(value || '').trim();
  const norm = (text) => String(text || '').trim().replace(/\s+/g, ' ').toLocaleLowerCase('ru');
  const matches = query ? options.filter((option) => matchesPickerQuery(option, query)) : [];
  const exact = matches.length === 1 && norm(matches[0].name) === norm(query);
  const shown = exact ? [] : matches.slice(0, limit);
  const cancelClose = () => { clearTimeout(blurTimer.current); blurTimer.current = null; };

  const pick = (option) => {
    onPick(option);
    setOpen(false);
    setActive(-1);
    cancelClose();
  };

  const onKeyDown = (e) => {
    if (!open || !shown.length) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive((i) => Math.min(i + 1, shown.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((i) => Math.max(i - 1, -1)); }
    else if (e.key === 'Enter' && active >= 0) { e.preventDefault(); pick(shown[active]); }
    else if (e.key === 'Escape') setOpen(false);
  };

  return (
    <div className="field search-picker">
      <span>{label}</span>
      <input
        ref={inputRef}
        autoComplete="off"
        autoCorrect="off"
        spellCheck={false}
        role="combobox"
        aria-expanded={open && shown.length > 0}
        aria-controls={listId}
        aria-autocomplete="list"
        value={value}
        placeholder={placeholder}
        onChange={(e) => { onChange(e.target.value); setActive(-1); setOpen(true); }}
        onFocus={() => { cancelClose(); setOpen(true); }}
        onBlur={() => { cancelClose(); blurTimer.current = setTimeout(() => setOpen(false), 150); }}
        onKeyDown={onKeyDown}
      />
      {open && query && (shown.length > 0 || (!exact && newHint)) && (
        <ul className="search-picker-list" id={listId} role="listbox">
          {shown.length > 0 && <li className="search-picker-empty">Есть в базе — нажмите, чтобы подставить:</li>}
          {shown.map((option, index) => (
            <li key={option.key} role="option" aria-selected={index === active}>
              <button type="button" className={index === active ? 'on' : ''}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => pick(option)}>
                {renderOption ? renderOption(option) : option.name}
              </button>
            </li>
          ))}
          {!shown.length && !exact && newHint && <li className="search-picker-empty">{newHint}</li>}
          {matches.length > shown.length && !exact && <li className="search-picker-empty">Ещё {matches.length - shown.length} — уточните ввод</li>}
        </ul>
      )}
    </div>
  );
}
