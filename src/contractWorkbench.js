const dayNumber = value => { const d = new Date(value); return Number.isFinite(+d) ? Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / 86400000 : NaN; };
export function overdueDays(rows, now = new Date()) {
 const due = rows.filter(r => r.status === 'overdue' && r.remainingDue > 0).map(r => dayNumber(r.dueDate)).filter(Number.isFinite);
 return due.length ? Math.max(0, dayNumber(now) - Math.min(...due)) : 0;
}
export function daysLabel(n) { const x=n%100,y=n%10; return `${n} ${x>=11&&x<=14?'дней':y===1?'день':y>=2&&y<=4?'дня':'дней'}`; }
export function staleNotification(payments, now = new Date()) {
 const times=Object.values(payments || {}).map(p=>p?.notifiedAt).filter(Boolean).map(x=>+new Date(x)).filter(Number.isFinite);
 return !times.length || +now - Math.max(...times) >= 3*86400000;
}
export function matchesWorkView(view, stats, contacts, payments, now = new Date()) {
 if (!view) return true;
 if (stats.done) return false;
 const today=dayNumber(now);
 if(view==='large') return stats.overdueSum>=100000;
 if(view==='promised') return contacts.some(c=>c.promisedDate && dayNumber(c.promisedDate)>=today);
 if(view==='calls') return contacts.some(c=>c.nextContactDate && dayNumber(c.nextContactDate)<=today) || contacts.some(c=>c.promisedDate && dayNumber(c.promisedDate)<=today) || (stats.overdueSum>0 && staleNotification(payments,now));
 return true;
}
