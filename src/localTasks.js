let tail = Promise.resolve();
let pending = 0;
let lastSavedAt = null;
const publish = (error = '') => window.dispatchEvent(new CustomEvent('rassrochki-storage', {
  detail: { pending, lastSavedAt, error },
}));

// One writer at a time, including file operations and full backups.
export function runLocalTask(task, showStatus = false) {
  if (showStatus) { pending += 1; publish(); }
  const result = tail.then(task);
  tail = result.catch(() => {});
  if (!showStatus) return result;
  return result.then((value) => {
    pending -= 1;
    if (!value?.error) lastSavedAt = new Date().toISOString();
    publish(value?.error?.message || '');
    return value;
  }, (error) => {
    pending -= 1; publish(error?.message || String(error)); throw error;
  });
}

export async function flushLocalTasks() {
  let current;
  do { current = tail; await current; } while (current !== tail);
}
