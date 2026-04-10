// ================================================================
// SAIPOS TOOLS v4.8.0 — content.js (ISOLATED world, document_idle)
// Extrai dados via API REST direta com auth headers interceptados
// ================================================================
(() => {
  if (window.__saiposInitialized) {
    console.log('[Saipos] Script já inicializado');
    return;
  }
  window.__saiposInitialized = true;
  console.log('[Saipos] Inicializando v4.8.0 (API mode)...');

  // ── Estado ──────────────────────────────────────────────────
  const EXT = window.__saiposExt = {
    running: false,
    paused:  false,
    stop:    false,
    sales:   [],
    log:     [],
    debug:   true
  };

  // API state
  let _authHeaders = null;
  let _capturedCalls = [];
  let _salesListUrl = null;
  let _saleDetailUrlPattern = null;

  // ── Helpers ─────────────────────────────────────────────────
  const sleep = ms => new Promise(r => setTimeout(r, ms));

  function emit(type, data = {}) {
    try { chrome.runtime.sendMessage({ type, ...data }); } catch (_) {}
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

  // ── Auth Headers ────────────────────────────────────────────
  function getAuthHeaders() {
    return new Promise(resolve => {
      if (_authHeaders && Object.keys(_authHeaders).length > 0) {
        return resolve(_authHeaders);
      }
      const timeout = setTimeout(() => {
        window.removeEventListener('__saipos_auth', handler);
        resolve(null);
      }, 3000);
      function handler(e) {
        clearTimeout(timeout);
        window.removeEventListener('__saipos_auth', handler);
        _authHeaders = (e.detail && e.detail.headers) ? { ...e.detail.headers } : null;
        resolve(_authHeaders);
      }
      window.addEventListener('__saipos_auth', handler);
      window.dispatchEvent(new CustomEvent('__saipos_get_auth'));
    });
  }

  // Atualiza auth passivamente
  window.addEventListener('__saipos_auth', e => {
    if (e.detail && e.detail.headers) {
      _authHeaders = { ...e.detail.headers };
    }
  });

  // ── API Call Discovery ──────────────────────────────────────
  window.addEventListener('__saipos_api_call', e => {
    if (!e.detail) return;
    _capturedCalls.push(e.detail);
  });

  function getCapturedCalls() {
    return new Promise(resolve => {
      const timeout = setTimeout(() => {
        window.removeEventListener('__saipos_calls_list', handler);
        resolve(_capturedCalls);
      }, 2000);
      function handler(e) {
        clearTimeout(timeout);
        window.removeEventListener('__saipos_calls_list', handler);
        const list = Array.isArray(e.detail) ? e.detail : [];
        // Use indexed list as primary source (has index for cached response retrieval)
        if (list.length > 0) {
          // Merge any extra real-time calls not yet in the indexed list
          const indexedUrls = new Set(list.map(c => c.url));
          for (const c of _capturedCalls) {
            if (!indexedUrls.has(c.url)) list.push(c);
          }
          _capturedCalls = list;
        }
        resolve(_capturedCalls);
      }
      window.addEventListener('__saipos_calls_list', handler);
      window.dispatchEvent(new CustomEvent('__saipos_get_calls'));
    });
  }

  // ── Get Cached Response from interceptor ────────────────────
  function getCachedResponse(index) {
    return new Promise(resolve => {
      const timeout = setTimeout(() => {
        window.removeEventListener('__saipos_call_response', handler);
        debug('getCachedResponse timeout for index=' + index);
        resolve(null);
      }, 5000);
      function handler(e) {
        clearTimeout(timeout);
        window.removeEventListener('__saipos_call_response', handler);
        if (!e.detail) { resolve(null); return; }
        try {
          const resp = typeof e.detail === 'string' ? JSON.parse(e.detail) : e.detail;
          if (resp.error) {
            debug('getCachedResponse error: ' + resp.error);
            resolve(null);
            return;
          }
          debug('getCachedResponse OK: dataType=' + typeof resp.data + ' keys=' + (resp.data && typeof resp.data === 'object' ? Object.keys(resp.data).join(',') : '-'));
          resolve(resp.data);
        } catch (err) {
          debug('getCachedResponse parse error: ' + err.message);
          resolve(null);
        }
      }
      window.addEventListener('__saipos_call_response', handler);
      window.dispatchEvent(new CustomEvent('__saipos_get_call_response', {
        detail: { index: index }
      }));
    });
  }

  // ── Endpoint Discovery ──────────────────────────────────────
  function discoverEndpoints(calls) {
    debug('Analisando ' + calls.length + ' chamadas capturadas...');
    let bestSalesList = null;
    let bestDetailUrl = null;

    // Percorre do MAIS RECENTE para o mais antigo — prioriza o último filtro aplicado pelo usuário
    for (let i = calls.length - 1; i >= 0; i--) {
      const call = calls[i];
      if (!call.url) continue;
      const url = call.url;
      const urlLow = url.toLowerCase();
      const isSalesRelated = /\/(sale|sales|venda|vendas|report|relatorio|order|by-period)/.test(urlLow);
      if (!isSalesRelated) continue;

      // URL com ID numérico é DETALHE, não listagem
      const isDetailUrl = /\/(sale|sales|venda|vendas|order)\/\d+/i.test(url);

      const summary = call.responseSummary;

      // Listagem: resposta é array ou objeto com array — exclui URLs de detalhe
      if (!bestSalesList && !isDetailUrl && (call.method === 'GET' || call.method === 'POST')) {
        if (summary) {
          if (summary._t === 'array' && summary._len > 0) {
            bestSalesList = { ...call, _dataKey: null, _arrLen: summary._len };
            debug('Listagem (array, mais recente): ' + url.substring(0, 200) + ' (' + summary._len + ' itens)');
          } else if (summary._t === 'object' && summary._arrays) {
            for (const [key, arr] of Object.entries(summary._arrays)) {
              if (arr && arr._len > 0) {
                bestSalesList = { ...call, _dataKey: key, _arrLen: arr._len };
                debug('Listagem (object.' + key + ', mais recente): ' + url.substring(0, 200) + ' (' + arr._len + ' itens)');
                break;
              }
            }
          }
        }
      }

      if (!bestSalesList && !isDetailUrl && /\/sales-by-period/i.test(url) && !url.includes('.html')) {
        bestSalesList = { ...call, _dataKey: null, _arrLen: 0 };
        debug('Listagem (fallback, provável 0 itens): ' + url.substring(0, 200));
      }

      // Detalhe: URL com ID numérico
      if (!bestDetailUrl && isDetailUrl) {
        bestDetailUrl = url.replace(/(\/(sale|sales|venda|vendas|order))\/\d+/i, '$1/{id}');
        debug('Endpoint de detalhe: ' + bestDetailUrl);
      }

      if (bestSalesList && bestDetailUrl) break;
    }

    // Extrai período de datas da URL para exibição
    let dateRange = null;
    if (bestSalesList && bestSalesList.url) {
      try {
        const filterMatch = bestSalesList.url.match(/filter=([^&]+)/i);
        if (filterMatch) {
          const filterObj = JSON.parse(decodeURIComponent(filterMatch[1]));
          if (filterObj.start_date && filterObj.end_date) {
            dateRange = { start: filterObj.start_date, end: filterObj.end_date };
            debug('Filtro de datas: ' + dateRange.start + ' até ' + dateRange.end);
          }
        }
      } catch(_) {}
    }

    return { salesList: bestSalesList, detailPattern: bestDetailUrl, dateRange };
  }

  // ── Proxy Fetch via MAIN world ──────────────────────────────
  // Requisições passam pelo interceptor (MAIN) que compartilha
  // cookies e origin com o SPA — evita 401 do ISOLATED world
  let _fetchId = 0;

  function _apiFetchOnce(url, method) {
    const id = String(++_fetchId);
    return new Promise((resolve, reject) => {
      const evtName = '__saipos_fetch_resp_' + id;
      const timeout = setTimeout(() => {
        window.removeEventListener(evtName, handler);
        reject(new Error('Proxy fetch timeout (30s)'));
      }, 30000);
      function handler(e) {
        clearTimeout(timeout);
        window.removeEventListener(evtName, handler);
        if (!e.detail) return reject(new Error('Resposta vazia do proxy'));
        var resp;
        try {
          resp = typeof e.detail === 'string' ? JSON.parse(e.detail) : e.detail;
        } catch (parseErr) {
          return reject(new Error('Proxy parse error: ' + parseErr.message));
        }
        debug('Proxy resp: type=' + typeof e.detail + ' keys=' + (resp ? Object.keys(resp).join(',') : 'null') + ' dataType=' + (resp && resp.data ? typeof resp.data : 'none') + ' dataKeys=' + (resp && resp.data && typeof resp.data === 'object' ? Object.keys(resp.data).join(',') : '-'));
        if (resp.error) {
          if (resp.status === 401 || resp.status === 403) {
            _authHeaders = null;
          }
          return reject(new Error(resp.error));
        }
        resolve(resp.data);
      }
      window.addEventListener(evtName, handler);
      window.dispatchEvent(new CustomEvent('__saipos_fetch_request', {
        detail: { id: id, url: url, method: method || 'GET' }
      }));
    });
  }

  async function apiFetch(url, method, maxRetries) {
    const retries = maxRetries !== undefined ? maxRetries : 2;
    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        return await _apiFetchOnce(url, method);
      } catch (e) {
        const is401 = e.message && (e.message.includes('401') || e.message.includes('403'));
        if (is401 && attempt < retries) {
          debug('Retry ' + (attempt + 1) + '/' + retries + ' após ' + e.message + ', aguardando 2s...');
          await sleep(2000);
          continue;
        }
        throw e;
      }
    }
  }

  // ── Parallel Fetch (Sliding Window) ─────────────────────────
  async function runWithConcurrency(items, limit, fn) {
    const results = new Array(items.length);
    let idx = 0;
    async function worker() {
      while (true) {
        const i = idx;
        if (i >= items.length) break;
        idx = i + 1;
        while (EXT.paused && !EXT.stop) await sleep(200);
        if (EXT.stop) break;
        try { results[i] = await fn(items[i], i); }
        catch (e) { results[i] = { _error: e.message }; }
      }
    }
    const workers = [];
    for (let w = 0; w < Math.min(limit, items.length); w++) workers.push(worker());
    await Promise.all(workers);
    return results;
  }

  // ── Field Mapping ───────────────────────────────────────────
  const SALE_ALIASES = {
    id:       ['id_sale', 'id', '_id', 'sale_id', 'saleId', 'codigo', 'code', 'numero', 'number_sale', 'sale_number'],
    mesa:     ['mesa', 'table_number', 'tableNumber', 'numero_mesa', 'num_mesa', 'desc_table', 'number_table'],
    comanda:  ['comanda', 'order_number', 'orderNumber', 'numero_comanda', 'command', 'num_comanda', 'number_order_card', 'order_card'],
    date:     ['data', 'date', 'created_at', 'createdAt', 'data_venda', 'datetime', 'dateTime', 'data_criacao'],
    payment:  ['forma_pagamento', 'payment_method', 'paymentMethod', 'pagamento', 'payment', 'tipo_pagamento', 'desc_payment_type', 'payment_type', 'desc_partner_sale'],
    subtotal: ['total_amount_items', 'total_itens', 'totalItens', 'subtotal', 'items_total', 'itemsTotal', 'products_total', 'valor_produtos', 'valor_itens', 'total_items_value'],
    taxa:     ['total_increase', 'taxa_servico', 'service_fee', 'serviceFee', 'taxa', 'tax', 'service_tax', 'taxa_de_servico', 'service_charge', 'service_charge_value', 'total_service_fee'],
    total:    ['total_value', 'totalValue', 'valor_total', 'grand_total', 'total_sale', 'amount', 'total_amount'],
    canceled: ['cancelado', 'canceled', 'cancelled', 'is_canceled', 'isCanceled', 'is_cancelled', 'is_deleted', 'deleted_at'],
    status:   ['status', 'estado', 'situacao', 'desc_sale_status', 'id_sale_status', 'sale_status'],
    items:    ['itens', 'items', 'produtos', 'products', 'sale_items', 'saleItems', 'detalhes', 'sale_items_data']
  };

  const ITEM_ALIASES = {
    nome:       ['desc_sale_item', 'nome', 'name', 'product_name', 'productName', 'descricao', 'description', 'produto', 'desc_item', 'desc_product', 'item_name', 'product', 'desc', 'title', 'label', 'item_description', 'product_description'],
    qtd:        ['quantidade', 'quantity', 'qtd', 'qty', 'quant'],
    garcom:     ['garcom', 'waiter', 'waiter_name', 'waiterName', 'atendente', 'attendant', 'funcionario', 'employee', 'desc_waiter', 'waiter_desc'],
    valor:      ['valor', 'price', 'preco', 'unit_price', 'unitPrice', 'valor_unitario', 'item_value', 'total_item', 'value', 'item_price'],
    cancelado:  ['cancelado', 'canceled', 'cancelled', 'is_canceled', 'isCanceled', 'item_cancelado', 'is_deleted'],
    deletadoPor:['deletado_por', 'deleted_by', 'deletedBy', 'cancelado_por', 'canceledBy', 'deleted_by_user']
  };

  function buildFieldMap(sampleObj, aliases) {
    const map = {};
    const keys = Object.keys(sampleObj);
    for (const [field, possibleNames] of Object.entries(aliases)) {
      for (const name of possibleNames) {
        const found = keys.find(k => k.toLowerCase() === name.toLowerCase());
        if (found) { map[field] = found; break; }
      }
    }
    return map;
  }

  function getField(obj, map, field, defaultVal) {
    const key = map[field];
    if (!key) return defaultVal;
    const val = obj[key];
    return val !== undefined && val !== null ? val : defaultVal;
  }

  function formatDate(raw) {
    if (!raw) return '';
    if (typeof raw === 'string' && (raw.includes('T') || (raw.includes('-') && raw.length > 10))) {
      const d = new Date(raw);
      if (!isNaN(d)) return d.toLocaleString('pt-BR');
    }
    if (typeof raw === 'number') return new Date(raw).toLocaleString('pt-BR');
    return String(raw);
  }

  // ── Map API → estrutura esperada ────────────────────────────
  function unwrapField(val) {
    if (val === null || val === undefined) return '';
    if (typeof val !== 'object') return String(val);
    // Extract first string/number from sub-object
    for (const v of Object.values(val)) {
      if (typeof v === 'string' && v.length > 0) return v;
      if (typeof v === 'number') return String(v);
    }
    return '';
  }

  function mapSale(raw, idx, saleMap) {
    const id = getField(raw, saleMap, 'id', '');
    const mesa = unwrapField(getField(raw, saleMap, 'mesa', ''));
    const comanda = unwrapField(getField(raw, saleMap, 'comanda', ''));
    const dateText = formatDate(getField(raw, saleMap, 'date', ''));
    const pagamento = String(getField(raw, saleMap, 'payment', ''));
    const totalItens = Number(getField(raw, saleMap, 'subtotal', 0));
    const taxa = Number(getField(raw, saleMap, 'taxa', 0));
    const total = Number(getField(raw, saleMap, 'total', 0));

    let canceled = false;
    const canceledField = getField(raw, saleMap, 'canceled', null);
    if (canceledField !== null) {
      canceled = Boolean(canceledField);
    }
    if (!canceled) {
      let statusVal = getField(raw, saleMap, 'status', '');
      // sale_status pode ser um sub-objeto { id_sale_status: N, desc_sale_status: "..." }
      if (statusVal && typeof statusVal === 'object') {
        const desc = statusVal.desc_sale_status || statusVal.desc || statusVal.description || statusVal.name || '';
        const idSt = statusVal.id_sale_status ?? statusVal.id ?? null;
        canceled = String(desc).toLowerCase().includes('cancel') || idSt === 3;
      } else {
        canceled = String(statusVal).toLowerCase().includes('cancel');
      }
    }
    // Verifica também id_sale_status diretamente no raw
    if (!canceled && raw.id_sale_status !== undefined) {
      canceled = raw.id_sale_status === 3;
    }

    const inlineItems = getField(raw, saleMap, 'items', null);
    const saleId = String(id || (mesa + '-' + comanda + '-' + dateText + '-' + total));

    return {
      idx, mesa, comanda, dateText, pagamento, saleId,
      totalItens, taxa, total, canceled,
      hasItemCanceled: false, items: [],
      _rawId: id, _rawItems: inlineItems
    };
  }

  function mapItem(raw, itemMap) {
    // Item name: try mapped field, then direct Saipos keys, then first plausible string
    let nome = getField(raw, itemMap, 'nome', '');
    if (!nome) {
      for (const k of ['desc_sale_item','desc_product','desc_item','product_name','name','description','product','desc','title','label']) {
        if (raw[k] && typeof raw[k] === 'string') { nome = raw[k]; break; }
      }
    }
    if (!nome && typeof raw === 'object') {
      for (const [k, v] of Object.entries(raw)) {
        if (typeof v === 'string' && v.length > 1 && v.length < 200 && !/^(id|guid|uuid|hash|token|created|updated|deleted)/i.test(k) && !/^\d+$/.test(v) && !/^\d{4}-/.test(v)) {
          nome = v; break;
        }
      }
    }

    // Waiter: might be a sub-object {desc_waiter, name, ...}
    let garcom = getField(raw, itemMap, 'garcom', '');
    if (garcom && typeof garcom === 'object') {
      garcom = garcom.desc_waiter || garcom.name || garcom.waiter_name || garcom.desc || garcom.employee_name || Object.values(garcom).find(v => typeof v === 'string') || '';
    }

    return {
      nome: String(nome || ''),
      qtd: Number(getField(raw, itemMap, 'qtd', 1)),
      garcom: String(garcom || ''),
      valor: Number(getField(raw, itemMap, 'valor', 0)),
      itemCancelado: Boolean(getField(raw, itemMap, 'cancelado', false)),
      deletadoPor: String(getField(raw, itemMap, 'deletadoPor', ''))
    };
  }

  // ── Pagination Analysis ─────────────────────────────────────
  function analyzePagination(url, response, dataKey) {
    let currentPage = 1;
    let perPage = 25;

    // Try to parse URL params (safely)
    try {
      const u = new URL(url);
      const params = u.searchParams;

      const pageParam = ['page', 'pagina', 'p'].find(p => params.has(p));
      const limitParam = ['limit', 'per_page', 'perPage', 'page_size', 'pageSize', 'size', 'rows_per_page'].find(p => params.has(p));
      if (pageParam) currentPage = parseInt(params.get(pageParam)) || 1;
      if (limitParam) perPage = parseInt(params.get(limitParam)) || 25;

      // Try Saipos-style filter JSON param
      const filterStr = params.get('filter');
      if (filterStr) {
        try {
          const filterObj = JSON.parse(filterStr);
          if (typeof filterObj.rows_per_page === 'number' && filterObj.rows_per_page > 0) perPage = filterObj.rows_per_page;
          if (typeof filterObj.rownum_initial === 'number') {
            currentPage = Math.floor(filterObj.rownum_initial / perPage) + 1;
          }
        } catch(e) {}
      }
    } catch(e) {
      // URL parse failed — try to extract filter from raw string
      try {
        const fm = url.match(/filter=([^&]+)/i);
        if (fm) {
          const filterObj = JSON.parse(decodeURIComponent(fm[1]));
          if (typeof filterObj.rows_per_page === 'number' && filterObj.rows_per_page > 0) perPage = filterObj.rows_per_page;
          if (typeof filterObj.rownum_initial === 'number') {
            currentPage = Math.floor(filterObj.rownum_initial / perPage) + 1;
          }
        }
      } catch(e2) {}
    }

    let totalItems = 0, totalPages = 1, dataArray = [];

    if (Array.isArray(response)) {
      dataArray = response;
      totalItems = response.length;
    } else if (typeof response === 'object' && response !== null) {
      // Find data array — prefer dataKey, then known keys, then first array
      if (dataKey && Array.isArray(response[dataKey])) {
        dataArray = response[dataKey];
      } else {
        // Try common known keys first
        for (const k of ['rows', 'data', 'items', 'results', 'records', 'vendas', 'sales']) {
          if (Array.isArray(response[k]) && response[k].length > 0) {
            dataArray = response[k];
            break;
          }
        }
        // Fallback: first array found
        if (dataArray.length === 0) {
          for (const key of Object.keys(response)) {
            if (Array.isArray(response[key]) && response[key].length > 0) {
              dataArray = response[key];
              break;
            }
          }
        }
      }
      // Get pagination metadata from response
      for (const f of ['rows_per_page', 'per_page', 'perPage', 'pageSize', 'page_size']) {
        if (typeof response[f] === 'number' && response[f] > 0) { perPage = response[f]; break; }
      }
      for (const f of ['total', 'total_rows', 'totalCount', 'total_count', 'count', 'totalItems', 'total_items', 'recordCount']) {
        if (typeof response[f] === 'number' && response[f] > 0) { totalItems = response[f]; break; }
      }
      for (const f of ['totalPages', 'total_pages', 'pages', 'lastPage', 'last_page', 'pageCount']) {
        if (typeof response[f] === 'number' && response[f] > 0) { totalPages = response[f]; break; }
      }
      // Calculate totalPages if not provided
      if (totalItems > 0 && totalPages <= 1 && perPage > 0) {
        totalPages = Math.ceil(totalItems / perPage);
      }
    }

    return { currentPage, perPage, totalItems, totalPages, dataArray, pageParam: 'page', limitParam: 'limit' };
  }

  // ── Build paginated URL (handles Saipos filter JSON) ────────
  // Saipos URLs use MIXED encoding: %22 for quotes, %7B/%7D for braces,
  // but RAW : and , for JSON structure chars.
  // NEVER re-encode via URL.searchParams.set() / new URL() — it changes encoding and breaks the API.
  // Works with URL as pure string only (replace/regex/string ops).
  //
  // baseRownum: the rownum_initial from page 1 response (e.g. 0 or 1)
  // Formula: baseRownum + (page-1)*perPage
  //   base=0 → page2=25, page3=50 (0-indexed)
  //   base=1 → page2=26, page3=51 (1-indexed, Saipos default)
  function buildPaginatedUrl(baseUrl, page, perPage, baseRownum) {
    baseRownum = (typeof baseRownum === 'number') ? baseRownum : 0;
    const rownum = baseRownum + (page - 1) * perPage;
    const urlStr = typeof baseUrl === 'string' ? baseUrl : String(baseUrl);

    // Strategy 1: Regex on raw URL string — handles all combinations:
    //   %22rownum_initial%22:  %22rownum_initial%22%3A  "rownum_initial":
    const rgx = /(%22rownum_initial%22\s*(?:%3A|:)\s*|"rownum_initial"\s*:\s*)\d+/i;
    if (rgx.test(urlStr)) {
      const replaced = urlStr.replace(rgx, function(_m, prefix) { return prefix + rownum; });
      debug('[buildPaginatedUrl] strategy=regex base=' + baseRownum + ' page=' + page + ' rownum_initial=' + rownum);
      debug('[buildPaginatedUrl] URL_FINAL=' + replaced);
      return replaced;
    }

    // Strategy 2: rownum_initial not found — inject into filter=%7B...%7D
    // Uses Saipos mixed encoding: %22 for quotes, raw : and ,
    const filterMatch = urlStr.match(/filter=([^&]+)/i);
    if (filterMatch) {
      const filterVal = filterMatch[1];
      const closePos = filterVal.lastIndexOf('%7D');
      if (closePos >= 0) {
        const inject = ',%22rownum_initial%22:' + rownum + ',%22rows_per_page%22:' + perPage;
        const newFilter = filterVal.substring(0, closePos) + inject + filterVal.substring(closePos);
        const result = urlStr.replace(filterMatch[1], newFilter);
        debug('[buildPaginatedUrl] strategy=inject base=' + baseRownum + ' page=' + page + ' rownum_initial=' + rownum);
        debug('[buildPaginatedUrl] URL_FINAL=' + result);
        return result;
      }
    }

    debug('[buildPaginatedUrl] nenhuma estratégia funcionou — URL inalterada');
    return urlStr;
  }

  // ── DOM-navigation pagination ────────────────────────────────
  // Fallback quando fetch direto retorna 401.
  // Clica no botão "próxima página" do SPA e captura a resposta via interceptor.
  // O SPA gerencia o token automaticamente — sem 401.
  // startPage: primeira página a coletar via DOM-nav (default 2)
  // Pressupõe que o SPA está na página startPage-1 neste momento
  async function collectViaSPANavigation(totalPages, dataKey, startPage) {
    startPage = startPage || 2;
    log('Estratégia DOM-nav: navegando paginador do SPA a partir da pág ' + startPage + '...');

    function findNextBtn() {
      // 1) ng-click com "page + 1" ou "nextPage" (AngularJS)
      const all = document.querySelectorAll('[ng-click]');
      for (const el of all) {
        const nc = el.getAttribute('ng-click') || '';
        if (/next\s*[Pp]age|changePage.*\+|goToPage.*\+|page\s*\+\s*1/i.test(nc)) {
          if (!el.closest('.disabled') && !el.hasAttribute('disabled')) return el;
        }
      }
      // 2) Bootstrap pagination: último <li> não disabled
      const paginationLis = document.querySelectorAll('ul.pagination > li');
      if (paginationLis.length > 0) {
        const last = paginationLis[paginationLis.length - 1];
        if (!last.classList.contains('disabled')) {
          const a = last.querySelector('a');
          if (a) return a;
        }
      }
      // 3) aria-label
      for (const sel of ['[aria-label*="próxima"]','[aria-label*="next" i]','[aria-label*="Next"]']) {
        const el = document.querySelector(sel);
        if (el && !el.closest('.disabled') && !el.hasAttribute('disabled')) return el;
      }
      return null;
    }

    // DOM dataset polling: interceptor escreve data-saipos-last-sales-idx no <html>
    // Content script lê direto — sem eventos cross-world, sem race conditions
    async function waitForNewSalesCall(prevIdx, timeoutMs) {
      const deadline = Date.now() + timeoutMs;
      while (Date.now() < deadline) {
        await sleep(300);
        const rawIdx = document.documentElement.dataset.saiposLastSalesIdx;
        if (rawIdx !== undefined && rawIdx !== null) {
          const idx = parseInt(rawIdx);
          if (idx > prevIdx) {
            debug('DOM-signal: novo sales-by-period idx=' + idx + ' (prev=' + prevIdx + ')');
            return idx;
          }
        }
      }
      return null;
    }

    const allData = [];
    // Pega o índice atual do último sales-by-period capturado
    let lastSalesIdx = parseInt(document.documentElement.dataset.saiposLastSalesIdx || '-1');
    debug('DOM-nav inicio: lastSalesIdx=' + lastSalesIdx);

    for (let page = startPage; page <= totalPages; page++) {
      while (EXT.paused && !EXT.stop) await sleep(200);
      if (EXT.stop) break;

      const nextBtn = findNextBtn();
      if (!nextBtn) {
        log('DOM-nav: botão próxima página não encontrado (página ' + page + ')', 'warn');
        break;
      }

      log('Página ' + page + '/' + totalPages + ': navegando via SPA...');
      nextBtn.scrollIntoView({ block: 'center' });
      nextBtn.click();

      // Aguarda SPA processar o click e a API responder
      await sleep(800);

      const newIdx = await waitForNewSalesCall(lastSalesIdx, 12000);
      if (newIdx === null) {
        log('Página ' + page + ': timeout aguardando resposta da API', 'warn');
        continue;
      }
      lastSalesIdx = newIdx;

      const resp = await getCachedResponse(newIdx);
      if (!resp) {
        log('Página ' + page + ': resposta não encontrada no cache', 'warn');
        continue;
      }

      const parsed = analyzePagination('', resp, dataKey);
      if (parsed.dataArray.length === 0) {
        log('Página ' + page + ': 0 vendas na resposta DOM-nav', 'warn');
        continue;
      }

      allData.push(...parsed.dataArray);
      log('Página ' + page + '/' + totalPages + ': +' + parsed.dataArray.length + ' vendas via SPA (total: ' + allData.length + ')');
      emit('PROGRESS', { current: allData.length, total: totalPages * parsed.dataArray.length, msg: 'DOM P' + page });
    }

    return allData;
  }

  // ── Discover detail endpoint by triggering SPA ──────────────
  async function discoverDetailViaDOM() {
    debug('Tentando descobrir endpoint de detalhe via DOM...');
    const verBtn = document.querySelector('tr[ng-repeat*="sale in vm.sales"] button[ng-click*="showSale"]')
      || document.querySelector('tr[ng-repeat*="sale in vm.sales"] button.btn-primary');
    if (!verBtn) return null;

    // Listen for the next API call
    return new Promise(resolve => {
      let found = null;
      const timeout = setTimeout(() => {
        window.removeEventListener('__saipos_api_call', handler);
        resolve(found);
      }, 5000);
      function handler(e) {
        if (!e.detail || !e.detail.url) return;
        const url = e.detail.url.toLowerCase();
        if (/\/(sale|sales|venda|order)\/\d+/i.test(url)) {
          found = e.detail.url.replace(/(\/(sale|sales|venda|vendas|order))\/\d+/i, '$1/{id}');
          clearTimeout(timeout);
          window.removeEventListener('__saipos_api_call', handler);
          // Close modal
          setTimeout(async () => {
            const closeBtn = document.querySelector('.modal button.close, .modal button[ng-click*="close"]');
            if (closeBtn) closeBtn.click();
            document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', keyCode: 27, bubbles: true }));
          }, 300);
          resolve(found);
        }
      }
      window.addEventListener('__saipos_api_call', handler);
      verBtn.scrollIntoView({ block: 'center' });
      verBtn.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
    });
  }

  // ── Try common detail URL patterns ──────────────────────────
  async function tryDetailPatterns(testId) {
    if (!_salesListUrl || !testId) return null;
    const u = new URL(_salesListUrl);
    const base = u.origin;
    const listPath = u.pathname;
    // Extract store base path (e.g. /v1/stores/80016)
    const storeMatch = listPath.match(/(\/v\d+\/stores\/\d+)/);
    const storeBase = storeMatch ? storeMatch[1] : '';
    const patterns = [
      storeBase + '/sales/' + testId,
      listPath.replace(/\?.*/, '') + '/' + testId,
      listPath.replace(/\?.*/, '').replace(/s$/, '') + '/' + testId,
      '/api/v1/sales/' + testId,
      '/api/v1/sale/' + testId,
      '/api/sales/' + testId,
      '/api/sale/' + testId
    ];
    for (const path of patterns) {
      try {
        debug('Tentando detalhe: ' + base + path);
        await apiFetch(base + path);
        const pattern = (base + path).replace(String(testId), '{id}');
        debug('Detalhe encontrado: ' + pattern);
        return pattern;
      } catch (_) {}
    }
    return null;
  }

  // ── Fetch items from detail responses ───────────────────────
  function extractItemsFromDetail(detail) {
    if (Array.isArray(detail)) return detail;
    if (typeof detail !== 'object' || !detail) return [];
    for (const key of ['itens', 'items', 'produtos', 'products', 'sale_items', 'saleItems', 'detalhes']) {
      if (Array.isArray(detail[key])) return detail[key];
    }
    for (const key of Object.keys(detail)) {
      if (Array.isArray(detail[key]) && detail[key].length > 0) return detail[key];
    }
    return [];
  }

  // ── MAIN EXTRACTION ─────────────────────────────────────────
  async function runExtraction() {
    if (EXT.running) { log('Já rodando'); return; }
    EXT.running = true;
    EXT.stop = false;
    EXT.paused = false;
    EXT.sales = [];
    EXT.log = [];

    log('Iniciando extração via API...');
    emit('STATUS', { status: 'running' });

    try {
      // ── 1. Auth headers ──
      log('Obtendo auth headers...');
      const auth = await getAuthHeaders();
      if (!auth) throw new Error('Auth headers não capturados. Faça login no Saipos e recarregue.');
      log('Auth OK: ' + Object.keys(auth).join(', '));

      // ── 2. Discover endpoints ──
      log('Descobrindo endpoints da API...');
      const calls = await getCapturedCalls();
      debug('Chamadas capturadas: ' + calls.length);

      if (calls.length === 0) {
        throw new Error('Nenhuma chamada API capturada. Aplique o filtro de datas e tente novamente.');
      }

      const endpoints = discoverEndpoints(calls);
      if (!endpoints.salesList) {
        throw new Error('Endpoint de vendas não encontrado. Aplique o filtro de datas na página de relatório.');
      }

      _salesListUrl = endpoints.salesList.url;

      _saleDetailUrlPattern = endpoints.detailPattern;
      const dataKey = endpoints.salesList._dataKey || null;
      const cachedIndex = endpoints.salesList.index;
      const _dateRange = endpoints.dateRange; // {start, end} ou null

      log('Endpoint listagem: ' + _salesListUrl.substring(0, 150));

      // Log date range
      if (_dateRange) {
        log('Período do filtro: ' + _dateRange.start + ' até ' + _dateRange.end);
      }

      // ── 3. Get first page data (from cache — always available) ──
      log('Obtendo dados da primeira página (cache)...');
      let firstResponse = null;

      // Tenta usar resposta já capturada pelo interceptor
      if (cachedIndex !== undefined && cachedIndex !== null) {
        log('Usando cache (index=' + cachedIndex + ')...');
        firstResponse = await getCachedResponse(cachedIndex);
        if (firstResponse) {
          const rkeys = typeof firstResponse === 'object' ? Object.keys(firstResponse) : [];
          debug('Cache OK: type=' + typeof firstResponse + ' keys=' + rkeys.join(','));
          if (typeof firstResponse === 'object') {
            const pInfo = ['total', 'total_pages', 'rows_per_page', 'rownum_initial'].map(k => k + '=' + firstResponse[k]).join(', ');
            debug('Cache pagination info: ' + pInfo);
          }
        } else {
          log('Cache vazio, tentando fetch...', 'warn');
        }
      }

      // Fallback: proxy fetch (pode dar 401 — tenta uma vez)
      if (!firstResponse) {
        log('Buscando via proxy fetch...');
        try {
          firstResponse = await apiFetch(_salesListUrl);
        } catch (e) {
          log('Proxy fetch falhou: ' + e.message + ' — continuando com DOM-nav...', 'warn');
        }
      }

      if (!firstResponse) {
        throw new Error('Nenhuma resposta obtida. Aplique o filtro de datas e tente novamente.');
      }

      const pagination = analyzePagination(_salesListUrl, firstResponse, dataKey);
      log('Paginação: ' + pagination.dataArray.length + ' vendas na pág 1, total=' + pagination.totalItems + ', páginas=' + pagination.totalPages + ', perPage=' + pagination.perPage);

      if (pagination.totalItems > pagination.dataArray.length && pagination.totalPages <= 1) {
        pagination.totalPages = Math.ceil(pagination.totalItems / pagination.perPage);
      }

      if (pagination.dataArray.length === 0) {
        log('WARN: dataArray vazio. Response type=' + typeof firstResponse + (firstResponse ? ' keys=' + Object.keys(firstResponse).join(',') : ''), 'warn');
        throw new Error('Nenhuma venda na resposta da API. Verifique o filtro de datas.');
      }

      // Build field mapping
      const saleMap = buildFieldMap(pagination.dataArray[0], SALE_ALIASES);
      debug('Sale mapping: ' + JSON.stringify(saleMap));

      const estimatedTotal = pagination.totalItems || pagination.dataArray.length;
      log('Total estimado: ' + estimatedTotal + ' vendas');
      emit('TOTAL', { total: estimatedTotal });

      // ── 4. Collect ALL sales — estratégia otimizada ──
      // Usa dados do cache (pág 1) + coleta restante via DOM-nav (SPA gerencia auth)
      // NUNCA usa proxy fetch para listagem (evita 401 persistente)
      const allRawSales = [...pagination.dataArray]; // Começa com pág 1 do cache
      log('Pág 1: ' + allRawSales.length + ' vendas do cache');
      emit('PROGRESS', { current: allRawSales.length, total: estimatedTotal, msg: 'Cache P1' });

      // Coleta páginas adicionais do cache do interceptor (se o usuário navegou manualmente)
      const targetDates = (function(u) {
         try { 
           const d = decodeURIComponent(u); 
           const s = d.match(/"start_date"\s*:\s*"([^"]+)"/i);
           const e = d.match(/"end_date"\s*:\s*"([^"]+)"/i);
           if (s && e) return s[1] + '|' + e[1]; 
         } catch(ex) {}
         return null;
      })(_salesListUrl);

      const allInterceptCalls = await getCapturedCalls();
      const cachedByRownum = new Map();
      
      // Itera do mais NOVO para o mais ANTIGO para pegar a cópia mais recente da página
      for (let i = allInterceptCalls.length - 1; i >= 0; i--) {
        const call = allInterceptCalls[i];
        if (!call.url || !call.url.includes('sales-by-period')) continue;
        
        // Verifica se a chamada do cache pertence ao mesmo filtro de datas (evita poluição cruzada)
        const callDates = (function(u) {
           try { 
             const d = decodeURIComponent(u); 
             const s = d.match(/"start_date"\s*:\s*"([^"]+)"/i);
             const e = d.match(/"end_date"\s*:\s*"([^"]+)"/i);
             if (s && e) return s[1] + '|' + e[1]; 
           } catch(ex) {}
           return null;
        })(call.url);
        
        if (targetDates && callDates && targetDates !== callDates) {
          continue; // Filtro de data diferente do atual, ignora este cache
        }
        
        const dec = decodeURIComponent(call.url);
        const m = dec.match(/"rownum_initial"\s*:\s*(\d+)/i);
        if (m) {
          const rn = parseInt(m[1]);
          // Só seta se não tiver, e como vem do mais novo pro mais velho, preserva o mais recente
          if (!cachedByRownum.has(rn)) cachedByRownum.set(rn, call.index);
        }
      }

      // Tenta ler todas as páginas do cache primeiro
      const baseRownum = 1;
      let pagesFromCache = 1;
      for (let page = 2; page <= pagination.totalPages; page++) {
        const rownum = (page - 1) * pagination.perPage + baseRownum;
        const cachedIdx = cachedByRownum.get(rownum);
        if (cachedIdx !== undefined && cachedIdx !== null) {
          const cachedResp = await getCachedResponse(cachedIdx);
          if (cachedResp) {
            const pageData = analyzePagination('', cachedResp, dataKey);
            if (pageData.dataArray.length > 0) {
              allRawSales.push(...pageData.dataArray);
              pagesFromCache++;
              log('Pág ' + page + ': +' + pageData.dataArray.length + ' do cache (total: ' + allRawSales.length + ')');
              emit('PROGRESS', { current: allRawSales.length, total: estimatedTotal, msg: 'Cache P' + page });
            }
          }
        }
      }

      // Se ainda faltam vendas, usa DOM-nav (SPA controla o auth, sem 401)
      if (allRawSales.length < estimatedTotal && pagination.totalPages > pagesFromCache) {
        const startPage = pagesFromCache + 1;
        log('Coletando páginas restantes via DOM-nav (pág ' + startPage + '-' + pagination.totalPages + ')...');

        // Primeiro, volta para a página 1 clicando no paginador do SPA
        const firstPageBtn = document.querySelector('ul.pagination > li:first-child a') ||
          document.querySelector('[ng-click*="changePage(1)"]') ||
          document.querySelector('[ng-click*="goToPage(1)"]');
        if (firstPageBtn && pagesFromCache === 1) {
          // Já estamos na pág 1, precisa navegar para frente
        }

        const domData = await collectViaSPANavigation(pagination.totalPages, dataKey, startPage);
        allRawSales.push(...domData);
        log('DOM-nav: +' + domData.length + ' vendas (total: ' + allRawSales.length + ')');
      }

      log('Total na listagem: ' + allRawSales.length + ' vendas (estimado: ' + estimatedTotal + ')');
      if (allRawSales.length < estimatedTotal) {
        log('⚠ Faltaram ' + (estimatedTotal - allRawSales.length) + ' vendas — dados parciais', 'warn');
      }

      if (EXT.stop) { EXT.running = false; return; }
      log('Total na listagem: ' + allRawSales.length + ' vendas');

      // ── 5. Map sales ──
      const mappedSales = allRawSales.map((raw, i) => mapSale(raw, i, saleMap));

      // ── 6. Fetch details (items/garcom) ──
      const hasInlineItems = mappedSales.some(s =>
        s._rawItems && Array.isArray(s._rawItems) && s._rawItems.length > 0
      );

      if (hasInlineItems) {
        log('Itens incluídos na listagem — mapeando...');
        const sample = mappedSales.find(s => s._rawItems && s._rawItems.length > 0);
        const itemMap = sample ? buildFieldMap(sample._rawItems[0], ITEM_ALIASES) : {};
        debug('Item mapping: ' + JSON.stringify(itemMap));
        for (const sale of mappedSales) {
          if (Array.isArray(sale._rawItems)) {
            sale.items = sale._rawItems.map(raw => mapItem(raw, itemMap));
            sale.hasItemCanceled = sale.items.some(i => i.itemCancelado);
          }
        }
      } else {
        // Need detail endpoint
        if (!_saleDetailUrlPattern) {
          log('Descobrindo endpoint de detalhe...');
          // Try common patterns FIRST to avoid SPA crashes from programmatic DOM clicks
          const testSale = mappedSales.find(s => s._rawId);
          if (testSale) {
            _saleDetailUrlPattern = await tryDetailPatterns(testSale._rawId);
          }
          // Only fallback to DOM trigger if patterns failed
          if (!_saleDetailUrlPattern) {
            _saleDetailUrlPattern = await discoverDetailViaDOM();
          }
        }

        if (_saleDetailUrlPattern) {
          const salesToFetch = mappedSales.filter(s => !s.canceled && s._rawId);
          log('Buscando detalhes: ' + salesToFetch.length + ' vendas (5 em paralelo - otimizado)...');
          let detailItemMap = null;
          let fetchedCount = 0;

          await runWithConcurrency(salesToFetch, 5, async (sale) => {
            const detailUrl = _saleDetailUrlPattern.replace('{id}', sale._rawId);
            try {
              // Adicionando um leve atraso de 50ms para evitar starvation da rede do SPA
              await new Promise(r => setTimeout(r, 50));
              const detail = await apiFetch(detailUrl);

              // Merge sale-level fields from detail response
              if (detail && typeof detail === 'object') {
                // Debug: log all numeric fields from first detail
                if (fetchedCount === 0) {
                  const numFields = Object.entries(detail).filter(([,v]) => typeof v === 'number').map(([k,v]) => k + '=' + v);
                  debug('Detail numeric fields: ' + numFields.join(' | '));
                  // Check nested payment_types for service fee
                  if (Array.isArray(detail.payment_types)) {
                    debug('payment_types: ' + JSON.stringify(detail.payment_types.slice(0,3)));
                  }
                  if (Array.isArray(detail.payments)) {
                    debug('payments[0] keys: ' + (detail.payments[0] ? Object.keys(detail.payments[0]).join(',') : 'empty'));
                    if (detail.payments[0]) {
                      const pNums = Object.entries(detail.payments[0]).filter(([,v]) => typeof v === 'number').map(([k,v]) => k + '=' + v);
                      debug('payments[0] nums: ' + pNums.join(' | '));
                    }
                  }
                }

                // --- totalItens (item subtotal) ---
                const ti = detail.total_amount_items ?? detail.total_items ?? detail.subtotal;
                if (ti !== undefined && ti !== null) sale.totalItens = Number(ti);

                // --- taxa (service fee) ---
                // Strategy 1: direct named fields
                let tx = null;
                for (const key of ['total_increase', 'service_charge', 'service_fee', 'total_service_fee', 'tip', 'gorjeta', 'taxa_servico', 'service_charge_value', 'total_tip']) {
                  if (typeof detail[key] === 'number' && detail[key] > 0) { tx = detail[key]; break; }
                }

                // Strategy 2: scan payments array for service fee entries
                if (tx === null || tx === 0) {
                  const paymentsArr = detail.payments || detail.payment_types || [];
                  if (Array.isArray(paymentsArr)) {
                    for (const p of paymentsArr) {
                      if (!p || typeof p !== 'object') continue;
                      for (const fk of ['service_charge', 'service_fee', 'tip', 'increase', 'total_increase', 'service_charge_value', 'gorjeta', 'taxa_servico']) {
                        if (typeof p[fk] === 'number' && p[fk] > 0) {
                          tx = (tx || 0) + p[fk];
                        }
                      }
                    }
                  }
                }

                // Strategy 3: compute from total difference
                // taxa = total_amount - total_amount_items + total_discount
                if ((tx === null || tx === 0) && typeof detail.total_amount === 'number' && typeof detail.total_amount_items === 'number') {
                  const discount = typeof detail.total_discount === 'number' ? detail.total_discount : 0;
                  const computed = detail.total_amount - detail.total_amount_items + discount;
                  if (computed > 0.01) {
                    tx = computed;
                    if (fetchedCount === 0) debug('Taxa computed from difference: total_amount(' + detail.total_amount + ') - total_amount_items(' + detail.total_amount_items + ') + discount(' + discount + ') = ' + computed);
                  }
                }

                if (fetchedCount === 0) debug('Taxa resolved: ' + tx);
                if (tx !== null && tx > 0) sale.taxa = Number(tx);

                // --- totalItens fallback: sum from items if API field missing ---
                if (!sale.totalItens || sale.totalItens === 0) {
                  const rawItems = extractItemsFromDetail(detail);
                  if (rawItems.length > 0) {
                    let itemsSum = 0;
                    for (const ri of rawItems) {
                      const price = ri.unit_price ?? ri.price ?? ri.valor ?? ri.value ?? ri.total_item ?? 0;
                      const qty = ri.quantity ?? ri.qtd ?? ri.qty ?? 1;
                      itemsSum += Number(price) * Number(qty);
                    }
                    if (itemsSum > 0) sale.totalItens = itemsSum;
                  }
                }

                // Mesa/comanda from table_order sub-object
                const to = detail.table_order;
                if (to && typeof to === 'object') {
                  if (!sale.mesa) sale.mesa = unwrapField(to.desc_table || to.table_number || to.number_table || to.mesa || '');
                  if (!sale.comanda) sale.comanda = unwrapField(to.number_order_card || to.order_card || to.comanda || '');
                }
                if (!sale.mesa) sale.mesa = unwrapField(detail.table_number || detail.desc_table || '');
                if (!sale.comanda) sale.comanda = unwrapField(detail.sale_number || detail.order_card || detail.number_order_card || '');
              }

              const rawItems = extractItemsFromDetail(detail);
              if (rawItems.length > 0) {
                if (!detailItemMap) {
                  detailItemMap = buildFieldMap(rawItems[0], ITEM_ALIASES);
                  debug('Detail item mapping: ' + JSON.stringify(detailItemMap));
                  debug('Detail item sample keys: ' + Object.keys(rawItems[0]).join(','));
                  // Log sample values to help identify name field
                  const sample = rawItems[0];
                  const strFields = Object.entries(sample).filter(([,v]) => typeof v === 'string' && v.length > 1).map(([k,v]) => k + '=' + String(v).substring(0, 40));
                  debug('Detail item string fields: ' + strFields.join(' | '));
                }
                sale.items = rawItems.map(raw => mapItem(raw, detailItemMap));
                sale.hasItemCanceled = sale.items.some(i => i.itemCancelado);
              }
            } catch (e) {
              debug('Erro detalhe ' + sale._rawId + ': ' + e.message);
            }
            fetchedCount++;
            if (fetchedCount % 10 === 0 || fetchedCount === salesToFetch.length) {
              emit('PROGRESS', { current: fetchedCount, total: salesToFetch.length, msg: 'Detalhes ' + fetchedCount + '/' + salesToFetch.length });
              log('Detalhes: ' + fetchedCount + '/' + salesToFetch.length);
            }
          });
        } else {
          log('Endpoint de detalhe não encontrado — itens não serão extraídos', 'warn');
        }
      }

      // Clean up internal fields
      for (const sale of mappedSales) {
        delete sale._rawId;
        delete sale._rawItems;
      }

      // Filtra vendas canceladas
      const activeSales = mappedSales.filter(s => !s.canceled);
      const canceledCount = mappedSales.length - activeSales.length;
      if (canceledCount > 0) {
        log(canceledCount + ' venda(s) cancelada(s) ignorada(s)');
      }

      EXT.sales = activeSales;
      EXT.running = false;

      const ok = activeSales.filter(s => s.items && s.items.length > 0).length;
      log('Concluído! ' + activeSales.length + ' vendas (' + ok + ' com itens)' + (canceledCount > 0 ? ' — ' + canceledCount + ' canceladas ignoradas' : ''));
      emit('DONE', { sales: activeSales, dateRange: _dateRange });

    } catch (e) {
      log('ERRO: ' + e.message, 'error');
      emit('STATUS', { status: 'error', msg: e.message });
      EXT.running = false;
    }
  }

  // ── API Test ────────────────────────────────────────────────
  async function testAPI() {
    const results = { auth: false, listing: false, detail: false, salesCount: 0, endpoints: {} };
    try {
      const auth = await getAuthHeaders();
      results.auth = !!auth;
      if (!auth) return results;

      const calls = await getCapturedCalls();
      const ep = discoverEndpoints(calls);

      if (ep.salesList) {
        results.endpoints.listing = ep.salesList.url;
        try {
          // Try cached response first
          let resp = null;
          if (ep.salesList.index !== undefined) {
            resp = await getCachedResponse(ep.salesList.index);
          }
          if (!resp) {
            resp = await apiFetch(ep.salesList.url);
          }
          const p = analyzePagination(ep.salesList.url, resp, ep.salesList._dataKey);
          results.listing = p.dataArray.length > 0;
          results.salesCount = p.totalItems || p.dataArray.length;
        } catch (_) {}
      }

      results.endpoints.detail = ep.detailPattern || null;
      results.detail = !!ep.detailPattern;
    } catch (_) {}
    return results;
  }
  // ── Happy Hour Routine ──────────────────────────────────────
  let _hhTimer = null;

  async function checkHappyHour() {
    try {
      if (!chrome.runtime || !chrome.runtime.id) {
         if (window.__saiposHHInterval) clearInterval(window.__saiposHHInterval);
         return;
      }
      const res = await chrome.storage.local.get('saipos_happyhour');
      const promos = res.saipos_happyhour || [];
      if (promos.length === 0) return;

      const now = new Date();
      const curDay = now.getDay();
      const curTime = now.getHours().toString().padStart(2, '0') + ':' + now.getMinutes().toString().padStart(2, '0');

      let changed = false;
      for (const p of promos) {
        if (!p.active) continue;

        const isHHTime = p.days.includes(curDay) && curTime >= p.startTime && curTime < p.endTime;
        const targetMode = isHHTime ? 'promo' : 'normal';

        if (p.lastApplied !== targetMode) {
          const targetPrice = isHHTime ? p.pricePromo : p.priceNormal;
          log(`⏰ [Happy Hour] Alterando preço: ${p.prod} -> R$ ${targetPrice.toFixed(2)} (${targetMode})`);
          
          const ok = await updateProductPrice(p, targetPrice);
          if (ok) {
            p.lastApplied = targetMode;
            changed = true;
            log(`✅ [Happy Hour] ${p.prod} atualizado para R$ ${targetPrice.toFixed(2)}`, 'success');
          } else {
            // Se falhou, logamos mas não mudamos o lastApplied para tentar de novo na próxima volta
            log(`❌ [Happy Hour] Erro ao atualizar ${p.prod}. Tentando novamente em breve...`, 'error');
          }
        }
      }

      if (changed) {
        await chrome.storage.local.set({ saipos_happyhour: promos });
      }
    } catch (err) {
      if (err.message && err.message.includes('Extension context invalidated')) {
        if (window.__saiposHHInterval) clearInterval(window.__saiposHHInterval);
      } else {
        debug('Erro na rotina Happy Hour: ' + err.message);
      }
    }
  }

  async function updateProductPrice(promo, newPrice) {
    try {
      // Garante auth antes de qualquer chamada
      if (!_authHeaders) {
        const h = await getAuthHeaders();
        if (!h) { debug('Auth não disponível para Happy Hour'); return false; }
      }
      const storeId = getStoreIdFromUrl();
      if (!storeId) { debug('StoreId não encontrado'); return false; }

      // 1. Encontrar o ID fazendo o servidor pesquisar o nome exato (o único jeito que retorna Itens não listados)
      log(`🔍 Pesquisando ID do produto: ${promo.prod}...`);
      const targetMatch = promo.prod.trim();
      
      const filterObj = {
        where: {
          generic_use: 'N',
          enabled: { inq: ['Y', 'N'] },
          desc_store_item_without_accent: { ilike: `%${targetMatch}%` }
        },
        order: 'desc_store_item asc',
        limit: 20,
        skip: 0
      };
      
      const itemsUrl = `https://api.saipos.com/v1/stores/${storeId}/items?filter=${encodeURIComponent(JSON.stringify(filterObj))}`;
      const res = await mainWorldFetch(itemsUrl);
      
      let items = null;
      if (res && Array.isArray(res.data)) items = res.data;
      else if (res && res.data && Array.isArray(res.data.rows)) items = res.data.rows;
      else if (Array.isArray(res)) items = res;
      
      if (!items || items.length === 0) {
          throw new Error(`Produto não localizado na pesquisa direta do BD do Saipos: ${promo.prod}`);
      }

      // Inspecionar o objeto retornado caso o ID mude
      const firstItem = items[0];
      const possibleIds = {
          id: firstItem.id,
          id_item: firstItem.id_item,
          id_store_item: firstItem.id_store_item,
          store_item_id: firstItem.store_item_id
      };
      
      log(`[Saipos DEBUG] Item retornado chaves: ${Object.keys(firstItem).slice(0, 15).join(', ')}`);
      
      // Tentar pegar o ID de qualquer uma das variações
      let id = possibleIds.id_store_item || possibleIds.id_item || possibleIds.id || possibleIds.store_item_id;

      if (!id) {
        log(`[Saipos DEBUG] FALHA ID: Objeto completo: JSON=${JSON.stringify(possibleIds)}`);
        throw new Error(`Item encontrado, mas Falha ao extrair ID do produto. (Veja o log)`);
      }

      // 2. Pegar objeto completo da API para não quebrar outras propriedades
      const getUrl = `https://api.saipos.com/v1/stores/${storeId}/items/${id}`;
      const itemRes = await mainWorldFetch(getUrl);
      if (!itemRes || !itemRes.data) throw new Error('Falha ao obter detalhes do produto ID ' + id);
      
      const item = itemRes.data;
      
      // O preço no Saipos fica dentro de variations[0].price, NÃO no nível raiz
      let currentPrice = null;
      if (item.variations && item.variations.length > 0) {
        currentPrice = parseFloat(item.variations[0].price);
      }
      
      if (currentPrice === newPrice) {
         debug(`Preço já é ${newPrice}, pulando update.`);
         return true;
      }

      // 3. Modificar o preço DENTRO de variations e enviar PUT
      if (item.variations && item.variations.length > 0) {
        for (let i = 0; i < item.variations.length; i++) {
          item.variations[i].price = newPrice;
        }
        log(`[Saipos DEBUG] Atualizando variations[].price de ${currentPrice} para ${newPrice}`);
      } else {
        // Fallback: caso não tenha variations, tenta no nível raiz
        item.price = newPrice;
        log(`[Saipos DEBUG] Sem variations, atualizando item.price direto`);
      }
      
      const putUrl = `https://api.saipos.com/v1/stores/${storeId}/items/${id}`;
      const putRes = await mainWorldFetch(putUrl, 'PUT', item);
      
      if (putRes && (putRes.status === 200 || putRes.data)) {
        return true;
      } else {
        throw new Error('Erro API PUT: ' + JSON.stringify(putRes || 'Sem resposta').substring(0, 200));
      }
    } catch (err) {
      log(`❌ Erro HH: ${err.message}`, 'error');
      return false;
    }
  }

  async function mainWorldFetch(url, method = 'GET', body = null) {
    return new Promise((resolve) => {
      const id = Math.random().toString(36).substring(7);
      const onResp = (e) => {
        window.removeEventListener('__saipos_fetch_resp_' + id, onResp);
        try {
          resolve(JSON.parse(e.detail));
        } catch (err) {
          debug('Erro parse resp: ' + err.message);
          resolve({ error: 'Parse error' });
        }
      };
      window.addEventListener('__saipos_fetch_resp_' + id, onResp);
      window.dispatchEvent(new CustomEvent('__saipos_fetch_request', {
        detail: { id, url, method, body }
      }));
      setTimeout(() => {
        window.removeEventListener('__saipos_fetch_resp_' + id, onResp);
        resolve({ error: 'Timeout' });
      }, 15000);
    });
  }

  function getStoreIdFromUrl() {
    // Tenta pegar de uma chamada capturada (mais confiável)
    const c = _capturedCalls.find(x => x.url && x.url.includes('/stores/'));
    if (c) {
      const m2 = c.url.match(/\/stores\/(\d+)\//);
      if (m2) return m2[1];
    }
    const m = window.location.href.match(/\/stores\/(\d+)\//);
    if (m) return m[1];
    return null;
  }

  async function saveHH() {
    // O loop do checkHappyHour já salva no final se houve 'changed'
  }

  // Iniciar rotina (a cada 30 segundos, mas espera auth primeiro)
  if (window.__saiposHHInterval) clearInterval(window.__saiposHHInterval);
  
  async function startHappyHour() {
    // Espera auth estar disponível antes de iniciar
    await getAuthHeaders();
    debug('Happy Hour: auth pronta, iniciando monitoramento...');
    checkHappyHour();
    window.__saiposHHInterval = setInterval(checkHappyHour, 30000);
  }
  // Delay de 5s para garantir que o SPA carregou e o interceptor capturou o auth
  setTimeout(startHappyHour, 5000);



  // ── Message Listener ────────────────────────────────────────
  chrome.runtime.onMessage.addListener((msg, _, sendResponse) => {
    if (msg.action === 'START') {
      if (!EXT.running) { runExtraction(); sendResponse({ ok: true }); }
      else sendResponse({ ok: false, msg: 'Já rodando' });
    }
    if (msg.action === 'PAUSE') {
      EXT.paused = !EXT.paused;
      sendResponse({ paused: EXT.paused });
    }
    if (msg.action === 'STOP') {
      EXT.stop = true;
      EXT.running = false;
      sendResponse({ ok: true });
    }
    if (msg.action === 'GET') {
      sendResponse({ sales: EXT.sales, running: EXT.running });
    }
    if (msg.action === 'TEST_API') {
      testAPI().then(r => sendResponse(r));
      return true;
    }
    if (msg.action === 'LOAD_PRODUCTS') {
      (async () => {
        try {
          let storeId = getStoreIdFromUrl();
          if (!storeId) {
            await getCapturedCalls();
            storeId = getStoreIdFromUrl();
          }
          if (!storeId) return sendResponse({ error: 'StoreId não encontrado (aguarde a API carregar ou atualize a página da loja)' });
          if (!_authHeaders) {
            const h = await getAuthHeaders();
            if (!h) return sendResponse({ error: 'Auth indisponível' });
          }
          const filter = JSON.stringify({
            where: { enabled: 'Y' },
            limit: 2000
          });
          const url = `https://api.saipos.com/v1/stores/${storeId}/items?filter=${encodeURIComponent(filter)}`;
          const res = await mainWorldFetch(url);
          
          let items = null;
          if (res && Array.isArray(res.data)) items = res.data;
          else if (res && res.data && Array.isArray(res.data.rows)) items = res.data.rows;
          else if (Array.isArray(res)) items = res;
          
          if (!items) return sendResponse({ error: 'Falha ao processar lista de produtos.' });
          
          const products = items.map(x => ({
            id: x.id_item || x.id,
            name: x.description || x.desc_item || x.name || 'Sem nome',
            price: parseFloat(x.price || 0)
          })).sort((a,b) => a.name.localeCompare(b.name));
          
          sendResponse({ success: true, products });
        } catch(err) {
          sendResponse({ error: err.message });
        }
      })();
      return true;
    }
    return true;
  });

  console.log('[Saipos] Content script pronto (API mode)');
})();
