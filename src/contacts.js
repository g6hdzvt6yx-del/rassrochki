import { contractsForClient } from './clientSummary';

// Both the expanded card and full contract show the same client's contact history.
export function clientContacts(contracts, client) {
  if (!client) return [];
  return contractsForClient(contracts, client)
    .flatMap((contract) => (Array.isArray(contract.payments?.__contacts) ? contract.payments.__contacts : [])
      .map((contact) => ({ ...contact, _contractId: contract.id, _item: contract.item || '' })))
    .sort((a, b) => String(b.occurredAt || '').localeCompare(String(a.occurredAt || '')));
}
