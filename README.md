# Pede Aí — client web

Frontend responsivo em português, integrado ao contrato existente de `mtlisboa/pede_ai_back`, branch `dev`, commit `445fe19b59de1ceb4f469420154a63d7131f5a0d`.

A organização visual parte de [leodymann/mvp_ifoode](https://github.com/leodymann/mvp_ifoode), commit `8f68580c3f8157efc2bdcfeade0e239da36e7804`: branco/vermelho, cards de cardápio, sacola e navegação inferior. A imagem ilustrativa `public/assets/food.jpg` vem de `cardapios/combo-bburguer-fritas.jpg` dessa referência. Ela não representa um produto ou promoção cadastrada na API. O restante da implementação foi escrito para consumir os endpoints reais; os dados simulados da referência não são usados.

## Executar com Docker

```bash
cp .env.example .env
# Edite API_UPSTREAM e STORES_JSON em .env.
docker compose up --build -d
```

Abra `http://localhost:8080`. A porta pode ser alterada por `FRONT_PORT`.

- Backend no host: `API_UPSTREAM=http://host.docker.internal:8000` (Compose adiciona o host gateway para Linux).
- Backend em outra rede Docker: conecte os dois serviços à mesma rede e use o nome/porta do serviço, por exemplo `http://api:8000`.
- Backend remoto: use sua origem HTTPS, sem `/api/v1`. A autenticação atual usa `/auth`.

O navegador acessa `/backend/...` no mesmo domínio do frontend. O servidor Node encaminha as chamadas à API, evitando dependência de CORS e evitando expor tokens ao JavaScript. As imagens são encaminhadas por `/media/products/...`. A aplicação não requer pacotes npm externos nem processo de compilação: o Docker copia os módulos ES diretamente.

A imagem roda como usuário `node`, aceita `PORT` e tem healthcheck em `/healthz`. O Compose configura filesystem somente leitura e remove capabilities. `/healthz` verifica o processo do frontend, não a saúde do backend.

## Executar sem Docker

Requer Node.js 24 ou superior.

```bash
cp .env.example .env
# Fora do Docker: API_UPSTREAM=http://127.0.0.1:8000
npm start
```

Para recarregamento do servidor durante desenvolvimento: `npm run dev`.

## Configuração

| Variável | Uso |
| --- | --- |
| `API_UPSTREAM` | Origem do backend, acessível pelo servidor Node. Padrão sem Compose: `http://127.0.0.1:8000`. |
| `PORT` | Porta interna do servidor. Padrão: `8080`. |
| `FRONT_PORT` | Porta publicada pelo Compose. Padrão: `8080`. |
| `HOST` | Interface de escuta do servidor. Padrão: `0.0.0.0`. |
| `COOKIE_SECURE` | `true` para cookies somente em HTTPS; `false` apenas em desenvolvimento HTTP. |
| `PUBLIC_ORIGIN` | Origem pública exata, sem barra final, como `https://pedidos.exemplo.com`. Configure em produção, especialmente atrás de proxy. |
| `STORES_JSON` | Lista de lojas exibidas no início, com IDs reais da API. Padrão: `[]`. |

Exemplo de configuração de lojas (troque pelos seus dados reais):

```dotenv
STORES_JSON=[{"id":1,"name":"Minha hamburgueria","description":"Hambúrgueres e porções"}]
```

Como a API ainda não lista lojas, essa lista é configurada pelo operador. Sem lojas configuradas, o cliente informa um código ou abre um link direto: `https://seu-front/#loja/1`. Não são inventados horários, avaliações, taxas ou disponibilidade das lojas.

## Telas e integração

| Tela | Comportamento |
| --- | --- |
| Início / busca de loja | Lojas configuradas e acesso por código. |
| Cardápio | Busca no servidor, paginação, destaques, disponibilidade, fotos, descrição e preço. |
| Cadastro | Nome, telefone e CPF opcional em `POST /api/v1/users`. |
| Login do cliente | Código WhatsApp em `/auth/user/generate-code` e `/auth/user/verify-code`. |
| Login do parceiro | E-mail/senha de funcionário em `/auth/user/login`. |
| Minha conta | Consulta, alteração e exclusão de `/api/v1/users/me`; logout. |
| Sacola | Cria/recupera carrinho por loja, adiciona/remove itens, altera quantidade/observação e limpa. |
| Revisão | Valida preços, inicia checkout e permite cancelar checkout para editar. |
| Produtos | Lista, busca, pagina, cria, edita com PUT, pausa com PATCH e exclui. |
| Cozinha | Tickets reais, detalhes, iniciar preparo, marcar pronto e imprimir; atualização a cada 15 s. |
| Pedidos | Explica a indisponibilidade atual do acompanhamento; não gera histórico fictício. |

### Regras do contrato observadas

- Preços, descontos, frete, totais, disponibilidade e permissão final são decididos pela API.
- Alterações do carrinho enviam `expected_version`. Em conflito `409` do carrinho ativo, o cliente recarrega o estado e solicita que o usuário confira antes de repetir; não repete automaticamente uma compra.
- `SHOPPER` usa sacola; `OWNER`/`EMPLOYEE` usam a área do estabelecimento. A API continua responsável por todas as autorizações e verifica o cargo de cozinha no banco.
- Identidade visual do usuário é lida dos claims apenas após a autenticação/renovação; não substitui a validação do backend.
- Access e refresh tokens ficam em cookies `HttpOnly`, `SameSite=Strict`; em HTTPS devem usar `Secure`. Renovação ocorre no servidor, com repetição única após `401` e deduplicação de renovações simultâneas.
- Escritas exigem a origem correta, JSON e o cabeçalho `X-Pede-Client`. O proxy só encaminha rotas e métodos conhecidos para a origem configurada, sem redirecionamentos externos.
- Textos retornados pela API são escapados. Não há tokens, senhas, CPF ou carrinhos completos em localStorage.
- A referência de checkout (`id_cart` e `version`) fica em sessionStorage, separada por usuário/loja, para cancelar a revisão após recarregar a mesma aba. Ela não é fonte de preços nem prova de pagamento.

## Limitações concretas do backend consultado

1. **Checkout ainda não cria pedido nem pagamento.** `POST /api/v1/carts/current/checkout` apenas muda a sacola para `CHECKOUT`. O frontend informa isso e não coleta cartão, gera Pix ou mostra confirmação de pedido. A tela de revisão permite voltar via `/{cart_id}/cancel-checkout`.
2. **Não existem rotas de pedidos/histórico, endereços, pagamento, CRUD de lojas/funcionários, campanhas ou financeiro** registradas em `src/main.py`. Não foram criadas requisições para endpoints inexistentes nem alterações no backend.
3. **Checkout não pode ser consultado por ID nem retomado em outra aba/dispositivo.** O backend expõe `current` apenas para `ACTIVE`. A mesma aba conserva a referência mínima; ao fechar a aba, a recuperação de um checkout exige suporte adicional no backend. Não inicie revisão se precisa continuar em outro dispositivo.
4. **Categorias e upload de imagens não têm endpoints.** Gestão de produtos usa o ID de uma categoria já existente e caminho de imagem já existente em `/uploads/products/`. Opções obrigatórias também não podem ser escolhidas sem um endpoint para listá-las; se o produto exigir opções, a API poderá recusar a inclusão e sua mensagem será exibida.
5. **Leitura pública de imagens e de rotas numéricas tem problemas de middleware.** No commit consultado, o middleware não libera `/uploads/products/`; as regex públicas numéricas usam `\\d` em raw string. O catálogo usa a coleção pública `/api/v1/products?store_id=...`. Imagens são encaminhadas com o token quando disponível e mostram `Sem foto` se a API negar acesso. Não há contorno de autorização.
6. **Não há modo mock automático.** Falhas de rede, autenticação, permissão, validação e lista vazia são exibidas como tais. Nenhum dado de demonstração é apresentado como produção.

## Deploy em Railway ou outro host Docker

O repositório inclui `railway.json` apontando para o Dockerfile e `/healthz`.

1. Conecte `mtlisboa/pede_ai_front` e selecione a branch `dev` no serviço de hospedagem.
2. Configure `API_UPSTREAM` com o endereço acessível do backend, `STORES_JSON` com suas lojas, `COOKIE_SECURE=true` e `PUBLIC_ORIGIN` com a origem HTTPS do frontend.
3. Faça o deploy pelo Dockerfile. Railway define `PORT` automaticamente.

O envio à branch `dev` disponibiliza o código para o deploy. Ele não cria um serviço de hospedagem nem configura a URL do backend automaticamente.

## Validação

```bash
npm run check
npm test
```

Os testes executam o servidor real do frontend contra um servidor HTTP de teste isolado. Cobrem arquivos estáticos, cookies, autenticação, renovação, proteção de origem, proxy de carrinho e versão, erros, tickets e imagens. Não substituem um teste ponta a ponta com banco/WhatsApp reais. Para desenvolvimento, crie usuário, loja, categoria e funcionário válidos no backend antes de testar os fluxos correspondentes.

O workflow `.github/workflows/ci.yml` executa checagem, testes, build Docker e smoke test de `/healthz` e `/` a cada push em `dev`/`main` e pull request.

Estrutura: `public/` contém a interface; `server.mjs` serve arquivos e faz proxy autenticado; `tests/` valida segurança e contrato HTTP. Nenhum segredo deve ser commitado; use `.env` ou variáveis do provedor.


## Autenticação por contatos

O comprador informa somente o celular e confirma o código do WhatsApp; a conta é
criada no primeiro acesso confirmado. O backend mantém uma sessão por comprador.
O acesso operacional aceita e-mail, celular ou username + senha e exibe o fluxo de
confirmação de e-mail e celular quando necessário. Tokens continuam em cookies
HttpOnly; a senha usada durante a confirmação fica somente na memória da página.
O login não redireciona para Mercado Pago. A conexão para pagamentos permanece na
página de integrações. Configure os provedores e migre o backend antes de usar o
novo fluxo (docs/login-contatos.md no backend).
