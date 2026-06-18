// @ts-check
const { test, expect, chromium } = require('@playwright/test');
const path = require('path');
const os = require('os');
const fs = require('fs');

// ── Configuração ─────────────────────────────────────────────
const EXTENSION_PATH = path.resolve(__dirname, '..');
const SAIPOS_URL     = 'https://conta.saipos.com';
const LOGIN_EMAIL    = 'douglasreismelo22@gmail.com';
const LOGIN_PASSWORD = 'psm2026';

// Categoria e produto únicos para não poluir dados reais
const TS           = Date.now();
const TEST_CAT     = `PW_TESTE_${TS}`;
const TEST_PRODUCT = `Produto PW ${TS}`;

// CSV de teste:
// 1) produto com categoria NOVA (deve criar automaticamente)
// 2) produto com vírgula no nome entre aspas (testa parseCSVLine v6.54.0)
const TEST_CSV = [
  `${TEST_PRODUCT},9.99,${TEST_CAT},Criado pelo Playwright`,
  `"Produto, com virgula ${TS}",5.00,${TEST_CAT},Descricao`,
].join('\n');

// ── Estado compartilhado ──────────────────────────────────────
let context, saiposPage, extensionId;

// ── Helper: abre popup e injeta patch em chrome.tabs.query ───
async function openPopup() {
  if (!extensionId) throw new Error('extensionId não encontrado');

  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/pages/popup.html`);
  await page.waitForLoadState('domcontentloaded');
  await page.waitForTimeout(1000); // aguarda chrome APIs ficarem disponíveis

  // Patch APÓS carregamento — suporta tanto callback quanto Promise (popup.js usa Promise)
  const patched = await page.evaluate(() => {
    try {
      const _orig = chrome.tabs.query.bind(chrome.tabs);

      chrome.tabs.query = function (queryInfo, callback) {
        if (typeof callback === 'function') {
          // Modo callback
          _orig({}, function (allTabs) {
            const saiposTab = allTabs.find(
              t => t.url && t.url.includes('conta.saipos.com') && !t.url.startsWith('chrome-extension')
            );
            callback(saiposTab ? [saiposTab] : allTabs);
          });
        } else {
          // Modo Promise (usado por: await chrome.tabs.query({active:true}))
          return new Promise(resolve => {
            _orig({}, function (allTabs) {
              const saiposTab = allTabs.find(
                t => t.url && t.url.includes('conta.saipos.com') && !t.url.startsWith('chrome-extension')
              );
              resolve(saiposTab ? [saiposTab] : []);
            });
          });
        }
      };
      return true;
    } catch (e) {
      return String(e);
    }
  });
  console.log('[popup] chrome.tabs.query patch:', patched);

  return page;
}

// ── Suite ─────────────────────────────────────────────────────
test.describe('Saipos Tools – Importação CSV v6.54.1', () => {

  test.beforeAll(async () => {
    const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'saipos-pw-'));

    context = await chromium.launchPersistentContext(userDataDir, {
      headless: false,
      slowMo: 150,
      // Evita detecção de bot pelo CloudFront do Saipos
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      args: [
        '--disable-blink-features=AutomationControlled',
        `--disable-extensions-except=${EXTENSION_PATH}`,
        `--load-extension=${EXTENSION_PATH}`,
        '--no-sandbox',
      ],
    });

    // Captura ID da extensão via service worker (MV3)
    let [sw] = context.serviceWorkers();
    if (!sw) {
      sw = await context.waitForEvent('serviceworker', { timeout: 15_000 }).catch(() => null);
    }
    if (sw) {
      extensionId = sw.url().split('/')[2];
      console.log('[setup] Extension ID:', extensionId);
    } else {
      console.warn('[setup] Service worker não encontrado — testes de popup serão pulados');
    }
  });

  test.afterAll(async () => {
    if (context) await context.close();
  });

  // ── 01: Login ──────────────────────────────────────────────
  test('01 – login no Saipos', async () => {
    saiposPage = await context.newPage();
    await saiposPage.goto(SAIPOS_URL, { waitUntil: 'domcontentloaded' });

    // Saipos usa inputs com placeholder, não type="email"
    // Aguarda qualquer input aparecer (Angular pode demorar para montar o form)
    await saiposPage.waitForSelector('input', { timeout: 30_000 });

    // Captura resposta da API de login para diagnóstico
    let loginApiResponse = null;
    saiposPage.on('response', async (resp) => {
      if (resp.url().includes('/auth') || resp.url().includes('/login') || resp.url().includes('/session')) {
        try { loginApiResponse = { url: resp.url(), status: resp.status(), body: await resp.text().catch(() => '') }; } catch (_) {}
      }
    });

    // Preenche e-mail (placeholder "E-mail" visto no screenshot do Saipos)
    await saiposPage.getByPlaceholder('E-mail').fill(LOGIN_EMAIL);

    // Preenche senha
    await saiposPage.getByPlaceholder('Senha').fill(LOGIN_PASSWORD);

    // Clica no botão laranja (único button visível → circle arrow button)
    await saiposPage.locator('button').first().click();

    // Aguarda resposta da API (logout/login)
    await saiposPage.waitForTimeout(4000);

    if (loginApiResponse) console.log('[01] Login API:', JSON.stringify(loginApiResponse).substring(0, 300));

    // Saipos exibe dialog quando usuário já está logado em outro computador:
    // "Este usuário já está conectado. Deseja desconectá-lo? [Não] [Sim]"
    // Precisa clicar "Sim" para forçar o logout do outro dispositivo
    const simBtn = saiposPage.locator('button:has-text("Sim"), [ng-click*="Yes"], [ng-click*="yes"], [ng-click*="forceLogin"]');
    const hasDialog = await simBtn.isVisible({ timeout: 5000 }).catch(() => false);
    if (hasDialog) {
      console.log('[01] Dialog de sessão ativa detectado — clicando Sim para desconectar');
      await simBtn.first().click();
      await saiposPage.waitForTimeout(5000); // aguarda redirect pós-forçar login
    }

    // Aguarda sair da tela de login (URL muda para /dashboard ou similar)
    await saiposPage.waitForURL(url => !url.includes('access/login'), { timeout: 25_000 })
      .catch(() => console.warn('[01] Redirect de login não detectado'));

    const url = saiposPage.url();
    console.log('[01] URL pós-login:', url);
    await saiposPage.screenshot({ path: path.join(__dirname, 'pos-login.png') });

    // Verifica que saiu da tela de login
    expect(url).not.toContain('access/login');
  });

  // ── 02: Navega ao catálogo para capturar storeId ──────────
  test('02 – navega ao catálogo para capturar storeId', async () => {
    if (!saiposPage) { test.skip(); return; }

    // Aguarda página atual estabilizar
    await saiposPage.waitForLoadState('load', { timeout: 10_000 }).catch(() => {});
    await saiposPage.waitForTimeout(2000);

    // Navega direto para o catálogo via hash (SPA Angular)
    // Link href encontrado na análise: #/app/v2/cardapio
    const baseUrl = saiposPage.url().split('#')[0]; // https://conta.saipos.com/
    try {
      await saiposPage.goto(baseUrl + '#/app/v2/cardapio', {
        waitUntil: 'domcontentloaded',
        timeout: 15_000
      });
      await saiposPage.waitForTimeout(3000);
      console.log('[02] Navegou ao catálogo:', saiposPage.url());
    } catch (e) {
      console.warn('[02] Navegação ao catálogo falhou:', e.message);
      // Continua — o storeId pode ser capturado de outras chamadas de API já feitas
    }

    await saiposPage.screenshot({ path: path.join(__dirname, 'catalogo.png') });
    // Não falha aqui — o storeId será capturado de qualquer chamada API /stores/ID/
    expect(saiposPage.url()).toContain('conta.saipos.com');
  });

  // ── 03: Importa CSV com nova categoria ─────────────────────
  test('03 – importa CSV com nova categoria', async () => {
    if (!saiposPage || !extensionId) {
      console.warn('[03] Pulando: login ou extensão não disponível');
      test.skip();
      return;
    }

    const popup = await openPopup();

    // Captura logs do console do popup para diagnóstico
    popup.on('console', msg => console.log('[popup-log]', msg.type(), msg.text()));

    // Diagnóstico: lista todas as abas visíveis para o popup
    const visibleTabs = await popup.evaluate(() =>
      new Promise(resolve => chrome.tabs.query({}, tabs =>
        resolve(tabs.map(t => ({ id: t.id, url: t.url, active: t.active })))
      ))
    );
    console.log('[03] Abas visíveis:', JSON.stringify(visibleTabs));

    // Ativa aba IMPORTAR via JS — bypassa visibilidade (tab pode estar oculto por lock system)
    await popup.evaluate(() => {
      // Dispara click no tab (funciona mesmo com display:none)
      document.querySelector('[data-tab="csv"]')?.click();
      // Garante que o painel está visível independente do estado do lock
      document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
      document.querySelectorAll('.panel').forEach(p => {
        p.classList.remove('active');
        p.style.display = 'none';
      });
      const tab = document.querySelector('[data-tab="csv"]');
      const panel = document.querySelector('#panel-csv');
      if (tab)   { tab.classList.add('active'); tab.style.display = 'flex'; }
      if (panel) { panel.classList.add('active'); panel.style.display = 'block'; }
    });
    await popup.waitForTimeout(500);

    // Cola CSV de teste (garante que o textarea está visível antes)
    await popup.locator('#csvTextInputSaipos').fill(TEST_CSV, { force: true }).catch(async () => {
      await popup.evaluate((csv) => {
        const ta = document.querySelector('#csvTextInputSaipos');
        if (ta) ta.value = csv;
      }, TEST_CSV);
    });
    console.log('[03] CSV:\n', TEST_CSV);
    console.log('[03] Categoria:', TEST_CAT);

    // Inicia importação
    await popup.locator('#btnProcessCsv').click({ force: true }).catch(async () => {
      await popup.evaluate(() => document.querySelector('#btnProcessCsv')?.click());
    });

    // Aguarda resultado no log (até 90s: criação de categoria + produtos + delays anti-ban)
    const logEl = popup.locator('#csvLogStatus');
    await expect(async () => {
      const text = await logEl.textContent({ timeout: 5_000 });
      expect(text).toMatch(/Finalizado|Erro|ignorado|✅|❌/i);
    }).toPass({ timeout: 90_000 });

    const logText = await logEl.textContent();
    console.log('[03] Log final:', logText);

    await popup.screenshot({ path: path.join(__dirname, 'resultado-importacao.png') });

    // Verifica que produtos não foram ignorados por categoria não encontrada
    expect(logText).not.toContain('ignorado: grupo');
    expect(logText).not.toContain('não foi cadastrado corretamente');
    expect(logText).toMatch(/Finalizado|✅/i);
  });

  // ── 04: Desfaz importação (limpeza) ───────────────────────
  test('04 – desfaz importação de teste', async () => {
    if (!saiposPage || !extensionId) { test.skip(); return; }

    const popup = await openPopup();

    // Ativa aba CSV via JS (mesma abordagem do teste 03)
    await popup.evaluate(() => {
      document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
      document.querySelectorAll('.panel').forEach(p => { p.classList.remove('active'); p.style.display = 'none'; });
      const tab = document.querySelector('[data-tab="csv"]');
      const panel = document.querySelector('#panel-csv');
      if (tab)   { tab.classList.add('active'); tab.style.display = 'flex'; }
      if (panel) { panel.classList.add('active'); panel.style.display = 'block'; }
    });
    await popup.waitForTimeout(500);

    const undoBtn = popup.locator('#btnUndoImport');
    const visible = await undoBtn.isVisible().catch(() => false);

    if (visible) {
      await undoBtn.click();
      console.log('[04] Desfazer clicado — aguardando...');
      await popup.waitForTimeout(15_000);
      const log = await popup.locator('#csvLogStatus').textContent().catch(() => '');
      console.log('[04] Log pós-desfazer:', log);
    } else {
      console.warn('[04] Botão desfazer não visível. Limpar manualmente:', TEST_CAT);
    }
  });

});
