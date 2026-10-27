import React, { useId, useRef, useState } from 'react';
import { matchesPickerQuery } from './passport';

// Поле поиска со списком вместо системного <select>: набранный текст не сбрасывается
// и всегда виден, ищет по любой части имени и по цифрам телефона.
export default function SearchPicker({ label, placeholder, options, renderOption, onPick, selectedLabel, onClear, emptyText = 'Ничего не найдено', limit = 8 }) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const inputRef = useRef(null);
  const blurTimer = useRef(null);
  const cancelClose = () => { clearTimeout(blurTimer.current); blurTimer.current = null; };
  const listId = useId();
  const matches = options.filter((option) => matchesPickerQuery(option, query));
  const shown = matches.slice(0, limit);

  const pick = (option) => {
    onPick(option);
    setQuery('');
    setOpen(false);
    inputRef.current?.blur();
    cancelClose();
  };

  const onKeyDown = (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setOpen(true); setActive((i) => Math.min(i + 1, shown.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((i) => Math.max(i - 1, 0)); }
    else if (e.key === 'Enter') { if (open && shown[active]) { e.preventDefault(); pick(shown[active]); } }
    else if (e.key === 'Escape') { setOpen(false); }
  };

  return (
    <div className="field search-picker">
      <span>{label}</span>
      {selectedLabel && !open ? (
        <div className="search-picker-selected">
          <span>{selectedLabel}</span>
          <button type="button" className="btn ghost btn-sm" onClick={() => { cancelClose(); setOpen(true); setTimeout(() => inputRef.current?.focus(), 0); }}>Изменить</button>
          {onClear && <button type="button" className="btn ghost btn-sm" onClick={onClear}>Сбросить</button>}
        </div>
      ) : (
        <>
          <input
            ref={inputRef}
            type="search"
            inputMode="search"
            autoComplete="off"
            autoCorrect="off"
            spellCheck={false}
            enterKeyHint="search"
            role="combobox"
            aria-expanded={open}
            aria-controls={listId}
            aria-autocomplete="list"
            value={query}
            placeholder={placeholder}
            onChange={(e) => { setQuery(e.target.value); setActive(0); setOpen(true); }}
            onFocus={(e) => { cancelClose(); setOpen(true); const el = e.currentTarget; setTimeout(() => el.scrollIntoView({ block: 'start', behavior: 'smooth' }), 250); }}
            onBlur={() => { cancelClose(); blurTimer.current = setTimeout(() => setOpen(false), 150); }}
            onKeyDown={onKeyDown}
          />
          {open && (
            <ul className="search-picker-list" id={listId} role="listbox">
              {shown.map((option, index) => (
                <li key={option.key} role="option" aria-selected={index === active}>
                  <button type="button" className={index === active ? 'on' : ''}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => pick(option)}>
                    {renderOption ? renderOption(option) : option.name}
                  </button>
                </li>
              ))}
              {!shown.length && <li className="search-picker-empty">{emptyText}</li>}
              {matches.length > shown.length && <li className="search-picker-empty">Ещё {matches.length - shown.length} — уточните поиск</li>}
            </ul>
          )}
        </>
      )}
    </div>
  );
}
