import React from 'react';
import {overdueDays,daysLabel} from './contractWorkbench';
import {OperatorMarkCell,NextActionCell} from './OperatorMarks.jsx';
import {nextMarkAction} from './operatorMarks';
import {formatPhone,normalizePhone} from './phone';

// Уровень выделения просрочки: до 2 недель, до 1,5 месяцев, дольше.
const overdueLevel = days => days >= 45 ? 'high' : days >= 15 ? 'mid' : 'low';

function SortHeader({id,label,sortBy,sortDir,onSort,className=''}) {
 const active=sortBy===id;
 return <th className={`${className} sortable ${active?'sorted':''}`} aria-sort={active?(sortDir==='asc'?'ascending':'descending'):'none'}>
  <button type="button" onClick={()=>onSort?.(id)} title={`Сортировать: ${label.toLowerCase()}`}>{label}<span className="sort-mark" aria-hidden="true">{active?(sortDir==='asc'?'↑':'↓'):'↕'}</span></button>
 </th>;
}

export default function ContractTable({contracts,getStats,selected,onSelect,onPay,onOpen,money,marks={},onMarksHistory,sortBy,sortDir,onSort,allSelected=false,onSelectAll}) {
 const sort={sortBy,sortDir,onSort};
 return <div className="contracts-table-wrap"><table className="contracts-table">
  <thead><tr>
   <th className="c-check">{onSelectAll?<input type="checkbox" aria-label="Выбрать все в списке" checked={allSelected} onChange={e=>onSelectAll(e.target.checked)}/>:null}</th>
   <th className="c-client">Клиент · товар</th>
   <SortHeader id="overdue" label="Просрочка" className="c-overdue" {...sort}/>
   <SortHeader id="remaining" label="Остаток" className="c-remaining num" {...sort}/>
   <SortHeader id="lastMark" label="Последняя отметка" className="c-mark" {...sort}/>
   <th className="c-next">След. действие</th>
   <th className="c-action"><span className="sr-only">Действие</span></th>
  </tr></thead>
  <tbody>{contracts.map(c=>{
   const s=getStats(c);
   const days=s.overdueSum>0?overdueDays(s.rows):0;
   const contractMarks=marks[c.id]||[];
   const phoneDigits=normalizePhone(c.phone);
   const action=nextMarkAction(contractMarks);
   return <tr key={c.id} className={s.overdueSum>0?`row-overdue od-${overdueLevel(days)}`:''}>
    <td className="c-check"><input type="checkbox" aria-label={`Выбрать ${c.clientName}`} checked={selected.has(c.id)} onChange={()=>onSelect(c.id)}/></td>
    <td className="c-client" data-label="Клиент">
     <button className="contract-link" onClick={()=>onOpen(c.id)} title={c.clientName}>{c.clientName}</button>
     <span className="client-sub">{c.item&&<span className="client-item" title={c.item}>{c.item}</span>}{c.phone&&<a className="client-phone" href={`tel:${phoneDigits?'+'+phoneDigits:c.phone}`}>{formatPhone(c.phone)}</a>}</span>
    </td>
    <td className="c-overdue" data-label="Просрочка">{s.overdueSum>0
     ?<span className={`od-pill od-${overdueLevel(days)}`} title={`Просрочка ${daysLabel(days)} · ${money(s.overdueSum)}`}><b>{daysLabel(days)}</b><span className="num">{money(s.overdueSum)}</span></span>
     :<span className="od-none">{s.done?'Закрыт':'Нет'}</span>}</td>
    <td className="c-remaining num" data-label="Остаток">{money(s.remaining)}</td>
    <td className="c-mark" data-label="Отметка"><OperatorMarkCell marks={contractMarks} onHistory={onMarksHistory?()=>onMarksHistory(c.id):undefined}/>{action&&<div className="mark-next"><NextActionCell action={action}/></div>}</td>
    <td className="c-next" data-label="След. действие"><NextActionCell action={action}/></td>
    <td className="c-action">{!s.done&&s.next
     ?<button className="btn primary btn-xs" onClick={()=>onPay(c.id)}>Принять платёж</button>
     :<button className="btn ghost btn-xs" onClick={()=>onOpen(c.id)}>Открыть</button>}</td>
   </tr>;})}</tbody>
 </table></div>;
}
