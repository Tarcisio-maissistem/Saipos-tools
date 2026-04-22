// ================================================================
// SAIPOS TOOLS v6.35.0 — interceptor.js (MAIN world, document_start)
// Captura auth headers e analisa chamadas API do SPA Angular
// ================================================================
(function() {
  if (window.__saiposInterceptorActive) return;
  window.__saiposInterceptorActive = true;

  var auth = {};
  var calls = [];

  // --- Salva refs originais ANTES de sobrescrever ---
  var origOpen = XMLHttpRequest.prototype.open;
  var origSend = XMLHttpRequest.prototype.send;
  var origSetRequestHeader = XMLHttpRequest.prototype.setRequestHeader;
  var origAddEventListener = XMLHttpRequest.prototype.addEventListener;

  // --- Resumo da resposta (sem dados completos) ---
  function summarize(resp, depth) {
    depth = depth || 0;
    if (!resp || depth > 2) return null;
    if (Array.isArray(resp)) {
      var info = { _t: 'array', _len: resp.length };
      if (resp.length > 0 && typeof resp[0] === 'object' && resp[0] !== null) {
        info._sampleKeys = Object.keys(resp[0]);
        if (depth < 2) {
          var nested = {};
          for (var k in resp[0]) {
            if (Array.isArray(resp[0][k]) && resp[0][k].length > 0) {
              nested[k] = summarize(resp[0][k], depth + 1);
            }
          }
          if (Object.keys(nested).length > 0) info._nested = nested;
        }
      }
      return info;
    }
    if (typeof resp === 'object') {
      var info = { _t: 'object', _keys: Object.keys(resp) };
      var arrays = {};
      var nums = {};
      for (var k in resp) {
        if (Array.isArray(resp[k])) {
          arrays[k] = summarize(resp[k], depth + 1);
        }
        if (typeof resp[k] === 'number') {
          nums[k] = resp[k];
        }
      }
      if (Object.keys(arrays).length > 0) info._arrays = arrays;
      if (Object.keys(nums).length > 0) info._nums = nums;
      return info;
    }
    return { _t: typeof resp };
  }

  var xhrState = new WeakMap();

  // --- Hook XMLHttpRequest.open ---
  XMLHttpRequest.prototype.open = function(method, url) {
    var state = xhrState.get(this) || {};
    state.method = method;
    state.url = url;
    state.headers = state.headers || {};
    xhrState.set(this, state);
    return origOpen.apply(this, arguments);
  };

  // --- Hook XMLHttpRequest.setRequestHeader ---
  XMLHttpRequest.prototype.setRequestHeader = function(name, value) {
    var state = xhrState.get(this);
    if (state) {
      state.headers[name] = value;
    }
    
    // Armazena headers apenas de requests para o saipos (evita que Pendo/Datadog sobrescrevam o Authorization)
    if (state && state.url && typeof state.url === 'string' && state.url.indexOf('api.saipos.com') > -1) {
      var low = name.toLowerCase();
      if (low === 'authorization' || low === 'token' || low === 'x-access-token' ||
          low.indexOf('x-token') === 0 || low.indexOf('x-api') === 0) {
        auth[name] = value;
        localStorage.setItem('saipos_token', value);
        fire('__saipos_auth', { headers: auth });
      }
    }
    return origSetRequestHeader.apply(this, arguments);
  };

  // --- Hook XMLHttpRequest.send ---
  XMLHttpRequest.prototype.send = function(body) {
    var self = this;
    var state = xhrState.get(this);
    
    // Only intercept if we have a URL and it's a Saipos API request
    if (state && state.url && typeof state.url === 'string' && state.url.indexOf('api.saipos.com/v1/stores') > -1) {
      if (!state.intercepted) {
        state.intercepted = true;
        origAddEventListener.call(this, 'load', function() {
          var sp = state;
          var entry = { method: sp.method, url: sp.url, status: self.status, reqHeaders: sp.headers };
          
          // Extrai e broadcast do storeId sempre que temos uma URL da API (qualquer endpoint)
          var storeIdXhrMatch = sp.url.match(/\/v1\/stores\/(\d+)/);
          if (storeIdXhrMatch) {
            fire('__saipos_store_id_detected', { storeId: storeIdXhrMatch[1] });
          }

          var isSalesEndpoint = (sp.url.indexOf('/sales-by') > -1 || sp.url.indexOf('/sales') > -1 || sp.url.indexOf('/table_order') > -1 || sp.url.indexOf('/orders') > -1);

          if (isSalesEndpoint) {
            try {
              var ct = self.getResponseHeader('content-type') || '';
              if (ct.indexOf('json') > -1) {
                var data = JSON.parse(self.responseText);
                calls.push({ method: entry.method, url: entry.url, status: entry.status, reqHeaders: entry.reqHeaders, response: data });
                entry.responseSummary = summarize(data, 0);
                // Signal para DOM: content script pode ler diretamente sem eventos cross-world
                if (entry.url && entry.url.indexOf('sales-by-period') > -1 && entry.url.indexOf('.html') === -1) {
                  document.documentElement.dataset.saiposLastSalesIdx = String(calls.length - 1);
                  document.documentElement.dataset.saiposLastSalesTs = String(Date.now());
                }
              }
            } catch(e) {}
          } else {
            calls.push({ method: entry.method, url: entry.url, status: entry.status, reqHeaders: entry.reqHeaders });
          }
          fire('__saipos_api_call', entry);
        });
      }
    }
    return origSend.apply(this, arguments);
  };

  // --- Hook fetch ---
  var origFetch = window.fetch;
  if (origFetch) {
    window.fetch = function(input, init) {
      var url = typeof input === 'string' ? input : (input ? input.url : '');
      var passUrl = (url || '').toString().toLowerCase();
      // By-pass completo para carregamento de módulos e APIs de terceiros (ex: pendo.io tem /v1/ também!)
      if (passUrl.indexOf('api.saipos.com') === -1 && passUrl.indexOf('/sales-by-period') === -1) {
        return origFetch.apply(window, arguments);
      }
      var method = (init && init.method) || (input && input.method) || 'GET';
      var headers = {};
      if (init && init.headers) {
        if (init.headers instanceof Headers) {
          init.headers.forEach(function(v, k) { headers[k] = v; });
        } else if (typeof init.headers === 'object') {
          for (var k in init.headers) headers[k] = init.headers[k];
        }
      }
      for (var key in headers) {
        var low = key.toLowerCase();
        if (low === 'authorization' || low === 'token' || low.indexOf('x-token') === 0) {
          auth[key] = headers[key];
          fire('__saipos_auth', { headers: auth });
        }
      }
      // Extrai storeId da URL do fetch e broadcast imediato (antes da resposta)
      var storeIdFetchMatch = url.match(/\/v1\/stores\/(\d+)/);
      if (storeIdFetchMatch) {
        fire('__saipos_store_id_detected', { storeId: storeIdFetchMatch[1] });
      }

      return origFetch.apply(window, arguments).then(function(response) {
        if (response.ok) {
          var isSalesEndpoint = (passUrl.indexOf('/sales-by') > -1 || passUrl.indexOf('/sales') > -1 || passUrl.indexOf('/table_order') > -1 || passUrl.indexOf('/orders') > -1);
          if (isSalesEndpoint) {
            try {
              var ct = response.headers ? (response.headers.get('content-type') || '') : '';
              if (ct.indexOf('json') > -1) {
                var clone = response.clone();
                clone.json().then(function(data) {
                  calls.push({ method: method, url: url, status: response.status, reqHeaders: headers, response: data });
                  var entry = { method: method, url: url, status: response.status, reqHeaders: headers };
                  entry.responseSummary = summarize(data, 0);
                  fire('__saipos_api_call', entry);
                }).catch(function() {});
              }
            } catch(e) {}
          } else {
            calls.push({ method: method, url: url, status: response.status, reqHeaders: headers });
            var entry = { method: method, url: url, status: response.status, reqHeaders: headers };
            fire('__saipos_api_call', entry);
          }
        }
        return response;
      });
    };
  }

  // --- Broadcast via CustomEvent ---
  function fire(name, data) {
    try {
      window.dispatchEvent(new CustomEvent(name, {
        detail: JSON.parse(JSON.stringify(data))
      }));
    } catch(e) {
      // Dados muito grandes — envia sem response/summary
      if (data.responseSummary || data.response) {
        var slim = {};
        for (var k in data) {
          if (k !== 'responseSummary' && k !== 'response') slim[k] = data[k];
        }
        try {
          window.dispatchEvent(new CustomEvent(name, { detail: JSON.parse(JSON.stringify(slim)) }));
        } catch(e2) {}
      }
    }
  }

  // --- Responde a pedidos do content script ---
  window.addEventListener('__saipos_get_auth', function() {
    fire('__saipos_auth', { headers: auth });
  });

  // Retorna itens originais da venda via Angular scope (vm.sale)
  window.addEventListener('__saipos_get_sale_items', function() {
    try {
      // Busca o scope Angular do controller da tela de close
      var els = document.querySelectorAll('[ng-controller]');
      var scope = null;
      for (var i = 0; i < els.length; i++) {
        var s = angular.element(els[i]).scope();
        while (s && !s.vm) s = s.$parent;
        if (s && s.vm && s.vm.sale) { scope = s; break; }
      }

      if (scope && scope.vm && scope.vm.sale) {
        var sale = scope.vm.sale;
        var vm   = scope.vm;

        // Taxa de serviço — tenta sale, vm e todas as variações de nome
        var taxaVal = sale.service_fee       || sale.service_fee_value  ||
                      sale.service_tax       || sale.service_tax_value  ||
                      sale.service_value     || sale.service_charge     ||
                      sale.fee_service       || sale.taxa_servico       ||
                      sale.valor_servico     || sale.servico            ||
                      vm.serviceValue        || vm.service_value        ||
                      vm.serviceFeeValue     || vm.serviceCharge        || 0;

        // Taxa como percentual — raw decimal (0.10) ou inteiro (10)
        var rawRate = sale.service_rate      || sale.service_percentage ||
                      sale.serviceRate       || vm.serviceRate          ||
                      vm.service_rate        || vm.serviceFeePercentage || 0;
        var pctStr = '';
        if (rawRate > 0) {
          var pctNum = rawRate <= 1 ? rawRate * 100 : rawRate;
          pctStr = pctNum.toFixed(0) + '%';
        } else if (sale.pct_service) {
          pctStr = sale.pct_service + '%';
        }

        // Último recurso: lê service_charge dos shifts da loja via $rootScope
        // (fonte oficial — config do estabelecimento, não da venda)
        if (!pctStr) {
          try {
            var rootEl = document.querySelector('[ng-app]') || document.body;
            var $rootScope = angular.element(rootEl).injector().get('$rootScope');
            var currentStore = $rootScope && $rootScope.currentStore;
            if (currentStore && Array.isArray(currentStore.shifts)) {
              var activeShift = null;
              for (var si = 0; si < currentStore.shifts.length; si++) {
                var sh = currentStore.shifts[si];
                if (sh.use_service_charge === 'Y' && sh.service_charge > 0) { activeShift = sh; break; }
              }
              if (activeShift) pctStr = String(Math.round(activeShift.service_charge)) + '%';
            }
          } catch(eShift) {}
        }

        // Total que inclui taxa — tenta campos de "total final" além do total_price
        var totalComTaxa = sale.final_total   || sale.grand_total       ||
                           sale.total_final   || sale.valor_total       ||
                           sale.total_amount  || 0;

        var result = {
          id_sale: sale.id_sale || sale.id,
          sale_items: [],
          mesa: sale.table_desc || sale.desc_table || sale.table || sale.mesa || '',
          comanda: sale.command_order || sale.id_command_order || sale.comanda || String(sale.command_number || ''),
          garcom: sale.waiter_name || sale.desc_waiter || sale.garcom || '',
          identificacao: sale.desc_sale || '',
          total:       sale.total_price || sale.total || 0, // total sem taxa (base)
          total_final: totalComTaxa,                         // total com taxa, se disponível
          taxa_servico: taxaVal,
          pct_servico:  pctStr,
          payments: []
        };

        // Itens originais
        var items = sale.sale_items || sale.items || sale.saleItems || [];
        for (var j = 0; j < items.length; j++) {
          var it = items[j];
          result.sale_items.push({
            nome: it.desc_item || it.desc_sale_item || it.name || '',
            qtd: it.quantity || it.qty || 1,
            valor_unit: it.sale_price || it.unit_price || it.price || 0,
            valor_total: it.total_price || it.total || 0
          });
        }

        // Pagamentos
        var payments = sale.payments || [];
        for (var k = 0; k < payments.length; k++) {
          var p = payments[k];
          // Pagamento pode ter sub-array payments
          var subPays = p.payments || [p];
          for (var l = 0; l < subPays.length; l++) {
            var sp = subPays[l];
            result.payments.push({
              forma: sp.desc_payment_type || sp.payment_type || '',
              desc: sp.desc_sale_payment || p.desc_sale_payment || '',
              valor: sp.value || sp.amount || sp.total || 0
            });
          }
        }

        window.dispatchEvent(new CustomEvent('__saipos_sale_items_response', {
          detail: JSON.stringify(result)
        }));
        return;
      }
    } catch(e) {
    }

    window.dispatchEvent(new CustomEvent('__saipos_sale_items_response', {
      detail: JSON.stringify({ sale_items: [], payments: [] })
    }));
  });

  window.addEventListener('__saipos_get_calls', function() {
    var list = calls.map(function(c, i) {
      return {
        index: i,
        method: c.method,
        url: c.url,
        status: c.status,
        hasResponse: !!c.response,
        responseSummary: c.response ? summarize(c.response, 0) : null
      };
    });
    fire('__saipos_calls_list', list);
  });

  // --- Retorna dados completos de uma chamada capturada (por index) ---
  window.addEventListener('__saipos_get_call_response', function(e) {
    var idx = e.detail && e.detail.index;
    if (idx === undefined || idx === null || !calls[idx]) {
      window.dispatchEvent(new CustomEvent('__saipos_call_response', {
        detail: JSON.stringify({ error: 'Call not found', index: idx })
      }));
      return;
    }
    var c = calls[idx];
    try {
      var json = JSON.stringify({ data: c.response, url: c.url, status: c.status });
      window.dispatchEvent(new CustomEvent('__saipos_call_response', {
        detail: json
      }));
    } catch(err) {
      window.dispatchEvent(new CustomEvent('__saipos_call_response', {
        detail: JSON.stringify({ error: 'Serialize error: ' + err.message })
      }));
    }
  });

  // --- Intercepta clique no botão IMPRIMIR da lista de comandas por mesa ---
  // Captura antes do ng-click (capture phase), lê Angular scope e dispara evento cross-world
  document.addEventListener('click', function(e) {
    // Sobe no DOM até encontrar elemento com ng-click="vm.printSale..."
    var el = e.target;
    var printEl = null;
    while (el && el !== document.body) {
      var ngClick = el.getAttribute && el.getAttribute('ng-click');
      if (ngClick && ngClick.indexOf('printSale') !== -1) { printEl = el; break; }
      el = el.parentElement;
    }
    if (!printEl) return;

    console.log('[SPT] Botão imprimir clicado, ng-click:', printEl.getAttribute('ng-click'));

    // Lê dados da comanda via Angular scope (percorre scope e $parent até encontrar order.sale)
    var result = null;
    try {
      if (typeof angular === 'undefined') { console.log('[SPT] Angular não disponível'); return; }
      var scopeEl = printEl;
      var scopeDepth = 0;
      while (scopeEl && !result) {
        var scope = angular.element(scopeEl).scope();
        if (scope) {
          // DEBUG — loga estrutura do scope em cada nível
          var scopeKeys = Object.keys(scope).filter(function(k) { return k[0] !== '$'; });
          console.log('[SPT] scope depth=' + scopeDepth + ' keys:', scopeKeys,
            'order?', !!(scope.order), 'sale?', !!(scope.sale), 'vm?', !!(scope.vm));

          // Procura o objeto sale em order.sale, sale ou vm.sale
          var sale = null;
          if (scope.order && scope.order.sale) sale = scope.order.sale;
          else if (scope.sale && scope.sale.id_sale) sale = scope.sale;
          else if (scope.vm && scope.vm.sale && scope.vm.sale.id_sale) sale = scope.vm.sale;

          if (sale) {
            // DEBUG — loga scope.order e primeiro pagamento para mapear nomes de campos
            var orderKeys = scope.order ? Object.keys(scope.order).filter(function(k){ return k[0] !== '$'; }) : [];
            console.log('[SPT] sale encontrado! id_sale=' + (sale.id_sale || sale.id) +
              ' table_desc=' + sale.table_desc + ' command_order=' + sale.command_order +
              ' payments=' + (sale.payments && sale.payments.length));
            console.log('[SPT] scope.order keys:', orderKeys);
            if (sale.payments && sale.payments.length > 0) {
              var p0 = sale.payments[0];
              var sp0 = (p0.payments && p0.payments[0]) || p0;
              console.log('[SPT] payment[0] keys:', Object.keys(p0), 'sub[0] keys:', Object.keys(sp0));
              console.log('[SPT] payment[0]:', JSON.stringify(sp0).slice(0, 300));
            }
          }
          scopeDepth++;

          if (sale && (sale.id_sale || sale.id)) {
            // Calcula percentual da taxa antes de criar result (permite fallback via shifts)
            var clickRawRate = sale.service_rate || sale.service_percentage || 0;
            var clickPctStr = '';
            if (clickRawRate > 0) {
              clickPctStr = (clickRawRate <= 1 ? clickRawRate * 100 : clickRawRate).toFixed(0) + '%';
            } else if (sale.pct_service) {
              clickPctStr = sale.pct_service + '%';
            }
            // Último recurso: shifts via $rootScope (fonte oficial do estabelecimento)
            if (!clickPctStr) {
              try {
                var rootEl2 = document.querySelector('[ng-app]') || document.body;
                var $rootScope2 = angular.element(rootEl2).injector().get('$rootScope');
                var currentStore2 = $rootScope2 && $rootScope2.currentStore;
                if (currentStore2 && Array.isArray(currentStore2.shifts)) {
                  for (var si2 = 0; si2 < currentStore2.shifts.length; si2++) {
                    var sh2 = currentStore2.shifts[si2];
                    if (sh2.use_service_charge === 'Y' && sh2.service_charge > 0) {
                      clickPctStr = String(Math.round(sh2.service_charge)) + '%';
                      break;
                    }
                  }
                }
              } catch(eClick) {}
            }

            // Mesa: scope.order.table é um OBJETO — extrai string de dentro
            var orderTable = (scope.order && scope.order.table) || {};
            if (scope.order && scope.order.table && typeof scope.order.table === 'object') {
              console.log('[SPT] scope.order.table keys:', Object.keys(scope.order.table),
                JSON.stringify(scope.order.table).slice(0, 150));
            }
            // desc_store_table é o campo correto (confirmado via debug)
            var clickMesa = orderTable.desc_store_table || orderTable.table_desc ||
                            orderTable.desc_table       || orderTable.table_name ||
                            orderTable.name             || String(orderTable.table_number || '') ||
                            sale.table_desc || sale.desc_table || sale.mesa || '';

            // Comanda: display_order_card é o campo correto no scope.order
            var clickComanda = (scope.order && (
              scope.order.display_order_card ||
              String(scope.order.id_store_order_card || scope.order.command_number || '')
            )) || sale.command_order || String(sale.command_number || sale.id_command_order || '');

            result = {
              id_sale: sale.id_sale || sale.id,
              mesa: clickMesa,
              comanda: clickComanda,
              garcom: sale.waiter_name || sale.desc_waiter || '',
              identificacao: sale.desc_sale || '',
              total: sale.total_price || sale.total || 0,
              taxa_servico: sale.service_fee || sale.service_tax || sale.service_tax_value || sale.fee_service || sale.taxa_servico || 0,
              pct_servico: clickPctStr,
              sale_items: [],
              payments: []
            };

            // Itens da comanda
            var items = sale.sale_items || sale.items || sale.saleItems || [];
            for (var j = 0; j < items.length; j++) {
              var it = items[j];
              result.sale_items.push({
                nome: it.desc_item || it.desc_sale_item || it.name || '',
                qtd: it.quantity || it.qty || 1,
                valor_unit: it.sale_price || it.unit_price || it.price || 0,
                valor_total: it.total_price || it.total || 0
              });
            }

            // Pagamentos — tenta vários nomes de campo para o valor (varia entre escopos)
            var pays = sale.payments || [];
            for (var k = 0; k < pays.length; k++) {
              var p = pays[k];
              var subPays = p.payments || [p];
              for (var l = 0; l < subPays.length; l++) {
                var sp = subPays[l];
                var pValor = sp.value  || sp.amount       || sp.total        ||
                             sp.valor  || sp.total_amount  || sp.paid_amount  ||
                             sp.payment_value || sp.amount_paid || 0;
                result.payments.push({
                  forma: sp.desc_payment_type || sp.payment_type || sp.desc || sp.forma || '',
                  desc:  sp.desc_sale_payment || p.desc_sale_payment || '',
                  valor: pValor
                });
              }
            }
          }
        }
        // Sobe para o $parent do scope se ainda não encontrou
        if (!result) {
          var parent = scopeEl.parentElement;
          scopeEl = parent;
        } else {
          break;
        }
      }
    } catch(err) { console.log('[SPT] Erro ao ler scope:', err); }

    if (!result || !result.id_sale) {
      console.log('[SPT] Nenhum sale encontrado no scope — deixando SAIPOS tratar');
      return; // sem dados → deixa SAIPOS tratar normalmente
    }

    console.log('[SPT] Disparando __saipos_print_from_list:', {
      id_sale:  result.id_sale,
      mesa:     result.mesa,
      comanda:  result.comanda,
      total:    result.total,
      itens:    result.sale_items.length,
      payments: result.payments.length,
      pct:      result.pct_servico,
    });

    e.stopImmediatePropagation(); // bloqueia ng-click e qualquer outro handler
    e.preventDefault();

    window.dispatchEvent(new CustomEvent('__saipos_print_from_list', {
      detail: JSON.stringify(result)
    }));
  }, true); // true = capture phase: dispara antes do ng-click (bubble)

  // --- Preenche formulário de datas do Saipos via Angular (disparado pelo content script) ---
  window.addEventListener('__saipos_fill_form', function(e) {
    var detail   = e.detail || {};
    var dateFrom = detail.dateFrom;   // 'YYYY-MM-DD'
    var dateTo   = detail.dateTo;     // 'YYYY-MM-DD'
    var saleTypes = detail.saleTypes || []; // [] = todos; ex: [1,2]

    // Converte YYYY-MM-DD → dd/MM/yyyy (formato esperado pelo datepicker)
    function isoToDisplay(iso) {
      if (!iso) return '';
      var p = iso.split('-');
      return p.length === 3 ? p[2] + '/' + p[1] + '/' + p[0] : iso;
    }

    // Define valor no input Angular do datepicker
    function setAngularDate(inputId, displayVal) {
      var el = document.getElementById(inputId);
      if (!el) return;
      try {
        if (typeof angular !== 'undefined') {
          var scope = angular.element(el).scope();
          if (scope && scope.$apply) {
            scope.$apply(function() {
              if (scope.dateString !== undefined) scope.dateString = displayVal;
            });
          }
        }
      } catch(err) {}
      // Dispara eventos nativos como fallback
      el.value = displayVal;
      ['input', 'change'].forEach(function(t) {
        el.dispatchEvent(new Event(t, { bubbles: true }));
      });
    }

    if (dateFrom) setAngularDate('datePickerSaipos_1', isoToDisplay(dateFrom));
    if (dateTo)   setAngularDate('datePickerSaipos_2', isoToDisplay(dateTo));

    // Após 700ms (Angular processar): ajusta filtros e clica Pesquisar
    setTimeout(function() {

      // Utilitário: define estado de um checkbox via Angular ou .click()
      function setCheckbox(cb, desiredChecked) {
        if (!cb || cb.checked === desiredChecked) return;
        try {
          var ngm = cb.getAttribute('ng-model');
          var scope = typeof angular !== 'undefined' && angular.element(cb).scope();
          if (scope && ngm) {
            // suporta ng-model com ponto: "filter.canceled"
            var parts = ngm.split('.');
            scope.$apply(function() {
              var obj = scope;
              for (var k = 0; k < parts.length - 1; k++) { obj = obj[parts[k]] || obj; }
              obj[parts[parts.length - 1]] = desiredChecked;
            });
          } else { cb.click(); }
        } catch(ex) { cb.click(); }
      }

      // Utilitário: encontra checkbox pelo texto do label pai
      function findCbByLabel(pattern) {
        var labels = document.querySelectorAll('label');
        for (var i = 0; i < labels.length; i++) {
          if (pattern.test(labels[i].textContent || '')) {
            var cb = labels[i].querySelector('input[type="checkbox"]');
            if (!cb) { var f = labels[i].getAttribute('for'); if (f) cb = document.getElementById(f); }
            if (cb) return cb;
          }
        }
        return null;
      }

      // ── Desmarca "Vendas canceladas" no painel Status da venda
      var cbCancelada = findCbByLabel(/cancelad/i);
      if (cbCancelada) setCheckbox(cbCancelada, false);

      // ── Tipos de atendimento: só altera se o usuário selecionou tipos específicos
      if (saleTypes.length > 0) {
        var tipoMap = [
          { pattern: /\bentrega\b|delivery/i,           type: 1 },
          { pattern: /retirada|balc[aã]o|pickup/i,      type: 2 },
          { pattern: /sal[aã]o|mesa|local/i,             type: 3 },
          { pattern: /ficha/i,                           type: 4 }
        ];
        tipoMap.forEach(function(m) {
          var cb = findCbByLabel(m.pattern);
          if (cb) setCheckbox(cb, saleTypes.indexOf(m.type) !== -1);
        });
      }

      // ── Clica no botão Pesquisar
      var btns = document.querySelectorAll('button');
      for (var j = 0; j < btns.length; j++) {
        if (/pesquisar|filtrar|buscar|search/i.test((btns[j].textContent || '').trim())) {
          btns[j].click();
          break;
        }
      }

      window.dispatchEvent(new CustomEvent('__saipos_form_filled', {}));
    }, 700);
  });

  // --- Proxy fetch para content script (ISOLATED world) ---
  // Executa fetch no contexto MAIN (mesmos cookies/origin do SPA)
  window.addEventListener('__saipos_fetch_request', function(e) {
    var req = e.detail;
    if (!req || !req.url || !req.id) return;
    var hdrs = {};
    for (var hk in auth) hdrs[hk] = auth[hk];
    var opts = { method: req.method || 'GET', credentials: 'include', headers: hdrs };
    if (req.body) {
      opts.body = typeof req.body === 'string' ? req.body : JSON.stringify(req.body);
      opts.headers['Content-Type'] = 'application/json';
    }
    origFetch.call(window, req.url, opts)
      .then(function(response) {
        var status = response.status;
        if (!response.ok) {
          window.dispatchEvent(new CustomEvent('__saipos_fetch_resp_' + req.id, {
            detail: JSON.stringify({ error: 'HTTP ' + status, status: status })
          }));
          return;
        }
        return response.json().then(function(data) {
          var json = JSON.stringify({ data: data, status: status });
          window.dispatchEvent(new CustomEvent('__saipos_fetch_resp_' + req.id, {
            detail: json
          }));
        });
      })
      .catch(function(err) {
        window.dispatchEvent(new CustomEvent('__saipos_fetch_resp_' + req.id, {
          detail: JSON.stringify({ error: err.message || 'Fetch failed' })
        }));
      });
  });
})();
