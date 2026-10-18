import initSqlJs from 'sql.js';
import wasmUrl from 'sql.js/dist/sql-wasm.wasm?url';
import { normalize, TABLES } from './backupImport';
let sqlPromise;
const query=(db,sql)=>{
  const result=db.exec(sql)[0];
  return result?result.values.map(values=>Object.fromEntries(result.columns.map((key,i)=>[key,values[i]]))):[];
};
export async function readMacBackup(fileList,onProgress=()=>{}) {
  const files=[...fileList];
  const databases=files.filter(f=>f.name==='rassrochki.db');
  if(databases.length!==1) throw new Error('Выберите одну папку копии, внутри которой находится rassrochki.db.');
  const database=databases[0], location=database.webkitRelativePath||database.name;
  const prefix=location.slice(0,-database.name.length);
  const fileMap=new Map(files.map(f=>[(f.webkitRelativePath||f.name).slice(prefix.length),f]));
  if(files.some(f=>!(f.webkitRelativePath||f.name).startsWith(prefix))) throw new Error('Выберите одну папку резервной копии.');
  if(database.size>100*1024*1024) throw new Error('База больше 100 МБ. Для неё нужен отдельный способ переноса.');
  if(fileMap.get('rassrochki.db-wal')?.size) throw new Error('Выбрана рабочая база, а не завершённая копия. Создайте резервную копию в приложении Mac.');
  let manifest={};
  if(fileMap.has('manifest.json')) {
    const f=fileMap.get('manifest.json');
    if(f.size>1024*1024) throw new Error('Служебный файл копии слишком большой.');
    try{manifest=JSON.parse(await f.text());}catch{throw new Error('Служебный файл копии повреждён.');}
  }
  onProgress('Чтение базы на этом компьютере…');
  const SQL=await (sqlPromise??=initSqlJs({locateFile:()=>wasmUrl}));
  const db=new SQL.Database(new Uint8Array(await database.arrayBuffer()));
  const backup={assets:new Map(),excluded:0,manifest,folder:prefix.replace(/\/$/,'')||'Резервная копия'};
  try {
    db.run('PRAGMA query_only=ON');
    const integrity=db.exec('PRAGMA quick_check')[0]?.values;
    if(integrity?.length!==1||integrity[0][0]!=='ok') throw new Error('Копия не прошла проверку целостности SQLite.');
    for(const table of TABLES) {
      const columns=query(db,`PRAGMA table_info(${table})`).map(r=>r.name);
      if(!columns.includes('data')||!columns.includes('id')) throw new Error('Это не полная копия приложения «Рассрочки».');
      const rows=query(db,`SELECT id,data${columns.includes('deleted_at')?',deleted_at':''} FROM ${table}`);
      if(rows.length>100000) throw new Error('Слишком много записей для переноса через браузер.');
      backup[table]=[];
      for(const record of rows) {
        if(record.deleted_at){backup.excluded++;continue;}
        const row=JSON.parse(record.data);
        if(String(row.id)!==String(record.id)) throw new Error('Номера записей в копии не совпадают. Перенос остановлен.');
        backup[table].push(normalize(table,row));
      }
      if(new Set(backup[table].map(r=>r.id)).size!==backup[table].length) throw new Error('В копии повторяются номера записей.');
    }
  } finally {db.close();}
  const paths=new Set(backup.contracts.flatMap(c=>Object.values(c.payments).map(p=>p?.receipt?.path).filter(Boolean)));
  let done=0;
  for(const path of paths) {
    if(typeof path!=='string'||path.startsWith('/')||path.split(/[\\/]/).includes('..')) throw new Error('Недопустимый путь файла чека в копии.');
    const file=fileMap.get('receipts/'+path);
    if(file) {
      if(file.size>50*1024*1024) throw new Error(`Файл чека ${file.name} больше 50 МБ.`);
      const hash=[...new Uint8Array(await crypto.subtle.digest('SHA-256',await file.arrayBuffer()))].map(n=>n.toString(16).padStart(2,'0')).join('');
      const extension=/\.[a-z0-9]{1,8}$/i.exec(file.name)?.[0].toLowerCase()||'';
      backup.assets.set(path,{file,hash,extension});
    }
    onProgress(`Чтение чеков: ${++done} из ${paths.size}`);
  }
  backup.missingReceipts=[...paths].filter(path=>!backup.assets.has(path)).length;
  return backup;
}
