// ================================================================
// SAIPOS TOOLS v6.4.1 — partial-payment.js (ISOLATED world, document_idle)
// Botão "Resumo" na tela de pagamento do SAIPOS
// Abre modal visual com itens, pagamentos realizados e saldo restante
// Opção de imprimir via .saiposprt (SAIPOS Printer)
// ================================================================
(function () {
  'use strict';

  if (window.__saiposPartialPaymentActive) return;
  window.__saiposPartialPaymentActive = true;

  const STORE_CACHE_KEY = 'saipos_store_info_cache';

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
    const hash = window.location.hash;
    return hash.includes('#/app/sale/table-order/close/') || hash.includes('table-order/close/');
  }

  function getSaleIdFromUrl() {
    const match = window.location.hash.match(/close\/(\d+)/);
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

    return {
      comanda: comanda ? comanda.textContent.trim() : '',
      mesa: mesa ? mesa.textContent.trim() : '',
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

    console.log('[SaiposTools] readItemsFromCloseScreen:', items.length, 'itens');
    return items;
  }

  // Lê pagamentos já realizados abrindo o modal nativo do SAIPOS
  // Clica em "Pagamentos realizados", lê os dados, e fecha o modal
  async function readPaymentsMadeFromDOM() {
    const payments = [];

    // Encontra o botão "Pagamentos realizados (N)"
    const paymentBtn = document.querySelector('[data-qa="payment-made"]');
    if (!paymentBtn) {
      console.log('[SaiposTools] Botão payment-made não encontrado');
      return payments;
    }

    // Verifica se está desabilitado (0 pagamentos)
    if (paymentBtn.disabled) {
      console.log('[SaiposTools] Botão payment-made desabilitado (sem pagamentos)');
      return payments;
    }

    // Extrai contagem do texto do botão: "Pagamentos realizados (2)"
    const countMatch = paymentBtn.textContent.match(/\((\d+)\)/);
    const count = countMatch ? parseInt(countMatch[1]) : 0;
    if (count === 0) {
      console.log('[SaiposTools] 0 pagamentos no botão');
      return payments;
    }

    // Clica para abrir o modal de pagamentos parciais
    paymentBtn.click();
    console.log('[SaiposTools] Clicou em payment-made, aguardando modal...');

    // Aguarda o modal aparecer (max 3s)
    const modalContent = await waitForElement('.modal-content [ng-repeat="item in vm.payments"]', 3000);
    if (!modalContent) {
      console.warn('[SaiposTools] Modal de pagamentos não apareceu');
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

    console.log('[SaiposTools] Lidos', payments.length, 'pagamentos do modal');

    // Fecha o modal clicando em "Voltar"
    const closeBtn = document.querySelector('.modal-content [data-qa="come-back"]')
      || document.querySelector('.modal-footer [data-qa="come-back"]')
      || document.querySelector('.modal-footer .btn-danger');
    if (closeBtn) {
      closeBtn.click();
      console.log('[SaiposTools] Modal de pagamentos fechado');
      await delay(300); // Aguarda fechar
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
    const totalGeralEl = document.querySelector('[data-qa="total-amount"]');
    const totalItensEl = document.querySelector('[data-qa="total-amount-items"]');
    const taxaServicoEl = document.querySelector('[data-qa="service-value"]');
    const pctServicoEl = document.querySelector('[data-qa="percentage-service-value"]');

    let totalItens = 0;
    if (totalItensEl) {
      const strong = totalItensEl.querySelector('strong');
      totalItens = parseBRL(strong ? strong.textContent : totalItensEl.textContent);
    }

    let pctServico = '';
    if (pctServicoEl) pctServico = pctServicoEl.textContent.trim();

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

    console.log('[SaiposTools] readTotaisFromDOM: totalGeral=' + totalGeral + ', totalItens=' + totalItens);
    return {
      totalGeral, totalItens,
      taxaServico: taxaServicoEl ? parseBRL(taxaServicoEl.textContent) : 0,
      pctServico
    };
  }

  // ================================================================
  // DADOS DA LOJA (via API com cache)
  // ================================================================

  function getStoreIdFromUrl() {
    // Tenta extrair do path: /stores/88111/...
    const m = window.location.href.match(/\/stores\/(\d+)/);
    if (m) return m[1];
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

  async function fetchStoreInfo(storeId) {
    try {
      const cached = await chrome.storage.local.get(STORE_CACHE_KEY);
      if (cached[STORE_CACHE_KEY] && cached[STORE_CACHE_KEY].idStore === storeId) {
        const cacheAge = Date.now() - (cached[STORE_CACHE_KEY].cachedAt || 0);
        if (cacheAge < 24 * 60 * 60 * 1000) return cached[STORE_CACHE_KEY];
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
            const info = {
              idStore: storeId,
              nome: d.desc_store || d.name || storeName,
              cnpj: d.cnpj || d.document || '',
              endereco: d.address || d.street || '',
              cidade: d.city || '',
              estado: d.state || '',
              bairro: d.neighborhood || '',
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
      const timeout = setTimeout(() => resolve(null), 2000);

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
        console.log('[SaiposTools] Timeout ao buscar itens originais do scope');
        resolve(null);
      }, 3000);

      const handler = (e) => {
        clearTimeout(timeout);
        window.removeEventListener('__saipos_sale_items_response', handler);
        try {
          const result = JSON.parse(e.detail);
          if (result && result.sale_items && result.sale_items.length > 0) {
            console.log('[SaiposTools] Itens originais do scope:', result.sale_items.length);
            resolve(result);
          } else {
            console.log('[SaiposTools] Scope sem itens');
            resolve(null);
          }
        } catch (err) {
          console.error('[SaiposTools] Erro ao parsear resposta do scope:', err);
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

  // Restaura valores originais dos itens (SAIPOS frac. proporcional após pagamento)
  // Fórmula: ratio = (totalAtual + totalPago) / totalAtual
  function restoreOriginalValues(items, totalGeral, totalPago) {
    if (totalPago <= 0 || totalGeral <= 0) return { items, totalOriginal: totalGeral };

    const totalOriginal = totalGeral + totalPago;
    const ratio = totalOriginal / totalGeral;

    const restoredItems = items.map(item => {
      let qtd = item.qtd * ratio;
      // Snap para inteiro se estiver próximo (ex: 0.997 → 1, 4.002 → 4)
      if (Math.abs(qtd - Math.round(qtd)) < 0.08) qtd = Math.round(qtd);
      else qtd = Math.round(qtd * 100) / 100;

      const valor = Math.round(item.valor * ratio * 100) / 100;
      return { ...item, qtd, valor };
    });

    console.log('[SaiposTools] Valores restaurados: ratio=' + ratio.toFixed(4)
      + ', totalOriginal=' + totalOriginal);
    return { items: restoredItems, totalOriginal };
  }

  // ================================================================
  // GERAÇÃO DO ARQUIVO .saiposprt
  // ================================================================

  function buildPrintRows(data, storeInfo) {
    const COLS = 30;
    const rows = [];

    rows.push('<barra_mostrar>0</barra_mostrar>');
    rows.push('<barra_largura>3</barra_largura>');
    rows.push('<barra_altura>120</barra_altura>');

    // Cabeçalho da loja
    if (storeInfo.nome) rows.push('</ae>' + cleanStoreName(storeInfo.nome));
    if (storeInfo.cnpj) rows.push('</ae>CNPJ: ' + storeInfo.cnpj);
    if (storeInfo.endereco) rows.push('</ae>' + storeInfo.endereco);
    if (storeInfo.cidade) {
      let c = storeInfo.cidade;
      if (storeInfo.bairro) c += ' - ' + storeInfo.bairro;
      rows.push('</ae>' + c);
    }
    rows.push('</ae></linha_simples>');

    // Título
    rows.push('</ce><n><e>RESUMO DA CONTA</e></n>');
    rows.push('</ad>' + formatDateShort(new Date()));

    if (data.identificacao) rows.push('</ae>Identifica\u00E7\u00E3o: ' + data.identificacao);
    rows.push('</ae>Mesa: ' + data.mesa + ' - Comanda: ' + data.comanda);
    if (data.garcom) rows.push('</ae>Gar\u00E7om: ' + data.garcom);

    rows.push('</linha_simples>');
    rows.push('</ae>Qt.   Descri\u00E7\u00E3o          Valor');
    rows.push('</ae></linha_simples>');

    // Itens — valores com ponto (formato ESC/POS)
    if (data.items && data.items.length > 0) {
      data.items.forEach(item => {
        const qtdStr = item.qtd % 1 === 0 ? String(item.qtd) : item.qtd.toFixed(3);
        const valorStr = formatDot(item.valor);
        const qtdPad = padR(qtdStr, 6);
        const valorPad = padL(valorStr, 6);
        const nomeSpace = COLS - 6 - 6;
        const nomePad = padR(item.nome.substring(0, nomeSpace), nomeSpace);
        rows.push('</ae><a>' + qtdPad + nomePad + valorPad + '</a>');
        rows.push('</ae>');
      });
    }

    rows.push('</ae></linha_simples>');

    // Totais — valores com vírgula (formato brasileiro)
    if (data.totalItens > 0) {
      const totalItensStr = formatBRL(data.totalItens);
      rows.push(padR('Total itens(=)', COLS - totalItensStr.length) + totalItensStr);
    }

    if (data.taxaServico > 0) {
      const taxaStr = formatBRL(data.taxaServico);
      let taxaLabel = 'Taxa de servi\u00E7o(+)';
      if (data.pctServico) {
        const pctMatch = data.pctServico.match(/([\d,]+)\s*%/);
        if (pctMatch) taxaLabel = 'Taxa de servi\u00E7o ' + pctMatch[1] + '%(+)';
      }
      rows.push(padR(taxaLabel, COLS - taxaStr.length) + taxaStr);
    }

    const totalGeralStr = formatBRL(data.totalGeral);
    rows.push(padR('TOTAL(=)', COLS - totalGeralStr.length) + totalGeralStr);
    rows.push('</linha_simples>');

    // Pagamentos realizados
    if (data.payments && data.payments.length > 0) {
      rows.push('</ce><n><e>PAGAMENTOS REALIZADOS</e></n>');
      rows.push('</linha_simples>');

      let totalPago = 0;
      data.payments.forEach(p => {
        const valorPagStr = formatBRL(p.valor);
        rows.push(padR(p.forma, COLS - valorPagStr.length) + valorPagStr);
        totalPago += p.valor;
      });

      rows.push('</linha_simples>');
      const totalPagoStr = formatBRL(totalPago);
      rows.push(padR('Total pago(=)', COLS - totalPagoStr.length) + totalPagoStr);
      rows.push('</linha_simples>');

      const saldo = data.totalGeral - totalPago;
      if (saldo > 0.01) {
        const saldoStr = formatBRL(saldo);
        rows.push('</ce><n><e>' + padR('FALTA PAGAR(=)', COLS - saldoStr.length) + saldoStr + '</e></n>');
      } else {
        rows.push('</ce><n><e>CONTA PAGA INTEGRALMENTE</e></n>');
      }
    } else {
      const saldoStr = formatBRL(data.totalGeral);
      rows.push('</ce><n><e>' + padR('FALTA PAGAR(=)', COLS - saldoStr.length) + saldoStr + '</e></n>');
    }

    rows.push('</linha_simples>');
    rows.push('</ae><c><n>www.saipos.com</n></c>');
    rows.push(' ');
    rows.push(' ');
    rows.push(' ');
    rows.push('</corte_parcial>');

    return rows;
  }

  function buildSaiposprtJSON(data, storeInfo) {
    // Use o saleId como fileName (igual ao SAIPOS nativo)
    const saleId = data.saleId || String(Date.now());
    const fileName = saleId + '.saiposprt';
    const idUser = data._idUser || 0;
    const printRows = buildPrintRows(data, storeInfo);

    const doc = [{
      printSettings: {
        type: 0, printDelivery: 1, printTable: 1, printServiceTicket: 1,
        layout: 2, rowColumns: 30, copies: 1, emptyLines: 3, emptyChar: ' ',
        fontSize: 11, cashierPrintZeroedValueItems: 1, printTableCancelItem: 0,
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
    const { json, fileName } = buildSaiposprtJSON(data, storeInfo);
    const jsonStr = JSON.stringify(json);
    // Converte string para bytes UTF-8, depois para base64 (preserva acentos)
    const utf8Bytes = new TextEncoder().encode(jsonStr);
    let binary = '';
    for (let i = 0; i < utf8Bytes.length; i++) {
      binary += String.fromCharCode(utf8Bytes[i]);
    }
    const base64 = btoa(binary);

    // Download via background.js usando chrome.downloads API
    return new Promise((resolve) => {
      chrome.runtime.sendMessage({
        type: 'DOWNLOAD_SAIPOSPRT',
        data: base64,
        fileName
      }, (response) => {
        if (response && response.ok) {
          console.log('[SaiposTools] Download enviado para background:', fileName);
        } else {
          console.error('[SaiposTools] Erro no download:', response);
        }
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
        width: 100%;
        padding: 10px 0 !important;
        box-shadow: none;
        margin-top: 5px;
        font-weight: bold;
        font-size: 14px;
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
      /* Modal card */
      #spt-modal-card {
        background: #fff; border-radius: 8px;
        width: 420px; max-height: 85vh;
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
      #spt-modal-header h3 { margin: 0; font-size: 18px; font-weight: 600; }
      #spt-modal-close {
        background: none; border: none; color: #fff;
        font-size: 22px; cursor: pointer; padding: 0 4px;
        line-height: 1;
      }
      #spt-modal-close:hover { opacity: 0.7; }
      /* Body */
      #spt-modal-body {
        padding: 16px 20px;
        overflow-y: auto; flex: 1;
        font-size: 13px; color: #333;
      }
      /* Info da mesa */
      .spt-info-row {
        display: flex; justify-content: space-between;
        padding: 2px 0; color: #666; font-size: 12px;
      }
      .spt-info-row strong { color: #333; }
      /* Separador */
      .spt-sep {
        border: none; border-top: 1px dashed #ccc;
        margin: 10px 0;
      }
      .spt-sep-bold {
        border: none; border-top: 2px solid #333;
        margin: 10px 0;
      }
      /* Tabela de itens */
      .spt-items-table {
        width: 100%; border-collapse: collapse;
        font-size: 13px;
      }
      .spt-items-table th {
        text-align: left; font-weight: 600;
        padding: 4px 0; border-bottom: 1px solid #ddd;
        font-size: 11px; color: #888; text-transform: uppercase;
      }
      .spt-items-table th:last-child,
      .spt-items-table td:last-child { text-align: right; }
      .spt-items-table th:nth-child(2),
      .spt-items-table td:nth-child(2) { text-align: center; }
      .spt-items-table td {
        padding: 5px 0; border-bottom: 1px solid #f0f0f0;
      }
      /* Totais */
      .spt-total-row {
        display: flex; justify-content: space-between;
        padding: 4px 0; font-size: 13px;
      }
      .spt-total-row.spt-grand {
        font-size: 15px; font-weight: 700; color: #333;
        padding: 6px 0;
      }
      /* Pagamentos */
      .spt-section-title {
        font-size: 13px; font-weight: 700;
        color: #2196F3; margin: 0 0 6px 0;
        text-transform: uppercase;
      }
      .spt-payment-row {
        display: flex; justify-content: space-between;
        padding: 3px 0; font-size: 13px;
      }
      /* Saldo restante */
      .spt-saldo-box {
        background: #FFF3E0; border: 1px solid #FF9800;
        border-radius: 6px; padding: 10px 14px;
        display: flex; justify-content: space-between;
        align-items: center; margin-top: 8px;
      }
      .spt-saldo-box.spt-pago {
        background: #E8F5E9; border-color: #4CAF50;
      }
      .spt-saldo-label {
        font-weight: 700; font-size: 14px; color: #E65100;
      }
      .spt-saldo-box.spt-pago .spt-saldo-label { color: #2E7D32; }
      .spt-saldo-valor {
        font-weight: 700; font-size: 18px; color: #E65100;
      }
      .spt-saldo-box.spt-pago .spt-saldo-valor { color: #2E7D32; }
      /* Footer */
      #spt-modal-footer {
        padding: 12px 20px;
        border-top: 1px solid #eee;
        display: flex; gap: 10px; justify-content: flex-end;
      }
      #spt-modal-footer button {
        padding: 8px 20px; border-radius: 4px;
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
      /* Sem itens */
      .spt-empty { color: #999; font-style: italic; text-align: center; padding: 12px 0; }
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
        console.log('[SaiposTools] Âncora encontrada:', sel);
        return el;
      }
    }
    return null;
  }

  // Injeta botão "Resumo" na tela de pagamento
  function injectPrintButton() {
    if (document.getElementById('spt-resumo-btn')) return false;

    const anchor = findAnchorElement();
    if (!anchor) return false;

    const parentContainer = anchor.closest('.row') || anchor.closest('.col-md-12') || anchor.parentElement;
    if (!parentContainer) return false;

    const btnRow = document.createElement('div');
    btnRow.className = 'row p-t-5';
    btnRow.id = 'spt-resumo-row';

    const btnCol = document.createElement('div');
    btnCol.className = 'col-md-12 p-0';

    const btn = document.createElement('button');
    btn.id = 'spt-resumo-btn';
    btn.className = 'btn btn-info btn-lg waves-effect';
    btn.innerHTML = '<i class="zmdi zmdi-assignment"></i> Resumo da Conta';
    btn.addEventListener('click', handleShowResumo);

    btnCol.appendChild(btn);
    btnRow.appendChild(btnCol);

    parentContainer.parentNode.insertBefore(btnRow, parentContainer.nextSibling);
    console.log('[SaiposTools] Botão Resumo da Conta injetado');
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

    // Tabela de itens
    if (data.items && data.items.length > 0) {
      html += '<table class="spt-items-table">';
      html += '<thead><tr><th>Item</th><th>Qtd</th><th>Valor</th></tr></thead>';
      html += '<tbody>';
      data.items.forEach(item => {
        const qtdStr = item.qtd % 1 === 0 ? String(item.qtd) : item.qtd.toFixed(2);
        html += '<tr>';
        html += '<td>' + item.nome + '</td>';
        html += '<td>' + qtdStr + '</td>';
        html += '<td>R$ ' + formatBRL(item.valor) + '</td>';
        html += '</tr>';
      });
      html += '</tbody></table>';
    } else {
      html += '<div class="spt-empty">Nenhum item encontrado</div>';
    }

    // Separador
    html += '<hr class="spt-sep">';

    // Totais
    if (data.totalItens > 0) {
      html += '<div class="spt-total-row"><span>Subtotal itens</span><span>R$ ' + formatBRL(data.totalItens) + '</span></div>';
    }
    if (data.taxaServico > 0) {
      let taxaLabel = 'Taxa de serviço';
      if (data.pctServico) {
        const pctMatch = data.pctServico.match(/([\d,]+)\s*%/);
        if (pctMatch) taxaLabel += ' (' + pctMatch[1] + '%)';
      }
      html += '<div class="spt-total-row"><span>' + taxaLabel + '</span><span>R$ ' + formatBRL(data.taxaServico) + '</span></div>';
    }
    html += '<div class="spt-total-row spt-grand"><span>TOTAL DA CONTA</span><span>R$ ' + formatBRL(data.totalGeral) + '</span></div>';

    // Pagamentos realizados
    let totalPago = 0;
    if (data.payments && data.payments.length > 0) {
      html += '<hr class="spt-sep">';
      html += '<div class="spt-section-title">Pagamentos Realizados</div>';
      data.payments.forEach(p => {
        html += '<div class="spt-payment-row"><span>' + p.forma + '</span><span>R$ ' + formatBRL(p.valor) + '</span></div>';
        totalPago += p.valor;
      });
      html += '<hr class="spt-sep">';
      html += '<div class="spt-total-row"><span>Total pago</span><span>R$ ' + formatBRL(totalPago) + '</span></div>';
    }

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

    console.log('[SaiposTools] Modal de resumo exibido');
  }

  // Coleta dados do DOM e abre modal
  async function handleShowResumo() {
    const btn = document.getElementById('spt-resumo-btn');
    if (btn) {
      btn.disabled = true;
      btn.innerHTML = '<i class="zmdi zmdi-spinner zmdi-hc-spin"></i> Carregando...';
    }

    const mesaInfo = readMesaInfo();
    const totais = readTotaisFromDOM();
    const idUser = await getIdUserFromToken();
    const storeId = getStoreIdFromUrl();
    const saleId = getSaleIdFromUrl();

    // Busca dados originais do Angular scope (itens + pagamentos)
    const saleData = await fetchOriginalSaleItems();

    // Itens originais do scope, ou fallback DOM
    let items = parseScopeItems(saleData);
    if (!items || items.length === 0) {
      items = readItemsFromCloseScreen();
      console.log('[SaiposTools] Usando itens do DOM (fallback)');
    }

    // Pagamentos do scope, ou fallback via modal do SAIPOS
    let payments = parseScopePayments(saleData);
    if (!payments || payments.length === 0) {
      payments = await readPaymentsMadeFromDOM();
    } else {
      console.log('[SaiposTools] Usando pagamentos do scope:', payments.length);
    }

    // Calcula total pago
    const totalPago = payments.reduce((sum, p) => sum + p.valor, 0);

    // Restaura valores originais (desfaz fracionamento proporcional)
    const restored = restoreOriginalValues(items, totais.totalGeral, totalPago);
    items = restored.items;
    const totalOriginal = restored.totalOriginal;

    const data = {
      saleId,
      mesa: (saleData && saleData.mesa) || mesaInfo.mesa,
      comanda: (saleData && saleData.comanda) || mesaInfo.comanda,
      garcom: (saleData && saleData.garcom) || mesaInfo.garcom,
      identificacao: (saleData && saleData.identificacao) || mesaInfo.identificacao,
      items,
      totalGeral: totalOriginal,
      totalItens: totalPago > 0 ? totalOriginal : totais.totalItens,
      taxaServico: totais.taxaServico,
      pctServico: totais.pctServico,
      payments,
      _idUser: idUser || 0
    };

    const storeInfo = storeId
      ? await fetchStoreInfo(storeId)
      : { idStore: '0', nome: getStoreNameFromDOM(), cnpj: '', endereco: '', cidade: '' };

    showResumoModal(data, storeInfo);

    if (btn) {
      btn.disabled = false;
      btn.innerHTML = '<i class="zmdi zmdi-assignment"></i> Resumo da Conta';
    }
  }

  // ================================================================
  // REMOÇÃO DE UI
  // ================================================================

  function removeUI() {
    if (!uiInjected) return;
    uiInjected = false;

    const row = document.getElementById('spt-resumo-row');
    if (row) row.remove();

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

  function handleRouteChange() {
    if (checkTimeout) clearTimeout(checkTimeout);

    if (isCloseScreen()) {
      checkTimeout = setTimeout(() => {
        if (!uiInjected && isCloseScreen()) {
          retryCount++;

          // Na 1ª tentativa, loga data-qa para diagnóstico
          if (retryCount === 1) {
            const allQa = [...document.querySelectorAll('[data-qa]')].map(el => el.getAttribute('data-qa'));
            console.log('[SaiposTools] data-qa disponíveis:', allQa);
          }

          const anchor = findAnchorElement();
          if (!anchor) {
            if (retryCount < MAX_RETRIES) {
              console.log(`[SaiposTools] Âncora não encontrada (tentativa ${retryCount}/${MAX_RETRIES})`);
              checkTimeout = setTimeout(() => handleRouteChange(), 500);
              return;
            }
            console.warn('[SaiposTools] Esgotou tentativas de encontrar âncora');
            return;
          }

          // Encontrou — injeta botão
          uiInjected = true;
          retryCount = 0;
          injectStyles();
          injectPrintButton();
        }
      }, 600);
    } else {
      retryCount = 0;
      removeUI();
    }
  }

  function init() {
    console.log('[SaiposTools] partial-payment.js v6.4.1 carregado');

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
        } else if (!isCloseScreen() && uiInjected) {
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
