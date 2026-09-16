import { api } from './api.js';
const result = document.querySelector('#oauth-result');
const params = new URLSearchParams(location.search);
const data = { state: params.get('state') || '', code: params.get('code'), error: params.get('error') };
history.replaceState(null, '', '/oauth/mercado-pago/callback');
try {
  if (!data.state || (!data.code && !data.error)) throw new Error('Retorno inválido. Inicie a conexão novamente pela sua loja.');
  const response = await api('/api/v1/stores/me/mercado-pago/complete', { method: 'POST', data });
  if (response.connected) location.replace('/#integracoes');
  else result.textContent = 'A autorização não foi concedida. Sua loja precisa conectar o Mercado Pago para receber novos pedidos.';
} catch (error) {
  result.textContent = error.status === 401 ? 'Sua sessão expirou. Entre como proprietário e inicie a conexão novamente.' : error.message;
}
