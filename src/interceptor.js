// ================================================================
// SAIPOS TOOLS v4.6.0 — interceptor.js (MAIN world, document_start)
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
        var result = {
          id_sale: sale.id_sale || sale.id,
          sale_items: [],
          mesa: sale.table_desc || sale.desc_table || '',
          comanda: sale.command_order || sale.id_command_order || '',
          garcom: sale.waiter_name || sale.desc_waiter || '',
          identificacao: sale.desc_sale || '',
          total: sale.total_price || sale.total || 0,
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

        console.log('[Saipos Interceptor] sale_items encontrados:', result.sale_items.length);
        window.dispatchEvent(new CustomEvent('__saipos_sale_items_response', {
          detail: JSON.stringify(result)
        }));
        return;
      }
    } catch(e) {
      console.error('[Saipos Interceptor] Erro ao ler Angular scope:', e);
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
      console.log('[Saipos DEBUG] Enviando cached response idx=' + idx + ' size=' + json.length);
      window.dispatchEvent(new CustomEvent('__saipos_call_response', {
        detail: json
      }));
    } catch(err) {
      console.log('[Saipos DEBUG] Erro ao serializar cached response: ' + err.message);
      window.dispatchEvent(new CustomEvent('__saipos_call_response', {
        detail: JSON.stringify({ error: 'Serialize error: ' + err.message })
      }));
    }
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
