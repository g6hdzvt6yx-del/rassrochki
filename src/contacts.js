import {callResults} from './access';
import { contractsForClient } from './clientSummary';

// Both the expanded card and full contract show the same client's contact history.
export function clientContacts(contracts, client, callLogs = []) {
  if (!client) return [];
  return contractsForClient(contracts, client)
    .flatMap((contract) => [...(Array.isArray(contract.payments?.__contacts) ? contract.payments.__contacts : []), ...callLogs.filter(log=>log.contract_id===contract.id).map(log=>({id:'operator:'+log.id,type:'call',resultLabel:callResults[log.result]||log.result,note:log.note,occurredAt:log.created_at,promisedDate:log.promised_date,promisedAmount:log.promised_amount,nextContactDate:log.next_contact_at,readOnly:true}))]
      .map((contact) => ({ ...contact, _contractId: contract.id, _item: contract.item || '' })))
    .sort((a, b) => String(b.occurredAt || '').localeCompare(String(a.occurredAt || '')));
}
