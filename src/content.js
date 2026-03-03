// ================================================================
// SAIPOS TOOLS v3.16.0 - content.js
// Retry + auto-resume com checkpoint apos erro
// ================================================================

(() => {
  // Evita multiplas injecoes
  if (window.__saiposInitialized) {
    console.log('[Saipos] Script ja inicializado');
    return;
  }
  window.__saiposInitialized = true;
  console.log('[Saipos] Inicializando v3.16.0...');

  const EXT = window.__saiposExt = {
    running: false,
    paused:  false,
    stop:    false,
    sales:   [],
    log:     [],
    processedIds: new Set(),
    debug: true
  };

  // Utilitarios
  const sleep = ms => new Promise(r => setTimeout(r, ms));

  function waitFor(selector, timeout = 8000) {
    return new Promise((res, rej) => {
      const t = Date.now();
      (function check() {
        const el = document.querySelector(selector);
        if (el) return res(el);
        if (Date.now() - t > timeout) return rej(new Error('timeout: ' + selector));
        setTimeout(check, 150);
      })();
    });
  }

  function waitForVisible(selector, timeout = 8000) {
    return new Promise((res, rej) => {
      const t = Date.now();
      (function check() {
        const el = document.querySelector(selector);
        if (el && el.offsetParent !== null) return res(el);
        if (Date.now() - t > timeout) return rej(new Error('timeout visible: ' + selector));
        setTimeout(check, 150);
      })();
    });
  }

  function waitForGone(selector, timeout = 5000) {
    return new Promise(res => {
      const t = Date.now();
      (function check() {
        const el = document.querySelector(selector);
        if (!el || el.offsetParent === null) return res();
        if (Date.now() - t > timeout) return res();
        setTimeout(check, 150);
      })();
    });
  }

  function parseReal(text) {
    if (!text) return 0;
    return parseFloat(
      text.replace('R$', '').replace(/\s/g, '').replace(/\./g, '').replace(',', '.').trim()
    ) || 0;
  }

  function emit(type, data = {}) {
    try { chrome.runtime.sendMessage({ type, ...data }); } catch(_) {}
  }

  function log(msg, type = 'info') {
    const entry = { msg, type, time: new Date().toLocaleTimeString('pt-BR') };
    EXT.log.push(entry);
    console.log('[Saipos] ' + entry.time + ' ' + msg);
    emit('LOG', { entry });
  }

  function debug(msg) {
    if (EXT.debug) console.log('[Saipos DEBUG] ' + msg);
  }

  // Checkpoint para recuperação de erros
  function saveCheckpoint(pageNum, saleIdx, sales, processedIds) {
    const checkpoint = {
      pageNum,
      saleIdx,
      sales: sales.map(s => ({ ...s, verBtn: null })), // Remove referência DOM
      processedIds: [...processedIds],
      timestamp: Date.now(),
      url: location.href
    };
    try {
      localStorage.setItem('saipos_checkpoint', JSON.stringify(checkpoint));
      debug('Checkpoint salvo: pagina ' + pageNum + ', venda ' + saleIdx);
    } catch (e) {
      debug('Erro ao salvar checkpoint: ' + e.message);
    }
  }

  function loadCheckpoint() {
    try {
      const data = localStorage.getItem('saipos_checkpoint');
      if (!data) return null;
      const checkpoint = JSON.parse(data);
      // Checkpoint válido por 30 minutos
      if (Date.now() - checkpoint.timestamp > 30 * 60 * 1000) {
        clearCheckpoint();
        return null;
      }
      debug('Checkpoint encontrado: pagina ' + checkpoint.pageNum + ', venda ' + checkpoint.saleIdx);
      return checkpoint;
    } catch (e) {
      return null;
    }
  }

  function clearCheckpoint() {
    try {
      localStorage.removeItem('saipos_checkpoint');
      debug('Checkpoint limpo');
    } catch (e) {}
  }

  // Le dados da tabela de vendas
  function readSaleRows() {
    const rows = document.querySelectorAll('tr[ng-repeat*="sale in vm.sales"]');
    debug('readSaleRows: ' + rows.length + ' linhas');
    const sales = [];

    rows.forEach((row, idx) => {
      const tds = row.querySelectorAll('td');
      const td0 = tds[0];
      let mesa = '', comanda = '';
      
      if (td0) {
        const fullText = td0.textContent.trim();
        const mesaMatch = fullText.match(/Mesa:\s*(\d+)/i);
        const comandaMatch = fullText.match(/Comanda:\s*(\d+)/i);
        if (mesaMatch) mesa = mesaMatch[1];
        if (comandaMatch) comanda = comandaMatch[1];
      }

      const dateRaw = tds[1] ? tds[1].textContent.trim() : '';
      const dateText = dateRaw.replace(',', '');
      const pagamento = tds[3] ? tds[3].textContent.trim() : '';

      let totalItens = 0, taxa = 0, total = 0;
      if (tds.length >= 12) {
        totalItens = parseReal(tds[5]?.textContent);
        taxa = parseReal(tds[10]?.textContent);
        total = parseReal(tds[11]?.textContent);
      } else if (tds.length >= 7) {
        totalItens = parseReal(tds[4]?.textContent);
        taxa = parseReal(tds[5]?.textContent);
        total = parseReal(tds[6]?.textContent);
      }

      // Cancelado - verifica texto e classes especificos
      let canceled = false;
      const badges = row.querySelectorAll('.badge, .label, .status, span');
      for (const b of badges) {
        const txt = b.textContent.toLowerCase();
        if (txt.includes('cancelad') && txt.length < 20) {
          canceled = true;
          break;
        }
      }

      const hasItemCanceled = !!row.querySelector('del');

      // Botao Ver - dentro da linha
      let verBtn = row.querySelector('button[ng-click*="showSale"]');
      if (!verBtn) verBtn = row.querySelector('button.btn-primary');
      if (!verBtn) verBtn = row.querySelector('td:last-child button');

      const saleId = mesa + '-' + comanda + '-' + dateText + '-' + total;
      
      debug('Row ' + idx + ': M' + mesa + '/C' + comanda + ' canceled=' + canceled + ' verBtn=' + !!verBtn);

      sales.push({
        idx, mesa, comanda, dateText, pagamento, saleId,
        totalItens, taxa, total, canceled, hasItemCanceled, verBtn,
        items: []
      });
    });

    return sales;
  }

  // Extrai itens - RETORNA null se falhar (com retry interno)
  async function extractItems(sale, idx, total, attempt = 1) {
    const maxAttempts = 3;
    
    if (!sale.verBtn) {
      log('X [' + idx + '/' + total + '] M' + sale.mesa + '/C' + sale.comanda + ' - sem botao Ver - ABORTANDO', 'error');
      return null;
    }

    debug('Tentativa ' + attempt + '/' + maxAttempts + ' - Clicando Ver para M' + sale.mesa + '/C' + sale.comanda);
    sale.verBtn.scrollIntoView({ block: 'center' });
    await sleep(400);
    
    // Clique com dispatchEvent
    sale.verBtn.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
    await sleep(1200);

    // Aguarda modal
    let modal1 = document.querySelector('.modal.in, .modal.show, .modal[style*="display: block"], div[uib-modal-window]');
    if (!modal1) {
      await sleep(1500);
      modal1 = document.querySelector('.modal.in, .modal.show, .modal[style*="display: block"], div[uib-modal-window]');
    }

    if (!modal1) {
      const allModals = document.querySelectorAll('.modal, [class*="modal"]');
      debug('Modais encontrados: ' + allModals.length);
      allModals.forEach((m, i) => debug('Modal ' + i + ': ' + m.className + ' display=' + getComputedStyle(m).display));
      
      if (attempt < maxAttempts) {
        log('⚠️ [' + idx + '/' + total + '] M' + sale.mesa + '/C' + sale.comanda + ' - modal Ver nao abriu - tentativa ' + attempt + '/' + maxAttempts, 'warn');
        await closeModals();
        await sleep(1000);
        // Rebusca o botão
        const freshBtns = document.querySelectorAll('tr[ng-repeat*="sale in vm.sales"] button[ng-click*="showSale"], tr[ng-repeat*="sale in vm.sales"] button.btn-primary');
        const btnIdx = sale.idx;
        if (freshBtns[btnIdx]) sale.verBtn = freshBtns[btnIdx];
        return extractItems(sale, idx, total, attempt + 1);
      }
      log('X [' + idx + '/' + total + '] M' + sale.mesa + '/C' + sale.comanda + ' - modal Ver nao abriu apos ' + maxAttempts + ' tentativas', 'error');
      return null;
    }

    debug('Modal Ver aberto');
    await sleep(500);

    // Botao Detalhamento
    let detBtn = document.querySelector('button[ng-click*="openSaleDetails"]');
    if (!detBtn) {
      const icon = document.querySelector('i.zmdi-search-in-file, i[class*="search"]');
      detBtn = icon ? icon.closest('button') : null;
    }

    // Log botoes do modal
    if (!detBtn) {
      const allBtns = modal1.querySelectorAll('button');
      debug('Botoes no modal Ver: ' + allBtns.length);
      allBtns.forEach((b, i) => {
        const ngClick = b.getAttribute('ng-click') || '';
        debug('Btn ' + i + ': "' + b.textContent.trim().substring(0,30) + '" ng-click="' + ngClick + '"');
      });
    }

    if (!detBtn) {
      if (attempt < maxAttempts) {
        log('⚠️ [' + idx + '/' + total + '] M' + sale.mesa + '/C' + sale.comanda + ' - botao Detalhamento nao encontrado - tentativa ' + attempt + '/' + maxAttempts, 'warn');
        await closeModals();
        await sleep(1000);
        const freshBtns = document.querySelectorAll('tr[ng-repeat*="sale in vm.sales"] button[ng-click*="showSale"], tr[ng-repeat*="sale in vm.sales"] button.btn-primary');
        const btnIdx = sale.idx;
        if (freshBtns[btnIdx]) sale.verBtn = freshBtns[btnIdx];
        return extractItems(sale, idx, total, attempt + 1);
      }
      log('X [' + idx + '/' + total + '] M' + sale.mesa + '/C' + sale.comanda + ' - botao Detalhamento nao encontrado apos ' + maxAttempts + ' tentativas', 'error');
      await closeModals();
      return null;
    }

    debug('Clicando Detalhamento');
    detBtn.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
    await sleep(1800);

    // Modal detalhamento
    let detModal = document.querySelector('div.modal-sale-detailed, .sale-detailed, .sale-details');
    if (!detModal) {
      await sleep(1000);
      detModal = document.querySelector('div.modal-sale-detailed, .sale-detailed, .sale-details');
    }
    if (!detModal) {
      // Tenta achar tabela de itens em qualquer modal
      const tbl = document.querySelector('.modal tr[ng-repeat*="saleItems"], .modal tr[ng-repeat*="item"]');
      if (tbl) detModal = tbl.closest('.modal') || tbl.closest('div');
    }

    if (!detModal) {
      if (attempt < maxAttempts) {
        log('⚠️ [' + idx + '/' + total + '] M' + sale.mesa + '/C' + sale.comanda + ' - modal Detalhamento nao abriu - tentativa ' + attempt + '/' + maxAttempts, 'warn');
        await closeModals();
        await sleep(1000);
        const freshBtns = document.querySelectorAll('tr[ng-repeat*="sale in vm.sales"] button[ng-click*="showSale"], tr[ng-repeat*="sale in vm.sales"] button.btn-primary');
        const btnIdx = sale.idx;
        if (freshBtns[btnIdx]) sale.verBtn = freshBtns[btnIdx];
        return extractItems(sale, idx, total, attempt + 1);
      }
      log('X [' + idx + '/' + total + '] M' + sale.mesa + '/C' + sale.comanda + ' - modal Detalhamento nao abriu apos ' + maxAttempts + ' tentativas', 'error');
      await closeModals();
      return null;
    }

    debug('Modal Detalhamento aberto');
    await sleep(500);

    // Extrai itens
    let itemRows = detModal.querySelectorAll('tr[ng-repeat*="saleItems"], tr[ng-repeat*="item in"]');
    if (itemRows.length === 0) itemRows = detModal.querySelectorAll('tbody tr');
    
    debug('Linhas de itens: ' + itemRows.length);

    const items = [];
    itemRows.forEach((tr, i) => {
      const tds = tr.querySelectorAll('td');
      if (tds.length < 3) return;

      const nome = tds[0]?.textContent.trim() || '';
      const qtd = parseInt(tds[1]?.textContent.trim()) || 1;
      const garcom = tds[2]?.textContent.trim() || '';
      const valor = parseReal(tds[3]?.textContent || '0');
      const deletadoPor = tds[6]?.textContent.trim() || '';
      const itemCancelado = deletadoPor !== '';

      if (nome && !nome.toLowerCase().includes('total')) {
        debug('Item: ' + nome + ' x' + qtd + ' ' + garcom + ' R$' + valor);
        items.push({ nome, qtd, garcom, valor, itemCancelado, deletadoPor });
      }
    });

    if (items.length === 0) {
      if (attempt < maxAttempts) {
        log('⚠️ [' + idx + '/' + total + '] M' + sale.mesa + '/C' + sale.comanda + ' - nenhum item encontrado - tentativa ' + attempt + '/' + maxAttempts, 'warn');
        await closeModals();
        await sleep(1000);
        const freshBtns = document.querySelectorAll('tr[ng-repeat*="sale in vm.sales"] button[ng-click*="showSale"], tr[ng-repeat*="sale in vm.sales"] button.btn-primary');
        const btnIdx = sale.idx;
        if (freshBtns[btnIdx]) sale.verBtn = freshBtns[btnIdx];
        return extractItems(sale, idx, total, attempt + 1);
      }
      log('X [' + idx + '/' + total + '] M' + sale.mesa + '/C' + sale.comanda + ' - nenhum item encontrado apos ' + maxAttempts + ' tentativas', 'error');
      await closeModals();
      return null;
    }

    log('OK [' + idx + '/' + total + '] M' + sale.mesa + '/C' + sale.comanda + ' - ' + items.length + ' itens');
    await closeModals();
    await sleep(400);
    return items;
  }

  // Fecha modais
  async function closeModals() {
    debug('Fechando modais...');
    const closeSelectors = [
      '.modal button[ng-click*="close"]',
      '.modal button.btn-link',
      '.modal .close',
      'button.close'
    ];

    for (const sel of closeSelectors) {
      const btns = document.querySelectorAll(sel);
      for (const btn of btns) {
        if (btn.offsetParent) {
          btn.click();
          await sleep(400);
        }
      }
    }

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', keyCode: 27, bubbles: true }));
    await sleep(300);
    
    const backdrop = document.querySelector('.modal-backdrop');
    if (backdrop) backdrop.click();
    
    await waitForGone('.modal.in, .modal.show', 3000);
  }

  // Paginacao
  function getPaginationInfo() {
    const pagination = document.querySelector('ul.pagination, .pagination');
    if (!pagination) return { hasPages: false, currentPage: 1, totalPages: 1, nextBtn: null };

    const activeItem = pagination.querySelector('li.active a, li.active span');
    const currentPage = activeItem ? parseInt(activeItem.textContent) || 1 : 1;

    // Busca o botão de próxima página pelo ícone zmdi-chevron-right
    let nextBtn = pagination.querySelector('a[ng-click*="currentPage + 1"]');
    if (!nextBtn) {
      // Fallback: busca pelo ícone chevron-right
      const chevronIcon = pagination.querySelector('i.zmdi-chevron-right');
      nextBtn = chevronIcon ? chevronIcon.closest('a') : null;
    }
    if (!nextBtn) {
      // Fallback 2: segundo li do final (o último é "ir para última página")
      const allLis = pagination.querySelectorAll('li');
      if (allLis.length >= 2) {
        const secondToLast = allLis[allLis.length - 2];
        nextBtn = secondToLast.querySelector('a');
      }
    }
    
    const nextParent = nextBtn?.closest('li');
    const isNextDisabled = nextParent?.classList.contains('disabled');

    const allPageNums = [...pagination.querySelectorAll('li a, li span')]
      .map(el => parseInt(el.textContent))
      .filter(n => !isNaN(n) && n > 0);
    const totalPages = allPageNums.length > 0 ? Math.max(...allPageNums) : 1;

    return { hasPages: totalPages > 1, currentPage, totalPages, nextBtn: isNextDisabled ? null : nextBtn };
  }

  async function goToNextPage() {
    const { nextBtn, currentPage, totalPages } = getPaginationInfo();
    if (!nextBtn) {
      log('Pagina ' + currentPage + '/' + totalPages + ' - ultima pagina');
      return false;
    }

    log('Avancando para pagina ' + (currentPage + 1) + '/' + totalPages + '...');
    nextBtn.scrollIntoView({ block: 'center' });
    await sleep(200);
    nextBtn.click();
    await sleep(2000);

    try {
      await waitFor('tr[ng-repeat*="sale in vm.sales"]', 10000);
      await sleep(500);
      return true;
    } catch {
      return false;
    }
  }

  // Processa uma pagina
  async function processCurrentPage(pageNum, globalIdx, startIdx = 0) {
    const pageSales = readSaleRows();
    let processed = 0, skipped = 0;

    for (let i = startIdx; i < pageSales.length; i++) {
      while (EXT.paused && !EXT.stop) await sleep(400);
      if (EXT.stop) return { processed, skipped, stopped: true, error: false };

      const sale = pageSales[i];
      if (EXT.processedIds.has(sale.saleId)) { skipped++; continue; }
      EXT.processedIds.add(sale.saleId);

      const idx = globalIdx + processed + 1;
      const totalEstimate = EXT.sales.length + pageSales.length - skipped;

      emit('PROGRESS', { current: idx, total: totalEstimate, msg: 'P' + pageNum + ' M' + sale.mesa + '/C' + sale.comanda });

      if (sale.canceled) {
        log('[P' + pageNum + '] M' + sale.mesa + '/C' + sale.comanda + ' - CANCELADO (pulando)');
        EXT.sales.push(sale);
        processed++;
        continue;
      }

      if (sale.totalItens === 0 && !sale.hasItemCanceled) {
        log('[P' + pageNum + '] M' + sale.mesa + '/C' + sale.comanda + ' - sem valor');
        EXT.sales.push(sale);
        processed++;
        continue;
      }

      log('[P' + pageNum + '] M' + sale.mesa + '/C' + sale.comanda + ' - ' + sale.dateText.substring(11,19) + ' - R$ ' + sale.totalItens.toFixed(2));

      // Rebusca botao
      const freshBtns = document.querySelectorAll('tr[ng-repeat*="sale in vm.sales"] button[ng-click*="showSale"], tr[ng-repeat*="sale in vm.sales"] button.btn-primary');
      if (freshBtns[i]) sale.verBtn = freshBtns[i];

      const items = await extractItems(sale, idx, totalEstimate);
      
      if (items === null) {
        log('⚠️ Falha ao extrair M' + sale.mesa + '/C' + sale.comanda + ' - salvando checkpoint e recarregando...', 'warn');
        
        // Salva checkpoint para retomar depois
        saveCheckpoint(pageNum, i, EXT.sales, EXT.processedIds);
        
        // Fecha modais e recarrega
        await closeModals();
        await sleep(500);
        
        log('🔄 Recarregando página para retomar extração...', 'info');
        location.reload();
        return { processed, skipped, stopped: true, error: true, willRetry: true };
      }

      sale.items = items;
      EXT.sales.push(sale);
      processed++;
      await sleep(600);
    }

    return { processed, skipped, stopped: false, error: false };
  }

  // Loop principal
  async function runExtraction(fromCheckpoint = false) {
    if (EXT.running) { log('Ja rodando'); return; }

    EXT.running = true;
    EXT.stop = false;
    EXT.paused = false;
    
    // Verifica se tem checkpoint para retomar
    const checkpoint = loadCheckpoint();
    let startPage = 1;
    let startSaleIdx = 0;
    
    if (checkpoint && fromCheckpoint) {
      EXT.sales = checkpoint.sales || [];
      EXT.processedIds = new Set(checkpoint.processedIds || []);
      startPage = checkpoint.pageNum || 1;
      startSaleIdx = checkpoint.saleIdx || 0;
      log('🔄 Retomando extração: página ' + startPage + ', venda ' + startSaleIdx);
      clearCheckpoint();
    } else {
      EXT.sales = [];
      EXT.processedIds = new Set();
      clearCheckpoint();
    }
    
    EXT.log = [];

    log('Iniciando varredura...');
    emit('STATUS', { status: 'running' });

    try {
      await waitFor('tr[ng-repeat*="sale in vm.sales"]', 12000);
    } catch {
      log('Nenhuma venda encontrada. Aplique o filtro.', 'error');
      emit('STATUS', { status: 'error', msg: 'Nenhuma venda encontrada.' });
      EXT.running = false;
      return;
    }

    const paginationInfo = getPaginationInfo();
    if (paginationInfo.hasPages) {
      log('Detectada paginacao: ' + paginationInfo.totalPages + ' paginas');
    }

    const initialCount = readSaleRows().length;
    if (startPage === 1) {
      log('Pagina 1: ' + initialCount + ' vendas encontradas');
    }
    emit('TOTAL', { total: initialCount * paginationInfo.totalPages });

    if (initialCount === 0) {
      emit('STATUS', { status: 'error', msg: 'Nenhuma venda.' });
      EXT.running = false;
      return;
    }

    // Se retomando de checkpoint, navega até a página correta
    let pageNum = 1, globalIdx = EXT.sales.length, hasMorePages = true;
    
    if (startPage > 1) {
      log('Navegando até página ' + startPage + '...');
      for (let p = 1; p < startPage; p++) {
        if (!await goToNextPage()) {
          log('Erro ao navegar para página ' + (p+1), 'error');
          emit('STATUS', { status: 'error', msg: 'Erro ao navegar páginas' });
          EXT.running = false;
          return;
        }
        pageNum++;
      }
      log('Retomando da página ' + pageNum);
    }

    while (hasMorePages && !EXT.stop) {
      const result = await processCurrentPage(pageNum, globalIdx, pageNum === startPage ? startSaleIdx : 0);
      globalIdx += result.processed;

      if (result.willRetry) {
        // A página vai recarregar, não faz mais nada
        return;
      }

      if (result.error) {
        emit('STATUS', { status: 'error', msg: 'Erro ao extrair. Abortado.' });
        EXT.running = false;
        return;
      }

      if (result.stopped) break;

      if (await goToNextPage()) {
        pageNum++;
        startSaleIdx = 0; // Reset para próximas páginas
      } else {
        hasMorePages = false;
      }
    }

    EXT.running = false;
    clearCheckpoint(); // Limpa checkpoint quando termina com sucesso
    const ok = EXT.sales.filter(s => !s.canceled && s.items && s.items.length > 0).length;
    log('Concluido! ' + EXT.sales.length + ' vendas (' + ok + ' com itens)');
    emit('DONE', { sales: EXT.sales });
  }

  // Auto-resume: verifica se há checkpoint ao carregar
  function checkAutoResume() {
    const checkpoint = loadCheckpoint();
    if (checkpoint) {
      console.log('[Saipos] Checkpoint encontrado - aguardando 3s para auto-retomar...');
      setTimeout(async () => {
        // Verifica se ainda tem checkpoint (pode ter sido limpo)
        const stillHasCheckpoint = loadCheckpoint();
        if (stillHasCheckpoint && !EXT.running) {
          console.log('[Saipos] Auto-retomando extração...');
          emit('LOG', { entry: { msg: '🔄 Auto-retomando extração após erro...', type: 'info', time: new Date().toLocaleTimeString('pt-BR') }});
          emit('STATUS', { status: 'running' });
          runExtraction(true);
        }
      }, 3000);
    }
  }

  // Listener
  chrome.runtime.onMessage.addListener((msg, _, sendResponse) => {
    if (msg.action === 'START') {
      if (!EXT.running) { runExtraction(false); sendResponse({ ok: true }); }
      else { sendResponse({ ok: false, msg: 'Ja rodando' }); }
    }
    if (msg.action === 'RESUME') {
      if (!EXT.running) { runExtraction(true); sendResponse({ ok: true }); }
      else { sendResponse({ ok: false, msg: 'Ja rodando' }); }
    }
    if (msg.action === 'PAUSE') { EXT.paused = !EXT.paused; sendResponse({ paused: EXT.paused }); }
    if (msg.action === 'STOP') { EXT.stop = true; EXT.running = false; clearCheckpoint(); sendResponse({ ok: true }); }
    if (msg.action === 'GET') { sendResponse({ sales: EXT.sales, running: EXT.running, hasCheckpoint: !!loadCheckpoint() }); }
    return true;
  });

  // Inicia verificação de auto-resume após página carregar
  if (document.readyState === 'complete') {
    checkAutoResume();
  } else {
    window.addEventListener('load', checkAutoResume);
  }

  console.log('[Saipos] Content script pronto');
})();
