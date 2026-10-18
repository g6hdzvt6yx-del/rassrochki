import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';
import ClientCard from './ClientCard';
it('renders all client contracts and totals without unrelated debt', () => {
 const contract={id:'a',clientName:'Иван',phone:'89991234567',item:'Холодильник',startDate:'2026-09-07'};
 const contracts=[contract,{...contract,id:'b',item:'Телевизор'},{...contract,id:'c',phone:'89990000000',item:'Чужой договор'}];
 const html=renderToStaticMarkup(<ClientCard contract={contract} contracts={contracts} contacts={[]} getStats={()=>({remaining:100,overdueSum:0,rows:[]})} investors={[]} onClose={()=>{}} onOpenContract={()=>{}} onExternal={()=>{}} renderContacts={()=>null}/>);
 expect(html).toContain('Холодильник');expect(html).toContain('Телевизор');expect(html).not.toContain('Чужой договор');
 expect(html).toContain('200 ₽');expect(html).toContain('Просрочки нет');expect(html).toContain('Карточка клиента');
});
it('renders malformed contact dates without losing the client card', () => {
 const contract={id:'a',clientName:'Иван'};
 const html=renderToStaticMarkup(<ClientCard contract={contract} contracts={[contract]} contacts={[{note:'Позвонить',occurredAt:'bad',promisedDate:'bad'}]} getStats={()=>({remaining:0,overdueSum:0,rows:[]})} investors={[]} onClose={()=>{}} onOpenContract={()=>{}} onExternal={()=>{}} renderContacts={()=>null}/>);
 expect(html).toContain('дата не указана');expect(html).toContain('Закрыт');
});
