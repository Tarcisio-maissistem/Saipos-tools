// ================================================================
// SAIPOS TOOLS v6.37.0 — partial-payment.js (ISOLATED world, document_idle)
// Botão "Resumo" na tela de pagamento do SAIPOS
// Abre modal visual com itens, pagamentos realizados e saldo restante
// Opção de imprimir via .saiposprt (SAIPOS Printer)
// Fix: botão voltar redireciona para tela de edição em vez da tela principal
// v6.7.0: sobreposição do botão nativo de impressão do SAIPOS (capture phase)
// v6.8.0: sobreposição também na tela de edição da comanda (table-order/edit)
// ================================================================
(function () {
  'use strict';

  if (window.__saiposPartialPaymentActive) return;
  window.__saiposPartialPaymentActive = true;

  const STORE_CACHE_KEY = 'saipos_store_info_cache';
  const SPT_VERSION = 'v6.43.0'; // versão exibida no rodapé do cupom impresso

  // StoreId detectado pelo interceptor via XHR/fetch (fallback para clientes sem /stores/ na URL)
  let detectedStoreId = null;
  window.addEventListener('__saipos_store_id_detected', (e) => {
    if (e.detail && e.detail.storeId) detectedStoreId = e.detail.storeId;
  });

  // Detecta finalização de pagamento (POST para endpoints de pagamento)
  // Evita redirect "botão voltar" quando o usuário realmente fechou a conta
  let paymentWasCompleted = false;
  window.addEventListener('__saipos_api_call', (e) => {
    const entry = e && e.detail;
    if (!entry || entry.method !== 'POST') return;
    const u = entry.url || '';
    if (u.includes('/payments') || u.includes('/close') || u.includes('/checkout')) {
      paymentWasCompleted = true;
    }
  });

  // ================================================================
  // UTILITÁRIOS
  // ================================================================

  function uuid() {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
      const r = Math.random() * 16 | 0;
      return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
    });
  }

  function parseBRL(str) {
    if (!str) return 0;
    const clean = str.replace(/[R$\s]/g, '').replace(/\./g, '').replace(',', '.');
    return parseFloat(clean) || 0;
  }

  function formatBRL(val) {
    return val.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  // Formata valor com PONTO para uso dentro de <a> tags (ESC/POS)
  function formatDot(val) {
    return val.toFixed(2);
  }

  function formatDateShort(date) {
    const d = new Date(date);
    const meses = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
    const dia = String(d.getDate()).padStart(2, '0');
    const h = String(d.getHours()).padStart(2, '0');
    const m = String(d.getMinutes()).padStart(2, '0');
    return `${dia}/${meses[d.getMonth()]} - ${h}:${m}`;
  }

  function padR(str, len) {
    str = String(str);
    while (str.length < len) str += ' ';
    return str.substring(0, len);
  }

  function padL(str, len) {
    str = String(str);
    while (str.length < len) str = ' ' + str;
    return str.substring(str.length - len);
  }

  // ================================================================
  // DETECÇÃO DA TELA DE PAGAMENTO (close)
  // ================================================================

  let uiInjected = false;

  // URL: #/app/sale/table-order/close/{saleId}
  function isCloseScreen() {
    return window.location.hash.includes('table-order/close/');
  }

  // v6.19.0 — qualquer tela de comanda: close, edit, view, detail, etc.
  function isAnyOrderScreen() {
    return window.location.hash.includes('table-order/');
  }

  // v6.19.0 — extrai saleId de qualquer URL de comanda (close, edit, view, ...)
  function getSaleIdFromUrl() {
    const match = window.location.hash.match(/table-order\/[^\/]+\/(\d+)/);
    return match ? match[1] : null;
  }

  // ================================================================
  // LEITURA DO DOM — Mesa, itens, totais, pagamentos realizados
  // ================================================================

  function readMesaInfo() {
    const comanda = document.querySelector('[data-qa="command-order"]');
    const mesa = document.querySelector('[data-qa="table-desc"]');
    const garcomEl = document.querySelector('[data-qa="waiter"]');
    const ident = document.querySelector('input[data-qa="desc-sale"]');

    let garcom = '';
    if (garcomEl && garcomEl.parentElement) {
      const txt = garcomEl.parentElement.textContent || '';
      garcom = txt.replace(/Garçom:\s*/i, '').trim();
    }

    // v6.6.0 — fallback: busca mesa/comanda em textos visíveis do DOM
    let mesaText = mesa ? mesa.textContent.trim() : '';
    let comandaText = comanda ? comanda.textContent.trim() : '';

    if (!mesaText || !comandaText) {
      // Tenta buscar via ng-bind ou outros seletores presentes na tela de close
      const allSpans = document.querySelectorAll('span, div, td, strong, b');
      for (const el of allSpans) {
        const txt = (el.textContent || '').trim();
        // Padrão "Mesa: 01" ou "MESA 01"
        if (!mesaText) {
          const mesaMatch = txt.match(/^Mesa[:\s]+(.+)/i);
          if (mesaMatch && mesaMatch[1].trim().length < 30) mesaText = mesaMatch[1].trim();
        }
        // Padrão "Comanda: 001" ou "Comanda 001"
        if (!comandaText) {
          const cmdMatch = txt.match(/^Comanda[:\s]+(.+)/i);
          if (cmdMatch && cmdMatch[1].trim().length < 30) comandaText = cmdMatch[1].trim();
        }
        if (mesaText && comandaText) break;
      }
    }

    // v6.6.0 — fallback extra: busca por ng-bind que contenha mesa/comanda
    if (!mesaText) {
      const ngMesa = document.querySelector('[ng-bind*="table_desc"], [ng-bind*="desc_table"], [ng-bind*="table"]');
      if (ngMesa) mesaText = ngMesa.textContent.trim();
    }
    if (!comandaText) {
      const ngCmd = document.querySelector('[ng-bind*="command_order"], [ng-bind*="comanda"]');
      if (ngCmd) comandaText = ngCmd.textContent.trim();
    }

    return {
      comanda: comandaText,
      mesa: mesaText,
      garcom,
      identificacao: ident ? ident.value.trim() : ''
    };
  }

  // Lê itens da tela de fechamento usando seletores da close screen
  function readItemsFromCloseScreen() {
    const items = [];
    const nameEls = document.querySelectorAll('[data-qa="item-name"]');

    nameEls.forEach(nameEl => {
      const nome = nameEl.textContent.trim();
      // Sobe até o container pai que contém qtd e valor
      const row = nameEl.closest('[ng-repeat]') || nameEl.closest('tr') || nameEl.closest('li')
        || nameEl.parentElement?.parentElement;

      let qtd = 1;
      let valor = 0;

      if (row) {
        const qtyEl = row.querySelector('[data-qa="item-remaining-quantity"]');
        const valEl = row.querySelector('[data-qa="item-remaining-value"]');
        if (qtyEl) {
          const qtyText = qtyEl.textContent.trim();
          qtd = parseFloat(qtyText.replace('.', '').replace(',', '.')) || 1;
        }
        if (valEl) valor = parseBRL(valEl.textContent);
      }

      if (nome) items.push({ nome, qtd, valor });
    });

    return items;
  }

  // Lê pagamentos já realizados abrindo o modal nativo do SAIPOS
  // Clica em "Pagamentos realizados", lê os dados, e fecha o modal
  async function readPaymentsMadeFromDOM() {
    const payments = [];

    // Encontra o botão "Pagamentos realizados (N)"
    const paymentBtn = document.querySelector('[data-qa="payment-made"]');
    if (!paymentBtn) {
      return payments;
    }

    // Verifica se está desabilitado (0 pagamentos)
    if (paymentBtn.disabled) {
      return payments;
    }

    // Extrai contagem do texto do botão: "Pagamentos realizados (2)"
    const countMatch = paymentBtn.textContent.match(/\((\d+)\)/);
    const count = countMatch ? parseInt(countMatch[1]) : 0;
    if (count === 0) {
      return payments;
    }

    // Clica para abrir o modal de pagamentos parciais
    paymentBtn.click();

    // Aguarda o modal aparecer (max 3s)
    const modalContent = await waitForElement('.modal-content [ng-repeat="item in vm.payments"]', 3000);
    if (!modalContent) {
      return payments;
    }

    // Pequeno delay para garantir renderização completa
    await delay(300);

    // Lê todos os pagamentos do modal
    const paymentRows = document.querySelectorAll('[ng-repeat="item in vm.payments"]');
    paymentRows.forEach((row, idx) => {
      // Tipo de pagamento: "Crédito", "Débito", "Dinheiro", etc.
      const typeEl = row.querySelector('[data-qa="desc-payment-type"]');
      // Descrição: "Pagamento 1"
      const descEl = row.querySelector('[data-qa="desc-payment"]');
      // Valor: "R$ 50,00" dentro de <strong>
      const valueEl = row.querySelector('[data-qa="payment-value"] strong')
        || row.querySelector('[data-qa="payment-value"]');

      const tipo = typeEl ? typeEl.textContent.trim() : '';
      const desc = descEl ? descEl.textContent.trim() : ('Pagamento ' + (idx + 1));
      const valor = valueEl ? parseBRL(valueEl.textContent) : 0;

      // Monta o nome como "Tipo - Descrição" ou só "Tipo"
      let forma = tipo;
      if (desc && desc !== tipo) forma = tipo + ' - ' + desc;
      if (!tipo) forma = desc;

      if (valor > 0) payments.push({ forma, valor });
    });

    // Fecha o modal clicando em "Voltar"
    const closeBtn = document.querySelector('.modal-content [data-qa="come-back"]')
      || document.querySelector('.modal-footer [data-qa="come-back"]')
      || document.querySelector('.modal-footer .btn-danger');
    if (closeBtn) {
      closeBtn.click();
      await delay(300);
    }

    return payments;
  }

  // Aguarda elemento aparecer no DOM
  function waitForElement(selector, timeout = 3000) {
    return new Promise(resolve => {
      const el = document.querySelector(selector);
      if (el) return resolve(el);

      const timer = setTimeout(() => { obs.disconnect(); resolve(null); }, timeout);
      const obs = new MutationObserver(() => {
        const found = document.querySelector(selector);
        if (found) {
          clearTimeout(timer);
          obs.disconnect();
          resolve(found);
        }
      });
      obs.observe(document.body, { childList: true, subtree: true });
    });
  }

  function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  function readTotaisFromDOM() {
    const totalGeralEl  = document.querySelector('[data-qa="total-amount"]');
    const totalItensEl  = document.querySelector('[data-qa="total-amount-items"]');
    const taxaServicoEl = document.querySelector('[data-qa="service-value"]');
    const pctServicoEl  = document.querySelector('[data-qa="percentage-service-value"]');

    let totalItens = 0;
    if (totalItensEl) {
      const strong = totalItensEl.querySelector('strong');
      totalItens = parseBRL(strong ? strong.textContent : totalItensEl.textContent);
    }

    // Taxa de serviço — lê strong filho se existir (mesmo padrão de totalItens)
    let taxaServico = 0;
    if (taxaServicoEl) {
      const strong = taxaServicoEl.querySelector('strong');
      taxaServico = parseBRL(strong ? strong.textContent : taxaServicoEl.textContent);
    }

    // Percentual — garante que "10" e "10%" sejam tratados como "10%"
    let pctServico = '';
    if (pctServicoEl) {
      const txt = pctServicoEl.textContent.trim();
      if (txt) pctServico = txt.includes('%') ? txt : txt + '%';
    }

    let totalGeral = totalGeralEl ? parseBRL(totalGeralEl.textContent) : 0;

    // Fallback: soma item-remaining-value
    if (!totalGeral) {
      const remainingEls = document.querySelectorAll('[data-qa="item-remaining-value"]');
      remainingEls.forEach(el => { totalGeral += parseBRL(el.textContent); });
    }

    // Fallback: procura strong com padrão R$
    if (!totalGeral) {
      const allStrongs = document.querySelectorAll('strong, .total-value, [class*="total"]');
      allStrongs.forEach(el => {
        const txt = el.textContent.trim();
        if (/R\$\s*[\d.,]+/.test(txt) && !totalGeral) {
          const parsed = parseBRL(txt);
          if (parsed > 0) totalGeral = parsed;
        }
      });
    }

    return { totalGeral, totalItens, taxaServico, pctServico };
  }

  // ================================================================
  // DADOS DA LOJA (via API com cache)
  // ================================================================

  function getStoreIdFromUrl() {
    // Tenta extrair do path: /stores/88111/...
    const m = window.location.href.match(/\/stores\/(\d+)/);
    if (m) return m[1];
    // Fallback: ID detectado pelo interceptor via XHR/fetch (clientes sem /stores/ na URL)
    if (detectedStoreId) return detectedStoreId;
    // Fallback: extrai do nome da loja no DOM que pode conter [88111]
    const storeName = getStoreNameFromDOM();
    const idMatch = storeName.match(/\[(\d+)\]/);
    if (idMatch) return idMatch[1];
    return null;
  }

  function getStoreNameFromDOM() {
    const span = document.querySelector('span.tm-label[uib-tooltip]');
    if (span) {
      const tooltip = span.getAttribute('uib-tooltip');
      if (tooltip) return tooltip;
      return span.textContent.trim();
    }
    return 'Loja Saipos';
  }

  // Retorna nome da loja SEM o [id] no final
  function cleanStoreName(name) {
    return name.replace(/\s*\[\d+\]\s*$/, '').trim();
  }

  // v6.6.0 — fetch genérico via proxy do interceptor (MAIN world)
  function fetchJson(url) {
    const reqId = 'fj_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6);
    return new Promise((resolve) => {
      const timeout = setTimeout(() => resolve(null), 5000);
      const handler = (e) => {
        clearTimeout(timeout);
        window.removeEventListener('__saipos_fetch_resp_' + reqId, handler);
        try {
          const resp = JSON.parse(e.detail);
          resolve(resp?.data || null);
        } catch (err) { resolve(null); }
      };
      window.addEventListener('__saipos_fetch_resp_' + reqId, handler);
      window.dispatchEvent(new CustomEvent('__saipos_fetch_request', {
        detail: { id: reqId, url, method: 'GET' }
      }));
    });
  }

  async function fetchStoreInfo(storeId) {
    try {
      const cached = await chrome.storage.local.get(STORE_CACHE_KEY);
      if (cached[STORE_CACHE_KEY] && cached[STORE_CACHE_KEY].idStore === storeId) {
        const cacheAge = Date.now() - (cached[STORE_CACHE_KEY].cachedAt || 0);
        // Invalida cache se serviceCharge ainda não foi armazenado (versão anterior)
        if (cacheAge < 24 * 60 * 60 * 1000 && cached[STORE_CACHE_KEY].serviceCharge !== undefined) return cached[STORE_CACHE_KEY];
      }
    } catch (e) { /* sem cache */ }

    const storeName = getStoreNameFromDOM();
    const reqId = 'store_' + Date.now();
    const url = `https://api.saipos.com/v1/stores/${storeId}`;

    return new Promise((resolve) => {
      const fallback = { idStore: storeId, nome: storeName, cnpj: '', endereco: '', cidade: '', cachedAt: Date.now() };
      const timeout = setTimeout(() => resolve(fallback), 5000);

      const handler = (e) => {
        clearTimeout(timeout);
        window.removeEventListener('__saipos_fetch_resp_' + reqId, handler);
        try {
          const resp = JSON.parse(e.detail);
          if (resp.data) {
            const d = resp.data;
            // Extrai service_charge dos shifts ativos (fonte oficial da taxa de serviço)
            let serviceCharge = 0;
            if (Array.isArray(d.shifts)) {
              const activeShift = d.shifts.find(s => s.use_service_charge === 'Y' && s.service_charge > 0);
              if (activeShift) serviceCharge = activeShift.service_charge;
            }
            const info = {
              idStore: storeId,
              nome: d.desc_store || d.name || storeName,
              cnpj: d.cnpj || d.document || '',
              endereco: d.address || d.street || '',
              cidade: d.city || '',
              estado: d.state || '',
              bairro: d.neighborhood || '',
              serviceCharge, // percentual (ex: 10 = 10%)
              cachedAt: Date.now()
            };
            chrome.storage.local.set({ [STORE_CACHE_KEY]: info }).catch(() => {});
            resolve(info);
          } else {
            resolve(fallback);
          }
        } catch (err) {
          resolve(fallback);
        }
      };

      window.addEventListener('__saipos_fetch_resp_' + reqId, handler);
      window.dispatchEvent(new CustomEvent('__saipos_fetch_request', {
        detail: { id: reqId, url, method: 'GET' }
      }));
    });
  }

  function decodeJWT(token) {
    try {
      const clean = token.replace(/^Bearer\s+/i, '');
      const parts = clean.split('.');
      if (parts.length < 2) return null;
      return JSON.parse(atob(parts[1]));
    } catch (e) { return null; }
  }

  // Lê id_user do token JWT via evento __saipos_auth (sem inline script, sem CSP)
  function getIdUserFromToken() {
    return new Promise((resolve) => {
      const timeout = setTimeout(() => resolve(null), 1000); // reduzido: token já disponível ou não está

      const handler = (e) => {
        clearTimeout(timeout);
        window.removeEventListener('__saipos_auth', handler);
        try {
          const headers = e.detail && e.detail.headers;
          if (headers) {
            // Procura token em qualquer header de auth
            const token = headers['Authorization'] || headers['token'] || headers['x-access-token'] || '';
            if (token) {
              const payload = decodeJWT(token);
              if (payload) {
                resolve(payload.id_user || payload.user_id || payload.sub || payload.id || null);
                return;
              }
            }
          }
        } catch (err) { /* ignore */ }
        resolve(null);
      };

      window.addEventListener('__saipos_auth', handler);
      // Pede ao interceptor que re-envie o auth
      window.dispatchEvent(new CustomEvent('__saipos_get_auth'));
    });
  }

  // Busca itens originais da venda via Angular scope (interceptor MAIN world)
  async function fetchOriginalSaleItems() {
    return new Promise((resolve) => {
      const timeout = setTimeout(() => {
        resolve(null);
      }, 1500); // reduzido: Angular scope já está pronto ou não vai estar

      const handler = (e) => {
        clearTimeout(timeout);
        window.removeEventListener('__saipos_sale_items_response', handler);
        try {
          const result = JSON.parse(e.detail);
          if (result && result.sale_items && result.sale_items.length > 0) {
            resolve(result);
          } else {
            resolve(null);
          }
        } catch (err) {
          resolve(null);
        }
      };

      window.addEventListener('__saipos_sale_items_response', handler);
      window.dispatchEvent(new CustomEvent('__saipos_get_sale_items'));
    });
  }

  // Converte itens do scope para o formato usado no modal/impressão
  function parseScopeItems(saleData) {
    if (!saleData || !saleData.sale_items) return null;
    return saleData.sale_items.map(item => ({
      nome: item.nome,
      qtd: item.qtd,
      valorUnit: item.valor_unit,
      valor: item.valor_total || (item.qtd * item.valor_unit)
    })).filter(i => i.nome);
  }

  // Converte pagamentos do scope
  function parseScopePayments(saleData) {
    if (!saleData || !saleData.payments) return null;
    return saleData.payments.map(p => ({
      forma: p.forma + (p.desc ? ' - ' + p.desc : ''),
      valor: p.valor
    })).filter(p => p.valor > 0);
  }

  // v6.6.2 — busca itens via API REST (fallback quando scope falha)
  // sale_price na API é o preço unitário ORIGINAL (não fracionado pelo SAIPOS)
  async function fetchSaleItemsFromAPI(storeId, saleId) {
    try {
      const url = `https://api.saipos.com/v1/stores/${storeId}/sales/${saleId}`;
      const sale = await fetchJson(url);
      if (!sale) return null;

      const rawItems = sale.sale_items || sale.items || sale.saleItems || [];
      if (rawItems.length === 0) return null;

      return rawItems.map(it => ({
        nome: it.desc_item || it.desc_sale_item || it.name || '',
        qtd: it.quantity || it.qty || 1,
        valorUnit: it.sale_price || it.unit_price || it.price || 0,
        valor: it.total_price || it.total || 0
      })).filter(i => i.nome);
    } catch (e) {
      return null;
    }
  }

  // v6.25.0 — busca pagamentos via API REST (fallback quando scope e DOM falham)
  async function fetchSalePaymentsFromAPI(storeId, saleId) {
    try {
      const url = `https://api.saipos.com/v1/stores/${storeId}/sales/${saleId}`;
      const sale = await fetchJson(url);
      if (!sale) return null;
      const rawPays = sale.payments || sale.sale_payments || [];
      if (!rawPays.length) return null;
      const result = [];
      rawPays.forEach(p => {
        const subs = p.payments || [p]; // pagamento pode ter sub-array de modalidades
        subs.forEach(sp => {
          const tipo  = sp.desc_payment_type || sp.payment_type || '';
          const desc  = sp.desc_sale_payment || p.desc_sale_payment || '';
          const valor = sp.value || sp.amount || sp.total || 0;
          const forma = tipo + (desc && desc !== tipo ? ' - ' + desc : '');
          if (valor > 0) result.push({ forma, valor });
        });
      });
      return result.length > 0 ? result : null;
    } catch (e) { return null; }
  }

  // v6.21.0 — Restaura qtd/valor originais usando rateio quando há pagamento parcial
  // SAIPOS fraciona quantity e total_price no scope Angular após pagamento parcial,
  // mas sale_price (valorUnit) SEMPRE é o preço unitário original.
  // Fórmula: qtd_original = qtd_fracionada × (totalGeral + totalPago) / totalGeral
  function restoreOriginalValues(items, totalGeral, totalPago) {
    const semPagParcial = !totalPago || totalPago <= 0 || !totalGeral || totalGeral <= 0;
    const totalOriginal = semPagParcial ? (totalGeral || 0) : (totalGeral + totalPago);
    const ratio = semPagParcial ? 1 : (totalOriginal / totalGeral);

    // Se soma(qtd × valorUnit) > totalGeral × 1.1 → API já retornou valores originais, skip ratio
    const somaAtual = items.reduce((s, i) =>
      s + (i.valorUnit > 0 ? i.qtd * i.valorUnit : i.valor), 0);
    const jaOriginal = semPagParcial || (totalOriginal > 0 && somaAtual > totalGeral * 1.1);

    const fixed = items.map(i => {
      const qtdRaw = jaOriginal ? i.qtd : i.qtd * ratio;
      // Arredonda para inteiro com tolerância 0.15 (cobre erros de ponto flutuante)
      // Preserva decimal para produtos vendidos por peso (ex: 0.5kg)
      const qtd = Math.abs(qtdRaw - Math.round(qtdRaw)) < 0.15
        ? Math.round(qtdRaw)
        : Math.round(qtdRaw * 100) / 100;
      const valor = i.valorUnit > 0
        ? Math.round(qtd * i.valorUnit * 100) / 100
        : Math.round(i.valor * (jaOriginal ? 1 : ratio) * 100) / 100;
      return { ...i, qtd, valor };
    });

    const totalCalculado = fixed.reduce((s, i) => s + i.valor, 0);
    return { items: fixed, totalOriginal: jaOriginal ? totalCalculado : totalOriginal };
  }

  // ================================================================
  // HAPPY HOUR — regra de preço no Resumo da Conta
  // ================================================================

  // Carrega TODAS as promoções HH configuradas (ativas ou não) para marcar itens pelo preço.
  // No Resumo da Conta, o que importa é se o item FOI lançado ao preço promo, não se o HH está ativo agora.
  async function loadHHPromos() {
    try {
      const res = await chrome.storage.local.get('saipos_happyhour');
      return res.saipos_happyhour || [];
    } catch (e) { return []; }
  }

  // v6.21.0 — Detecta itens HH com duas estratégias:
  // 1. Promo configurada: valorUnit bate com pricePromo da promo (tolerância 0.02)
  // 2. Fallback: mesmo produto na mesma comanda tem preços diferentes → menor = HH
  function applyHHRule(items, hhPromos) {
    // Índice do maior preço por produto — usado no fallback de desvio de preço
    const maxPriceByNome = {};
    items.forEach(i => {
      if (i.valorUnit > 0) {
        const k = i.nome.trim().toLowerCase();
        if (!maxPriceByNome[k] || i.valorUnit > maxPriceByNome[k]) maxPriceByNome[k] = i.valorUnit;
      }
    });

    return items.map(item => {
      // Estratégia 1 — correspondência com promo configurada no storage
      if (hhPromos && hhPromos.length > 0) {
        const promo = hhPromos.find(p =>
          item.nome.toUpperCase().trim().includes(p.prod.toUpperCase().trim())
        );
        if (promo && item.valorUnit > 0 && Math.abs(item.valorUnit - promo.pricePromo) < 0.02) {
          const valor = Math.round(item.qtd * promo.pricePromo * 100) / 100;
          return { ...item, valorUnit: promo.pricePromo, valor, hhTag: true };
        }
      }

      // Estratégia 2 — fallback: item tem preço menor que outro do mesmo produto na comanda
      const k = item.nome.trim().toLowerCase();
      const maxVal = maxPriceByNome[k] || 0;
      if (item.valorUnit > 0 && maxVal > 0 && item.valorUnit < maxVal - 0.01) {
        return { ...item, hhTag: true };
      }

      return item;
    });
  }

  // ================================================================
  // GERAÇÃO DO ARQUIVO .saiposprt
  // ================================================================

  // Agrupa itens pelo nome — nunca agrupa itens com valorUnit diferente
  function groupItemsByName(items) {
    const map = new Map();
    for (const item of items) {
      // Chave: nome + valorUnit — garante que preços diferentes nunca são mesclados
      const unitKey = item.valorUnit > 0 ? item.valorUnit.toFixed(2) : 'x';
      const key = item.nome.trim().toLowerCase() + '|' + unitKey;
      if (map.has(key)) {
        const g = map.get(key);
        g.qtd   = Math.round((g.qtd   + item.qtd)   * 1000) / 1000;
        g.valor = Math.round((g.valor + item.valor)  * 100)  / 100;
      } else {
        map.set(key, { ...item }); // preserva valorUnit, hhTag e outros campos
      }
    }
    return Array.from(map.values());
  }

  function buildPrintRows(data, storeInfo, cols) {
    // v6.21.0 — layout idêntico ao SAIPOS nativo: prefixo </ae>, <a> nos itens
    // Qt(6) + Nome(?) + Unit(7) + Valor(8) = COLS total (configurável)
    const COLS   = cols || 44; // largura configurável — padrão 44 (SAIPOS nativo)
    const AE     = '</ae>';  // prefixo left-align (padrão SAIPOS nativo)
    const QTY_W  = 6;        // mesmo que SAIPOS nativo
    const UNIT_W = 7;        // coluna valor unitário (nosso acréscimo)
    const VAL_W  = 8;        // coluna valor total
    const NAME_W = COLS - QTY_W - UNIT_W - VAL_W; // 23 chars para nome
    const rows = [];

    rows.push('<barra_mostrar>0</barra_mostrar>');
    rows.push('<barra_largura>3</barra_largura>');
    rows.push('<barra_altura>120</barra_altura>');

    // Cabeçalho da loja — </ae> alinhado esquerda (igual SAIPOS nativo)
    if (storeInfo.nome) rows.push(AE + cleanStoreName(storeInfo.nome));
    if (storeInfo.cnpj) rows.push(AE + 'CNPJ: ' + storeInfo.cnpj);
    if (storeInfo.endereco) rows.push(AE + storeInfo.endereco);
    if (storeInfo.cidade) {
      let c = storeInfo.cidade;
      if (storeInfo.bairro) c += ' - ' + storeInfo.bairro;
      rows.push(AE + c);
    }
    rows.push(AE + '</linha_simples>'); // separador com </ae> (igual SAIPOS nativo)

    // Título e data
    rows.push('</ce><n><e>RESUMO DA CONTA</e></n>');
    rows.push('</ad>' + formatDateShort(new Date()));

    // Info da comanda — bold nos campos principais para melhor visualização
    if (data.identificacao) rows.push(AE + '<n>Identifica\u00E7\u00E3o: ' + data.identificacao + '</n>');
    rows.push(AE + '<n>Mesa: ' + data.mesa + ' - Comanda: ' + data.comanda + '</n>');
    if (data.garcom) rows.push(AE + 'Gar\u00E7om: ' + data.garcom);

    rows.push('</linha_simples>');
    // Cabeçalho: Qt. alinhado à direita + 2 espaços separadores
    rows.push(AE + padL('Qt.', QTY_W - 2) + '  ' + padR('Descri\u00E7\u00E3o', NAME_W) + padL('Unit', UNIT_W) + padL('Valor', VAL_W));
    rows.push('</linha_simples>');

    // Itens — </ae><a>...</a> igual SAIPOS nativo + linha vazia </ae> após cada item
    let hasHHItems = false;
    if (data.items && data.items.length > 0) {
      const grouped = groupItemsByName(data.items);
      grouped.forEach(item => {
        const qtdStr  = item.qtd % 1 === 0 ? String(Math.round(item.qtd)) : item.qtd.toFixed(3);
        const valorStr = formatDot(item.valor);
        const unitStr  = item.valorUnit > 0 ? formatDot(item.valorUnit).replace('.', ',') : '';
        // Qty: right-align em (QTY_W-2) chars + 2 espaços separadores antes do nome
        const qtdPad  = padL(qtdStr, QTY_W - 2) + '  ';
        const nomeRaw = item.hhTag
          ? item.nome.substring(0, NAME_W - 2) + ' *'  // reserva 2 chars para ' *'
          : item.nome.substring(0, NAME_W);
        const nomePad = padR(nomeRaw, NAME_W);
        const unitPad = padL(unitStr, UNIT_W);
        const valPad  = padL(valorStr, VAL_W);
        if (item.hhTag) hasHHItems = true;
        rows.push(AE + '<a>' + qtdPad + nomePad + unitPad + valPad + '</a>');
        rows.push(AE); // linha vazia após cada item (igual SAIPOS nativo)
      });
      if (hasHHItems) rows.push(AE + '* Pre\u00E7o Happy Hour aplicado');
    }

    rows.push('</linha_simples>');

    // Totais — sem prefixo, alinhados em 44 cols (igual SAIPOS nativo)
    if (data.totalItens > 0) {
      const s = formatBRL(data.totalItens);
      rows.push(padR('Total itens(=)', COLS - s.length) + s);
    }
    if (data.taxaServico > 0) {
      const s = formatBRL(data.taxaServico);
      rows.push(padR('Taxa de servi\u00E7o(+)', COLS - s.length) + s);
    }
    const totalGeralStr = formatBRL(data.totalGeral);
    rows.push(padR('TOTAL(=)', COLS - totalGeralStr.length) + totalGeralStr);
    rows.push('</linha_simples>');

    // Pagamentos realizados — </ae> em todas as linhas para garantir impressão correta
    if (data.payments && data.payments.length > 0) {
      rows.push('</ce><n>PAGAMENTOS REALIZADOS</n>'); // sem <e> — evita conflito com printer
      rows.push('</linha_simples>');
      let totalPago = 0;
      data.payments.forEach(p => {
        const s = formatBRL(p.valor);
        rows.push(AE + padR(p.forma, COLS - s.length) + s);
        totalPago += p.valor;
      });
      rows.push('</linha_simples>');
      const tpStr = formatBRL(totalPago);
      rows.push(AE + padR('Total pago(=)', COLS - tpStr.length) + tpStr);
      rows.push('</linha_simples>');
      const saldo = data.totalGeral - totalPago;
      if (saldo > 0.01) {
        const sStr = formatBRL(saldo);
        // Label em bold + valor em bold+enlarged na linha seguinte (destaque máximo)
        rows.push('</ce><n>FALTA PAGAR(=)</n>');
        rows.push('</ce><n><e>' + sStr + '</e></n>');
      } else {
        rows.push('</ce><n>CONTA PAGA INTEGRALMENTE</n>');
      }
    } else {
      const sStr = formatBRL(data.totalGeral);
      // Label em bold + valor em bold+enlarged na linha seguinte (destaque máximo)
      rows.push('</ce><n>FALTA PAGAR(=)</n>');
      rows.push('</ce><n><e>' + sStr + '</e></n>');
    }

    rows.push('</linha_simples>');
    rows.push('</ae><c><n>www.saipos.com</n></c>');
    rows.push('</ae><c>Saipos Tools ' + SPT_VERSION + '</c>'); // versão da extensão
    rows.push(' ');
    rows.push(' ');
    rows.push(' ');
    rows.push('</corte_parcial>');

    return rows;
  }

  function buildSaiposprtJSON(data, storeInfo, cols) {
    // Use o saleId como fileName (igual ao SAIPOS nativo)
    const saleId = data.saleId || String(Date.now());
    const fileName = saleId + '.saiposprt';
    const idUser = data._idUser || 0;
    const COLS = cols || 44; // repassa para printSettings.rowColumns
    const printRows = buildPrintRows(data, storeInfo, COLS);

    const doc = [{
      printSettings: {
        type: 0, printDelivery: 1, printTable: 1, printServiceTicket: 1,
        layout: 2, rowColumns: COLS, copies: 1, emptyLines: 3, emptyChar: ' ',
        fontSize: 11, cashierPrintZeroedValueItems: 1, printTableCancelItem: 0, // fontSize 11 (igual SAIPOS nativo)
        groupItemsQuantity: 0, printEscposModel: 2, showPaymentDetailPrintingAndApp: 0,
        escpos: true, idStore: parseInt(storeInfo.idStore) || 0, printPath: '',
        guid: uuid(), id_user: idUser, fileName
      },
      printRows,
      sale_number: 'da mesa ' + data.mesa + ' e da comanda ' + data.comanda,
      logData: {
        id_store: parseInt(storeInfo.idStore) || 0,
        id_sale: parseInt(data.saleId) || 0,
        print_sent_user: idUser,
        print_sent_method: 1,
        print_auto: 'N'
      }
    }];

    return { json: doc, fileName };
  }

  async function downloadSaiposprt(data, storeInfo) {
    // Lê largura configurada no painel — padrão 44 (SAIPOS nativo)
    let printerCols = 44;
    try {
      const c = await chrome.storage.local.get('saipos_printer_cols');
      if (c.saipos_printer_cols) printerCols = parseInt(c.saipos_printer_cols) || 44;
    } catch (e) {}
    const { json, fileName } = buildSaiposprtJSON(data, storeInfo, printerCols);
    const jsonStr = JSON.stringify(json);
    // btoa() codifica como Latin-1 (1 byte por char) — compatível com SAIPOS Printer
    const base64 = btoa(jsonStr);

    // Download via background.js usando chrome.downloads API
    return new Promise((resolve) => {
      chrome.runtime.sendMessage({
        type: 'DOWNLOAD_SAIPOSPRT',
        data: base64,
        fileName
      }, (response) => {
        resolve();
      });
    });
  }

  // ================================================================
  // UI — MODAL DE RESUMO
  // ================================================================

  function injectStyles() {
    if (document.getElementById('spt-styles')) return;
    const style = document.createElement('style');
    style.id = 'spt-styles';
    style.textContent = `
      #spt-resumo-btn {
        padding: 10px 16px !important;
        box-shadow: none;
        font-weight: bold;
        white-space: nowrap;
        flex-shrink: 0;
      }
      /* Modal overlay */
      #spt-modal-overlay {
        position: fixed; top: 0; left: 0; right: 0; bottom: 0;
        background: rgba(0,0,0,0.6);
        z-index: 99999;
        display: flex; align-items: center; justify-content: center;
        animation: sptFadeIn 0.2s ease;
      }
      @keyframes sptFadeIn { from { opacity: 0; } to { opacity: 1; } }
      /* Modal card — 600px para colunas de valor não quebrarem */
      #spt-modal-card {
        background: #fff; border-radius: 8px;
        width: 600px; max-width: calc(100vw - 32px); max-height: 88vh;
        box-shadow: 0 8px 32px rgba(0,0,0,0.3);
        display: flex; flex-direction: column;
        overflow: hidden;
      }
      /* Header */
      #spt-modal-header {
        background: #2196F3; color: #fff;
        padding: 16px 20px;
        display: flex; justify-content: space-between; align-items: center;
      }
      #spt-modal-header h3 { margin: 0; font-size: 16px; font-weight: 600; }
      #spt-modal-close {
        background: none; border: none; color: #fff;
        font-size: 22px; cursor: pointer; padding: 0 4px;
        line-height: 1;
      }
      #spt-modal-close:hover { opacity: 0.7; }
      /* Body — 14px é o padrão Bootstrap/SAIPOS */
      #spt-modal-body {
        padding: 16px 20px;
        overflow-y: auto; flex: 1;
        color: #333; font-size: 14px;
      }
      /* Info da mesa */
      .spt-info-row {
        display: flex; justify-content: space-between;
        padding: 4px 0; color: #666; font-size: 14px;
      }
      .spt-info-row strong { color: #333; }
      /* Separador */
      .spt-sep {
        border: none; border-top: 1px dashed #ccc;
        margin: 12px 0;
      }
      .spt-sep-bold {
        border: none; border-top: 2px solid #333;
        margin: 12px 0;
      }
      /* Tabela de itens — table-layout:fixed garante que as larguras definidas sejam respeitadas */
      .spt-items-table {
        width: 100%; border-collapse: collapse; font-size: 13px;
        table-layout: fixed;
      }
      .spt-items-table th {
        text-align: left; font-weight: 600;
        padding: 6px 4px; border-bottom: 2px solid #ddd;
        color: #666; text-transform: uppercase; font-size: 11px;
        overflow: hidden;
      }
      /* Col 1: Qtd — estreita e centralizada */
      .spt-items-table th:nth-child(1),
      .spt-items-table td:nth-child(1) {
        width: 36px; text-align: center;
      }
      /* Col 2: Item — ocupa o restante */
      .spt-items-table th:nth-child(2),
      .spt-items-table td:nth-child(2) {
        text-align: left; word-break: break-word;
      }
      /* Col 3: Vr.Unit — largura fixa, sem quebra */
      .spt-items-table th:nth-child(3),
      .spt-items-table td:nth-child(3) {
        width: 110px; text-align: right; white-space: nowrap;
      }
      /* Col 4: Valor — largura fixa, sem quebra */
      .spt-items-table th:nth-child(4),
      .spt-items-table td:nth-child(4) {
        width: 110px; text-align: right; white-space: nowrap;
      }
      .spt-items-table td {
        padding: 8px 4px; border-bottom: 1px solid #f0f0f0;
        font-size: 13px; overflow: hidden;
      }
      /* Totais */
      .spt-total-row {
        display: flex; justify-content: space-between;
        padding: 6px 0; font-size: 14px;
      }
      .spt-total-row.spt-grand {
        font-weight: 700; color: #333;
        font-size: 16px; padding: 8px 0;
      }
      /* Pagamentos */
      .spt-section-title {
        font-size: 14px; font-weight: 700;
        color: #2196F3; margin: 0 0 8px 0;
        text-transform: uppercase;
      }
      .spt-payment-row {
        display: flex; justify-content: space-between;
        padding: 5px 0; font-size: 14px;
      }
      /* Saldo restante */
      .spt-saldo-box {
        background: #FFF3E0; border: 1px solid #FF9800;
        border-radius: 6px; padding: 12px 16px;
        display: flex; justify-content: space-between;
        align-items: center; margin-top: 10px;
      }
      .spt-saldo-box.spt-pago {
        background: #E8F5E9; border-color: #4CAF50;
      }
      .spt-saldo-label {
        font-weight: 700; font-size: 16px; color: #E65100;
      }
      .spt-saldo-box.spt-pago .spt-saldo-label { color: #2E7D32; }
      .spt-saldo-valor {
        font-weight: 700; font-size: 22px; color: #E65100;
      }
      .spt-saldo-box.spt-pago .spt-saldo-valor { color: #2E7D32; }
      /* Footer */
      #spt-modal-footer {
        padding: 12px 20px;
        border-top: 1px solid #eee;
        display: flex; gap: 10px; justify-content: flex-end;
      }
      #spt-modal-footer button {
        padding: 9px 22px; border-radius: 4px;
        font-size: 14px; font-weight: 600;
        cursor: pointer; border: none;
      }
      .spt-btn-close {
        background: #eee; color: #555;
      }
      .spt-btn-close:hover { background: #ddd; }
      .spt-btn-print {
        background: #2196F3; color: #fff;
      }
      .spt-btn-print:hover { background: #1976D2; }
      .spt-btn-print:disabled {
        background: #90CAF9; cursor: not-allowed;
      }
      /* Legenda Happy Hour abaixo da tabela */
      .spt-hh-legend {
        font-size: 12px; color: #FF6B00; font-weight: 700;
        margin-top: 4px; padding-left: 4px;
      }
      /* Sem itens */
      .spt-empty { color: #999; font-style: italic; text-align: center; padding: 16px 0; font-size: 14px; }
    `;
    document.head.appendChild(style);
  }

  // Encontra ponto de inserção na tela de pagamento
  function findAnchorElement() {
    const selectors = [
      '[data-qa="options-print"]',
      '[data-qa="option-print"]',
      'button[ng-click*="print"]',
      'button[ng-click*="Print"]',
      '#button-add-payment',
      '[data-qa="button-add-payment"]',
      'button.btn-success[ng-click*="add"]',
    ];
    for (const sel of selectors) {
      const el = document.querySelector(sel);
      if (el) {
        return el;
      }
    }
    return null;
  }

  // v6.12.0 — Injeta botão "Resumo" ao lado do input "Adicionar comanda ao pagamento"
  // Estratégia: cria um wrapper flex PRÓPRIO que envolve o container ng-show.
  // O wrapper não é controlado pelo Angular → seu display:flex nunca é sobrescrito.
  // Angular continua controlando o display do container interno (o input), o que é ok.
  function injectPrintButton() {
    if (document.getElementById('spt-resumo-btn')) return false;

    const btn = document.createElement('button');
    btn.id = 'spt-resumo-btn';
    btn.className = 'btn btn-info btn-lg waves-effect';
    btn.innerHTML = '<i class="zmdi zmdi-assignment"></i> Resumo da Conta';
    btn.addEventListener('click', handleShowResumo);

    const comandaInput = document.querySelector('#filter-order-card-transfer');
    if (comandaInput) {
      // Sobe até o container ng-show que envolve o input
      const ngShowEl = comandaInput.closest('[ng-show]') || comandaInput.parentElement;
      if (ngShowEl && ngShowEl.parentElement) {
        const parent   = ngShowEl.parentElement;
        const nextEl   = ngShowEl.nextSibling; // referência para restaurar posição

        // Wrapper flex — não tem ng-show, Angular não toca no display dele
        const wrapper = document.createElement('div');
        wrapper.id    = 'spt-resumo-row';
        wrapper.style.cssText = 'display:flex; align-items:center; width:100%; padding:10px 25px 10px 0;';
        wrapper.dataset.sptWrapper = '1'; // marca para removeUI saber que precisa restaurar

        // Move o container ng-show para dentro do wrapper (Angular continua funcionando)
        ngShowEl.style.flex   = '1';
        ngShowEl.style.margin = '0';
        ngShowEl.style.padding = '0';
        wrapper.appendChild(ngShowEl);
        wrapper.appendChild(btn);

        // Insere o wrapper exatamente onde o ngShowEl estava
        if (nextEl) {
          parent.insertBefore(wrapper, nextEl);
        } else {
          parent.appendChild(wrapper);
        }
        return true;
      }
    }

    // Fallback: linha abaixo do botão de impressão (se input não encontrado)
    const anchor = findAnchorElement();
    if (!anchor) return false;
    const parentContainer = anchor.closest('.row') || anchor.closest('.col-md-12') || anchor.parentElement;
    if (!parentContainer) return false;

    const btnRow = document.createElement('div');
    btnRow.className = 'row p-t-5';
    btnRow.id = 'spt-resumo-row';
    const btnCol = document.createElement('div');
    btnCol.className = 'col-md-12 p-0';
    btnCol.appendChild(btn);
    btnRow.appendChild(btnCol);
    parentContainer.parentNode.insertBefore(btnRow, parentContainer.nextSibling);
    return true;
  }

  // Gera HTML do conteúdo do modal
  function buildModalHTML(data, storeInfo) {
    let html = '';

    // Info da mesa/comanda
    html += '<div class="spt-info-row"><span>Mesa</span><strong>' + (data.mesa || '-') + '</strong></div>';
    html += '<div class="spt-info-row"><span>Comanda</span><strong>' + (data.comanda || '-') + '</strong></div>';
    if (data.garcom) html += '<div class="spt-info-row"><span>Garçom</span><strong>' + data.garcom + '</strong></div>';
    if (data.identificacao) html += '<div class="spt-info-row"><span>Identificação</span><strong>' + data.identificacao + '</strong></div>';
    html += '<div class="spt-info-row"><span>Data/Hora</span><strong>' + formatDateShort(new Date()) + '</strong></div>';

    // Separador
    html += '<hr class="spt-sep">';

    // Tabela de itens — com valor unitário
    if (data.items && data.items.length > 0) {
      html += '<table class="spt-items-table">';
      html += '<thead><tr><th>Qtd</th><th>Item</th><th>Vr.Unit</th><th>Valor</th></tr></thead>';
      html += '<tbody>';
      let hasHH = false;
      data.items.forEach(item => {
        const qtdStr  = item.qtd % 1 === 0 ? String(item.qtd) : item.qtd.toFixed(2);
        const unitStr = item.valorUnit > 0 ? 'R$ ' + formatBRL(item.valorUnit) : '-';
        if (item.hhTag) hasHH = true;
        html += '<tr>';
        html += '<td>' + qtdStr + '</td>';
        html += '<td>' + item.nome + (item.hhTag ? ' *' : '') + '</td>'; // * no final do nome
        html += '<td>' + unitStr + '</td>';
        html += '<td>R$ ' + formatBRL(item.valor) + '</td>';
        html += '</tr>';
      });
      html += '</tbody></table>';
      // Legenda do * abaixo da tabela, igual à impressão
      if (hasHH) html += '<div class="spt-hh-legend">* Pre\u00E7o Happy Hour</div>';
    } else {
      html += '<div class="spt-empty">Nenhum item encontrado</div>';
    }

    // Pagamentos realizados (lista primeiro)
    let totalPago = 0;
    html += '<hr class="spt-sep">';
    if (data.payments && data.payments.length > 0) {
      html += '<div class="spt-section-title">Pagamentos Realizados</div>';
      data.payments.forEach(p => {
        html += '<div class="spt-payment-row"><span>' + p.forma + '</span><span>R$ ' + formatBRL(p.valor) + '</span></div>';
        totalPago += p.valor;
      });
    } else {
      html += '<div class="spt-section-title">Pagamentos Realizados</div>';
      html += '<div class="spt-payment-row" style="color:#999;font-style:italic"><span>Nenhum pagamento realizado</span></div>';
    }

    // Totais: itens → taxa → total (após os pagamentos)
    html += '<hr class="spt-sep">';
    if (data.totalItens > 0) {
      html += '<div class="spt-total-row"><span>Total dos itens</span><span>R$ ' + formatBRL(data.totalItens) + '</span></div>';
    }
    if (data.taxaServico > 0) {
      // Mostra percentual se disponível, ex: "Taxa de serviço (10%)"
      const pctLabel = data.pctServico ? ' (' + data.pctServico + ')' : '';
      html += '<div class="spt-total-row"><span>Taxa de servi\u00E7o' + pctLabel + '</span><span>R$ ' + formatBRL(data.taxaServico) + '</span></div>';
    }
    html += '<div class="spt-total-row spt-grand"><span>TOTAL</span><span>R$ ' + formatBRL(data.totalGeral) + '</span></div>';

    // Saldo restante
    html += '<hr class="spt-sep-bold">';
    const saldo = data.totalGeral - totalPago;
    if (saldo > 0.01) {
      html += '<div class="spt-saldo-box">';
      html += '<span class="spt-saldo-label">FALTA PAGAR</span>';
      html += '<span class="spt-saldo-valor">R$ ' + formatBRL(saldo) + '</span>';
      html += '</div>';
    } else {
      html += '<div class="spt-saldo-box spt-pago">';
      html += '<span class="spt-saldo-label">CONTA PAGA</span>';
      html += '<span class="spt-saldo-valor">✓ Integralmente</span>';
      html += '</div>';
    }

    return html;
  }

  // Exibe o modal de resumo na tela
  function showResumoModal(data, storeInfo) {
    // Remove modal anterior se existir
    const old = document.getElementById('spt-modal-overlay');
    if (old) old.remove();

    const overlay = document.createElement('div');
    overlay.id = 'spt-modal-overlay';

    const card = document.createElement('div');
    card.id = 'spt-modal-card';

    // Header
    const header = document.createElement('div');
    header.id = 'spt-modal-header';
    header.innerHTML = '<h3><i class="zmdi zmdi-assignment"></i> Resumo da Conta</h3>'
      + '<button id="spt-modal-close" title="Fechar">&times;</button>';
    card.appendChild(header);

    // Body
    const body = document.createElement('div');
    body.id = 'spt-modal-body';
    body.innerHTML = buildModalHTML(data, storeInfo);
    card.appendChild(body);

    // Footer
    const footer = document.createElement('div');
    footer.id = 'spt-modal-footer';

    const btnClose = document.createElement('button');
    btnClose.className = 'spt-btn-close';
    btnClose.textContent = 'Fechar';

    const btnPrint = document.createElement('button');
    btnPrint.className = 'spt-btn-print';
    btnPrint.id = 'spt-modal-print-btn';
    btnPrint.innerHTML = '<i class="zmdi zmdi-print"></i> Imprimir';

    footer.appendChild(btnClose);
    footer.appendChild(btnPrint);
    card.appendChild(footer);

    overlay.appendChild(card);
    document.body.appendChild(overlay);

    // Fechar modal
    const closeModal = () => overlay.remove();
    btnClose.addEventListener('click', closeModal);
    header.querySelector('#spt-modal-close').addEventListener('click', closeModal);
    overlay.addEventListener('click', (e) => { if (e.target === overlay) closeModal(); });

    // Imprimir via SAIPOS Printer
    btnPrint.addEventListener('click', async () => {
      btnPrint.disabled = true;
      btnPrint.innerHTML = '<i class="zmdi zmdi-spinner zmdi-hc-spin"></i> Enviando...';
      await downloadSaiposprt(data, storeInfo);
      btnPrint.innerHTML = '<i class="zmdi zmdi-check"></i> Enviado!';
      setTimeout(() => {
        btnPrint.disabled = false;
        btnPrint.innerHTML = '<i class="zmdi zmdi-print"></i> Imprimir';
      }, 2000);
    });

  }

  // ================================================================
  // v6.7.0 — COLETA DE DADOS (reutilizado por modal e impressão direta)
  // ================================================================

  async function collectSaleData() {
    const mesaInfo = readMesaInfo();
    const totais = readTotaisFromDOM();
    const storeId = getStoreIdFromUrl();
    const saleId = getSaleIdFromUrl();

    // Paraleliza scope + token: independentes, economiza ~2-3s
    const [saleData, idUser] = await Promise.all([
      fetchOriginalSaleItems(),
      getIdUserFromToken()
    ]);

    // Itens originais do scope, ou fallback API, ou fallback DOM
    let items = parseScopeItems(saleData);

    // v6.6.2 — fallback API: busca sale_price (preço unitário original, não fracionado)
    if ((!items || items.length === 0) && storeId && saleId) {
      items = await fetchSaleItemsFromAPI(storeId, saleId);
    }
    if (!items || items.length === 0) {
      items = readItemsFromCloseScreen();
    }

    // v6.8.0 — fallback de totalGeral para tela de edição (DOM não tem elementos da close screen)
    if (!totais.totalGeral && saleData && saleData.total > 0) {
      totais.totalGeral = saleData.total; // total_price do scope Angular
    }

    // Pagamentos: scope → API → DOM (abre modal como último recurso)
    let payments = parseScopePayments(saleData);
    if ((!payments || payments.length === 0) && storeId && saleId) {
      payments = await fetchSalePaymentsFromAPI(storeId, saleId) || [];
    }
    if (!payments || payments.length === 0) {
      payments = await readPaymentsMadeFromDOM(); // abre modal nativo apenas se scope e API falharam
    }
    payments = payments || [];

    // v6.21.0 — calcula totalPago para restaurar qtd/valor fracionados pelo SAIPOS
    const totalPagoAcumulado = payments.reduce((sum, p) => sum + p.valor, 0);
    const restored = restoreOriginalValues(items, totais.totalGeral, totalPagoAcumulado);
    items = restored.items;

    // v6.17.0 — Aplica regra HH: mantém/corrige preço promo e marca itens lançados durante Happy Hour
    const hhPromos = await loadHHPromos();
    // Sempre roda — o fallback detecta HH por desvio de preço mesmo sem promo configurada
    items = applyHHRule(items, hhPromos);

    const totalItens = items.reduce((s, i) => s + i.valor, 0); // recalcula após HH

    // Recalcula taxa de serviço — prioridade: DOM percentual > DOM valor > scope > diferença total
    let taxaServico = totais.taxaServico;
    let pctServico = totais.pctServico;

    // 1) DOM tem percentual → recalcula para evitar valor fracionado
    if (pctServico) {
      const pctMatch = pctServico.match(/([\d,]+)\s*%/);
      if (pctMatch) {
        const pct = parseFloat(pctMatch[1].replace(',', '.'));
        taxaServico = Math.round(totalItens * (pct / 100) * 100) / 100;
      }
    }

    // 2) Fallback: scope Angular capturado pelo interceptor
    if (!taxaServico && saleData && saleData.taxa_servico > 0) {
      taxaServico = saleData.taxa_servico;
    }
    if (!pctServico && saleData && saleData.pct_servico) {
      pctServico = saleData.pct_servico;
      // Recalcula taxaServico a partir do percentual para evitar valor fracionado por pgto parcial
      if (!taxaServico) {
        const m = pctServico.match(/([\d,]+)\s*%/);
        if (m) taxaServico = Math.round(totalItens * (parseFloat(m[1].replace(',', '.')) / 100) * 100) / 100;
      }
    }

    // 3) Fallback: total_final do scope (campo separado que inclui taxa) − totalItens
    if (!taxaServico && saleData && saleData.total_final > 0 && saleData.total_final > totalItens + 0.01) {
      taxaServico = Math.round((saleData.total_final - totalItens) * 100) / 100;
    }

    // 4) Fallback: total base do scope − totalItens (quando total_price inclui taxa)
    if (!taxaServico && saleData && saleData.total > 0 && saleData.total > totalItens + 0.01) {
      taxaServico = Math.round((saleData.total - totalItens) * 100) / 100;
    }

    const totalGeral = Math.round((totalItens + taxaServico) * 100) / 100;

    const data = {
      saleId,
      mesa: (saleData && saleData.mesa) || mesaInfo.mesa,
      comanda: (saleData && saleData.comanda) || mesaInfo.comanda,
      garcom: (saleData && saleData.garcom) || mesaInfo.garcom,
      identificacao: (saleData && saleData.identificacao) || mesaInfo.identificacao,
      items,
      totalGeral,   // totalItens + taxaServico (inclui os 10%)
      totalItens,   // soma dos itens apenas
      taxaServico,
      pctServico,
      payments,
      _idUser: idUser || 0
    };

    // Fallback API consolidado — UMA chamada para preencher tudo que ainda falta:
    // mesa/comanda, taxa de serviço e pagamentos. Evita chamadas duplicadas.
    const needsApi = (!data.mesa || !data.comanda || !data.taxaServico || data.payments.length === 0)
                     && storeId && saleId;
    if (needsApi) {
      try {
        const apiSale = await fetchJson(`https://api.saipos.com/v1/stores/${storeId}/sales/${saleId}`);
        if (apiSale) {
          // Mesa / comanda / garçom
          if (!data.mesa)    data.mesa    = apiSale.table_desc || apiSale.desc_table || apiSale.table || '';
          if (!data.comanda) data.comanda = apiSale.command_order || apiSale.id_command_order || String(apiSale.command_number || '');
          if (!data.garcom)  data.garcom  = apiSale.waiter_name  || apiSale.desc_waiter || '';

          // Taxa de serviço — tenta todos os campos conhecidos + percentual + diferença de totais
          if (!data.taxaServico) {
            data.taxaServico =
              apiSale.service_fee       || apiSale.service_fee_value  ||
              apiSale.service_tax       || apiSale.service_tax_value  ||
              apiSale.service_value     || apiSale.service_charge     ||
              apiSale.fee_service       || apiSale.taxa_servico       ||
              apiSale.valor_servico     || apiSale.servico            || 0;

            // Percentual → recalcula sobre totalItens (evita valor fracionado por pgto parcial)
            if (!data.pctServico) {
              const pct = apiSale.service_rate || apiSale.service_percentage ||
                          apiSale.serviceRate  || apiSale.service_fee_rate;
              if (pct) {
                const pctNum = pct <= 1 ? pct * 100 : pct;
                data.pctServico  = pctNum.toFixed(0) + '%';
                data.taxaServico = Math.round(data.totalItens * (pctNum / 100) * 100) / 100;
              }
            }

            // Diferença: total_final (com taxa) − totalItens
            if (!data.taxaServico) {
              const apiTotalFinal = apiSale.final_total  || apiSale.grand_total ||
                                    apiSale.total_final  || apiSale.valor_total ||
                                    apiSale.total_amount || 0;
              if (apiTotalFinal > data.totalItens + 0.01) {
                data.taxaServico = Math.round((apiTotalFinal - data.totalItens) * 100) / 100;
              }
            }

            // Diferença genérica: qualquer total maior que totalItens
            if (!data.taxaServico) {
              const apiTotal = apiSale.total_price || apiSale.total || 0;
              if (apiTotal > data.totalItens + 0.01) {
                data.taxaServico = Math.round((apiTotal - data.totalItens) * 100) / 100;
              }
            }

            // Recalcula totalGeral se taxa foi encontrada
            if (data.taxaServico) {
              data.totalGeral = Math.round((data.totalItens + data.taxaServico) * 100) / 100;
            }
          }

          // Pagamentos — extrai do response da API
          if (data.payments.length === 0) {
            const rawPays = apiSale.payments || apiSale.sale_payments || [];
            const apiPays = [];
            rawPays.forEach(p => {
              (p.payments || [p]).forEach(sp => {
                const tipo  = sp.desc_payment_type || sp.payment_type || '';
                const desc  = sp.desc_sale_payment || p.desc_sale_payment || '';
                const valor = sp.value || sp.amount || sp.total || 0;
                if (valor > 0) apiPays.push({ forma: tipo + (desc && desc !== tipo ? ' - ' + desc : ''), valor });
              });
            });
            if (apiPays.length > 0) data.payments = apiPays;
          }
        }
      } catch(e) {}
    }

    const storeInfo = storeId
      ? await fetchStoreInfo(storeId)
      : { idStore: '0', nome: getStoreNameFromDOM(), cnpj: '', endereco: '', cidade: '', serviceCharge: 0 };

    // Fallback final: taxa de serviço via config do estabelecimento (shifts.service_charge)
    // Fonte mais confiável — dados de configuração da loja, não da venda
    if (!data.taxaServico && storeInfo.serviceCharge > 0) {
      const pctNum = storeInfo.serviceCharge;
      data.pctServico  = data.pctServico  || pctNum.toFixed(0) + '%';
      data.taxaServico = Math.round(data.totalItens * (pctNum / 100) * 100) / 100;
      data.totalGeral  = Math.round((data.totalItens + data.taxaServico) * 100) / 100;
    }

    return { data, storeInfo };
  }

  // Coleta dados e abre modal de resumo
  async function handleShowResumo() {
    const btn = document.getElementById('spt-resumo-btn');
    if (btn) {
      btn.disabled = true;
      btn.innerHTML = '<i class="zmdi zmdi-spinner zmdi-hc-spin"></i> Carregando...';
    }

    const { data, storeInfo } = await collectSaleData();
    showResumoModal(data, storeInfo);

    if (btn) {
      btn.disabled = false;
      btn.innerHTML = '<i class="zmdi zmdi-assignment"></i> Resumo da Conta';
    }
  }

  // v6.7.0 — Coleta dados e imprime diretamente (sem abrir modal)
  // Usado como substituto do vm.printSale nativo do SAIPOS
  async function handlePrintDirect() {
    const nativeBtn = document.querySelector('[data-qa="options-print"]');
    const originalHTML = nativeBtn ? nativeBtn.innerHTML : '';

    // Feedback visual durante coleta
    if (nativeBtn) {
      nativeBtn.disabled = true;
      nativeBtn.innerHTML = '<i class="zmdi zmdi-spinner zmdi-hc-spin"></i>';
    }

    const { data, storeInfo } = await collectSaleData();
    await downloadSaiposprt(data, storeInfo);

    // Restaura botão após envio
    if (nativeBtn) {
      nativeBtn.innerHTML = '<i class="zmdi zmdi-check"></i>';
      setTimeout(() => {
        nativeBtn.disabled = false;
        nativeBtn.innerHTML = originalHTML;
      }, 2000);
    }
  }

  // v6.7.0 — Sobrepõe botão nativo de impressão do SAIPOS
  // Usa capture phase para interceptar ANTES do ng-click do AngularJS (bubble phase)
  // stopImmediatePropagation() impede ng-click e disable-button-delay de disparar
  function overrideNativePrintButton() {
    const nativeBtn = document.querySelector('[data-qa="options-print"]');
    if (!nativeBtn || nativeBtn.__sptPrintOverridden) return; // evita registro duplo

    nativeBtn.__sptPrintOverridden = true;
    nativeBtn.addEventListener('click', function(e) {
      e.stopImmediatePropagation(); // bloqueia ng-click e quaisquer outros handlers
      e.preventDefault();
      handlePrintDirect(); // imprime com dados corretos do Resumo da Conta
    }, true); // true = capture phase: dispara antes do ng-click (bubble)
  }

  // ================================================================
  // REMOÇÃO DE UI
  // ================================================================

  function removeUI() {
    if (!uiInjected) return;
    uiInjected = false;

    const row = document.getElementById('spt-resumo-row');
    if (row) {
      if (row.dataset.sptWrapper) {
        // Restaura: move o container ng-show de volta para o parent original
        const ngShowEl = row.querySelector('[ng-show]');
        if (ngShowEl) {
          ngShowEl.style.flex    = '';
          ngShowEl.style.margin  = '';
          ngShowEl.style.padding = '';
          row.parentElement.insertBefore(ngShowEl, row); // devolve antes do wrapper
        }
      }
      row.remove();
    }

    // Fecha modal se estiver aberto
    const modal = document.getElementById('spt-modal-overlay');
    if (modal) modal.remove();

    const styles = document.getElementById('spt-styles');
    if (styles) styles.remove();
  }

  // ================================================================
  // INICIALIZAÇÃO
  // ================================================================

  let checkTimeout = null;
  let retryCount = 0;
  const MAX_RETRIES = 30;
  // v6.6.0 — salva saleId da tela close para corrigir botão voltar
  let lastCloseSaleId = null;

  function handleRouteChange() {
    if (checkTimeout) clearTimeout(checkTimeout);
    const hash = window.location.hash;

    if (isCloseScreen()) {
      // --- Tela de pagamento: injeta Resumo + sobrepõe impressão ---
      lastCloseSaleId = getSaleIdFromUrl();
      paymentWasCompleted = false; // reseta a cada abertura da tela de pagamento
      checkTimeout = setTimeout(() => {
        if (!uiInjected && isCloseScreen()) {
          retryCount++;
          const anchor = findAnchorElement();
          if (!anchor) {
            if (retryCount < MAX_RETRIES) {
              checkTimeout = setTimeout(() => handleRouteChange(), 500);
              return;
            }
            return;
          }
          uiInjected = true;
          retryCount = 0;
          injectStyles();
          injectPrintButton();
          overrideNativePrintButton();
        }
      }, 600);

    } else if (isAnyOrderScreen()) {
      // v6.19.0 — qualquer tela de comanda (edit, view, etc.): só sobrepõe impressão

      // v6.31.0 — Fix botão Voltar: redireciona SOMENTE se pagamento NÃO foi confirmado
      // (evita redirect quando SAIPOS navega após fechar conta com sucesso)
      if (lastCloseSaleId && !paymentWasCompleted && !hash.includes('table-order/edit/' + lastCloseSaleId)) {
        const saleId = lastCloseSaleId;
        lastCloseSaleId = null;
        console.log('[SPT] Voltar interceptado (table-order), redirecionando para edit/' + saleId);
        window.location.hash = '#/app/sale/table-order/edit/' + saleId;
        return;
      }
      lastCloseSaleId = null; // limpa para não re-disparar

      retryCount = 0;
      removeUI(); // limpa elementos da close screen se existirem
      checkTimeout = setTimeout(() => {
        if (!isAnyOrderScreen()) return;
        const printBtn = document.querySelector('[data-qa="options-print"]');
        if (!printBtn) {
          if (retryCount < MAX_RETRIES) {
            retryCount++;
            checkTimeout = setTimeout(() => handleRouteChange(), 500);
          }
          return;
        }
        retryCount = 0;
        overrideNativePrintButton();
      }, 600);

    } else {
      // --- Outras telas: limpa tudo ---
      retryCount = 0;
      removeUI();

      // v6.6.0 — Fix: redireciona SOMENTE se o pagamento não foi confirmado
      // (ex: usuário clicou Voltar sem fechar a conta)
      if (lastCloseSaleId && !paymentWasCompleted) {
        const editHash = '#/app/sale/table-order/edit/' + lastCloseSaleId;
        const currentSaleId = lastCloseSaleId;
        lastCloseSaleId = null;
        if (!hash.includes('table-order/edit/' + currentSaleId) && !hash.includes('table-order/close/')) {
          window.location.hash = editHash;
          return;
        }
      }
      lastCloseSaleId = null;
      paymentWasCompleted = false; // limpa após sair do fluxo de close
    }
  }

  // v6.29.0 — Recebe dados do interceptor quando botão IMPRIMIR do card é clicado
  // Estratégia: faz UMA chamada API logo no início e usa como fallback para
  // mesa/comanda, pagamentos e taxa de serviço — garante saída idêntica ao close screen
  window.addEventListener('__saipos_print_from_list', async (e) => {
    try {
      const raw = JSON.parse(e.detail);
      if (!raw.id_sale) return;

      // DEBUG — log tudo que veio do interceptor (scope do card)
      console.log('[SPT] print_from_list raw:', {
        id_sale:     raw.id_sale,
        mesa:        raw.mesa,
        comanda:     raw.comanda,
        garcom:      raw.garcom,
        total:       raw.total,
        taxa_servico: raw.taxa_servico,
        pct_servico: raw.pct_servico,
        itens:       (raw.sale_items || []).length,
        payments:    (raw.payments   || []).length,
      });

      const storeId = getStoreIdFromUrl();
      const idUser  = await getIdUserFromToken();
      const saleId  = String(raw.id_sale);

      // Busca sale completo via API logo no início (scope do card raramente tem tudo)
      let apiSale = null;
      if (storeId) {
        try {
          apiSale = await fetchJson(`https://api.saipos.com/v1/stores/${storeId}/sales/${saleId}`);
          // DEBUG — log objetos aninhados chave para mesa/taxa
          const to = apiSale && apiSale.table_order;
          const sh = apiSale && apiSale.shift;
          const st = apiSale && apiSale.store;
          console.log('[SPT] API sale keys:', apiSale ? Object.keys(apiSale) : 'null');
          console.log('[SPT] API sale:', {
            table_desc:     apiSale && apiSale.table_desc,
            command_order:  apiSale && apiSale.command_order,
            payments_count: apiSale && (apiSale.payments || []).length,
            service_fee:    apiSale && apiSale.service_fee,
            total_amount:   apiSale && apiSale.total_amount,
          });
          console.log('[SPT] table_order FULL:', to ? JSON.stringify(to).slice(0, 600) : 'null');
          console.log('[SPT] shift:', sh ? JSON.stringify(sh).slice(0, 200) : 'null');
          if (apiSale && apiSale.payments && apiSale.payments.length > 0) {
            const pay0 = apiSale.payments[0];
            const sub0 = (pay0.payments && pay0.payments[0]) || pay0;
            console.log('[SPT] API payment[0]:', JSON.stringify(sub0).slice(0, 300));
          }
          console.log('[SPT] payment_types FULL:', apiSale && apiSale.payment_types ? JSON.stringify(apiSale.payment_types).slice(0, 800) : 'null');
        } catch(e) { console.log('[SPT] API error:', e); }
      } else {
        console.log('[SPT] storeId não encontrado na URL:', window.location.href);
      }

      // ── Itens: scope → API ──
      let items = (raw.sale_items || []).map(it => ({
        nome:      it.nome,
        qtd:       it.qtd,
        valorUnit: it.valor_unit,
        valor:     it.valor_total || Math.round(it.qtd * it.valor_unit * 100) / 100
      })).filter(i => i.nome);

      if (items.length === 0 && apiSale) {
        const rawItems = apiSale.sale_items || apiSale.items || [];
        items = rawItems.map(it => ({
          nome:      it.desc_item || it.desc_sale_item || it.name || '',
          qtd:       it.quantity  || it.qty || 1,
          valorUnit: it.sale_price || it.unit_price || it.price || 0,
          valor:     it.total_price || it.total || 0
        })).filter(i => i.nome);
      }

      // ── Pagamentos: scope → API ──
      // raw.payments pode ter valor=0 se o nome do campo diferir; filter remove esses
      let payments = (raw.payments || [])
        .map(p => ({ forma: p.forma + (p.desc ? ' - ' + p.desc : ''), valor: p.valor }))
        .filter(p => p.valor > 0);

      if (payments.length === 0 && apiSale) {
        // payment_types = resumo de formas de pagamento com totais (melhor fonte para exibição)
        // Forma fica em payment_type.desc_store_payment_type (objeto aninhado confirmado)
        const ptypes = apiSale.payment_types || [];
        if (ptypes.length > 0) {
          ptypes.forEach(pt => {
            const tipo  = (pt.payment_type && pt.payment_type.desc_store_payment_type) ||
                          pt.desc_payment_type || pt.desc || pt.type || '';
            const valor = pt.payment_amount || pt.total_amount || pt.amount || pt.valor || 0;
            if (valor > 0) payments.push({ forma: tipo, valor });
          });
        }

        // Fallback: sale.payments — valor = soma de items[].amount + charge_amount (taxa)
        if (payments.length === 0) {
          const rawPays = apiSale.payments || apiSale.sale_payments || [];
          rawPays.forEach(p => {
            const tipo = p.desc_payment_type || p.payment_type || p.desc || '';
            const desc = p.desc_sale_payment || '';
            // Valor do pagamento = soma dos itens pagos + taxa de serviço proporcional
            let valor = p.value || p.amount || p.total || p.valor || p.paid_amount || 0;
            if (!valor && Array.isArray(p.items) && p.items.length > 0) {
              valor = p.items.reduce((s, i) => s + (i.amount || 0), 0) + (p.charge_amount || 0);
            }
            if (!valor) valor = p.charge_amount || p.payment_charge_amount || 0;
            if (valor > 0) payments.push({ forma: tipo + (desc && desc !== tipo ? ' - ' + desc : ''), valor });
          });
        }
      }

      // ── Restaura qtd/valor fracionados e aplica HH ──
      // NOTA: neste path (card list / edit screen) os itens do scope/API já têm quantidades
      // completas — NÃO passar totalPagoAcumulado para evitar inflação incorreta das quantidades.
      // restoreOriginalValues com totalPago=0 age como no-op (ratio=1).
      const totalPagoAcumulado = payments.reduce((s, p) => s + p.valor, 0);
      const totalRef = raw.total
        || (apiSale && (apiSale.total_amount_items || apiSale.total_price || apiSale.total_amount || apiSale.total))
        || 0;
      const restored = restoreOriginalValues(items, totalRef, 0);
      items = restored.items;
      const hhPromos = await loadHHPromos();
      items = applyHHRule(items, hhPromos);
      const totalItens = items.reduce((s, i) => s + i.valor, 0);

      // ── Taxa de serviço: scope → API campos diretos → shift aninhado → diferença ──
      let taxaServico = raw.taxa_servico || 0;
      let pctServico  = raw.pct_servico  || '';

      if (pctServico) {
        const m = pctServico.match(/([\d,]+)\s*%/);
        if (m) taxaServico = Math.round(totalItens * (parseFloat(m[1].replace(',', '.')) / 100) * 100) / 100;
      }
      if (!taxaServico && apiSale) {
        taxaServico = apiSale.service_fee      || apiSale.service_fee_value ||
                      apiSale.service_tax      || apiSale.service_tax_value ||
                      apiSale.fee_service      || apiSale.taxa_servico      || 0;
        if (!pctServico) {
          const pct = apiSale.service_rate || apiSale.service_percentage;
          if (pct) {
            const pctNum = pct <= 1 ? pct * 100 : pct;
            pctServico   = pctNum.toFixed(0) + '%';
            taxaServico  = Math.round(totalItens * (pctNum / 100) * 100) / 100;
          }
        }
        // shift aninhado na venda (fonte mais confiável — config do estabelecimento)
        if (!taxaServico) {
          const apiShift = apiSale.shift || {};
          if (apiShift.use_service_charge === 'Y' && apiShift.service_charge > 0) {
            const pctNum = apiShift.service_charge;
            pctServico   = pctServico || pctNum.toFixed(0) + '%';
            taxaServico  = Math.round(totalItens * (pctNum / 100) * 100) / 100;
          }
        }
        // store.shifts aninhado na venda (mesmo dado, path alternativo)
        if (!taxaServico && apiSale.store && Array.isArray(apiSale.store.shifts)) {
          const activeShift = apiSale.store.shifts.find(s => s.use_service_charge === 'Y' && s.service_charge > 0);
          if (activeShift) {
            pctServico  = pctServico || activeShift.service_charge.toFixed(0) + '%';
            taxaServico = Math.round(totalItens * (activeShift.service_charge / 100) * 100) / 100;
          }
        }
      }
      if (!taxaServico && totalRef > totalItens + 0.01) {
        taxaServico = Math.round((totalRef - totalItens) * 100) / 100;
      }

      const totalGeral = Math.round((totalItens + taxaServico) * 100) / 100;

      // ── Mesa / comanda / garçom: scope → API (table_order aninhado) ──
      const apiTableOrder = (apiSale && apiSale.table_order) || {};
      // raw.mesa pode chegar como objeto se interceptor pegou scope.order.table (objeto)
      const rawMesaStr = (raw.mesa && typeof raw.mesa === 'object')
        ? (raw.mesa.desc_store_table || raw.mesa.table_desc || raw.mesa.desc_table || '')
        : (raw.mesa || '');
      // table_order.table.desc_store_table = campo confirmado via debug
      const toTable = apiTableOrder.table || {};
      const toCard  = apiTableOrder.order_card || {};
      const mesa    = rawMesaStr ||
        toTable.desc_store_table || toTable.table_desc || toTable.desc_table || toTable.table_name ||
        apiTableOrder.table_desc || '-';
      const comanda = raw.comanda ||
        toCard.display_order_card || String(toCard.id_store_order_card || '') ||
        apiTableOrder.command_order || String(apiTableOrder.command_number || '') || '-';
      const garcom  = raw.garcom  ||
        (apiSale && (apiSale.waiter_name || apiSale.desc_waiter)) ||
        (apiSale && apiSale.user && (apiSale.user.name || apiSale.user.desc_user)) || '';

      // DEBUG — log resultado final antes de imprimir
      console.log('[SPT] print_from_list FINAL:', {
        mesa, comanda, garcom,
        totalItens, taxaServico, pctServico, totalGeral,
        payments: payments.length,
        items:    items.length,
      });

      const data = {
        saleId, mesa, comanda, garcom,
        identificacao: raw.identificacao || '',
        items, totalGeral, totalItens, taxaServico, pctServico,
        payments,
        _idUser: idUser || 0
      };

      const storeInfo = storeId
        ? await fetchStoreInfo(storeId)
        : { idStore: '0', nome: getStoreNameFromDOM(), cnpj: '', endereco: '', cidade: '' };

      await downloadSaiposprt(data, storeInfo);
    } catch (err) {
      console.error('[SPT] Erro ao imprimir comanda da lista:', err);
    }
  });

  function init() {

    window.addEventListener('hashchange', () => handleRouteChange());
    handleRouteChange();

    // MutationObserver como backup (SPA pode mudar DOM sem hashchange)
    let mutationTimer = null;
    const observer = new MutationObserver(() => {
      if (mutationTimer) return;
      mutationTimer = setTimeout(() => {
        mutationTimer = null;
        if (isCloseScreen() && !uiInjected) {
          handleRouteChange();
        } else if (isAnyOrderScreen()) {
          // Re-aplica override se Angular re-renderizou o botão de impressão
          const btn = document.querySelector('[data-qa="options-print"]');
          if (btn && !btn.__sptPrintOverridden) overrideNativePrintButton();
        } else if (uiInjected) {
          removeUI();
        }
      }, 300);
    });
    observer.observe(document.body, { childList: true, subtree: true });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
