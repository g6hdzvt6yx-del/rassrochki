import {it,expect} from 'vitest';
import {matchesOperatorSearch} from './operatorSearch';
const client={clientName:'Семён Тестов',item:'Часы Garmin Instinct 3',phone:'8-900-000-12-34'};
it('matches keywords across fields, regardless of case, order and ё',()=>{
 expect(matchesOperatorSearch(client,'  GARMIN семен  ')).toBe(true);
 expect(matchesOperatorSearch(client,'Тест часы')).toBe(true);
 expect(matchesOperatorSearch(client,'Garmin Иван')).toBe(false);
 expect(matchesOperatorSearch({item:'iPhone 17'},'17')).toBe(true);
});
it('matches formatted, partial and normalized phone numbers',()=>{
 for(const query of ['89000001234','+7 (900) 000-12-34','0001234'])expect(matchesOperatorSearch(client,query)).toBe(true);
 expect(matchesOperatorSearch(client,'89991111111')).toBe(false);
});
it('accepts an empty query and tolerates missing fields',()=>{
 expect(matchesOperatorSearch({},'  ')).toBe(true);
 expect(matchesOperatorSearch({},'часы')).toBe(false);
});
