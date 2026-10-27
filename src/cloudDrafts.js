import { supabase } from './supabaseClient';

// Черновики договоров веб-версии хранятся в таблице drafts (доступ только у администратора, RLS).
export async function listCloudDrafts() {
  const { data, error } = await supabase.from('drafts').select('*').order('updated_at', { ascending: false });
  if (error) throw new Error(error.message);
  return (data || []).filter((draft) => draft.draft_type !== 'Импорт Excel');
}

export async function saveCloudDraft({ id, draftType, title, data, completion }) {
  const { error } = await supabase.from('drafts').upsert({
    id, draft_type: draftType, title: String(title || '').trim() || 'Без названия',
    data, completion: Math.max(0, Math.min(100, Math.round(completion || 0))), updated_at: new Date().toISOString(),
  }, { onConflict: 'id' });
  if (error) throw new Error(error.message);
}

export async function deleteCloudDraft(id) {
  const { error } = await supabase.from('drafts').delete().eq('id', id);
  if (error) throw new Error(error.message);
}

export const draftTitle = (values) => [values.clientName, values.item].map((v) => String(v || '').trim()).filter(Boolean).join(' · ') || 'Новый договор';
export const draftCompletion = (values) => Math.round([values.clientName, values.phone, values.item, values.totalPrice, values.startDate, values.termMonths]
  .filter((value) => String(value || '').trim()).length / 6 * 100);
export const draftHasContent = (values) => [values.clientName, values.phone, values.item, values.totalPrice, values.comment]
  .some((value) => String(value || '').trim());
