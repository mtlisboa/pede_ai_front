import { api, request, money, escapeHTML as h, positiveId } from './api.js';

const main = document.querySelector('#content');
const toast = document.querySelector('#toast');
let rendering = false;
let scheduled = false;
let sessionCache = null;

const STATUS = {
  PENDING: 'Recebido',
  CONFIRMED: 'Confirmado',
  PREPARING: 'Em preparo',
  READY: 'Pronto',
  OUT_FOR_DELIVERY: 'Saiu para entrega',
  DELIVERED: 'Concluído',
  CANCELLED: 'Cancelado',
};
const PAYMENT_STATUS = {
  PENDING: 'Aguardando pagamento',
  PAID: 'Pago',
  MANUAL_CONFIRMED: 'Pagamento confirmado',
  CANCELLED: 'Cancelado',
  REFUNDED: 'Estornado',
};
const PAYMENT_METHOD = {
  PIX: 'Pix',
  CASH: 'Dinheiro',
  CARD_MACHINE: 'Maquineta',
  ONLINE: 'Mercado Pago',
};
const ORDER_TYPE = {
  PICKUP: 'Retirada',
  DELIVERY: 'Entrega',
  DINE_IN: 'No local',
};
const KANBAN_COLUMNS = [
  ['received', 'Recebidos'],
  ['preparing', 'Sendo preparados'],
  ['ready', 'Prontos para entrega'],
  ['out_for_delivery', 'Sendo entregues'],
  ['delivered', 'Concluídos'],
  ['cancelled', 'Cancelados'],
];

function showToast(message) {
  if (!toast) return;
  toast.textContent = message;
  toast.hidden = false;
  setTimeout(() => { if (toast.textContent === message) toast.hidden = true; }, 6500);
}

function route() {
  return location.hash.slice(1).split('/');
}

function empty(title, text) {
  return `<section class="empty"><span class="empty-symbol" aria-hidden="true">○</span><h2>${title}</h2><p>${text}</p></section>`;
}

function statusBadge(value) {
  const green = ['DELIVERED', 'PAID', 'MANUAL_CONFIRMED', 'APPROVED'].includes(value);
  const neutral = ['CANCELLED', 'REJECTED'].includes(value);
  return `<span class="status ${green ? 'green' : neutral ? 'neutral' : ''}">${h(STATUS[value] || PAYMENT_STATUS[value] || value || '—')}</span>`;
}

async function getSession(force = false) {
  if (!force && sessionCache) return sessionCache;
  try { sessionCache = await request('/session'); }
  catch { sessionCache = { user: null }; }
  return sessionCache;
}

function isOperator(user) {
  return ['OWNER', 'EMPLOYEE'].includes(user?.role);
}

function clearCheckoutForCart(cartId) {
  for (let i = sessionStorage.length - 1; i >= 0; i--) {
    const key = sessionStorage.key(i);
    if (!key?.startsWith('pede-checkout:')) continue;
    try {
      const value = JSON.parse(sessionStorage.getItem(key));
      if (Number(value?.id_cart) === Number(cartId)) sessionStorage.removeItem(key);
    } catch { /* ignore malformed local state */ }
  }
}

function orderSummary(order) {
  return `<article class="store-card order-card">
    <div>
      <h3>Pedido #${h(order.order_number)}</h3>
      <p>${h(ORDER_TYPE[order.order_type] || order.order_type)} · ${new Date(order.created_at).toLocaleString('pt-BR')}</p>
      <p>${statusBadge(order.status)} ${statusBadge(order.payment_status)}</p>
    </div>
    <div><strong>${money(order.total_amount)}</strong><br><a href="#pedido/${order.id_order}">Ver pedido →</a></div>
  </article>`;
}

function kanbanCard(order) {
  const created = new Date(order.created_at).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
  return `<article class="kanban-card">
    <div class="kanban-card-heading"><strong>#${h(order.order_number)}</strong><strong>${money(order.total_amount)}</strong></div>
    <p>${h(order.customer_name)}<br><span>${h(order.customer_phone)}</span></p>
    <p>${h(ORDER_TYPE[order.order_type] || order.order_type)} · ${created}</p>
    <a class="button ghost small full" href="#pedido/${order.id_order}">Ver pedido</a>
  </article>`;
}

function kanbanHTML(data) {
  return `<div class="order-kanban" aria-label="Quadro de pedidos">${KANBAN_COLUMNS.map(([key, title]) => {
    const orders = data.columns?.[key] || [];
    const total = Number(data.totals?.[key] || 0);
    const hidden = Math.max(0, total - orders.length);
    return `<section class="kanban-column kanban-${key}">
      <header><h2>${title}</h2><span>${total}</span></header>
      <div class="kanban-list">${orders.length ? orders.map(kanbanCard).join('') : '<p class="kanban-empty">Nenhum pedido</p>'}</div>
      ${hidden ? `<p class="kanban-overflow">+ ${hidden} pedido${hidden === 1 ? '' : 's'} fora da visualização inicial</p>` : ''}
    </section>`;
  }).join('')}</div>`;
}

async function renderOrders() {
  const session = await getSession(true);
  if (!session.user) {
    main.innerHTML = `<div data-orders-owned>${empty('Entre para consultar seus pedidos', 'Seu histórico fica disponível depois do login.')}<p><a class="button primary" href="#entrar">Entrar</a></p></div>`;
    return;
  }
  const operator = isOperator(session.user);
  main.innerHTML = '<div class="loading" role="status">Carregando pedidos…</div>';
  const data = await api(operator ? '/api/v1/orders/kanban' : '/api/v1/orders?limit=50&offset=0');
  main.innerHTML = `<div data-orders-owned><div class="page-heading"><div><p class="eyebrow">${operator ? 'OPERAÇÃO DA LOJA' : 'MINHA CONTA'}</p><h1>${operator ? 'Pedidos da loja' : 'Meus pedidos'}</h1></div><button type="button" class="button ghost" data-order-action="refresh-orders">Atualizar</button></div>
    ${operator ? kanbanHTML(data) : data.items?.length ? `<div class="section">${data.items.map(orderSummary).join('')}</div>` : empty('Nenhum pedido por aqui', 'Finalize uma sacola para criar seu primeiro pedido.')}</div>`;
}

function nextStatus(order) {
  if (order.status === 'PENDING') return ['PREPARING', 'Iniciar preparo'];
  if (order.status === 'CONFIRMED') return ['PREPARING', 'Iniciar preparo'];
  if (order.status === 'PREPARING') return ['READY', 'Marcar como pronto'];
  if (order.status === 'READY') return order.order_type === 'DELIVERY' ? ['OUT_FOR_DELIVERY', 'Saiu para entrega'] : ['DELIVERED', 'Concluir pedido'];
  if (order.status === 'OUT_FOR_DELIVERY') return ['DELIVERED', 'Confirmar entrega'];
  return null;
}

function paymentHTML(payment, operator) {
  const manualConfirm = operator && payment.status === 'PENDING' && ['CASH', 'CARD_MACHINE'].includes(payment.method)
    ? `<button type="button" class="button ghost small" data-order-action="confirm-payment" data-order="${payment.id_order}" data-payment="${payment.id_order_payment}">Confirmar recebimento</button>` : '';
  return `<article class="panel payment-card">
    <div class="section-heading"><h3>${h(PAYMENT_METHOD[payment.method] || payment.method)}</h3>${statusBadge(payment.status)}</div>
    <p><strong>${money(payment.amount)}</strong></p>
    <p>Referência: <code>${h(payment.reference)}</code></p>
    ${payment.method === 'PIX' && payment.status === 'PENDING' ? '<p class="small-copy">O cliente envia o comprovante pelo WhatsApp respondendo à solicitação da cobrança ou informando esta referência na legenda.</p>' : ''}
    ${payment.method === 'ONLINE' ? `<p class="small-copy">Mercado Pago: ${h(payment.mp_status || 'aguardando evento do provedor')} · sincronização ${h(payment.mp_sync_status || 'pendente')}</p>` : ''}
    ${manualConfirm}
  </article>`;
}

function receiptHTML(orderId, receipt, operator) {
  const review = operator && receipt.status === 'AWAITING_REVIEW'
    ? `<div class="table-actions"><button type="button" class="button primary small" data-order-action="approve-receipt" data-order="${orderId}" data-receipt="${receipt.id_receipt}">Aprovar</button><button type="button" class="button ghost small" data-order-action="reject-receipt" data-order="${orderId}" data-receipt="${receipt.id_receipt}">Rejeitar</button></div>` : '';
  return `<article class="store-card">
    <div><h3>Comprovante #${receipt.id_receipt}</h3><p>${h(receipt.mime_type)} · ${(Number(receipt.size_bytes || 0) / 1024).toFixed(1)} KB</p><p>${statusBadge(receipt.status)}</p>${receipt.review_note ? `<p>${h(receipt.review_note)}</p>` : ''}</div>
    <div><a class="button ghost small" href="/backend/api/v1/orders/${orderId}/receipts/${receipt.id_receipt}/content">Baixar</a>${review}</div>
  </article>`;
}

function historyHTML(history = []) {
  if (!history.length) return empty('Sem movimentações', 'O histórico deste pedido ainda não possui registros.');
  return `<ol class="order-history">${history.map(entry => {
    const title = entry.from_status ? `${STATUS[entry.from_status] || entry.from_status} → ${STATUS[entry.to_status] || entry.to_status}` : 'Pedido criado';
    const actor = entry.changed_by_role === 'USER' ? 'Cliente' : entry.changed_by_role === 'EMPLOYEE' ? 'Equipe da loja' : 'Sistema';
    return `<li><span class="history-marker" aria-hidden="true"></span><div><strong>${h(title)}</strong><p>${new Date(entry.created_at).toLocaleString('pt-BR')} · ${actor}</p>${entry.note ? `<p class="history-note">${h(entry.note)}</p>` : ''}</div></li>`;
  }).join('')}</ol>`;
}

async function renderOrderDetail(id) {
  const session = await getSession(true);
  if (!session.user) {
    main.innerHTML = `<div data-orders-owned>${empty('Entre para consultar este pedido', 'O pedido só pode ser acessado por seu cliente ou pela loja responsável.')}<p><a class="button primary" href="#entrar">Entrar</a></p></div>`;
    return;
  }
  main.innerHTML = '<div class="loading" role="status">Carregando pedido…</div>';
  const [order, receipts] = await Promise.all([
    api(`/api/v1/orders/${id}`),
    api(`/api/v1/orders/${id}/receipts`).catch(error => error.status === 404 ? [] : Promise.reject(error)),
  ]);
  const operator = isOperator(session.user);
  const advance = operator ? nextStatus(order) : null;
  const canCancel = operator && ['PENDING', 'CONFIRMED', 'PREPARING', 'READY'].includes(order.status);
  const address = order.delivery_address_snapshot;
  main.innerHTML = `<div data-orders-owned><div class="page-heading"><div><p class="eyebrow">PEDIDO #${h(order.order_number)}</p><h1>${h(STATUS[order.status] || order.status)}</h1></div><a class="button ghost" href="#pedidos">Todos os pedidos</a></div>
    <div class="cart-layout">
      <section class="panel cart-items">
        ${order.items.map(item => `<article class="cart-item"><div class="item-heading"><h3>${item.quantity}× ${h(item.product_name)}</h3><strong>${money(item.total_price)}</strong></div>${item.options.map(option => `<p class="item-option">${option.quantity}× ${h(option.option_name)}</p>`).join('')}${item.observation ? `<p class="observation">${h(item.observation)}</p>` : ''}</article>`).join('')}
        ${order.customer_observation ? `<div class="notice">Observação: ${h(order.customer_observation)}</div>` : ''}
        ${address ? `<div class="notice"><strong>Entrega:</strong> ${h(address.street)}, ${h(address.number)}${address.complement ? `, ${h(address.complement)}` : ''} · ${h(address.neighborhood)} · ${h(address.city)}/${h(address.state)} · CEP ${h(address.postal_code)}</div>` : ''}
      </section>
      <aside class="panel cart-summary">
        <h2>Resumo</h2>
        <dl class="totals"><div><dt>Subtotal</dt><dd>${money(order.subtotal_amount)}</dd></div><div><dt>Desconto</dt><dd>− ${money(order.discount_amount)}</dd></div><div><dt>Entrega</dt><dd>${money(order.delivery_fee)}</dd></div><div class="total"><dt>Total</dt><dd>${money(order.total_amount)}</dd></div></dl>
        <p>${statusBadge(order.status)} ${statusBadge(order.payment_status)}</p>
        <p><strong>Cliente:</strong> ${h(order.client?.name || order.customer_name)}<br><strong>Telefone:</strong> ${h(order.client?.phone || order.customer_phone)}<br><strong>Loja:</strong> ${h(order.store?.name || `#${order.id_store}`)}</p>
        <p>${h(ORDER_TYPE[order.order_type] || order.order_type)} · ${h(PAYMENT_METHOD[order.payment_method] || order.payment_method)}</p>
        ${advance ? `<button type="button" class="button primary full" data-order-action="advance-order" data-id="${order.id_order}" data-version="${order.version}" data-status="${advance[0]}">${advance[1]}</button>` : ''}
        ${canCancel ? `<button type="button" class="button text-danger full" data-order-action="cancel-order" data-id="${order.id_order}" data-version="${order.version}">Cancelar pedido</button>` : ''}
      </aside>
    </div>
    <section class="section panel"><div class="section-heading"><h2>Histórico do pedido</h2></div>${historyHTML(order.history)}</section>
    <section class="section"><div class="section-heading"><h2>Pagamentos</h2></div>${order.payments.length ? order.payments.map(payment => paymentHTML(payment, operator)).join('') : empty('Sem cobrança', 'Este pedido ainda não possui cobrança registrada.')}</section>
    <section class="section"><div class="section-heading"><h2>Comprovantes</h2></div>${receipts.length ? receipts.map(receipt => receiptHTML(order.id_order, receipt, operator)).join('') : empty('Nenhum comprovante recebido', order.payment_method === 'PIX' ? 'Quando um arquivo válido for associado à cobrança pelo WhatsApp, ele aparecerá aqui.' : 'Este método de pagamento não exige comprovante.')}</section></div>`;
}

function checkoutStoreId() {
  const [page, id] = route();
  if (!['checkout', 'sacola'].includes(page)) return null;
  return positiveId(id);
}

async function enhanceCheckout() {
  const storeId = checkoutStoreId();
  if (!storeId || document.querySelector('[data-order-checkout]')) return;
  const heading = [...main.querySelectorAll('.eyebrow')].find(node => node.textContent.includes('SACOLA EM REVISÃO'));
  if (!heading) return;
  const session = await getSession();
  if (session.user?.role !== 'SHOPPER') return;
  let cart;
  try { cart = await api(`/api/v1/carts/current?store_id=${storeId}`); }
  catch { return; }
  if (!cart?.id_cart || cart.status !== 'CHECKOUT') return;
  const host = main.querySelector('.panel');
  if (!host) return;
  host.insertAdjacentHTML('beforeend', `<hr><form data-order-checkout data-cart="${cart.id_cart}" data-store="${storeId}">
    <h2>Finalizar pedido</h2>
    <label>Forma de recebimento<select name="order_type"><option value="PICKUP">Retirada na loja</option><option value="DELIVERY">Entrega</option><option value="DINE_IN">Consumir no local</option></select></label>
    <fieldset data-delivery-address hidden>
      <div class="form-grid"><label>Rua<input name="street" maxlength="200"></label><label>Número<input name="number" maxlength="30"></label></div>
      <div class="form-grid"><label>Bairro<input name="neighborhood" maxlength="100"></label><label>Cidade<input name="city" maxlength="100"></label></div>
      <div class="form-grid"><label>UF<input name="state" maxlength="2" pattern="[A-Za-z]{2}" placeholder="PB"></label><label>CEP<input name="postal_code" inputmode="numeric" maxlength="9" placeholder="58000000"></label></div>
      <label>Complemento<input name="complement" maxlength="200"></label>
    </fieldset>
    <label>Pagamento<select name="payment_method"><option value="PIX">Pix</option><option value="CASH">Dinheiro</option><option value="CARD_MACHINE">Maquineta na entrega/retirada</option></select></label>
    <label>Observação do pedido<textarea name="observation" maxlength="1000" placeholder="Opcional"></textarea></label>
    <div class="notice">O pedido só é criado após esta confirmação. Para Pix, o backend enviará pelo WhatsApp a chave, o favorecido e a referência usada para associar o comprovante.</div>
    <p class="form-error" role="alert" hidden></p>
    <button class="button primary full">Confirmar pedido</button>
  </form>`);
}

async function submitCheckout(form) {
  const errorBox = form.querySelector('.form-error');
  const submit = form.querySelector('button[type="submit"], button:not([type])');
  submit.disabled = true;
  errorBox.hidden = true;
  try {
    const values = Object.fromEntries(new FormData(form));
    const storeId = positiveId(form.dataset.store);
    const cart = await api(`/api/v1/carts/current?store_id=${storeId}`);
    const payload = {
      cart_id: cart.id_cart,
      expected_version: cart.version,
      payment_method: values.payment_method,
      order_type: values.order_type,
      observation: values.observation.trim() || null,
    };
    if (values.order_type === 'DELIVERY') {
      payload.delivery_address = {
        street: values.street.trim(),
        number: values.number.trim(),
        neighborhood: values.neighborhood.trim(),
        city: values.city.trim(),
        state: values.state.trim().toUpperCase(),
        postal_code: values.postal_code.replace(/\D/g, ''),
        complement: values.complement.trim() || null,
      };
    }
    const order = await api('/api/v1/orders', { method: 'POST', data: payload });
    clearCheckoutForCart(cart.id_cart);
    showToast(`Pedido #${order.order_number} criado com sucesso.`);
    location.hash = `pedido/${order.id_order}`;
  } catch (error) {
    errorBox.textContent = error.message || 'Não foi possível criar o pedido.';
    errorBox.hidden = false;
  } finally {
    submit.disabled = false;
  }
}

async function orderAction(button) {
  const action = button.dataset.orderAction;
  if (action === 'refresh-orders') return renderOrders();
  const orderId = positiveId(button.dataset.id || button.dataset.order);
  if (action === 'cancel-order') {
    const reason = prompt('Descrição do cancelamento (opcional). Deixe vazio para cancelar sem descrição:');
    if (reason === null) return;
    await api(`/api/v1/orders/${orderId}/status`, { method: 'PATCH', data: {
      expected_version: positiveId(button.dataset.version), status: 'CANCELLED', reason: reason.trim() || null,
    } });
    showToast('Pedido cancelado.');
    return renderOrderDetail(orderId);
  }
  if (action === 'advance-order') {
    await api(`/api/v1/orders/${orderId}/status`, { method: 'PATCH', data: { expected_version: positiveId(button.dataset.version), status: button.dataset.status, reason: null } });
    return renderOrderDetail(orderId);
  }
  const paymentId = positiveId(button.dataset.payment);
  if (action === 'confirm-payment') {
    await api(`/api/v1/orders/${orderId}/payments/${paymentId}/confirm`, { method: 'POST', data: {} });
    showToast('Pagamento confirmado.');
    return renderOrderDetail(orderId);
  }
  const receiptId = positiveId(button.dataset.receipt);
  if (action === 'approve-receipt') {
    await api(`/api/v1/orders/${orderId}/receipts/${receiptId}/review`, { method: 'POST', data: { approve: true, note: 'Valor e favorecido conferidos pela loja.' } });
    showToast('Comprovante aprovado e pagamento confirmado.');
    return renderOrderDetail(orderId);
  }
  if (action === 'reject-receipt') {
    const note = prompt('Motivo da rejeição do comprovante:');
    if (!note?.trim()) return;
    await api(`/api/v1/orders/${orderId}/receipts/${receiptId}/review`, { method: 'POST', data: { approve: false, note: note.trim() } });
    showToast('Comprovante rejeitado. O cliente poderá reenviar pelo WhatsApp.');
    return renderOrderDetail(orderId);
  }
}

async function addPartnerOrdersCard() {
  const session = await getSession();
  if (!isOperator(session.user)) return;
  const grid = main.querySelector('.dashboard-grid');
  if (!grid || grid.querySelector('[data-orders-card]')) return;
  grid.insertAdjacentHTML('beforeend', '<a class="panel dashboard-card" data-orders-card href="#pedidos"><span class="dashboard-icon" aria-hidden="true">▣</span><h2>Pedidos</h2><p>Acompanhe pedidos, pagamentos e comprovantes.</p><strong>Gerenciar pedidos →</strong></a>');
}

async function syncView() {
  if (rendering) return;
  const [page, id] = route();
  if (['pedidos', 'pedido'].includes(page) && main.querySelector('[data-orders-owned]')) return;
  rendering = true;
  try {
    if (page === 'pedidos') await renderOrders();
    else if (page === 'pedido' && positiveId(id)) await renderOrderDetail(positiveId(id));
    else {
      await enhanceCheckout();
      await addPartnerOrdersCard();
    }
  } catch (error) {
    if (['pedidos', 'pedido'].includes(route()[0])) {
      main.innerHTML = `<div data-orders-owned>${empty('Não foi possível carregar', h(error.message || 'Tente novamente.'))}<p><button type="button" class="button primary" data-order-action="refresh-orders">Tentar novamente</button></p></div>`;
    }
  } finally {
    rendering = false;
  }
}

function scheduleSync() {
  if (scheduled) return;
  scheduled = true;
  queueMicrotask(() => {
    scheduled = false;
    syncView();
  });
}

document.addEventListener('submit', event => {
  const form = event.target.closest('[data-order-checkout]');
  if (!form) return;
  event.preventDefault();
  submitCheckout(form);
});

document.addEventListener('change', event => {
  const select = event.target.closest('[data-order-checkout] select[name="order_type"]');
  if (!select) return;
  const fieldset = select.form.querySelector('[data-delivery-address]');
  fieldset.hidden = select.value !== 'DELIVERY';
  for (const input of fieldset.querySelectorAll('input')) input.required = select.value === 'DELIVERY' && input.name !== 'complement';
});

document.addEventListener('click', event => {
  const button = event.target.closest('[data-order-action]');
  if (!button || button.disabled) return;
  button.disabled = true;
  orderAction(button).catch(error => showToast(error.message || 'Não foi possível concluir esta ação.')).finally(() => { if (button.isConnected) button.disabled = false; });
});

window.addEventListener('hashchange', () => {
  sessionCache = null;
  setTimeout(scheduleSync, 0);
});

new MutationObserver(scheduleSync).observe(main, { childList: true, subtree: true });
setTimeout(scheduleSync, 0);
