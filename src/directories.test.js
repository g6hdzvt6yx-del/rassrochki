import {it,expect,vi} from 'vitest';
import {directoryClients,directoryProducts,saveDirectoryClient} from './directories';
it('groups formatted phones while keeping namesakes with other phones separate',()=>{
 const rows=[{id:'a',clientName:'Анна',phone:'89991234567',item:' Телефон '},{id:'b',clientName:'Анна',phone:'+7 999 123-45-67',item:'телефон'},{id:'c',clientName:'Анна',phone:'',item:''},{id:'d',clientName:'Анна',phone:'89990000000',item:'Часы'}];
 expect(directoryClients(rows).length).toBe(3);
 expect(directoryClients(rows)[0].contracts.map(c=>c.id)).toEqual(['a','b']);
 expect(directoryProducts(rows).find(x=>x.name==='Телефон').contracts.length).toBe(2);
 expect(directoryProducts(rows).length).toBe(2);
});
it('updates only client fields for the selected contracts in one request',async()=>{
 const select=vi.fn().mockResolvedValue({data:[{id:'a'},{id:'b'}],error:null});const inIds=vi.fn(()=>({select}));const update=vi.fn(()=>({in:inIds}));const from=vi.fn(()=>({update}));
 expect(await saveDirectoryClient({from},['a','b'],{name:' Новое имя ',phone:'89991234567'})).toEqual({clientName:'Новое имя',phone:'8-999-123-45-67'});
 expect(update).toHaveBeenCalledWith({client_name:'Новое имя',phone:'8-999-123-45-67'});
 expect(inIds).toHaveBeenCalledWith('id',['a','b']);
});
it('rejects invalid input before writing and reports denied writes',async()=>{
 const from=vi.fn();await expect(saveDirectoryClient({from},['a'],{name:' ',phone:''})).rejects.toThrow('ФИО');
 await expect(saveDirectoryClient({from},['a'],{name:'Имя',phone:'123'})).rejects.toThrow('номер');expect(from).not.toHaveBeenCalled();
 const db={from:()=>({update:()=>({in:()=>({select:async()=>({data:[],error:null})})})})};
 await expect(saveDirectoryClient(db,['a'],{name:'Имя',phone:''})).rejects.toThrow('Не все договоры');
});
