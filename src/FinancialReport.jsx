import React, { useState } from 'react';
import { buildFinancialReport, buildFinancialReportWorkbook, reportMetrics, REPORT_NOTE } from './financialReport.js';
import { isDesktopApp } from './dataClient';

const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; };
const money = n => new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 }).format(n) + ' ₽';
export default function FinancialReport({ contracts, investors, withdrawals, getStats }) {
  const [from, setFrom] = useState(() => today().slice(0,7) + '-01');
  const [to, setTo] = useState(today);
  const [investorId, setInvestorId] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  let report, validation = '';
  try { report = buildFinancialReport({ contracts, investors, withdrawals, getStats, from, to, investorId, asOf: today() }); }
  catch (e) { validation = e.message; }
  const exportReport = async () => {
    if (!report) return;
    setBusy(true); setError('');
    try {
      const XLSX = await import('xlsx');
      const workbook = buildFinancialReportWorkbook(XLSX, report);
      const filename = `Финансовый_отчёт_${investorId ? 'инвестор' : 'собственник'}_${from}_${to}.xlsx`;
      if (isDesktopApp) {
        const { save } = await import('@tauri-apps/plugin-dialog');
        const path = await save({ defaultPath: filename, filters: [{ name: 'Excel', extensions: ['xlsx'] }] });
        if (!path) return;
        const { writeFile } = await import('@tauri-apps/plugin-fs');
        await writeFile(path, new Uint8Array(XLSX.write(workbook, { type: 'array', bookType: 'xlsx' })));
      } else XLSX.writeFile(workbook, filename);
    } catch (e) { setError(`Не удалось сохранить отчёт: ${e.message || e}`); }
    finally { setBusy(false); }
  };
  return <section className="panel investor-profit-panel" style={{ padding: 18 }}>
    <div className="panel-hd">Финансовый отчёт</div>
    <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'end', marginBottom: 16 }}>
      <label>Получатель<br/><select value={investorId} onChange={e => setInvestorId(e.target.value)}><option value="">Собственник — весь портфель</option>{investors.map(i => <option key={i.id} value={i.id}>{i.name}</option>)}</select></label>
      <label>С даты<br/><input type="date" value={from} max={to} onChange={e => setFrom(e.target.value)}/></label>
      <label>По дату<br/><input type="date" value={to} min={from} max={today()} onChange={e => setTo(e.target.value)}/></label>
      <button className="btn" disabled={!report || busy} onClick={exportReport}>{busy ? 'Сохранение…' : 'Скачать отчёт Excel'}</button>
    </div>
    {(validation || error) && <p role="alert">{validation || error}</p>}
    {report && <>
      <p>{report.audience} · {from} — {to}. Остатки на {report.asOf}.</p>
      {!report.portfolio.length && <p>Нет договоров для выбранного получателя.</p>}
      <div className="profit-table-wrap"><table className="profit-table"><tbody>{reportMetrics(report).map(([label, value]) => <tr key={label}><td>{label}</td><td className="num">{money(value)}</td></tr>)}</tbody></table></div>
      {report.undated > 0 && <p role="alert">Платежи без корректной даты: {money(report.undated)}. Они исключены из периода.</p>}
      <p style={{ fontSize: 12, lineHeight: 1.6 }}>{REPORT_NOTE}</p>
    </>}
  </section>;
}
