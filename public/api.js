export class ApiError extends Error {
  constructor(message, status) { super(message); this.status = status; }
}
export function errorText(data) {
  const detail = data?.detail ?? data?.message;
  if (Array.isArray(detail)) return detail.map(x => `${(x.loc || []).filter(k => k !== 'body').join('.')}: ${x.msg}`).join(' • ');
  if (typeof detail === 'object' && detail) return detail.message || 'Não foi possível concluir esta ação.';
  return typeof detail === 'string' ? detail : 'Não foi possível concluir esta ação.';
}
export async function request(path, { method = 'GET', data, signal } = {}) {
  let response;
  try {
    response = await fetch(path, {
      method, credentials: 'same-origin', signal,
      headers: { 'Content-Type': data instanceof Blob ? 'application/octet-stream' : 'application/json', 'X-Pede-Client': 'web' },
      ...(data !== undefined ? { body: data instanceof Blob ? data : JSON.stringify(data) } : {}),
    });
  } catch (e) {
    if (e.name === 'AbortError') throw e;
    throw new ApiError('Não foi possível conectar. Verifique sua conexão e tente novamente.', 0);
  }
  if (response.status === 204) return null;
  let result;
  try { result = await response.json(); } catch { throw new ApiError('O serviço retornou uma resposta inesperada.', response.status); }
  if (!response.ok) throw new ApiError(errorText(result), response.status);
  return result;
}
export const api = (path, options) => request('/backend' + path, options);
export const money = value => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Number(value || 0));
export const escapeHTML = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
export function positiveId(value) { const n = Number(value); return Number.isSafeInteger(n) && n > 0 ? n : null; }
export function productImage(path) {
  if (typeof path !== 'string' || !/^\/uploads\/products\/[a-zA-Z0-9_.-]+\.(jpg|jpeg|png|webp|avif|svg)$/i.test(path)) return '';
  return path.replace('/uploads/', '/media/');
}
