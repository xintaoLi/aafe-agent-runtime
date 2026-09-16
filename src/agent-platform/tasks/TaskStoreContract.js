export const TASK_STORE_METHODS = Object.freeze([
  'create', 'get', 'getContext', 'replaceContext', 'getSnapshot', 'patchSnapshot',
  'update', 'transition', 'appendEvent', 'events', 'list'
]);

export function assertTaskStoreContract(store) {
  if (!store || typeof store !== 'object') throw new Error('task-store-missing');
  const missing = TASK_STORE_METHODS.filter((method) => typeof store[method] !== 'function');
  if (missing.length) throw new Error(`task-store-contract-missing:${missing.join(',')}`);
  return store;
}
