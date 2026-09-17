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
  if (partner) {
    partner.dataset.merchantLink = 'true';
    const icon = partner.querySelector('span')?.outerHTML || '<span aria-hidden="true">▤</span>';
    if (!partner.dataset.merchantDecorated) {
      partner.innerHTML = `${icon}Área da loja`;
      partner.dataset.merchantDecorated = 'true';
    }
  }

  if (!accountNav) return;
  const isLogged = Boolean(accountNav.querySelector('.account-link'));
  if (!isLogged && !accountNav.querySelector('.merchant-top-link')) {
    accountNav.insertAdjacentHTML('afterbegin', '<a class="button ghost small merchant-top-link" href="#parceiro">Sou lojista</a>');
  }
}

function decorateLanding() {
  if (routeName() !== 'inicio') return;
  const homeGrid = main?.querySelector('.home-grid');
  if (!homeGrid || main.querySelector('[data-landing-shell]')) return;

  homeGrid.insertAdjacentHTML('beforebegin', `
    <section class="landing-shell" data-landing-shell>
      <div class="landing-hero">
        <div class="landing-copy">
          <span class="landing-kicker">Pedidos mais simples, operação mais clara</span>
          <h1>Do cardápio ao pedido, <em>tudo flui.</em></h1>
          <p>O Pede Aí conecta clientes e estabelecimentos em uma experiência direta: escolha, peça, acompanhe e gerencie a operação sem depender de várias ferramentas.</p>
          <div class="landing-actions">
            <a class="button primary" href="#buscar">Quero fazer um pedido →</a>
            <a class="button merchant-cta" href="#parceiro">Sou lojista</a>
          </div>
          <div class="landing-proof" aria-label="Recursos da plataforma">
            <span><strong>WhatsApp</strong>acesso rápido do cliente</span>
            <span><strong>Acesso com senha</strong>e-mail, celular ou usuário</span>
            <span><strong>Tempo real</strong>pedidos e cozinha</span>
          </div>
        </div>
        <div class="landing-preview" aria-hidden="true">
          <div class="preview-top"><span class="preview-logo">pede aí.</span><span class="preview-pill">operação online</span></div>
          <div class="preview-order"><div><strong>Pedido #1042</strong><br><span>2 itens · Retirada</span></div><b>R$ 42,90</b></div>
          <div class="preview-order"><div><strong>Pedido #1043</strong><br><span>3 itens · Entrega</span></div><b>R$ 67,50</b></div>
          <div class="preview-order"><div><strong>Pedido #1044</strong><br><span>1 item · No local</span></div><b>R$ 24,00</b></div>
        </div>
      </div>
      <div class="landing-section-title">
        <div><p class="eyebrow">COMECE AGORA</p><h2>Peça de um jeito simples ou leve sua loja para a plataforma.</h2></div>
      </div>
    </section>
  `);

  homeGrid.insertAdjacentHTML('afterend', `
    <section class="landing-features" aria-label="Vantagens do Pede Aí">
      <article class="landing-feature"><span class="landing-icon">01</span><h3>Pedido sem atrito</h3><p>Cardápio, sacola, pagamento e acompanhamento em uma única jornada.</p></article>
      <article class="landing-feature"><span class="landing-icon">02</span><h3>Operação organizada</h3><p>Produtos, pedidos e fila da cozinha reunidos no painel do estabelecimento.</p></article>
      <article class="landing-feature"><span class="landing-icon">03</span><h3>Integrações seguras</h3><p>Mercado Pago via OAuth e comunicação pelo WhatsApp sem expor credenciais no navegador.</p></article>
    </section>
  `);
}

function decorateMerchantLogin() {
  if (routeName() !== 'parceiro') return;
  const form = main?.querySelector('form[data-form="employee"]');
  const shell = form?.closest('.auth-shell');
  if (!form || !shell || shell.dataset.merchantDecorated) return;
  shell.dataset.merchantDecorated = 'true';

  const intro = shell.querySelector('.auth-intro');
  const eyebrow = intro?.querySelector('.eyebrow');
  const title = intro?.querySelector('h1');
  const copy = intro?.querySelector('p:not(.eyebrow)');
  const panelTitle = shell.querySelector('.auth-panel h2');
  if (eyebrow) eyebrow.textContent = 'ACESSO EXCLUSIVO DO LOJISTA';
  if (title) title.innerHTML = 'Sua loja no controle.<br>Do pedido ao caixa.';
  if (copy) copy.textContent = 'Entre na área operacional da sua loja. Para proprietários, a autorização da conta Mercado Pago por OAuth faz parte da ativação obrigatória.';
  if (panelTitle) panelTitle.textContent = 'Entrar na área do lojista';

  form.insertAdjacentHTML('beforebegin', `
    <div class="merchant-auth-badge"><span aria-hidden="true">◆</span><div><strong>Fluxo protegido para estabelecimentos</strong><br>O OAuth do Mercado Pago acontece somente após a identificação da conta da loja.</div></div>
    <div class="merchant-oauth-steps" aria-label="Etapas de acesso do lojista">
      <div class="merchant-oauth-step"><b>1</b><span>Entre com a credencial da sua conta OWNER ou EMPLOYEE.</span></div>
      <div class="merchant-oauth-step"><b>2</b><span>Se você for proprietário e a loja ainda não estiver vinculada, autorize o Mercado Pago via OAuth.</span></div>
    </div>
  `);

  const submit = form.querySelector('button');
  if (submit) submit.textContent = 'Continuar como lojista';
  const switchLink = shell.querySelector('.muted-link');
  if (switchLink) switchLink.textContent = 'Voltar para entrada de cliente';
}

function decorateMercadoPago() {
  if (routeName() !== 'integracoes') return;
  const panel = main?.querySelector('.panel.narrow');
  if (!panel || panel.querySelector('.mp-oauth-callout')) return;
  const button = panel.querySelector('[data-action="connect-mercado-pago"]');
  if (!button) return;

  button.insertAdjacentHTML('beforebegin', `
    <div class="mp-oauth-callout">
      <span class="mp-mark">MP</span>
      <div><strong>Autorização oficial do Mercado Pago</strong><p>Você será direcionado ao domínio do Mercado Pago. A senha da sua conta e os tokens OAuth não são enviados ao frontend do Pede Aí.</p></div>
    </div>
  `);
  if (/^Conectar/.test(button.textContent.trim())) button.textContent = 'Continuar com Mercado Pago';
}

function decorateHeader() {
  const note = document.querySelector('.header-note');
  if (!note) return;
  const route = routeName();
  note.textContent = ['parceiro','produtos','cozinha','integracoes','pedidos','pedido'].includes(route)
    ? 'Central de operação da sua loja.'
    : 'Peça fácil. Acompanhe tudo.';
}

function decorate() {
  setRouteClass();
  decorateNavigation();
  decorateHeader();
  decorateLanding();
  // Legacy Mercado Pago login decoration retained, disabled in the active flow.
  decorateMercadoPago();
}

const observer = new MutationObserver(scheduleDecorate);
observer.observe(document.body, { childList: true, subtree: true });
window.addEventListener('hashchange', scheduleDecorate);
document.addEventListener('DOMContentLoaded', scheduleDecorate);
scheduleDecorate();

