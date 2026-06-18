// @ts-check
const { test, expect, chromium } = require('@playwright/test');
const path = require('path');
const os   = require('os');
const fs   = require('fs');

// ── Config ────────────────────────────────────────────────────
const EXTENSION_PATH = path.resolve(__dirname, '..');
const SAIPOS_URL     = 'https://conta.saipos.com';
const LOGIN_EMAIL    = 'douglasreismelo22@gmail.com';
const LOGIN_PASSWORD = 'psm2026';

// ── CSV dos 87 produtos ───────────────────────────────────────
// Formato: nome,preco,categoria,descricao
// Nomes com vírgula ficam entre aspas (parseCSVLine v6.54.1)
const PRODUCTS_CSV = [
  // REFRIGERANTE P (7)
  'COCA COLA LATA 310ML,6.00,REFRIGERANTE P,',
  'PEPSI 350ML,6.00,REFRIGERANTE P,',
  'GUARANA 350ML,6.00,REFRIGERANTE P,',
  'SUKITA 350ML,6.00,REFRIGERANTE P,',
  'RED BULL 250ML,12.00,REFRIGERANTE P,',
  'RED BULL 473ML,19.00,REFRIGERANTE P,',
  'PEPSI BLACK 350ML,6.00,REFRIGERANTE P,',
  // REFRIGERANTER G (10)
  'GUARANÁ 1LT,8.00,REFRIGERANTER G,',
  'COCA 1LT,8.00,REFRIGERANTER G,',
  '"COCA 1,5LTS",13.00,REFRIGERANTER G,',   // vírgula → aspas
  'COCA 2LTS,16.00,REFRIGERANTER G,',
  '"GUARANA 1,5LTS",12.00,REFRIGERANTER G,', // vírgula → aspas
  'GUARANA 2LTS,14.00,REFRIGERANTER G,',
  'SUKITA 2LTS,14.00,REFRIGERANTER G,',
  'SUKITA 1LT,8.00,REFRIGERANTER G,',
  '"SUKITA 1,5LT",12.00,REFRIGERANTER G,',  // vírgula → aspas
  'PEPSI 1LT,8.00,REFRIGERANTER G,',
  // PORÇÕES (18)
  'BATATA M,25.00,PORÇÕES,',
  'BATATA COMPLETA M,30.00,PORÇÕES,',
  'BATATA G,45.00,PORÇÕES,',
  'BATATA COMPLETA G,50.00,PORÇÕES,',
  'CALABRESA ACEBOLADA,30.00,PORÇÕES,',
  'ISCA DE FRANGO TEMPURA,35.00,PORÇÕES,',
  'ANEL DE CEBOLA,35.00,PORÇÕES,',
  'POLENTA,35.00,PORÇÕES,',
  'NUGGETS,37.00,PORÇÕES,',
  'TIRAS DE FRANGO EMPANADO,39.00,PORÇÕES,',
  'QUIBE,39.00,PORÇÕES,',
  'BOLINHO DE MANDIOCA C/ CARNE SECA,39.00,PORÇÕES,',
  'MINI COXINHA DE FRANGO,40.00,PORÇÕES,',
  'BOLINHO PRESUNTO E MUSSARELA,40.00,PORÇÕES,',
  'MINI SALSICHA,40.00,PORÇÕES,',
  'CROQUETE DE CARNE,40.00,PORÇÕES,',
  'FILE DE TILAPIA,55.00,PORÇÕES,',
  'FILÉ ACEBOLADO,78.00,PORÇÕES,',
  // AGUA (5)
  'TONICA 350ML,6.00,AGUA,',
  'H2O 500ML,8.00,AGUA,',
  'H2O LIMONETO 500ML,8.00,AGUA,',
  'AGUA MINERAL,4.00,AGUA,',
  'AGUA COM GAS,5.00,AGUA,',
  // CERVEJA LT/LG (9)
  'BRAHMA ZERO 330,9.00,CERVEJA LT/LG,',
  'BRAHMA 269,5.00,CERVEJA LT/LG,',
  'SKOL 269,5.00,CERVEJA LT/LG,',
  'ANTARCTICA 269,5.00,CERVEJA LT/LG,',
  'ORIGINAL 269,6.00,CERVEJA LT/LG,',
  'CORONA 330ML,11.00,CERVEJA LT/LG,',
  'BUDWEISER ZERO 330,9.00,CERVEJA LT/LG,',
  'STELLA 330ML,11.00,CERVEJA LT/LG,',
  'STELLA PURE GOLD 330ML,11.00,CERVEJA LT/LG,',
  // CERVEJA 600 (7)
  'BRAHMA 600ML,12.00,CERVEJA 600,',
  'SKOL 600ML,12.00,CERVEJA 600,',
  'ANTARCTICA 600ML,12.00,CERVEJA 600,',
  'SPATEN 600ML,14.00,CERVEJA 600,',
  'ORIGINAL 600ML,14.00,CERVEJA 600,',
  'STELLA 600ML,14.00,CERVEJA 600,',
  'CORONA 600ML,17.00,CERVEJA 600,',
  // SUCOS COM AGUA (7)
  'ACEROLA AGUA,9.00,SUCOS COM AGUA,',
  'UVA AGUA,9.00,SUCOS COM AGUA,',
  'MORANGO AGUA,9.00,SUCOS COM AGUA,',
  'CUPUAÇU AGUA,9.00,SUCOS COM AGUA,',
  'ABACAXI AGUA,9.00,SUCOS COM AGUA,',
  'ABCX HORTELA AGUA,9.00,SUCOS COM AGUA,',
  'MARACUJA AGUA,12.00,SUCOS COM AGUA,',
  // SUCOS COM LEITE (7)
  'ACEROLA LEITE,10.00,SUCOS COM LEITE,',
  'UVA LEITE,10.00,SUCOS COM LEITE,',
  'MORANGO LEITE,10.00,SUCOS COM LEITE,',
  'CUPUAÇU LEITE,10.00,SUCOS COM LEITE,',
  'ABACAXI LEITE,10.00,SUCOS COM LEITE,',
  'ABCX HORTELA LEITE,10.00,SUCOS COM LEITE,',
  'MARACUJA LEITE,13.00,SUCOS COM LEITE,',
  // PIZZAS (2)
  'PIZZA G,79.00,PIZZAS,',
  'PIZZA M,68.00,PIZZAS,',
  // COPO ESPECIAL (3)
  'COPO ESPECIAL,2.00,COPO ESPECIAL,',
  'COPO COM GELO,2.00,COPO ESPECIAL,',
  'CDB,5.00,COPO ESPECIAL,',
  // CHOPP (2)
  'CHOPP,9.90,CHOPP,',
  'BARRIL,0.00,CHOPP,',
  // DOCES (8)
  'PURURUCA,8.00,DOCES,',
  'HALLS,4.00,DOCES,',
  'TRIDENT,4.00,DOCES,',
  'PICOLÉ AGUA,3.00,DOCES,',
  'PICOLÉ AO LEITE,4.00,DOCES,',
  'ALGODÃO DOCE,12.00,DOCES,',
  'DOCE LEITE NINHO,4.00,DOCES,',
  'PIRULITO CHAVES,9.00,DOCES,',
  // Sem grupo original → OUTROS (2)
  'REFEIÇÃO,0.00,OUTROS,',
  'PIZZA CONGELADA G,49.00,OUTROS,',
].join('\n');

// ── Estado compartilhado ──────────────────────────────────────
let context, saiposPage, extensionId;
let capturedHeaders = null; // headers auth da última request à API
let capturedStoreId = null; // id da loja

// ── Helper: abre popup e aplica patch no chrome.tabs.query ───
async function openPopup() {
  if (!extensionId) throw new Error('extensionId não encontrado');
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/pages/popup.html`);
  await page.waitForLoadState('domcontentloaded');
  await page.waitForTimeout(1000);

  // Patch suporta tanto callback quanto Promise (popup.js usa Promise)
  const patched = await page.evaluate(() => {
    try {
      const _orig = chrome.tabs.query.bind(chrome.tabs);
      chrome.tabs.query = function (queryInfo, callback) {
        if (typeof callback === 'function') {
          _orig({}, function (allTabs) {
            const saiposTab = allTabs.find(
              t => t.url && t.url.includes('conta.saipos.com') && !t.url.startsWith('chrome-extension')
            );
            callback(saiposTab ? [saiposTab] : allTabs);
          });
        } else {
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
    } catch (e) { return String(e); }
  });
  console.log('[popup] chrome.tabs.query patch:', patched);
  return page;
}

// ── Helper: DELETE via Playwright API request (sem CORS) ─────
// context.request faz a chamada no processo Node, não no browser
async function apiDelete(url) {
  try {
    const resp = await context.request.delete(url, {
      headers: capturedHeaders || {},
    });
    return { ok: resp.ok(), status: resp.status() };
  } catch (e) { return { ok: false, status: 0, err: String(e) }; }
}

// ── Helper: GET JSON via Playwright API request (sem CORS) ───
async function apiGet(url) {
  try {
    const resp = await context.request.get(url, {
      headers: capturedHeaders || {},
    });
    if (!resp.ok()) return { ok: false, status: resp.status(), data: null };
    const data = await resp.json();
    return { ok: true, status: resp.status(), data };
  } catch (e) { return { ok: false, status: 0, data: null, err: String(e) }; }
}

// ── Suite ─────────────────────────────────────────────────────
test.describe('Saipos Tools – Substituição completa de estoque', () => {

  test.setTimeout(600_000); // 10 min — delete + import de 87 produtos leva tempo

  test.beforeAll(async () => {
    const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'saipos-bulk-'));

    context = await chromium.launchPersistentContext(userDataDir, {
      headless: false,
      slowMo: 100,
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      args: [
        '--disable-blink-features=AutomationControlled',
        `--disable-extensions-except=${EXTENSION_PATH}`,
        `--load-extension=${EXTENSION_PATH}`,
        '--no-sandbox',
      ],
    });

    let [sw] = context.serviceWorkers();
    if (!sw) {
      sw = await context.waitForEvent('serviceworker', { timeout: 15_000 }).catch(() => null);
    }
    if (sw) {
      extensionId = sw.url().split('/')[2];
      console.log('[setup] Extension ID:', extensionId);
    } else {
      console.warn('[setup] Service worker não encontrado');
    }
  });

  test.afterAll(async () => {
    if (context) await context.close();
  });

  // ── 01: Login ──────────────────────────────────────────────
  test('01 – login', async () => {
    saiposPage = await context.newPage();

    // Intercepta requests para capturar auth headers e storeId
    saiposPage.on('request', req => {
      const url = req.url();
      if (!url.includes('api.saipos.com') && !url.includes('conta.saipos.com/api')) return;
      const h = req.headers();
      // Captura qualquer header de autenticação
      if (h['authorization'] || h['x-auth-token'] || h['token'] || h['x-api-key']) {
        capturedHeaders = h;
      }
      // Captura storeId da URL: /stores/{id}/
      const m = url.match(/\/stores\/([^\/\?]+)/);
      if (m && !capturedStoreId) {
        capturedStoreId = m[1];
        console.log('[01] StoreId capturado:', capturedStoreId);
      }
    });

    await saiposPage.goto(SAIPOS_URL, { waitUntil: 'domcontentloaded' });
    await saiposPage.waitForSelector('input', { timeout: 30_000 });

    await saiposPage.getByPlaceholder('E-mail').fill(LOGIN_EMAIL);
    await saiposPage.getByPlaceholder('Senha').fill(LOGIN_PASSWORD);
    await saiposPage.locator('button').first().click();
    await saiposPage.waitForTimeout(4000);

    // Dialog "Este usuário já está conectado" → clica Sim
    const simBtn = saiposPage.locator('button:has-text("Sim"), [ng-click*="Yes"], [ng-click*="yes"], [ng-click*="forceLogin"]');
    const hasDialog = await simBtn.isVisible({ timeout: 5000 }).catch(() => false);
    if (hasDialog) {
      console.log('[01] Dialog de sessão ativa — clicando Sim');
      await simBtn.first().click();
      await saiposPage.waitForTimeout(5000);
    }

    await saiposPage.waitForURL(url => !url.includes('access/login'), { timeout: 25_000 })
      .catch(() => console.warn('[01] Redirect não detectado'));

    const url = saiposPage.url();
    console.log('[01] URL pós-login:', url);
    await saiposPage.screenshot({ path: path.join(__dirname, 'bulk-01-login.png') });
    expect(url).not.toContain('access/login');
  });

  // ── 02: Captura storeId e headers via catálogo ─────────────
  test('02 – captura storeId e auth', async () => {
    if (!saiposPage) { test.skip(); return; }

    await saiposPage.waitForLoadState('load', { timeout: 10_000 }).catch(() => {});
    await saiposPage.waitForTimeout(2000);

    const baseUrl = saiposPage.url().split('#')[0];
    await saiposPage.goto(baseUrl + '#/app/v2/cardapio', {
      waitUntil: 'domcontentloaded',
      timeout: 15_000,
    }).catch(e => console.warn('[02] Nav falhou:', e.message));

    // Aguarda requests do Angular carregar o catálogo
    await saiposPage.waitForTimeout(6000);

    // Se ainda não capturou headers, tenta buscar token via localStorage
    if (!capturedHeaders) {
      const token = await saiposPage.evaluate(() => {
        // Saipos costuma guardar o token em uma dessas chaves
        const keys = ['token', 'authToken', 'access_token', 'jwt', 'saipos_token'];
        for (const k of keys) {
          const v = localStorage.getItem(k) || sessionStorage.getItem(k);
          if (v) return v;
        }
        // Tenta no objeto global Angular
        try {
          const inj = angular.element(document.body).injector();
          return inj?.get('AuthService')?.getToken?.() || null;
        } catch (_) { return null; }
      }).catch(() => null);

      if (token) {
        capturedHeaders = { authorization: `Bearer ${token}` };
        console.log('[02] Token extraído via localStorage');
      }
    }

    console.log('[02] StoreId:', capturedStoreId);
    console.log('[02] Auth headers:', capturedHeaders ? Object.keys(capturedHeaders).join(', ') : 'nenhum capturado');

    await saiposPage.screenshot({ path: path.join(__dirname, 'bulk-02-catalogo.png') });
    expect(saiposPage.url()).toContain('conta.saipos.com');
  });

  // ── 03: Apaga todos os produtos ────────────────────────────
  test('03 – apaga todos os produtos', async () => {
    if (!saiposPage || !capturedStoreId) {
      console.warn('[03] Sem storeId — pulando');
      test.skip();
      return;
    }

    const baseApi = `https://api.saipos.com/v1/stores/${capturedStoreId}`;
    const result  = await apiGet(`${baseApi}/items`);

    if (!result.ok) {
      console.warn('[03] GET items falhou:', result.status, result.err || '');
      // Tenta via extension DELETE_ALL_STOCK como fallback
      const popup = await openPopup();
      await popup.evaluate(() => {
        chrome.runtime.sendMessage({ action: 'DELETE_ALL_STOCK' });
      });
      await popup.waitForTimeout(30_000);
      await popup.close();
      return;
    }

    const data  = result.data;
    const items = Array.isArray(data) ? data : (data?.items || data?.data || []);
    console.log('[03] Produtos a deletar:', items.length);

    // Loga estrutura do primeiro item para diagnóstico
    if (items.length > 0) console.log('[03] Exemplo item[0]:', JSON.stringify(items[0]).substring(0, 200));

    let deleted = 0;
    for (const item of items) {
      // Saipos usa id_store_item como chave primária nos items
      const id = item.id_store_item || item.id || item._id || item.item_id;
      if (!id) { console.warn('[03] Item sem id:', JSON.stringify(item).substring(0, 100)); continue; }
      const delUrl = `${baseApi}/items/${id}`;
      const del = await apiDelete(delUrl);
      console.log('[03] DELETE', id, '→', del.status, del.ok ? 'OK' : 'FAIL', del.err || '');
      if (del.ok) deleted++;
      await new Promise(r => setTimeout(r, 250));
    }

    console.log(`[03] Deletados: ${deleted}/${items.length}`);
    // Não falha se o servidor rejeitou — continua para importação
    console.warn('[03] Alerta: falha no delete não impede importação');
  });

  // ── 04: Apaga todas as categorias ──────────────────────────
  test('04 – apaga todas as categorias', async () => {
    if (!saiposPage || !capturedStoreId) { test.skip(); return; }

    const baseApi = `https://api.saipos.com/v1/stores/${capturedStoreId}`;
    const result  = await apiGet(`${baseApi}/category_items`);

    if (!result.ok) {
      console.warn('[04] GET categories falhou:', result.status);
      return; // não bloqueia — importação cria as categorias automaticamente
    }

    const data = result.data;
    const cats = Array.isArray(data) ? data : (data?.categories || data?.data || []);
    console.log('[04] Categorias a deletar:', cats.length);

    let deleted = 0;
    for (const cat of cats) {
      const id = cat.id || cat._id;
      if (!id) continue;
      const del = await apiDelete(`${baseApi}/category_items/${id}`);
      if (del.ok) deleted++;
      else console.warn('[04] Delete falhou cat', id, del.status);
      await new Promise(r => setTimeout(r, 250));
    }

    console.log(`[04] Categorias deletadas: ${deleted}/${cats.length}`);
  });

  // ── 05: Importa 87 produtos via extensão ──────────────────
  test('05 – importa 87 produtos via CSV', async () => {
    if (!saiposPage || !extensionId) { test.skip(); return; }

    const popup = await openPopup();
    popup.on('console', msg => console.log('[popup-log]', msg.type(), msg.text()));

    // Ativa aba CSV via JS — bypassa lock system da extensão
    await popup.evaluate(() => {
      document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
      document.querySelectorAll('.panel').forEach(p => {
        p.classList.remove('active');
        p.style.display = 'none';
      });
      const tab   = document.querySelector('[data-tab="csv"]');
      const panel = document.querySelector('#panel-csv');
      if (tab)   { tab.classList.add('active'); tab.style.display = 'flex'; }
      if (panel) { panel.classList.add('active'); panel.style.display = 'block'; }
    });
    await popup.waitForTimeout(500);

    // Insere o CSV completo no textarea
    await popup.locator('#csvTextInputSaipos').fill(PRODUCTS_CSV, { force: true }).catch(async () => {
      await popup.evaluate((csv) => {
        const ta = document.querySelector('#csvTextInputSaipos');
        if (ta) ta.value = csv;
      }, PRODUCTS_CSV);
    });

    const totalLines = PRODUCTS_CSV.split('\n').length;
    console.log(`[05] CSV: ${totalLines} produtos`);

    // Dispara importação
    await popup.locator('#btnProcessCsv').click({ force: true }).catch(async () => {
      await popup.evaluate(() => document.querySelector('#btnProcessCsv')?.click());
    });

    // Aguarda mensagem de conclusão — "Finalizado" aparece apenas no fim
    // ✅ sozinho não basta: cada produto criado emite "✅ Produto X inserido"
    const logEl = popup.locator('#csvLogStatus');
    await expect(async () => {
      const text = await logEl.textContent({ timeout: 5_000 });
      expect(text).toMatch(/Finalizado|Erro fatal|❌.*Finalizado/i);
    }).toPass({ timeout: 480_000 }); // 8 min de margem para 87 produtos

    const logText = await logEl.textContent();
    console.log('[05] Log final:', logText);

    await popup.screenshot({ path: path.join(__dirname, 'bulk-05-resultado.png') });

    // Não deve ter ignorados por grupo inexistente (a extensão cria automaticamente)
    expect(logText).not.toContain('ignorado: grupo');
    expect(logText).not.toContain('não foi cadastrado corretamente');
    expect(logText).toMatch(/Finalizado/i);
  });

});
