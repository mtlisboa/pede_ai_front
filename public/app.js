import { api, request, money, escapeHTML as h, positiveId, productImage } from './api.js';

const $ = (selector, root = document) => root.querySelector(selector);
const main = $('#content');
const modal = $('#modal');
const state = { stores: [], user: null, store: null, cart: null, products: [], page: 1, query: '', filter: '', searchFilters: new Set(), busy: false, epoch: 0, tickets: [] };
let poll, toastTimer;
let pendingCredentials = null;
const icons = { home: '⌂', search: '⌕', bag: '▢', user: '○', kitchen: '▤' };
const button = (text, action, extra = '', kind = 'primary') => `<button type="button" class="button ${kind}" data-action="${action}" ${extra}>${text}</button>`;
const field = (label, name, type = 'text', value = '', attrs = '') => `<label>${label}<input name="${name}" type="${type}" value="${h(value)}" ${attrs}></label>`;
const note = text => `<div class="notice">${text}</div>`;
const empty = (title, text, action = '') => `<section class="empty"><span class="empty-symbol" aria-hidden="true">○</span><h2>${title}</h2><p>${text}</p>${action}</section>`;
const heading = (eyebrow, title, trailing = '') => `<div class="page-heading"><div><p class="eyebrow">${eyebrow}</p><h1>${title}</h1></div>${trailing}</div>`;
const storeName = () => state.stores.find(s => s.id === state.store)?.name || `Loja ${state.store}`;
const shopper = () => state.user?.role === 'SHOPPER';
const operator = () => ['OWNER', 'EMPLOYEE'].includes(state.user?.role);
const route = () => location.hash.slice(1).split('/');
const cartPath = suffix => `/api/v1/carts/current${suffix}?store_id=${state.store}`;
function toast(message) { $('#toast').textContent = message; $('#toast').hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => $('#toast').hidden = true, 6500); }
function go(hash) { if (location.hash === '#' + hash) render(); else location.hash = hash; }
function photo(product, cls = '') { const src = productImage(product.image_url); return `<div class="product-image ${cls}"><span aria-hidden="true">Sem foto</span>${src ? `<img src="${h(src)}" alt="${h(product.name)}" loading="lazy">` : ''}</div>`; }
function nav() {
  $('#account-nav').innerHTML = state.user ? `<a class="account-link" href="#conta">Olá, ${h(state.user.name.split(' ')[0] || 'você')}</a>` : '<a class="button ghost small" href="#entrar">Entrar</a>';
  const current = route()[0] || 'inicio';
  const links = [['inicio', icons.home, 'Início'], [state.store ? `loja/${state.store}` : 'buscar', icons.search, 'Cardápio'], [state.store ? `sacola/${state.store}` : 'sacola', icons.bag, 'Sacola'], ['parceiro', icons.kitchen, 'Parceiro'], ['conta', icons.user, 'Conta']];
  $('#navigation').innerHTML = links.map(([url, icon, label]) => `<a href="#${url}" ${current === url.split('/')[0] ? 'aria-current="page"' : ''}><span aria-hidden="true">${icon}</span>${label}</a>`).join('');
}
function modalOpen(content) { modal.innerHTML = `${button('×', 'close', 'aria-label="Fechar janela"', 'close')}<div class="dialog-content">${content}<p class="form-error" role="alert" hidden></p></div>`; modal.showModal(); }
function showError(error, target = modal.open ? $('.form-error', modal) : $('.form-error', main)) {
  if (target) { target.textContent = error.message; target.hidden = false; } else toast(error.message);
}
async function action(run) {
  if (state.busy) return;
  state.busy = true;
  const controls = [...document.querySelectorAll('button')];
  const enabled = controls.filter(b => !b.disabled); enabled.forEach(b => b.disabled = true);
  try { await run(); } catch (error) {
    if (error.status === 409 && state.store && shopper() && !checkoutRef()) {
      try { state.cart = await api(cartPath('')); } catch { state.cart = null; }
      if (modal.open) modal.close();
      toast('A sacola mudou. Atualizamos os dados; confira os itens antes de tentar novamente.');
      await render();
    } else if (error.status === 401 && !['entrar', 'parceiro'].includes(route()[0])) {
      state.user = null; state.cart = null; if (modal.open) modal.close(); nav(); go('entrar'); toast('Entre novamente para continuar.');
    } else showError(error);
  } finally { state.busy = false; enabled.filter(b => b.isConnected).forEach(b => b.disabled = false); }
}
function storeForm() { return `<form data-form="store" class="search-row">${field('Código da loja', 'store', 'number', state.store || '', 'required min="1" step="1" placeholder="Ex.: 1"')}<button class="button primary">Abrir cardápio</button></form>`; }
function home() {
  main.innerHTML = `${heading('BATEU A FOME?', 'O que vamos pedir hoje?')}<div class="home-grid"><section class="food-banner"><img src="/assets/food.jpg" alt="Hambúrguer artesanal acompanhado de batatas fritas"><div><span class="tag">Pede Aí</span><h2>Seu cardápio.<br>Sua próxima escolha.</h2><a class="button light" href="#buscar">Encontrar uma loja <span aria-hidden="true">→</span></a></div></section><section class="panel find-store"><p class="eyebrow">DIRETO AO CARDÁPIO</p><h2>Já sabe onde pedir?</h2><p>Abra o link recebido da loja ou informe o código dela.</p>${storeForm()}</section></div><section class="section"><h2>Lojas disponíveis</h2>${state.stores.length ? `<div class="store-grid">${state.stores.map(s => `<a class="store-card" href="#loja/${s.id}"><span class="store-initial">${h(s.name.slice(0, 1))}</span><div><h3>${h(s.name)}</h3><p>${h(s.description || 'Conheça o cardápio')}</p></div><span aria-hidden="true">→</span></a>`).join('')}</div>` : note('Nenhuma loja está listada no momento. Você ainda pode abrir um cardápio pelo código ou pelo link da loja.')}</section>`;
}
function login(partner = false) {
  pendingCredentials = null;
  if (state.user && (partner ? operator() : true)) {
    if (partner) return partnerHome();
    return account();
  }
  main.innerHTML = `<section class="auth-shell"><div class="auth-intro"><p class="eyebrow">${partner ? 'ÁREA DO ESTABELECIMENTO' : 'BEM-VINDO AO PEDE AÍ'}</p><h1>${partner ? 'Sua operação,<br>em um só lugar.' : 'Seu próximo pedido<br>começa por aqui.'}</h1><p>${partner ? 'Acesse o cardápio e a fila de preparo com sua conta de funcionário.' : 'Entre com o código enviado ao seu WhatsApp para montar sua sacola.'}</p><img src="/assets/food.jpg" alt="Hambúrguer e fritas"></div><div class="panel auth-panel"><h2>${partner ? 'Entrar como parceiro' : 'Entrar na minha conta'}</h2>${partner ? `<form data-form="employee">${field('E-mail, celular ou usuário', 'identifier', 'text', '', 'required autocomplete="username" maxlength="255"')}${field('Senha', 'password', 'password', '', 'required minlength="6" maxlength="255" autocomplete="current-password"')}<button class="button primary full">Entrar</button></form>` : `<form data-form="request-code">${field('WhatsApp com DDI e DDD', 'phone', 'tel', '', 'required autocomplete="tel" placeholder="55 83 99999-9999" minlength="8" maxlength="22"')}<button class="button primary full">Receber código</button></form><p class="auth-foot">Primeiro acesso? Sua conta é criada ao confirmar o número. Um novo login encerra a sessão anterior.</p>`}<p class="form-error" role="alert" hidden></p><a class="muted-link" href="#${partner ? 'entrar' : 'parceiro'}">${partner ? 'Sou cliente' : 'Acesso do estabelecimento'}</a></div></section>`;
}
function registration() {
  main.innerHTML = `<section class="narrow">${heading('PRIMEIRO PEDIDO?', 'Crie sua conta')}<div class="panel"><form data-form="register">${field('Seu nome', 'name', 'text', '', 'required minlength="2" maxlength="120" autocomplete="name"')}${field('WhatsApp com DDI e DDD', 'phone', 'tel', '', 'required autocomplete="tel" placeholder="55 83 99999-9999" minlength="8" maxlength="22"')}${field('CPF (opcional)', 'cpf', 'text', '', 'inputmode="numeric" maxlength="14"')}<button class="button primary full">Criar conta</button></form><p class="form-error" role="alert" hidden></p><p>Já tem conta? <a href="#entrar">Entrar</a></p></div></section>`;
}
function verification(phone) {
  main.innerHTML = `<section class="narrow">${heading('CONFIRME SEU NÚMERO', 'Confira seu WhatsApp')}<div class="panel"><p>Enviamos um código para <strong>${h(phone)}</strong>.</p><form data-form="verify" data-phone="${h(phone)}">${field('Código de 6 dígitos', 'code', 'text', '', 'required inputmode="numeric" pattern="[0-9]{6}" maxlength="6" autocomplete="one-time-code" autofocus')}<button class="button primary full">Confirmar e entrar</button></form><p class="form-error" role="alert" hidden></p><a href="#entrar">Usar outro número ou pedir novo código</a></div></section>`;
  $('[name="code"]').focus();
}
function contactVerification() {
  main.innerHTML = `<section class="narrow">${heading('CONFIRME SEUS CONTATOS', 'Proteja sua conta')}<div class="panel"><p>Confirme o e-mail e o celular cadastrados antes do primeiro acesso.</p><section data-contact="email"><h3>E-mail</h3><form data-form="contact-send" data-channel="email"><button class="button primary">Enviar código por e-mail</button></form></section><section data-contact="phone"><h3>WhatsApp</h3><form data-form="contact-send" data-channel="phone">${field('Celular (preencha se sua conta ainda não tiver um)', 'phone_number', 'tel', '', 'autocomplete="tel" placeholder="55 83 99999-9999" maxlength="22"')}<button class="button primary">Enviar código pelo WhatsApp</button></form></section><form data-form="contacts-finish"><button class="button primary full">Concluir e entrar</button></form><p class="form-error" role="alert" hidden></p><a href="#parceiro">Voltar ao login</a></div></section>`;
}
async function account() {
  if (!state.user) return login();
  const epoch = state.epoch;
  const user = shopper() ? await api('/api/v1/users/me') : null;
  if (epoch !== state.epoch) return;
  main.innerHTML = `<section class="narrow">${heading('MINHA CONTA', h(user?.name || state.user.name))}<div class="panel">${user ? `<form data-form="profile">${field('Nome', 'name', 'text', user.name, 'required minlength="2" maxlength="120"')}${field('CPF (opcional)', 'cpf', 'text', user.cpf || '', 'inputmode="numeric" maxlength="14"')}<label>WhatsApp<input value="${h(user.phone)}" disabled></label><button class="button primary">Salvar alterações</button></form><p class="form-error" role="alert" hidden></p>` : `<p>Conta operacional</p><a class="button primary" href="#parceiro">Abrir painel</a><details><summary>Definir nome de usuário</summary><form data-form="username">${field('E-mail ou celular atual', 'identifier', 'text', '', 'required autocomplete="username"')}${field('Senha atual', 'password', 'password', '', 'required autocomplete="current-password"')}${field('Novo usuário', 'username', 'text', '', 'required pattern="[a-zA-Z][a-zA-Z0-9_.-]{2,63}" minlength="3" maxlength="64"')}<button class="button primary">Salvar usuário</button></form><p class="form-error" role="alert" hidden></p></details>`}<div class="account-actions">${button('Sair da conta', 'logout', '', 'ghost')}${user ? button('Excluir minha conta', 'delete-account', '', 'text-danger') : ''}</div></div>${user ? `<div class="section"><a class="store-card" href="#pedidos"><div><h3>Meus pedidos</h3><p>Disponibilidade do acompanhamento</p></div><span aria-hidden="true">→</span></a></div>` : ''}</section>`;
}
async function catalog() {
  if (!state.store) { main.innerHTML = `${heading('ENCONTRE SEU CARDÁPIO', 'Qual é a sua loja?')}<div class="panel narrow">${storeForm()}</div>`; return; }
  const epoch = state.epoch;
  const query = new URLSearchParams({ store_id: state.store, page: state.page, page_size: 12, ...(state.query ? { q: state.query } : {}), ...(state.filter ? { [state.filter]: true } : {}) });
  // Use the public collection: backend dev currently protects numeric detail/store paths.
  const data = await api(`/api/v1/products?${query}`);
  if (epoch !== state.epoch) return;
  state.products = data.items;
  main.innerHTML = `${heading('CARDÁPIO', h(storeName()), `<a class="button ghost" href="#sacola/${state.store}">Ver sacola →</a>`)}<section class="catalog-toolbar"><form data-form="search" class="search-row">${field('Buscar no cardápio', 'query', 'search', state.query, 'maxlength="120" placeholder="Qual é a sua vontade?"')}<button class="button primary">Buscar</button></form><div class="chips" aria-label="Filtros de produtos">${[['', 'Todos'], ['is_featured', 'Destaques'], ['is_available', 'Disponíveis']].map(([filter, title]) => `<button class="chip" data-action="filter" data-filter="${filter}" aria-pressed="${state.filter === filter}">${title}</button>`).join('')}</div></section><div class="section-heading"><h2>Escolha seus favoritos</h2><span>${data.total} ${data.total === 1 ? 'opção' : 'opções'}</span></div>${data.items.length ? `<div class="product-grid">${data.items.map(p => `<article class="product-card">${photo(p)}<div class="product-body"><div class="product-tags">${p.is_featured ? '<span class="tag">Destaque</span>' : ''}${(!p.is_active || !p.is_available) ? '<span class="tag neutral">Indisponível</span>' : ''}</div><h3>${h(p.name)}</h3><p>${h(p.description || 'Veja os detalhes e personalize sua escolha.')}</p><div class="product-bottom"><div><strong>${money(p.base_price)}</strong>${p.preparation_time_minutes != null ? `<small>Preparo: ${p.preparation_time_minutes} min</small>` : ''}</div>${button('+', 'product', `data-id="${p.id_product}" aria-label="Ver ${h(p.name)}"`, 'add')}</div></div></article>`).join('')}</div><nav class="pagination" aria-label="Páginas do cardápio">${button('← Anterior', 'page', `data-page="${state.page - 1}" ${state.page <= 1 ? 'disabled' : ''}`, 'ghost')}<span>Página ${state.page} de ${Math.ceil(data.total / data.page_size)}</span>${button('Próxima →', 'page', `data-page="${state.page + 1}" ${state.page * data.page_size >= data.total ? 'disabled' : ''}`, 'ghost')}</nav>` : empty('Nenhum produto encontrado', 'Tente outra busca ou volte mais tarde para conferir o cardápio.', button('Limpar filtros', 'reset-search', '', 'ghost'))}`;
}
const discoveryFilters = [
  ['entrega', 'Entrega'],
  ['retirar_no_balcao', 'Retirar no balcão'],
  ['entrega_em_casa', 'Entrega em casa'],
  ['lanches', 'Lanches'],
  ['almocos', 'Almoços'],
  ['jantas', 'Jantas'],
  ['cafe_da_manha', 'Café da manhã'],
  ['bebidas', 'Bebidas'],
  ['loja', 'Loja'],
  ['loja_fisica', 'Loja física'],
];
function discoveryToolbar() {
  return `<section class="catalog-toolbar"><form data-form="search" class="search-row">${field('Buscar comida ou restaurante', 'query', 'search', state.query, 'maxlength="120" placeholder="Ex.: hambúrguer ou Restaurante Central"')}<button class="button primary">Buscar</button></form><div class="chips" aria-label="Filtros da busca">${discoveryFilters.map(([value, label]) => `<button class="chip" data-action="search-filter" data-filter="${value}" aria-pressed="${state.searchFilters.has(value)}">${label}</button>`).join('')}</div></section>`;
}
async function discovery() {
  const toolbar = discoveryToolbar();
  if (!state.query && !state.searchFilters.size) {
    main.innerHTML = `${heading('ENCONTRE O QUE DESEJA', 'Comida e restaurantes')}${toolbar}${empty('Comece sua busca', 'Digite o nome de uma comida ou restaurante, ou selecione um filtro.')}`;
    return;
  }
  const query = new URLSearchParams({ page: state.page, page_size: 12 });
  if (state.query) query.set('q', state.query);
  for (const filter of state.searchFilters) query.append('filters', filter);
  const epoch = state.epoch;
  const data = await api(`/api/v1/search?${query}`);
  if (epoch !== state.epoch) return;
  state.products = data.products;
  const stores = data.stores.length ? `<section class="section"><div class="section-heading"><h2>Restaurantes</h2><span>${data.store_total}</span></div><div class="store-grid">${data.stores.map(store => `<a class="store-card" href="#loja/${store.id_store}"><span class="store-initial">${h(store.name.slice(0, 1))}</span><div><h3>${h(store.name)}</h3><p>${[store.supports_delivery ? 'Entrega' : '', store.supports_pickup ? 'Retirada' : '', store.is_physical_store ? 'Loja física' : ''].filter(Boolean).join(' · ')}</p></div><span aria-hidden="true">→</span></a>`).join('')}</div></section>` : '';
  const products = data.products.length ? `<section class="section"><div class="section-heading"><h2>Comidas</h2><span>${data.product_total}</span></div><div class="product-grid">${data.products.map(product => `<article class="product-card">${photo(product)}<div class="product-body"><div class="product-tags">${product.is_featured ? '<span class="tag">Destaque</span>' : ''}<span class="tag neutral">${h(product.store_name)}</span></div><h3>${h(product.name)}</h3><p>${h(product.description || 'Disponível no cardápio do estabelecimento.')}</p><div class="product-bottom"><strong>${money(product.base_price)}</strong>${button('+', 'search-product', `data-id="${product.id_product}" data-store="${product.id_store}" aria-label="Ver ${h(product.name)}"`, 'add')}</div></div></article>`).join('')}</div></section>` : '';
  const noResults = !data.stores.length && !data.products.length ? empty('Nenhum resultado encontrado', 'Tente outro nome ou remova alguns filtros.', button('Limpar busca', 'reset-discovery', '', 'ghost')) : '';
  const totalPages = Math.ceil(Math.max(data.store_total, data.product_total) / data.page_size);
  const pagination = totalPages > 1 ? `<nav class="pagination" aria-label="Páginas dos resultados">${button('← Anterior', 'page', `data-page="${state.page - 1}" ${state.page <= 1 ? 'disabled' : ''}`, 'ghost')}<span>Página ${state.page} de ${totalPages}</span>${button('Próxima →', 'page', `data-page="${state.page + 1}" ${state.page >= totalPages ? 'disabled' : ''}`, 'ghost')}</nav>` : '';
  main.innerHTML = `${heading('RESULTADOS DA BUSCA', state.query ? `Resultados para “${h(state.query)}”` : 'Comida e restaurantes')}${toolbar}${stores}${products}${noResults}${pagination}`;
}
function productModal(id) {
  const p = state.products.find(p => p.id_product === id); if (!p) return;
  modalOpen(`${photo(p, 'detail-image')}<p class="eyebrow">${h(storeName())}</p><h2 id="modal-title">${h(p.name)}</h2><p>${h(p.description || '')}</p><strong class="price">${money(p.base_price)}</strong>${p.is_active && p.is_available ? `<form data-form="add-item" data-id="${id}">${field('Quantidade', 'quantity', 'number', 1, 'required min="1" max="100" step="1"')}<label>Alguma observação?<textarea name="observation" maxlength="1000" placeholder="Ex.: sem cebola"></textarea></label><button class="button primary full">${shopper() ? 'Adicionar à sacola' : 'Entrar para adicionar'}</button></form>` : note('Este produto está indisponível no momento.')}`);
}
function checkoutKey() { return `pede-checkout:${state.user?.user_id}:${state.store}`; }
function checkoutRef() { try { const value = JSON.parse(sessionStorage.getItem(checkoutKey())); return value && positiveId(value.id_cart) && positiveId(value.version) ? value : null; } catch { return null; } }
function saveCheckout(cart) { sessionStorage.setItem(checkoutKey(), JSON.stringify({ id_cart: cart.id_cart, version: cart.version })); }
async function getCart(create = false) {
  if (checkoutRef()) throw new Error('Sua sacola está em revisão. Volte à sacola para retomar a edição.');
  try { return await api(cartPath('')); } catch (e) {
    if (e.status !== 404) throw e;
    return create ? api('/api/v1/carts', { method: 'POST', data: { id_store: state.store } }) : null;
  }
}
async function cartView() {
  if (!state.user) { main.innerHTML = empty('Sua sacola espera por você', 'Entre para adicionar produtos e recuperar sua sacola.', '<a class="button primary" href="#entrar">Entrar na minha conta</a>'); return; }
  if (!shopper()) { main.innerHTML = empty('Sacola do cliente', 'Use uma conta de cliente para montar uma sacola.', button('Sair da conta de funcionário', 'logout', '', 'ghost')); return; }
  if (!state.store) { main.innerHTML = empty('Vamos escolher uma loja?', 'Abra um cardápio para começar sua sacola.', '<a class="button primary" href="#buscar">Encontrar uma loja</a>'); return; }
  if (checkoutRef()) return checkoutView();
  const epoch = state.epoch;
  const cart = await getCart();
  if (epoch !== state.epoch) return;
  state.cart = cart;
  main.innerHTML = `${heading(h(storeName()), 'Sua sacola', `<a class="button ghost" href="#loja/${state.store}">Adicionar mais itens</a>`)}${!cart?.items.length ? empty('Ainda tem espaço para algo gostoso', 'Escolha um produto no cardápio para começar.', `<a class="button primary" href="#loja/${state.store}">Explorar cardápio</a>`) : `<div class="cart-layout"><section class="panel cart-items">${cart.items.map(i => `<article class="cart-item"><div class="item-heading"><h3>${h(i.product_name_snapshot)}</h3><strong>${money(i.total_price_snapshot)}</strong></div>${i.options.map(o => `<p class="item-option">${o.quantity}× ${h(o.option_name_snapshot)}</p>`).join('')}${i.observation ? `<p class="observation">${h(i.observation)}</p>` : ''}<div class="item-actions"><div class="quantity">${button('−', 'quantity', `data-id="${i.id_cart_item}" data-quantity="${i.quantity - 1}" aria-label="Diminuir ${h(i.product_name_snapshot)}"`, 'icon')}<span>${i.quantity}</span>${button('+', 'quantity', `data-id="${i.id_cart_item}" data-quantity="${i.quantity + 1}" ${i.quantity >= 100 ? 'disabled' : ''} aria-label="Aumentar ${h(i.product_name_snapshot)}"`, 'icon')}</div>${button('Editar observação', 'edit-note', `data-id="${i.id_cart_item}"`, 'text')}${button('Remover', 'remove-item', `data-id="${i.id_cart_item}"`, 'text-danger')}</div></article>`).join('')}${button('Limpar sacola', 'clear-cart', '', 'text-danger')}</section><aside class="panel cart-summary"><h2>Resumo</h2>${totals(cart)}<p class="small-copy">Os valores são confirmados pela loja ao revisar a sacola.</p>${button('Revisar sacola', 'review-cart', '', 'primary full')}${note('A finalização de pedidos e o pagamento ainda não estão disponíveis. Nenhuma cobrança será feita.')}</aside></div>`}`;
}
function totals(cart) { return `<dl class="totals"><div><dt>Subtotal</dt><dd>${money(cart.subtotal_amount)}</dd></div><div><dt>Desconto</dt><dd>− ${money(cart.discount_amount)}</dd></div><div><dt>Entrega</dt><dd>${money(cart.delivery_fee)}</dd></div><div class="total"><dt>Total</dt><dd>${money(cart.total_amount)}</dd></div></dl>`; }
function checkoutView() {
  main.innerHTML = `<section class="narrow">${heading('SACOLA EM REVISÃO', 'Confira antes de continuar')}<div class="panel">${state.cart?.status === 'CHECKOUT' ? `${state.cart.items.map(i => `<p>${i.quantity}× ${h(i.product_name_snapshot)} <strong>${money(i.total_price_snapshot)}</strong></p>`).join('')}${totals(state.cart)}` : '<p>Sua sacola foi colocada em revisão nesta sessão. Retome a edição para consultar os valores atualizados.</p>'}${note('Seu pedido ainda não foi enviado à cozinha. A finalização e o pagamento não estão disponíveis no momento.')}${button('Voltar à edição da sacola', 'cancel-checkout', '', 'primary full')}</div></section>`;
}
async function partnerHome() {
  const connection = await api('/api/v1/stores/me/mercado-pago');
  const connectionNotice = connection.connected
    ? '<a class="button ghost" href="#integracoes">Mercado Pago conectado</a>'
    : note('Conexão obrigatória: o proprietário precisa autorizar o Mercado Pago para a loja receber novos pedidos. <a href="#integracoes">Conectar conta</a>');

  main.innerHTML = `${heading('ÁREA DO ESTABELECIMENTO', `Olá, ${h(state.user.name.split(' ')[0])}`)}${connectionNotice}<div class="dashboard-grid"><a class="panel dashboard-card" href="#produtos"><span class="dashboard-icon" aria-hidden="true">▦</span><h2>Meu cardápio</h2><p>Cadastre produtos, ajuste preços e controle a disponibilidade.</p><strong>Gerenciar produtos →</strong></a><a class="panel dashboard-card" href="#cozinha"><span class="dashboard-icon" aria-hidden="true">▤</span><h2>Cozinha</h2><p>Receba tickets, inicie o preparo e sinalize os pedidos prontos.</p><strong>Abrir fila de preparo →</strong></a></div>${note('Pedidos, financeiro, campanhas e integrações serão disponibilizados conforme os serviços da loja forem habilitados.')}`;
}
async function integrationsView() {
  if (!operator()) return login(true);
  const epoch = state.epoch;
  const data = await api('/api/v1/stores/me/mercado-pago');
  if (epoch !== state.epoch) return;
  main.innerHTML = `${heading('CONTA DA LOJA', 'Mercado Pago', '<a class="button ghost" href="#parceiro">Voltar</a>')}<section class="panel narrow"><h2>${data.connected ? 'Conta conectada' : 'Conexão obrigatória'}</h2><p>${data.connected ? `Conta Mercado Pago ${h(data.provider_user_id)} vinculada à sua loja.` : 'Autorize sua conta Mercado Pago para habilitar o recebimento de novos pedidos. O cardápio e os pedidos existentes continuam acessíveis.'}</p>${!data.configured ? note('A plataforma está concluindo a configuração do Mercado Pago. Entre em contato com o suporte para liberar a conexão.') : data.can_authorize ? button(data.connected ? 'Autorizar novamente' : 'Conectar Mercado Pago', 'connect-mercado-pago') : note('Somente o proprietário da loja pode concluir esta autorização.')}${data.status === 'REAUTH_REQUIRED' ? note('A autorização expirou ou foi revogada. Conecte novamente para liberar novos pedidos.') : ''}<p class="form-error" role="alert" hidden></p></section>`;
}
let productCategories = [];
async function productsView() {
  if (!operator()) return login(true);
  const epoch = state.epoch;
  const [data, categories] = await Promise.all([
    api(`/api/v1/products/manage?${new URLSearchParams({ page: state.page, page_size: 20, ...(state.query ? { q: state.query } : {}) })}`),
    api('/api/v1/products/categories'),
  ]);
  productCategories = categories;
  if (epoch !== state.epoch) return;
  state.products = data.items;
  main.innerHTML = `${heading('GESTÃO DO CARDÁPIO', 'Meus produtos', button('+ Novo produto', 'new-product'))}<div class="panel"><form class="search-row" data-form="search">${field('Buscar produto', 'query', 'search', state.query, 'maxlength="120"')}<button class="button primary">Buscar</button>${button('+ Categoria', 'new-category', '', 'ghost')}</form>${data.items.length ? `<div class="table-scroll"><table><thead><tr><th>Produto</th><th>Preço</th><th>Disponibilidade</th><th>Ações</th></tr></thead><tbody>${data.items.map(p => `<tr><td><strong>${h(p.name)}</strong><small>${h(productCategories.find(c => c.id_category === p.id_category)?.name || 'Sem categoria')}${p.is_featured ? ' · Destaque' : ''}</small></td><td>${money(p.base_price)}</td><td><span class="status ${p.is_available ? 'green' : 'neutral'}">${!p.is_active ? 'Inativo' : p.is_available ? 'Disponível' : 'Pausado'}</span></td><td><div class="table-actions">${button('Editar', 'edit-product', `data-id="${p.id_product}"`, 'ghost small')}${button(p.is_available ? 'Pausar' : 'Disponibilizar', 'toggle-product', `data-id="${p.id_product}"`, 'ghost small')}${button('Excluir', 'delete-product', `data-id="${p.id_product}"`, 'text-danger small')}</div></td></tr>`).join('')}</tbody></table></div><nav class="pagination" aria-label="Páginas dos produtos">${button('← Anterior', 'page', `data-page="${state.page - 1}" ${state.page <= 1 ? 'disabled' : ''}`, 'ghost')}<span>${state.page} / ${Math.ceil(data.total / data.page_size)}</span>${button('Próxima →', 'page', `data-page="${state.page + 1}" ${state.page * data.page_size >= data.total ? 'disabled' : ''}`, 'ghost')}</nav>` : empty('Nenhum produto nesta lista', 'Cadastre um produto ou altere sua busca.')}</div>`;
}
function productEditor(id) {
  if (!productCategories.length) { categoryEditor(); return; }
  const p = state.products.find(p => p.id_product === id) || {};
  modalOpen(`<h2 id="modal-title">${id ? 'Editar produto' : 'Novo produto'}</h2><form data-form="product-save" data-id="${id || ''}">${field('Nome', 'name', 'text', p.name || '', 'required minlength="2" maxlength="120"')}<div class="form-grid">${field('Preço (R$)', 'base_price', 'number', p.base_price ?? '', 'required min="0" max="99999999.99" step="0.01"')}<label>Categoria<select name="id_category" required><option value="">Selecione uma categoria</option>${productCategories.map(c => `<option value="${c.id_category}" ${c.id_category === p.id_category ? 'selected' : ''}>${h(c.name)}</option>`).join('')}</select></label></div><label>Descrição<textarea name="description" maxlength="5000">${h(p.description || '')}</textarea></label><div class="form-grid">${field('Preparo em minutos (opcional)', 'preparation_time_minutes', 'number', p.preparation_time_minutes ?? '', 'min="0" step="1"')}${field('SKU (opcional)', 'sku', 'text', p.sku || '', 'maxlength="80"')}</div><input type="hidden" name="image_url" value="${h(p.image_url || '/uploads/products/default.svg')}"><label>Foto do produto<input type="file" name="photo" accept="image/jpeg,image/png,image/webp,image/avif"></label><p class="small-copy">JPG, PNG, WebP ou AVIF, até 5 MB. A foto será enviada ao salvar.</p>${p.image_url ? `<img src="${h(productImage(p.image_url))}" alt="Foto atual" width="120" height="120">` : ''}<label class="check"><input type="checkbox" name="remove_photo">Usar imagem padrão</label><div class="checks">${[['is_active', 'Ativo', true], ['is_available', 'Disponível', true], ['is_featured', 'Destaque', false], ['is_sweet', 'Doce', false], ['is_savory', 'Salgado', false], ['is_solid', 'Sólido', false], ['is_snack', 'Lanche', false], ['is_beverage', 'Bebida', false], ['is_stew', 'Ensopado', false], ['is_breakfast', 'Café da manhã', false], ['is_lunch', 'Almoço', false], ['is_dinner', 'Janta', false]].map(([name, label, fallback]) => `<label class="check"><input type="checkbox" name="${name}" ${(p[name] ?? fallback) ? 'checked' : ''}>${label}</label>`).join('')}</div>${field('Ordem no cardápio', 'sort_order', 'number', p.sort_order || 0, 'required min="0" step="1"')}<button class="button primary full">Salvar produto</button></form>`);
}
function categoryEditor() {
  modalOpen(`<h2 id="modal-title">Nova categoria</h2><form data-form="category-save">${field('Nome da categoria', 'name', 'text', '', 'required minlength="2" maxlength="120"')}<button class="button primary full">Salvar categoria</button></form>`);
}
function ticketsHTML(tickets) {
  if (!tickets.length) return empty('Tudo em dia por aqui', 'Os pedidos confirmados aparecerão nesta fila.');
  return `<div class="ticket-grid">${tickets.map(t => `<article class="ticket ${t.urgency.toLowerCase()}"><header><div><small>Pedido</small><h2>#${t.order_number}</h2></div><span class="status ${t.status === 'READY' ? 'green' : 'neutral'}">${({ CONFIRMED: 'Na fila', PREPARING: 'Em preparo', READY: 'Pronto' })[t.status] || h(t.status)}</span></header><div class="ticket-meta"><strong>${h(t.customer_name)}</strong><span>${({ DELIVERY: 'Entrega', PICKUP: 'Retirada', DINE_IN: 'No local' })[t.order_type] || h(t.order_type)} · ${t.elapsed_minutes} min</span></div>${t.items.map(i => `<div class="ticket-item"><strong>${i.quantity}× ${h(i.product_name)}</strong>${i.options.map(o => `<p>+ ${o.quantity}× ${h(o.option_name)}</p>`).join('')}${i.observation ? `<p class="observation">${h(i.observation)}</p>` : ''}</div>`).join('')}${t.customer_observation ? note(h(t.customer_observation)) : ''}<footer>${t.status === 'CONFIRMED' ? button('Iniciar preparo', 'ticket-claim', `data-id="${t.id_order}"`, 'primary full') : t.status === 'PREPARING' ? button('Marcar como pronto', 'ticket-ready', `data-id="${t.id_order}"`, 'primary full') : '<span class="ready-label">Pronto para saída</span>'}${button('Imprimir ticket', 'print-ticket', `data-id="${t.id_order}"`, 'ghost full small')}</footer></article>`).join('')}</div>`;
}
async function kitchenView() {
  if (!operator()) return login(true);
  const epoch = state.epoch;
  const result = await api('/api/v1/kitchen/tickets?include_ready=true&limit=200');
  if (epoch !== state.epoch) return;
  state.tickets = result.tickets;
  main.innerHTML = `${heading('OPERAÇÃO AO VIVO', 'Fila da cozinha', button('Atualizar agora', 'refresh', '', 'ghost'))}<div class="kitchen-info"><p>Até 200 tickets · Atualização a cada 15 segundos</p><span id="queue-status" role="status">Atualizado às ${new Date(result.server_time).toLocaleTimeString('pt-BR')}</span></div><div id="tickets">${ticketsHTML(result.tickets)}</div>`;
  poll = setInterval(async () => {
    if (state.busy || document.hidden) return;
    try {
      const fresh = await api('/api/v1/kitchen/tickets?include_ready=true&limit=200');
      if (epoch !== state.epoch || state.busy || modal.open) return;
      state.tickets = fresh.tickets;
      $('#tickets').innerHTML = ticketsHTML(fresh.tickets);
      $('#queue-status').textContent = `Atualizado às ${new Date(fresh.server_time).toLocaleTimeString('pt-BR')}`;
    } catch { if (epoch === state.epoch) $('#queue-status').textContent = 'Sem atualização. Tentaremos novamente em instantes.'; }
  }, 15000);
}
async function render() {
  clearInterval(poll); state.epoch++;
  const [page = 'inicio', id] = route();
  const store = positiveId(id);
  if (['loja', 'sacola', 'checkout'].includes(page) && store && store !== state.store) { state.store = store; state.cart = null; state.page = 1; state.query = ''; }
  nav(); main.innerHTML = '<div class="loading" role="status">Carregando…</div>';
  const epoch = state.epoch;
  document.title = `Pede Aí • ${({ loja: 'Cardápio', sacola: 'Sacola', entrar: 'Entrar', conta: 'Minha conta', cozinha: 'Cozinha', produtos: 'Produtos', parceiro: 'Parceiro', cadastro: 'Cadastro' })[page] || 'Início'}`;
  try {
    if (page !== 'parceiro') pendingCredentials = null;
    if (page === 'inicio' || !page) home();
    else if (page === 'buscar') await discovery();
    else if (page === 'loja') await catalog();
    else if (page === 'entrar') await login();
    else if (page === 'cadastro') login();
    else if (page === 'conta') await account();
    else if (page === 'sacola' || page === 'checkout') await cartView();
    else if (page === 'parceiro') await login(true);
    else if (page === 'integracoes') await integrationsView();
    else if (page === 'produtos') await productsView();
    else if (page === 'cozinha') await kitchenView();
    else if (page === 'pedidos') main.innerHTML = `${heading('MEUS PEDIDOS', 'Acompanhamento de pedidos')}${empty('Acompanhamento ainda não disponível', 'Você pode montar e revisar sua sacola. A criação e o histórico de pedidos serão liberados quando a finalização estiver disponível.', `<a class="button primary" href="#${state.store ? `sacola/${state.store}` : 'inicio'}">Voltar à sacola</a>`)}`;
    else main.innerHTML = empty('Página não encontrada', 'Vamos voltar ao início?', '<a class="button primary" href="#inicio">Ir para o início</a>');
  } catch (e) {
    if (epoch !== state.epoch) return;
    main.innerHTML = empty('Não foi possível carregar', h(e.message), `${button('Tentar novamente', 'refresh', '', 'primary')} ${e.status === 401 ? '<a class="button ghost" href="#entrar">Entrar</a>' : ''}`);
  }
}

main.addEventListener('error', event => { if (event.target.tagName === 'IMG') event.target.remove(); }, true);
modal.addEventListener('error', event => { if (event.target.tagName === 'IMG') event.target.remove(); }, true);
modal.addEventListener('click', e => { if (e.target === modal && !state.busy) modal.close(); });
modal.addEventListener('cancel', e => { if (state.busy) e.preventDefault(); });
window.addEventListener('hashchange', () => { if (modal.open) modal.close(); state.page = 1; state.query = ''; state.filter = ''; render(); });

async function mutateCart(method, suffix, data = {}) {
  const version = state.cart.version;
  const query = method === 'DELETE' ? `&expected_version=${version}` : '';
  state.cart = await api(cartPath(suffix) + query, { method, ...(method === 'DELETE' ? {} : { data: { ...data, expected_version: version } }) });
  if (modal.open) modal.close();
  await render();
}
function confirmDialog(title, text, actionName, extra = '') { modalOpen(`<h2 id="modal-title">${title}</h2><p>${text}</p><div class="dialog-actions">${button('Voltar', 'close', '', 'ghost')}${button('Confirmar', actionName, extra)}</div>`); }

document.addEventListener('click', event => {
  const link = event.target.closest('a[href^="#"]');
  if (link && link.hash !== '#content') {
    if (state.busy) { event.preventDefault(); return; }
    if (link.hash === location.hash) { event.preventDefault(); render(); return; }
  }
  const el = event.target.closest('[data-action]'); if (!el || el.disabled) return;
  const name = el.dataset.action, id = positiveId(el.dataset.id);
  if (name === 'close') { modal.close(); return; }
  if (name === 'new-category') { categoryEditor(); return; }
  if (name === 'product') { productModal(id); return; }
  if (name === 'search-product') { state.store = positiveId(el.dataset.store); productModal(id); return; }
  if (name === 'new-product' || name === 'edit-product') { productEditor(id); return; }
  if (name === 'delete-product') { confirmDialog('Excluir produto?', 'O produto será removido do cardápio.', 'confirm-delete-product', `data-id="${id}"`); return; }
  if (name === 'clear-cart') { confirmDialog('Limpar sua sacola?', 'Todos os itens desta sacola serão removidos.', 'confirm-clear-cart'); return; }
  if (name === 'delete-account') { confirmDialog('Excluir sua conta?', 'Esta ação exclui sua conta no serviço. Você precisará se cadastrar novamente para voltar a pedir.', 'confirm-delete-account'); return; }
  if (name === 'edit-note') {
    const item = state.cart.items.find(i => i.id_cart_item === id);
    modalOpen(`<h2 id="modal-title">Observação do item</h2><form data-form="item-note" data-id="${id}"><label>${h(item.product_name_snapshot)}<textarea name="observation" maxlength="1000">${h(item.observation || '')}</textarea></label><button class="button primary full">Salvar observação</button></form>`); return;
  }
  action(async () => {
    if (name === 'connect-mercado-pago') {
      const result = await api('/api/v1/stores/me/mercado-pago/authorize', { method: 'POST', data: {} });
      const url = new URL(result.authorization_url);
      if (url.origin !== 'https://auth.mercadopago.com' || url.pathname !== '/authorization') throw new Error('Endereço de autorização inválido.');
      location.assign(url.href);
    } else if (name === 'refresh') await render();
    else if (name === 'search-filter') {
      const value = el.dataset.filter;
      if (state.searchFilters.has(value)) state.searchFilters.delete(value); else state.searchFilters.add(value);
      state.page = 1; await render();
    }
    else if (name === 'filter') { state.filter = el.dataset.filter; state.page = 1; await render(); }
    else if (name === 'page') { state.page = positiveId(el.dataset.page) || 1; await render(); }
    else if (name === 'reset-search') { state.page = 1; state.query = ''; state.filter = ''; await render(); }
    else if (name === 'reset-discovery') { state.page = 1; state.query = ''; state.searchFilters.clear(); await render(); }
    else if (name === 'change-store') { state.store = null; await render(); }
    else if (name === 'logout') {
      try { await request('/session/logout', { method: 'POST', data: {} }); } finally { state.user = null; state.cart = null; nav(); go('entrar'); }
    } else if (name === 'quantity') {
      const quantity = Number(el.dataset.quantity);
      await mutateCart(quantity ? 'PATCH' : 'DELETE', `/items/${id}`, quantity ? { quantity } : {});
    } else if (name === 'remove-item') await mutateCart('DELETE', `/items/${id}`);
    else if (name === 'confirm-clear-cart') await mutateCart('DELETE', '');
    else if (name === 'review-cart') {
      const result = await api(cartPath('/validate'), { method: 'POST', data: { expected_version: state.cart.version } });
      state.cart = result.cart;
      modalOpen(`<h2 id="modal-title">${result.changed ? 'Os valores foram atualizados' : 'Revise sua sacola'}</h2>${totals(result.cart)}${note('A próxima etapa reserva a sacola para revisão. Nenhum pedido será enviado e nenhum pagamento será cobrado.')}${button('Iniciar revisão', 'start-checkout', '', 'primary full')}`);
    } else if (name === 'start-checkout') {
      // Verify resumable metadata can be saved before changing backend state.
      sessionStorage.setItem('pede-storage-check', '1');
      sessionStorage.removeItem('pede-storage-check');
      state.cart = await api(cartPath('/checkout'), { method: 'POST', data: { expected_version: state.cart.version } });
      saveCheckout(state.cart); modal.close(); checkoutView();
    } else if (name === 'cancel-checkout') {
      const ref = checkoutRef();
      state.cart = await api(`/api/v1/carts/${ref.id_cart}/cancel-checkout`, { method: 'POST', data: { expected_version: ref.version } });
      sessionStorage.removeItem(checkoutKey()); await render();
    } else if (name === 'confirm-delete-product') {
      await api(`/api/v1/products/${id}`, { method: 'DELETE' }); modal.close(); await render(); toast('Produto excluído.');
    } else if (name === 'toggle-product') {
      const p = state.products.find(p => p.id_product === id);
      await api(`/api/v1/products/${id}`, { method: 'PATCH', data: { is_available: !p.is_available } }); await render();
    } else if (name === 'confirm-delete-account') {
      await api('/api/v1/users/me', { method: 'DELETE' }); state.user = null; state.cart = null; modal.close(); nav(); go('inicio'); toast('Conta excluída.');
    } else if (name === 'ticket-claim' || name === 'ticket-ready') {
      await api(`/api/v1/kitchen/tickets/${id}/${name === 'ticket-claim' ? 'claim' : 'ready'}`, { method: 'POST', data: {} }); await render();
    } else if (name === 'print-ticket') {
      const ticket = await api(`/api/v1/kitchen/tickets/${id}`);
      modalOpen(`<h2 id="modal-title">Ticket #${ticket.order_number}</h2>${ticketsHTML([ticket])}`);
      window.print();
    }
  });
});

document.addEventListener('submit', event => {
  const form = event.target.closest('[data-form]'); if (!form) return;
  event.preventDefault();
  const values = Object.fromEntries(new FormData(form));
  action(async () => {
    const name = form.dataset.form;
    if (name === 'store' || name === 'admin-store') {
      state.store = positiveId(values.store); state.cart = null;
      go(name === 'store' ? `loja/${state.store}` : 'produtos');
    } else if (name === 'search') { state.query = values.query.trim(); state.page = 1; await render(); }
    else if (name === 'request-code') {
      const phone = values.phone.replace(/\D/g, '');
      await api('/auth/user/generate-code', { method: 'POST', data: { phone_number: phone } }); verification(phone);
    } else if (name === 'verify' || name === 'employee') {
      let response;
      try {
        response = await api(name === 'verify' ? '/auth/user/verify-code' : '/auth/user/login', { method: 'POST', data: name === 'verify' ? { phone_number: form.dataset.phone, code: values.code } : values });
      } catch (error) {
        if (name === 'employee' && error.code === 'contact_verification_required') {
          pendingCredentials = { identifier: values.identifier, password: values.password };
          contactVerification(); return;
        }
        throw error;
      }
      pendingCredentials = null;
      state.user = response.user; state.cart = null; nav();
      go(name === 'employee' ? (operator() ? 'parceiro' : 'conta') : state.store ? `loja/${state.store}` : 'inicio');
    } else if (name === 'contact-send' || name === 'contact-confirm') {
      if (!pendingCredentials) { go('parceiro'); return; }
      const channel = form.dataset.channel;
      const phone_number = values.phone_number || form.dataset.phone || undefined;
      const data = { ...pendingCredentials, channel, ...(phone_number ? { phone_number } : {}), ...(name === 'contact-confirm' ? { code: values.code } : {}) };
      await api(`/auth/credentials/${name === 'contact-send' ? 'request-code' : 'verify-code'}`, { method: 'POST', data });
      if (name === 'contact-send') {
        const container = form.closest('[data-contact]');
        container.innerHTML = `<h3>${channel === 'email' ? 'E-mail' : 'WhatsApp'}</h3><p>Código enviado ao contato da sua conta. Válido por 5 minutos.</p><form data-form="contact-confirm" data-channel="${channel}" data-phone="${h(phone_number || '')}">${field('Código de 6 dígitos', 'code', 'text', '', 'required inputmode="numeric" pattern="[0-9]{6}" maxlength="6" autocomplete="one-time-code"')}<button class="button primary">Confirmar</button></form>`;
      } else {
        form.closest('[data-contact]').innerHTML = `<p role="status">${channel === 'email' ? 'E-mail' : 'Celular'} confirmado ✓</p>`;
      }
    } else if (name === 'contacts-finish') {
      if (!pendingCredentials) { go('parceiro'); return; }
      const response = await api('/auth/user/login', { method: 'POST', data: pendingCredentials });
      pendingCredentials = null; state.user = response.user; state.cart = null; nav(); go(operator() ? 'parceiro' : 'conta');
    } else if (name === 'username') {
      await api('/auth/credentials/username', { method: 'POST', data: values });
      form.reset(); toast('Nome de usuário atualizado.');
    } else if (name === 'register') {
      await api('/api/v1/users', { method: 'POST', data: { name: values.name.trim(), phone: values.phone.replace(/\D/g, ''), cpf: values.cpf.replace(/\D/g, '') || null } });
      go('entrar'); toast('Conta criada. Peça seu código para entrar.');
    } else if (name === 'profile') {
      const user = await api('/api/v1/users/me', { method: 'PATCH', data: { name: values.name.trim(), cpf: values.cpf.replace(/\D/g, '') || null } });
      state.user.name = user.name; nav(); toast('Dados atualizados.');
    } else if (name === 'add-item') {
      if (!shopper()) { modal.close(); go('entrar'); if (state.user) toast('Use uma conta de cliente para adicionar itens.'); return; }
      state.cart = await getCart(true);
      state.cart = await api(cartPath('/items'), { method: 'POST', data: { id_product: positiveId(form.dataset.id), expected_version: state.cart.version, quantity: Number(values.quantity), observation: values.observation.trim() || null, options: [] } });
      modal.close(); toast('Produto adicionado à sacola.');
    } else if (name === 'item-note') await mutateCart('PATCH', `/items/${positiveId(form.dataset.id)}`, { observation: values.observation.trim() || null });
    else if (name === 'category-save') {
      await api('/api/v1/products/categories', { method: 'POST', data: { name: values.name } });
      modal.close(); await render(); toast('Categoria criada. Você já pode cadastrar produtos.');
    }
    else if (name === 'product-save') {
      if (values.photo?.size > 5 * 1024 * 1024) throw new Error('A foto deve ter no máximo 5 MB.');
      const data = { ...values, base_price: values.base_price, id_category: Number(values.id_category), sort_order: Number(values.sort_order), preparation_time_minutes: values.preparation_time_minutes === '' ? null : Number(values.preparation_time_minutes), sku: values.sku.trim() || null, description: values.description.trim() || null };
      delete data.photo; delete data.remove_photo;
      if (values.remove_photo === 'on') data.image_url = '/uploads/products/default.svg';
      for (const key of ['is_active', 'is_available', 'is_featured', 'is_sweet', 'is_savory', 'is_solid', 'is_snack', 'is_beverage', 'is_stew', 'is_breakfast', 'is_lunch', 'is_dinner']) data[key] = values[key] === 'on';
      const id = positiveId(form.dataset.id);
      const saved = await api(`/api/v1/products${id ? `/${id}` : ''}`, { method: id ? 'PUT' : 'POST', data });
      form.dataset.id = saved.id_product;
      if (values.photo?.size && values.remove_photo !== 'on') {
        try {
          const uploaded = await api(`/api/v1/products/${saved.id_product}/image`, { method: 'POST', data: values.photo });
          form.elements.image_url.value = uploaded.image_url;
        } catch (error) { throw new Error(`Produto salvo, mas a foto não foi enviada: ${error.message}. Tente salvar novamente.`); }
      }
      modal.close(); await render(); toast('Produto salvo.');
    }
  }).catch(showError);
});

async function boot() {
  const [config, session] = await Promise.allSettled([request('/config'), request('/session')]);
  if (config.status === 'fulfilled') state.stores = config.value.stores;
  if (session.status === 'fulfilled') state.user = session.value.user;
  if (state.stores.length === 1) state.store = state.stores[0].id;
  await render();
  if (config.status === 'rejected') toast('Não foi possível carregar a lista de lojas. Tente recarregar a página.');
  if (session.status === 'rejected' && session.reason.status !== 401) toast('Não foi possível restaurar sua sessão. Tente novamente.');
}
boot();
