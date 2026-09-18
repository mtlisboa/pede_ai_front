const main = document.querySelector('#content');
const navigation = document.querySelector('#navigation');
const accountNav = document.querySelector('#account-nav');
let scheduled = false;

function routeName() {
  return (location.hash.slice(1).split('/')[0] || 'inicio').toLowerCase();
}

function scheduleDecorate() {
  if (scheduled) return;
  scheduled = true;
  requestAnimationFrame(() => {
    scheduled = false;
    decorate();
  });
}

function setRouteClass() {
  for (const className of [...document.body.classList]) {
    if (className.startsWith('route-')) document.body.classList.remove(className);
  }
  document.body.classList.add(`route-${routeName()}`);
}

function decorateNavigation() {
  if (!navigation) return;
  const partner = navigation.querySelector('a[href="#parceiro"]');
  if (partner) partner.dataset.merchantLink = 'true';

  if (!accountNav) return;
  const isLogged = Boolean(accountNav.querySelector('.account-link:not(.guest)'));
  if (!isLogged && !accountNav.querySelector('.merchant-top-link')) {
    accountNav.insertAdjacentHTML('afterbegin', '<a class="merchant-top-link" href="#parceiro">ÁREA DO LOJISTA</a>');
  }
}

function decorateMerchantLogin() {
  if (routeName() !== 'parceiro') return;
  const form = main?.querySelector('form[data-form="employee"]');
  const shell = form?.closest('.auth-shell');
  if (!form || !shell || shell.dataset.merchantDecorated) return;
  shell.dataset.merchantDecorated = 'true';

  const eyebrow = shell.querySelector('.auth-intro .eyebrow');
  const title = shell.querySelector('.auth-intro h1');
  const copy = shell.querySelector('.auth-intro p:not(.eyebrow)');
  const panelTitle = shell.querySelector('.auth-panel h2');
  if (eyebrow) eyebrow.textContent = 'ÁREA DO LOJISTA';
  if (title) title.innerHTML = 'Gerencie sua loja<br>em um só lugar.';
  if (copy) copy.textContent = 'Acesse produtos, pedidos, cozinha e integrações da sua operação.';
  if (panelTitle) panelTitle.textContent = 'Acessar estabelecimento';

  if (!form.previousElementSibling?.classList.contains('merchant-login-note')) {
    form.insertAdjacentHTML('beforebegin', '<div class="merchant-login-note"><b>ACESSO EXCLUSIVO</b><span>Use sua credencial de proprietário ou funcionário.</span></div>');
  }
  const submit = form.querySelector('button');
  if (submit) submit.textContent = 'ENTRAR';
}

function decorateMercadoPago() {
  if (routeName() !== 'integracoes') return;
  const panel = main?.querySelector('.panel.narrow');
  if (!panel || panel.querySelector('.mp-oauth-callout')) return;
  const button = panel.querySelector('[data-action="connect-mercado-pago"]');
  if (!button) return;
  button.insertAdjacentHTML('beforebegin', '<div class="mp-oauth-callout"><span class="mp-mark">MP</span><div><strong>Mercado Pago</strong><p>Conecte a conta do estabelecimento usando o fluxo oficial OAuth.</p></div></div>');
  if (/^Conectar/.test(button.textContent.trim())) button.textContent = 'CONECTAR MERCADO PAGO';
}

function decorateHeader() {
  const note = document.querySelector('.header-note');
  if (!note) return;
  const route = routeName();
  const merchantRoutes = ['parceiro','produtos','cozinha','integracoes'];
  note.textContent = merchantRoutes.includes(route) ? 'PAINEL DO ESTABELECIMENTO' : 'CARDÁPIO DIGITAL';
}

function decorate() {
  setRouteClass();
  decorateNavigation();
  decorateHeader();
  // Legacy landing and Mercado Pago login decorators are retained but disabled.
  decorateMercadoPago();
}

const observer = new MutationObserver(scheduleDecorate);
observer.observe(document.body, { childList: true, subtree: true });
window.addEventListener('hashchange', scheduleDecorate);
document.addEventListener('DOMContentLoaded', scheduleDecorate);
scheduleDecorate();
