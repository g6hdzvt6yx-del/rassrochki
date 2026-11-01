/* Общие мелкие детали мобильных экранов администратора. */

import React from "react";
import { Phone, MessageCircle, Check, ChevronRight } from "lucide-react";
import { normalizePhone } from "../phone";

// ссылка для звонка — как в компьютерной версии
export const telHref = (phone) => `tel:${normalizePhone(phone) ? `+${normalizePhone(phone)}` : phone}`;

export const CallBtn = ({ phone, label = "Позвонить" }) => (phone
  ? <a className="m-ib call" href={telHref(phone)} onClick={(e) => e.stopPropagation()} aria-label={label}><Phone size={19} /></a>
  : null);

// WhatsApp: открывает сообщение и после подтверждения отмечает «уведомлён» (обработчик onNotify из App)
export const WaBtn = ({ url, notified, onNotify }) => (url ? (
  <a
    className={`m-ib wa ${notified ? "done" : ""}`}
    href={url}
    target="_blank"
    rel="noreferrer"
    aria-label={notified ? "Уведомлён. Отправить напоминание повторно" : "Напомнить в WhatsApp"}
    onClick={(e) => { e.preventDefault(); e.stopPropagation(); onNotify(e.currentTarget.href); }}
  >
    {notified ? <Check size={19} /> : <MessageCircle size={19} />}
  </a>
) : null);

// быстрые кнопки в строке списка: позвонить, WhatsApp, принять платёж
export function QuickActions({ phone, waUrl, notified, onNotify, onPay, payLabel = "Принять платёж", children }) {
  if (!phone && !waUrl && !onPay && !children) return null;
  return (
    <div className="m-qa" onClick={(e) => e.stopPropagation()}>
      <CallBtn phone={phone} />
      <WaBtn url={waUrl} notified={notified} onNotify={onNotify} />
      {children}
      {onPay && <button type="button" className="m-btn success sm" onClick={onPay}><Check size={18} /> {payLabel}</button>}
    </div>
  );
}

export const MStat = ({ icon, label, value, tone, onClick, wide }) => {
  const Tag = onClick ? "button" : "div";
  return (
    <Tag type={onClick ? "button" : undefined} className={`m-stat ${wide ? "wide" : ""} ${tone || ""} ${onClick ? "m-press" : ""}`} onClick={onClick}>
      <span className="m-stat-ic">{icon}</span>
      <span className="m-stat-label">{label}</span>
      <span className="m-stat-val num">{value}</span>
      {onClick && wide && <ChevronRight size={18} className="m-stat-chev" />}
    </Tag>
  );
};
