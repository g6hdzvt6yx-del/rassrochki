import { actualPaid } from './contractSafety';
import { splitScheduleAmount } from './finance';

export const TABLES = ['investors', 'contracts', 'withdrawals'];
const fields = {
  investors: ['id','name','amount','monthly_payment','accrual_start_date'],
  contracts: ['id','client_name','phone','item','total_price','down_payment','markup','markup_percent','term_months','start_date','investor_id','payments','comment','guarantor_name','guarantor_phone'],
  withdrawals: ['id','amount','date','investor_id','purpose','note'],
};
const text = v => String(v ?? '').trim();
const keyText = v => text(v).toLocaleLowerCase('ru-RU').replace(/\s+/g,' ');
export const stable = value => JSON.stringify(canonical(value));
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(k=>[k,canonical(value[k])]));
  return value;
}
function number(v, label) {
  const n=Number(v ?? 0);
  if(!Number.isFinite(n) || n<0) throw new Error(`Некорректная сумма: ${label}`);
  return n;
}
function date(v, optional=false) {
  if(optional && !v) return null;
  const s=text(v);
  if(!/^\d{4}-\d{2}-\d{2}$/.test(s)||!Number.isFinite(Date.parse(s))||new Date(s).toISOString().slice(0,10)!==s) throw new Error(`Некорректная дата: ${s}`);
  return s;
}
export function normalize(table, source) {
  const id=text(source.id);
  if(!id || id.length>250 || /[\/\\]/.test(id)) throw new Error('В копии есть запись с недопустимым номером договора/записи.');
  if(table==='investors') return {id,name:text(source.name),amount:number(source.amount,'вклад'),monthly_payment:number(source.monthly_payment??source.monthlyPayment,'выплата вкладчику'),accrual_start_date:date(source.accrual_start_date??source.accrualStartDate,true)};
  if(table==='withdrawals') return {id,amount:number(source.amount,'выплата'),date:date(source.date),investor_id:text(source.investor_id),purpose:text(source.purpose)||'other',note:text(source.note)};
  const term=Number(source.term_months);
  if(!Number.isInteger(term)||term<1||term>1200) throw new Error(`Некорректный срок договора ${id}`);
  if(!source.payments || typeof source.payments!=='object' || Array.isArray(source.payments)) throw new Error(`Повреждена история платежей договора ${id}`);
  if(!text(source.client_name)) throw new Error(`Не заполнено имя клиента в договоре ${id}`);
  return {id,client_name:text(source.client_name),phone:text(source.phone),item:text(source.item),total_price:number(source.total_price,'цена'),down_payment:number(source.down_payment,'взнос'),markup:number(source.markup,'наценка'),markup_percent:number(source.markup_percent,'процент'),term_months:term,start_date:date(source.start_date),investor_id:text(source.investor_id),payments:JSON.parse(JSON.stringify(source.payments)),comment:text(source.comment),guarantor_name:text(source.guarantor_name),guarantor_phone:text(source.guarantor_phone)};
}
export function paidTotal(row) {
  if(!row) return 0;
  const amounts=splitScheduleAmount(Math.max(0,row.total_price-row.down_payment+row.markup),row.term_months);
  return amounts.reduce((sum,amount,index)=>sum+actualPaid(row.payments?.[index],amount),0);
}
function natural(table,row) {
  if(table==='investors') return keyText(row.name);
  if(table==='contracts') return [row.client_name,row.item,row.start_date].map(keyText).join('|');
  return stable([row.date,row.amount,row.investor_id,row.purpose,row.note]);
}
export function makePlan(backup, cloud) {
  const plan=[], investorMap=new Map();
  for(const table of TABLES) {
    const remote=cloud[table].map(r=>({raw:r,row:normalize(table,r)}));
    const candidates=backup[table].map(source=>{
      let row=normalize(table,source), problem='';
      if(table!=='investors' && row.investor_id) {
        const mapped=investorMap.get(row.investor_id);
        if(mapped) row.investor_id=mapped;
        else if(!remoteInvestor(cloud,row.investor_id)) problem='Не найден однозначный источник финансирования. Перенос этой записи заблокирован.';
      }
      const exact=remote.find(r=>r.row.id===row.id);
      const matches=exact?[exact]:remote.filter(r=>natural(table,r.row)===natural(table,row));
      if(matches.length>1) problem='Несколько совпадений на сайте. Автоматическое объединение запрещено.';
      const match=matches.length===1?matches[0]:null;
      const targetId=match?.row.id||row.id;
      if(table==='investors'&&!problem) investorMap.set(source.id,targetId);
      row.id=targetId;
      return {table,sourceId:source.id,row,before:match?.raw||null,matchedBy:exact?'id':match?'description':'new',problem,uploads:[]};
    });
    const counts=new Map();
    for(const c of candidates) counts.set(c.row.id,(counts.get(c.row.id)||0)+1);
    for(const c of candidates) {
      if(counts.get(c.row.id)>1) c.problem='Несколько записей Mac соответствуют одной записи сайта. Требуется ручная сверка.';
      if(table==='investors' && c.problem) investorMap.delete(c.sourceId);
      if(table==='contracts') for(const [index,payment] of Object.entries(c.row.payments)) {
        if(!payment?.receipt) continue;
        const receipt=payment.receipt;
        if(receipt.dataUrl && !receipt.path) continue; // Existing embedded receipt stays embedded.
        const asset=backup.assets.get(receipt.path);
        if(!asset) {c.problem=`Не найден файл чека для платежа №${Number(index)+1}. Выберите всю папку копии.`;continue;}
        const path=`${c.row.id}/mac-import/${asset.hash}${asset.extension}`;
        c.row.payments[index]={...payment,receipt:{...receipt,path}};
        c.uploads.push({...asset,path});
      }
      c.kind=c.problem?'blocked':!c.before?'new':stable(c.row)===stable(normalize(table,c.before))?'same':'update';
      c.key=`${table}:${c.sourceId}`;
      plan.push(c);
    }
  }
  return plan;
}
function remoteInvestor(cloud,id){return cloud.investors.some(r=>r.id===id);}
export function validateSelection(plan, selected, cloud) {
  const ids=new Set(cloud.investors.map(r=>r.id));
  for(const p of plan) if(p.table==='investors'&&selected.has(p.key)&&p.kind!=='blocked') ids.add(p.row.id);
  for(const p of plan) if(selected.has(p.key)) {
    if(p.kind==='blocked') throw new Error('В выборе есть запись с конфликтом.');
    if(p.table!=='investors'&&p.row.investor_id&&!ids.has(p.row.investor_id)) throw new Error('Для выбранного договора/выплаты нужно также выбрать перенос его вкладчика.');
  }
}
export async function readCloud(client) {
  const snapshot={};
  for(const table of TABLES) {
    snapshot[table]=[];
    for(let from=0;;from+=500) {
      const {data,error}=await client.from(table).select('*').order('id').range(from,from+499);
      if(error) throw new Error(`Не удалось прочитать ${table}: ${error.message}`);
      snapshot[table].push(...data);
      if(data.length<500) break;
    }
  }
  return snapshot;
}
export function cloudFingerprint(cloud) {return stable(Object.fromEntries(TABLES.map(t=>[t,[...cloud[t]].sort((a,b)=>a.id.localeCompare(b.id))])));}
async function updateChecked(client,table,row,before,ownerId) {
  let query=client.from(table).update(row).eq('id',row.id).eq('user_id',ownerId);
  for(const field of fields[table].filter(f=>f!=='id')) {
    const value=before[field];
    query=value==null?query.is(field,null):query.eq(field,typeof value==='object'?JSON.stringify(value):value);
  }
  const {data,error}=await query.select('id');
  if(error) throw error;
  if(data?.length!==1) throw new Error('Запись на сайте изменилась. Выполните сравнение заново; перезапись остановлена.');
}
export async function executePlan({client,plan,selected,cloud,ownerId,onProgress}) {
  const {data:profile,error}=await client.from('app_members').select('role,active,owner_id').eq('user_id',ownerId).single();
  if(error||!profile?.active||profile.role!=='admin'||profile.owner_id!==ownerId) throw new Error('Перенос доступен только активному администратору.');
  validateSelection(plan,selected,cloud);
  const fresh=await readCloud(client);
  if(cloudFingerprint(fresh)!==cloudFingerprint(cloud)) throw new Error('После сравнения данные сайта изменились. Нажмите «Сравнить заново».');
  const report={startedAt:new Date().toISOString(),completed:[],failed:null,partial:null};
  const chosen=plan.filter(p=>selected.has(p.key)&&['new','update'].includes(p.kind));
  for(const p of chosen) {
    let inserted=false;
    try {
      onProgress({done:report.completed.length,total:chosen.length,label:p.row.client_name||p.row.name||'Выплата'});
      let before=p.before;
      if(p.kind==='new') {
        const initial=structuredClone(p.row);
        if(p.table==='contracts') for(const payment of Object.values(initial.payments)) if(payment?.receipt?.path) delete payment.receipt;
        const {data,error}=await client.from(p.table).insert({...initial,user_id:ownerId}).select('*').single();
        if(error) throw error;
        inserted=true;before=data;
      }
      for(const upload of p.uploads) {
        const {error}=await client.storage.from('receipts').upload(upload.path,upload.file,{upsert:false,contentType:upload.file.type||'application/octet-stream'});
        if(error) {
          // A retried import may already have uploaded this content-addressed file.
          const existing=await client.storage.from('receipts').download(upload.path);
          if(existing.error) throw new Error(`Чек не загружен: ${error.message}`);
          const digest=[...new Uint8Array(await crypto.subtle.digest('SHA-256',await existing.data.arrayBuffer()))].map(n=>n.toString(16).padStart(2,'0')).join('');
          if(digest!==upload.hash) throw new Error('На сайте другой файл с таким именем. Чек не перезаписан.');
        }
      }
      if(p.kind==='update'||p.uploads.length) await updateChecked(client,p.table,p.row,before,ownerId);
      report.completed.push({table:p.table,id:p.row.id,name:p.row.client_name||p.row.name||p.row.note,action:p.kind});
    } catch(error) {
      report.failed={table:p.table,id:p.row.id,message:error.message||String(error)};
      if(inserted) report.partial='Основная запись уже создана; загрузка чеков или завершение записи не выполнены. Повторите сравнение: уже сохранённые записи не нужно добавлять повторно.';
      break;
    }
  }
  report.finishedAt=new Date().toISOString();
  return report;
}
