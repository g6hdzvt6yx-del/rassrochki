import React from 'react';
import {overdueDays,daysLabel} from './contractWorkbench';
export default function ContractTable({contracts,getStats,selected,onSelect,onPay,onOpen,money}) {
 return <div className="contracts-table-wrap"><table className="contracts-table"><thead><tr><th>Выбор</th><th>Клиент / товар</th><th>Телефон</th><th>Просрочка</th><th>Остаток</th><th>Действие</th></tr></thead><tbody>{contracts.map(c=>{const s=getStats(c);return <tr key={c.id}>
 <td><input type="checkbox" aria-label={`Выбрать ${c.clientName}`} checked={selected.has(c.id)} onChange={()=>onSelect(c.id)}/></td>
 <td><button className="contract-link" onClick={()=>onOpen(c.id)}>{c.clientName}</button><small>{c.item}</small></td><td>{c.phone || '—'}</td>
 <td>{s.overdueSum>0?<span className="table-overdue"><b>{daysLabel(overdueDays(s.rows))}</b><span>{money(s.overdueSum)}</span></span>:s.done?'Закрыт':'—'}</td>
 <td className="num">{money(s.remaining)}</td><td>{!s.done&&s.next?<button className="btn primary btn-sm" onClick={()=>onPay(c.id)}>Принять платёж</button>:<button className="btn ghost btn-sm" onClick={()=>onOpen(c.id)}>Открыть</button>}</td></tr>})}</tbody></table></div>;
}
