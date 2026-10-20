import {normalizePhone} from './phone';
const normalize=value=>String(value??'').toLocaleLowerCase('ru-RU').replace(/ё/g,'е');
export function matchesOperatorSearch(client,query){
 const text=normalize(query).trim();
 if(!text)return true;
 const phone=String(client.phone??'').replace(/\D/g,'');
 const canonical=normalizePhone(client.phone);
 if(/^[+\d\s().-]+$/.test(text)&&/\d/.test(text)){
  const digits=text.replace(/\D/g,'');
  if(phone.includes(digits)||canonical.includes(digits)||(normalizePhone(text)!==''&&normalizePhone(text)===canonical))return true;
 }
 const haystack=normalize([client.clientName,client.phone,client.item,phone,canonical].filter(Boolean).join(' '));
 return text.split(/\s+/).every(word=>haystack.includes(word));
}
