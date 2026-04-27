// popup.js
let allSales = [];
let allDateRange = null;
let isRunning = false;
let isPaused  = false;
let currentSaleTypes = []; // [] = todos; ex: [1,3] = Entrega + Salão

// ── Catraca: estado inicial (sobrescrito por loadLockConfig) ──
const TAB_LABELS = { log: 'LOG', resumo: 'COMISSÕES', happyhour: 'HAPPY HOUR', csv: 'IMPORTAR', entrega: 'ENTREGA', estoque: 'ESTOQUE' };
let lockConfig = { password: '314159', locked: { log: false, csv: true, estoque: true, resumo: false, happyhour: false, entrega: false } };

const $ = id => document.getElementById(id);

// Produtos isentos de comissão/taxa de serviço
const PRODUTOS_ISENTOS = [
  'COUVERT ARTÍSTICO', 'COUVERT ARTISTICO',
  'COVERT ARTÍSTICO', 'COVERT ARTISTICO',
  'BRINQUEDOTECA'
];
function isIsento(nome) {
  if (!nome) return false;
  const n = nome.toUpperCase().trim();
  return PRODUTOS_ISENTOS.some(p => n.includes(p));
}

function getSaleTime(dateText, withSeconds = false) {
  const text = String(dateText || '').trim();
  if (!text) return '';
  const match = text.match(/(\d{2}:\d{2})(?::(\d{2}))?/);
  if (!match) return '';
  if (!withSeconds) return match[1];
  return match[2] ? `${match[1]}:${match[2]}` : match[1];
}

function filterSalesByTimeRange(sales, timeFrom, timeTo) {
  if (!timeFrom && !timeTo) return Array.isArray(sales) ? [...sales] : [];
  return (sales || []).filter(sale => {
    const hora = getSaleTime(sale.dateText);
    if (!hora) return true;
    if (timeFrom && hora < timeFrom) return false;
    if (timeTo && hora > timeTo) return false;
    return true;
  });
}

function getSalesForCurrentFilters(sales = allSales) {
  const timeFrom = $('pTimeFrom') ? $('pTimeFrom').value : '';
  const timeTo = $('pTimeTo') ? $('pTimeTo').value : '';
  return filterSalesByTimeRange(sales, timeFrom, timeTo);
}

// ── Helpers ──────────────────────────────────────────────────
function setStatus(st, label) {
  $('dot').className = 'dot ' + (st || '');
  $('statusLabel').textContent = label;
}

function setProgress(cur, tot) {
  const pct = tot > 0 ? Math.round(cur / tot * 100) : 0;
  $('progFill').style.width = pct + '%';
  $('progLabel').textContent = `${cur} / ${tot} vendas`;
  $('pctBadge').textContent  = tot > 0 ? pct + '%' : '';
}

function addLog(entry) {
  const container = $('log-content');
  if (!container) return;
  const empty = container.querySelector('.empty');
  if (empty) empty.remove();

  const div = document.createElement('div');
  div.className = `log-line ${entry.type || ''}`;
  div.innerHTML = `<span class="ll-time">${entry.time}</span><span class="ll-msg">${entry.msg}</span>`;
  container.appendChild(div);
  
  const panel = $('panel-log');
  if (panel) panel.scrollTop = panel.scrollHeight;
}

function setButtons(running) {
  $('bStart').disabled  =  running;
  $('bPause').disabled  = !running;
  $('bStop').disabled   = !running;
  $('bReport').disabled =  running || allSales.length === 0;
  if ($('bDayReport')) $('bDayReport').disabled = running || allSales.length === 0;
  const delBtn = $('bDeliveryReport');
  if (delBtn) delBtn.disabled = running || allSales.length === 0;
}

// ── Check URL ────────────────────────────────────────────────
async function checkUrl() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const ok = tab && tab.url && tab.url.includes('conta.saipos.com');
  $('urlWarn').classList.toggle('show', !ok);
  return ok;
}

// ── Tabs ─────────────────────────────────────────────────────
function switchToTab(tabKey) {
  document.querySelectorAll('.tab').forEach(x => x.classList.remove('active'));
  document.querySelectorAll('.panel').forEach(x => x.classList.remove('active'));
  const tabEl = document.querySelector(`.tab[data-tab="${tabKey}"]`);
  const panelEl = document.getElementById('panel-' + tabKey);
  if (tabEl) tabEl.classList.add('active');
  if (panelEl) panelEl.classList.add('active');
}

document.querySelectorAll('.tab').forEach(t => {
  t.addEventListener('click', () => switchToTab(t.dataset.tab));
});

// ── Comunicação com content ──────────────────────────────────
async function sendContent(action) {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab) return null;
  return chrome.tabs.sendMessage(tab.id, { action }).catch(() => null);
}
// ── API STATUS ───────────────────────────────────────────
function setApiStatus(status, label) {
  const dot = $('apiDot');
  const lbl = $('apiLabel');
  dot.className = 'api-dot ' + (status || '');
  lbl.textContent = label;
}

$('bTest').addEventListener('click', async () => {
  const ok = await checkUrl();
  if (!ok) return;
  setApiStatus('warn', 'API: testando...');
  const result = await sendContent('TEST_API');
  if (!result) {
    setApiStatus('err', 'API: sem resposta do content script');
    return;
  }
  if (result.auth && result.listing) {
    setApiStatus('ok', 'API: OK — ' + result.salesCount + ' vendas encontradas');
  } else if (result.auth) {
    setApiStatus('warn', 'API: auth OK, endpoint não encontrado. Aplique o filtro.');
  } else {
    setApiStatus('err', 'API: sem auth. Faça login no Saipos.');
  }
});
// ── INICIAR ──────────────────────────────────────────────────
$('bStart').addEventListener('click', async () => {
  const dateFrom = $('pDateFrom').value;  // 'YYYY-MM-DD'
  const dateTo   = $('pDateTo').value;
  const timeFrom = $('pTimeFrom').value;
  const timeTo   = $('pTimeTo').value;
  // Lê checkboxes de tipo marcados; [] = todos
  const saleTypes = Array.from(document.querySelectorAll('#pSaleTypes input:checked')).map(el => Number(el.value));
  currentSaleTypes = saleTypes;

  allSales = [];
  allDateRange = null; // limpa período anterior para evitar relatório com datas erradas
  $('log-content').innerHTML = '';
  $('resumo-content').innerHTML = '<div class="empty"><big>👤</big>Processando...</div>';
  isRunning = true;
  isPaused  = false;
  setStatus('run', 'Iniciando...');
  setProgress(0, 0);
  setButtons(true);
  // Remove dados de relatório anteriores para garantir que novo relatório use só os novos dados
  chrome.storage.local.remove(['saiposReportData', 'saiposReportDayData']).catch(() => {});
  chrome.runtime.sendMessage({ type: 'RESET' }).catch(() => {});

  // Salva parâmetros para uso nos relatórios (tempo e tipo)
  await chrome.storage.local.set({
    saiposSearchParams: { dateFrom, dateTo, timeFrom, timeTo, saleTypes },
    saiposReportTimeFrom: timeFrom,
    saiposReportTimeTo: timeTo
  });

  const TARGET = 'https://conta.saipos.com/#/app/report/sales-by-period';
  let [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

  const onSaipos       = tab && tab.url && tab.url.includes('conta.saipos.com');
  const onCorrectPage  = onSaipos && tab.url.includes('sales-by-period');

  // Navega para a página correta se necessário
  if (!tab) {
    tab = await chrome.tabs.create({ url: TARGET });
  } else if (!onSaipos) {
    setStatus('warn', 'Abrindo Saipos...');
    await chrome.tabs.update(tab.id, { url: TARGET });
  } else if (!onCorrectPage) {
    setStatus('run', 'Navegando para relatório...');
    await chrome.tabs.update(tab.id, { url: TARGET });
  }

  // Se datas foram fornecidas, envia FILL_AND_SEARCH com retry
  if (dateFrom || dateTo) {
    setStatus('run', 'Aguardando página...');
    let filled = false;
    for (let i = 0; i < 20; i++) { // até 10s
      await new Promise(r => setTimeout(r, 500));
      const res = await chrome.tabs.sendMessage(tab.id, {
        action: 'FILL_AND_SEARCH', dateFrom, dateTo, saleTypes
      }).catch(() => null);
      if (res && res.ok) { filled = true; break; }
    }
    if (!filled) {
      setStatus('warn', 'Página não respondeu — preencha as datas manualmente');
      isRunning = false;
      setButtons(false);
    } else {
      setStatus('run', 'Formulário preenchido, aguardando busca...');
    }
  } else {
    // Sem datas: fluxo manual (usuário já aplicou filtro no Saipos)
    const ok = await checkUrl();
    if (!ok) { isRunning = false; setButtons(false); return; }
    await sendContent('START');
  }
});

// ── PAUSAR ───────────────────────────────────────────────────
$('bPause').addEventListener('click', async () => {
  const res = await sendContent('PAUSE');
  isPaused = res ? res.paused : !isPaused;
  $('bPause').textContent = isPaused ? '▶ RETOMAR' : '⏸ PAUSAR';
  setStatus(isPaused ? 'warn' : 'run', isPaused ? 'Pausado' : 'Rodando...');
  // Sincroniza estado pausado com background
  chrome.runtime.sendMessage({ type: 'PAUSED', paused: isPaused }).catch(() => {});
});

// ── PARAR ────────────────────────────────────────────────────
$('bStop').addEventListener('click', async () => {
  await sendContent('STOP');
  isRunning = false;
  $('bPause').textContent = '⏸ PAUSAR';
  setStatus('', 'Interrompido');
  setButtons(false);
  // Atualiza status no background
  chrome.runtime.sendMessage({ type: 'STATUS', status: 'stopped' }).catch(() => {});
});

// ── LIMPAR LOG ───────────────────────────────────────────────
$('btnClearLog').addEventListener('click', () => {
  const lc = $('log-content');
  if (lc) lc.innerHTML = '<div class="empty"><big>🤖</big>Log limpo.</div>';
});

// ── RELATÓRIO ENTREGAS ─────────────────────────────────────────────
$('bDeliveryReport').addEventListener('click', async () => {
  const filteredSales = getSalesForCurrentFilters(allSales);
  if (filteredSales.length === 0) return;

  // Extrai nome da loja do DOM (mesmo método do relatório de comissões)
  let storeName = 'Loja Saipos';
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab && tab.url && tab.url.includes('conta.saipos.com')) { // só executa em tab do Saipos
      const res = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: () => {
          const span = document.querySelector('span.tm-label[uib-tooltip]');
          return span ? span.textContent.trim() : null;
        }
      });
      if (res && res[0] && res[0].result) storeName = res[0].result;
    }
  } catch (_) {}

  // Filter: only delivery type (saleType === 1) and NOT canceled
  let deliverySales = filteredSales.filter(s => !s.canceled && s.saleType === 1);
  const isFallback = deliverySales.length === 0;
  if (isFallback) deliverySales = filteredSales.filter(s => !s.canceled);

  // Enriquece entregadores ausentes via fetch individual (API por saleId)
  const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const missingEnt = deliverySales.filter(s => !s.entregador || !s.entregador.trim());
  if (missingEnt.length > 0 && activeTab) {
    try {
      const saleIds = missingEnt.map(s => String(s.saleId || s._rawId || s.idx)).filter(Boolean);
      const detRes = await chrome.tabs.sendMessage(activeTab.id, {
        action: 'FETCH_DELIVERY_MAN', saleIds
      }).catch(() => null);
      if (detRes && detRes.results) {
        const nameMap = {};
        detRes.results.forEach(r => { if (r.entregador) nameMap[r.saleId] = r.entregador; });
        deliverySales.forEach(s => {
          const id = String(s.saleId || s._rawId || s.idx);
          if (nameMap[id] && (!s.entregador || !s.entregador.trim())) s.entregador = nameMap[id];
        });
      }
    } catch(e) {}
  }

  await chrome.storage.local.set({
    saiposDeliveryData: { sales: deliverySales, storeName, dateRange: allDateRange, fallback: isFallback }
  });

  chrome.tabs.create({ url: chrome.runtime.getURL('pages/delivery-report.html') });
});
$('bReport').addEventListener('click', async () => {
  const filteredSales = getSalesForCurrentFilters(allSales);
  if (filteredSales.length === 0) return;

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab) return;

  // Extrai nome da loja do Saipos (só executa em tab do Saipos)
  let storeName = 'Loja Saipos';
  if (tab.url && tab.url.includes('conta.saipos.com')) {
    try {
      const storeResult = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: () => {
          const span = document.querySelector('span.tm-label[uib-tooltip]');
          if (span) {
            const tooltip = span.getAttribute('uib-tooltip');
            if (tooltip) return tooltip;
          }
          if (span) return span.textContent.trim();
          return null;
        }
      });
      if (storeResult && storeResult[0] && storeResult[0].result) storeName = storeResult[0].result;
    } catch (_) {}
  }

  // Salva dados no storage para a página de relatório
  await chrome.storage.local.set({
    saiposReportData: {
      sales: filteredSales,
      storeName: storeName,
      dateRange: allDateRange
    },
    saiposReportTimeFrom: $('pTimeFrom').value || '',
    saiposReportTimeTo: $('pTimeTo').value || ''
  });

  // Abre a página de relatório (CSP-compliant)
  chrome.tabs.create({ url: chrome.runtime.getURL('pages/report.html') });
});

// ── Relatório separado por dia (uma guia por dia, máx 15) ────
$('bDayReport') && $('bDayReport').addEventListener('click', async () => {
  const filteredSales = getSalesForCurrentFilters(allSales);
  if (filteredSales.length === 0) return;

  const dateFrom = $('pDateFrom').value;
  const dateTo   = $('pDateTo').value;
  if (!dateFrom || !dateTo) { alert('Defina o período nos campos Data De / Data Até.'); return; }

  // Gera lista de dias do período
  const days = [];
  const cur = new Date(dateFrom + 'T00:00:00');
  const end = new Date(dateTo   + 'T00:00:00');
  while (cur <= end) {
    days.push(cur.toISOString().slice(0, 10));
    cur.setDate(cur.getDate() + 1);
  }

  if (days.length > 15) {
    alert(`Período com ${days.length} dias — máximo permitido é 15.\nAjuste o filtro de datas.`);
    return;
  }
  if (days.length === 0) { alert('Período inválido.'); return; }

  // Extrai nome da loja
  let storeName = 'Loja Saipos';
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab && tab.url && tab.url.includes('conta.saipos.com')) {
    try {
      const r = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: () => { const s = document.querySelector('span.tm-label[uib-tooltip]'); return s ? (s.getAttribute('uib-tooltip') || s.textContent.trim()) : null; }
      });
      if (r && r[0] && r[0].result) storeName = r[0].result;
    } catch (_) {}
  }

  // Salva dados compartilhados (chave separada — não é apagada automaticamente pela guia de relatório)
  await chrome.storage.local.set({
    saiposReportDayData: { sales: filteredSales, storeName, dateRange: allDateRange },
    saiposReportTimeFrom: $('pTimeFrom').value || '',
    saiposReportTimeTo:   $('pTimeTo').value   || ''
  });

  // Abre uma guia por dia
  for (const day of days) {
    chrome.tabs.create({ url: chrome.runtime.getURL('pages/report.html') + '?date=' + day });
  }
});

// ── Mensagens vindas do content / background ─────────────────
chrome.runtime.onMessage.addListener(msg => {
  if (msg.type === 'LOG')      addLog(msg.entry);
  if (msg.type === 'PROGRESS') {
    setProgress(msg.current, msg.total);
    setStatus('run', `[${msg.current}/${msg.total}] ${msg.msg || ''}`);
  }
  if (msg.type === 'TOTAL')    setProgress(0, msg.total);
  if (msg.type === 'STATUS' && msg.status === 'error') {
    setStatus('err', msg.msg || 'Erro');
    setButtons(false);
    addLog({ msg: '❌ ' + (msg.msg || 'Erro desconhecido'), type: 'error', time: new Date().toLocaleTimeString('pt-BR') });
  }
  if (msg.type === 'DONE') {
    if (allSales.length > 0 && msg.sales && isRunning) return; // Prevent double DONE durante coleta ativa
    // Filtra por tipos selecionados ([] = todos)
    allSales = currentSaleTypes.length > 0
      ? (msg.sales || []).filter(s => currentSaleTypes.includes(s.saleType))
      : (msg.sales || []);
    const filteredSales = getSalesForCurrentFilters(allSales);
    allDateRange = msg.dateRange || null;
    isRunning = false;
    setStatus('done', `✅ ${filteredSales.length} vendas concluídas`);
    setButtons(false);
    renderResumo(filteredSales);
    renderAlertas(filteredSales);
    // Se somente Entrega selecionada → abre rel. entrega; caso contrário → comissões
    const onlyEntrega = currentSaleTypes.length === 1 && currentSaleTypes[0] === 1;
    addLog({ msg: `🎉 Pronto! ${filteredSales.length} vendas · abrindo ${onlyEntrega ? 'rel. entrega' : 'relatório'}...`, type: 'info', time: new Date().toLocaleTimeString('pt-BR') });

    setTimeout(() => {
      if (onlyEntrega) $('bDeliveryReport').click();
      else             $('bReport').click();
    }, 500);
  }
});

// ── Render Resumo ────────────────────────────────────────────
function renderResumo(sales) {
  const garcom = {};
  for (const s of sales) {
    if (s.canceled || !s.items) continue;
    const totalNaoIsento = s.items.filter(i => !i.itemCancelado && !isIsento(i.nome)).reduce((a, i) => a + i.valor * i.qtd, 0);
    for (const item of s.items) {
      if (item.itemCancelado) continue;
      const g  = (item.garcom || '?').toUpperCase().trim();
      const vt = item.valor * item.qtd;
      const exempt = isIsento(item.nome);
      const ci = (!exempt && totalNaoIsento > 0) ? (vt / totalNaoIsento) * s.taxa : 0;
      if (!garcom[g]) garcom[g] = { venda: 0, comissao: 0, qtd: 0 };
      garcom[g].venda    += vt;
      garcom[g].comissao += ci;
      garcom[g].qtd++;
    }
  }

  const panel = $('resumo-content');
  if (Object.keys(garcom).length === 0) {
    panel.innerHTML = '<div class="empty"><big>👤</big>Sem dados.</div>';
    return;
  }

  panel.innerHTML = '';
  for (const [g, v] of Object.entries(garcom).sort((a,b) => b[1].comissao - a[1].comissao)) {
    const div = document.createElement('div');
    div.className = 'gc-row';
    div.innerHTML = `
      <div class="gc-name"><span>👤 ${g}</span><span>R$ ${fmt(v.comissao)}</span></div>
      <div class="gc-stats">
        <div class="gc-stat"><span>Total vendido</span><b>R$ ${fmt(v.venda)}</b></div>
        <div class="gc-stat"><span>Comissão</span><b>R$ ${fmt(v.comissao)}</b></div>
        <div class="gc-stat"><span>Itens</span><b>${v.qtd}</b></div>
      </div>`;
    panel.appendChild(div);
  }
}

// ── Render Alertas ───────────────────────────────────────────
function renderAlertas(sales) {
  const panel = $('panel-alertas');
  if (!panel) return;

  const semTaxa   = sales.filter(s => !s.canceled && s.totalItens > 0 && s.taxa === 0);
  const baixaTaxa = sales.filter(s => {
    if (s.canceled || s.totalItens === 0) return false;
    const p = s.taxa / s.totalItens * 100;
    return p > 0 && p < 9.95;
  });
  const canceladas = sales.filter(s => s.canceled);

  if (!semTaxa.length && !baixaTaxa.length && !canceladas.length) {
    panel.innerHTML = '<div class="empty"><big>✅</big>Sem alertas!</div>';
    return;
  }

  let h = '';

  if (semTaxa.length) {
    h += `<div class="sec-label">❌ Sem taxa (${semTaxa.length})</div>
    <table class="alert-tbl"><thead><tr><th>Mesa</th><th>Cmd</th><th>Horário</th><th>Itens</th><th>Taxa</th></tr></thead><tbody>`;
    for (const s of semTaxa) {
      h += `<tr><td>M${s.mesa}</td><td>C${s.comanda}</td><td>${getSaleTime(s.dateText, true)}</td>
            <td>R$ ${fmt(s.totalItens)}</td><td><span class="badge b-zero">0%</span></td></tr>`;
    }
    h += '</tbody></table>';
  }

  if (baixaTaxa.length) {
    h += `<div class="sec-label">⚠️ Taxa &lt; 10% (${baixaTaxa.length})</div>
    <table class="alert-tbl"><thead><tr><th>Mesa</th><th>Cmd</th><th>Horário</th><th>Itens</th><th>%</th></tr></thead><tbody>`;
    for (const s of baixaTaxa) {
      const p = (s.taxa / s.totalItens * 100).toFixed(1).replace('.',',');
      h += `<tr><td>M${s.mesa}</td><td>C${s.comanda}</td><td>${getSaleTime(s.dateText, true)}</td>
            <td>R$ ${fmt(s.totalItens)}</td><td><span class="badge b-low">${p}%</span></td></tr>`;
    }
    h += '</tbody></table>';
  }

  if (canceladas.length) {
    h += `<div class="sec-label">🚫 Canceladas (${canceladas.length})</div>
    <table class="alert-tbl"><thead><tr><th>Mesa</th><th>Cmd</th><th>Horário</th><th>Total</th></tr></thead><tbody>`;
    for (const s of canceladas) {
      h += `<tr><td>M${s.mesa}</td><td>C${s.comanda}</td><td>${getSaleTime(s.dateText, true)}</td>
            <td>R$ ${fmt(s.total)}</td></tr>`;
    }
    h += '</tbody></table>';
  }

  panel.innerHTML = h;
}

// ── Formato moeda ────────────────────────────────────────────
function fmt(n) {
  return (n || 0).toFixed(2).replace('.', ',').replace(/\B(?=(\d{3})+(?!\d))/g, '.');
}

// ── Restaurar estado do background ──────────────────────────
async function restoreState() {
  try {
    const state = await chrome.runtime.sendMessage({ type: 'GET_STATE' });
    if (!state) return;

    // Restaura logs
    if (state.logs && state.logs.length > 0) {
      $('log-content').innerHTML = '';
      for (const entry of state.logs) {
        addLog(entry);
      }
    }

    // Restaura progresso
    if (state.status === 'running' && state.progress) {
      isRunning = true;
      isPaused = state.progress.paused || false;
      setProgress(state.progress.current || 0, state.progress.total || state.total || 0);
      setStatus('run', `[${state.progress.current || 0}/${state.progress.total || state.total || 0}] ${state.progress.msg || 'Processando...'}`);
      setButtons(true);
      $('resumo-content').innerHTML = '<div class="empty"><big>👤</big>Processando...</div>';
      
      if (isPaused) {
        $('bPause').textContent = '▶ RETOMAR';
        setStatus('warn', 'Pausado');
      }
    }

    // Restaura se já terminou
    if (state.status === 'done' && state.sales && state.sales.length > 0) {
      allSales = state.sales;
      const filteredSales = getSalesForCurrentFilters(allSales);
      setStatus('done', `✅ ${filteredSales.length} vendas concluídas`);
      setButtons(false);
      renderResumo(filteredSales);
      renderAlertas(filteredSales);
    }

  } catch (e) {
  }
}

// ── CSV Import Logic ─────────────────────────────────────────

// v6.6.0 — Verifica se existe importação para desfazer
async function checkUndoAvailable() {
  try {
    const data = await chrome.storage.local.get('lastImport');
    const record = data?.lastImport;
    const btnUndo = $('btnUndoImport');
    const undoInfo = $('undoInfo');
    if (record && record.products?.length > 0) {
      btnUndo.style.display = 'block';
      undoInfo.style.display = 'block';
      undoInfo.innerHTML = `📦 Última importação: <b>${record.total} produtos</b> em ${record.date}`;
    } else {
      btnUndo.style.display = 'none';
      undoInfo.style.display = 'none';
    }
  } catch(e) {}
}
checkUndoAvailable();

// v6.6.0 — Botão desfazer última importação
$('btnUndoImport').addEventListener('click', async () => {
  const logStatus = $('csvLogStatus');
  if (!confirm('Tem certeza? Todos os produtos da última importação serão DELETADOS do Saipos.')) return;
  logStatus.innerText = '🔄 Iniciando remoção...';
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab) { logStatus.innerText = '❌ Aba do Saipos não encontrada!'; return; }
    const res = await chrome.tabs.sendMessage(tab.id, { action: 'UNDO_IMPORT' });
    if (res && res.error) logStatus.innerText = '❌ ' + res.error;
  } catch(err) {
    logStatus.innerText = '❌ Erro de comunicação: recarregue a página do Saipos.';
  }
});

$('btnProcessCsv').addEventListener('click', async () => {
    const textInput = $('csvTextInputSaipos');
    const logStatus = $('csvLogStatus');
    const text = textInput.value.trim();

    if (!text) {
        logStatus.innerText = '❌ Cole o conteúdo do CSV primeiro!';
        return;
    }

    logStatus.innerText = '🔄 Processando texto...';

    const rows = text.split('\n').filter(row => row.trim().length > 0);
    
    // Se a primeira linha tiver cabeçalho (ex: nome,valor), removemos
    if (rows[0].toLowerCase().includes('nome') || rows[0].toLowerCase().includes('valor')) {
        rows.shift();
    }

    if (rows.length === 0) {
        logStatus.innerText = '❌ Nenhuma linha de dados encontrada!';
        return;
    }

    logStatus.innerText = '🔄 Solicitando importação à extensão...';
    
    try {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (!tab) {
            logStatus.innerText = '❌ Aba do Saipos não encontrada!';
            return;
        }
        
        const res = await chrome.tabs.sendMessage(tab.id, { action: 'IMPORT_CSV', rows });
        if (res && res.error) {
            logStatus.innerText = '❌ ' + res.error;
        } else if (res && res.started) {
            $('csvTextInputSaipos').value = '';
        }
    } catch(err) {
        logStatus.innerText = '❌ Erro de comunicação com a página: recarregue a página do Saipos.';
    }
});

// O content.js avisa o log de CSV
chrome.runtime.onMessage.addListener(msg => {
    if (msg.type === 'CSV_LOG') {
        const logStatus = $('csvLogStatus');
        if (logStatus) logStatus.innerHTML = msg.text;
    }
    // v6.6.0 — atualiza botão desfazer após importação ou undo
    if (msg.type === 'IMPORT_DONE' || msg.type === 'UNDO_DONE') {
        checkUndoAvailable();
    }
    // Delivery import log
    if (msg.type === 'DELIVERY_LOG') {
        const logStatus = $('deliveryLogStatus');
        if (logStatus) logStatus.innerHTML = msg.text;
    }
});

// ── IMPORTAR TAXAS DE ENTREGA ────────────────────────────────
$('btnImportDelivery').addEventListener('click', async () => {
    const textarea = $('deliveryCsvInput');
    const logStatus = $('deliveryLogStatus');
    const text = textarea.value.trim();

    if (!text) {
        logStatus.innerHTML = '❌ Cole a lista de bairros e valores primeiro!';
        return;
    }

    const rows = text.split('\n')
        .map(l => l.trim())
        .filter(l => l.length > 0 && l.includes(','));

    if (rows.length === 0) {
        logStatus.innerHTML = '❌ Formato inválido. Use: <code>Bairro,10.00</code> por linha.';
        return;
    }

    logStatus.innerHTML = `⏳ Preparando importação de ${rows.length} bairros...`;

    try {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (!tab) {
            logStatus.innerHTML = '❌ Aba do Saipos não encontrada!';
            return;
        }
        if (!tab.url || !tab.url.includes('conta.saipos.com')) {
            logStatus.innerHTML = '❌ Acesse <b>conta.saipos.com/#/app/store/delivery-area</b> primeiro.';
            return;
        }

        const res = await chrome.tabs.sendMessage(tab.id, { action: 'IMPORT_DELIVERY', rows }).catch(() => null);
        if (res && res.error) {
            logStatus.innerHTML = '❌ ' + res.error;
        } else if (res && res.started) {
            logStatus.innerHTML = `🛵 Importação iniciada! ${rows.length} bairros na fila...`;
        } else {
            logStatus.innerHTML = '❌ Sem resposta. Recarregue a página do Saipos e tente novamente.';
        }
    } catch (err) {
        logStatus.innerHTML = '❌ Erro: ' + err.message;
    }
});

// ── Happy Hour Promo Logic ───────────────────────────────
let hhPromos = [];

// Salva promos em local + sync (dupla persistência — garante recuperação se um falhar)
async function savePromosToStorage(promos) {
  const payload = { saipos_happyhour: promos };
  await chrome.storage.local.set(payload);
  try { await chrome.storage.sync.set(payload); } catch (e) {} // sync tem limite de quota; ignorar erro
}

// ── Currency Mask ────────────────────────────────────────
function applyCurrencyMask(input) {
  input.addEventListener('input', () => {
    let v = input.value.replace(/\D/g, '');
    if (!v) { input.value = ''; return; }
    v = (parseInt(v, 10) / 100).toFixed(2);
    input.value = 'R$ ' + v.replace('.', ',');
  });
}

function parseCurrency(str) {
  if (!str) return NaN;
  return parseFloat(str.replace(/[^\d,]/g, '').replace(',', '.'));
}

function formatCurrency(val) {
  return 'R$ ' + val.toFixed(2).replace('.', ',');
}

function initHH() {
  // Toggle dias
  document.querySelectorAll('.day-btn').forEach(btn => {
    btn.addEventListener('click', () => btn.classList.toggle('active'));
  });

  // Máscaras de moeda
  applyCurrencyMask($('hhPriceNormal'));
  applyCurrencyMask($('hhPricePromo'));

  // Salvar
  $('bSaveHH').addEventListener('click', saveHH);

  $('btnHHExport').addEventListener('click', exportConfig);
  $('btnHHImport').addEventListener('click', () => $('hhImportFile').click());
  $('hhImportFile').addEventListener('change', (e) => {
    if (e.target.files.length > 0) importConfig(e.target.files[0]);
  });

  loadPromos();
}

async function exportConfig() {
  const data = await chrome.storage.local.get(null);
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `saipos_tools_backup_${new Date().toISOString().split('T')[0]}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

function importConfig(file) {
  const reader = new FileReader();
  reader.onload = async (e) => {
    try {
      const data = JSON.parse(e.target.result);
      if (confirm('Isso irá sobrescrever as configurações atuais (Happy Hour, Logs, etc). Continuar?')) {
        await chrome.storage.local.clear();
        await chrome.storage.local.set(data);
        alert('Backup restaurado com sucesso! Reiniciando...');
        window.location.reload();
      }
    } catch (err) {
      alert('Erro ao importar arquivo: arquivo inválido ou corrompido.');
    }
  };
  reader.readAsText(file);
}

async function saveHH() {
    const editId = $('hhEditId').value;
    const prod = $('hhProd').value.trim();
    const priceNormal = parseCurrency($('hhPriceNormal').value);
    const pricePromo = parseCurrency($('hhPricePromo').value);
    const startTime = $('hhStart').value;
    const endTime = $('hhEnd').value;
    const days = Array.from(document.querySelectorAll('.day-btn.active')).map(b => parseInt(b.dataset.day));

    if (!prod || isNaN(priceNormal) || isNaN(pricePromo) || !startTime || !endTime || days.length === 0) {
      alert('Preencha o Nome Exato do Produto, Preços e selecione ao menos um dia.');
      return;
    }

    if (editId) {
      const existing = hhPromos.find(x => x.id === editId);
      if (existing) {
        existing.prod = prod;
        existing.priceNormal = priceNormal;
        existing.pricePromo = pricePromo;
        existing.startTime = startTime;
        existing.endTime = endTime;
        existing.days = days;
        existing.lastApplied = null; // forçar reavaliação imediata
      }
    } else {
      const newPromo = {
        id: Date.now().toString(),
        prod,
        priceNormal,
        pricePromo,
        startTime,
        endTime,
        days,
        active: true,
        lastApplied: null
      };
      hhPromos.push(newPromo);
    }
    
    await savePromosToStorage(hhPromos);
    
    // Limpar form
    $('hhEditId').value = '';
    $('hhProd').value = '';
    $('hhPriceNormal').value = '';
    $('hhPricePromo').value = '';
    $('bSaveHH').textContent = '+ SALVAR PROMOÇÃO';
    
    renderPromos();
}


async function loadPromos() {
  const res = await chrome.storage.local.get('saipos_happyhour');
  if (res.saipos_happyhour && res.saipos_happyhour.length > 0) {
    hhPromos = res.saipos_happyhour;
  } else {
    // Fallback: tenta recuperar do sync (cobre reinstalação da extensão)
    try {
      const syncRes = await chrome.storage.sync.get('saipos_happyhour');
      if (syncRes.saipos_happyhour && syncRes.saipos_happyhour.length > 0) {
        hhPromos = syncRes.saipos_happyhour;
        await savePromosToStorage(hhPromos); // restaura local
      } else {
        hhPromos = [];
      }
    } catch (e) { hhPromos = []; }
  }
  renderPromos();
}

document.addEventListener('DOMContentLoaded', async () => {
  // Configura a versão dinamicamente pelo manifest
  const manifest = chrome.runtime.getManifest();
  const vSpan = document.getElementById('app-version');
  if (vSpan && manifest && manifest.version) vSpan.textContent = 'v' + manifest.version;

  // Busca e exibe nome fantasia da empresa na aba ativa do Saipos
  try {
    const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (activeTab && activeTab.url && activeTab.url.includes('conta.saipos.com')) {
      const storeRes = await chrome.scripting.executeScript({
        target: { tabId: activeTab.id },
        func: () => {
          const span = document.querySelector('span.tm-label[uib-tooltip]');
          if (!span) return null;
          return span.getAttribute('uib-tooltip') || span.textContent.trim() || null;
        }
      });
      const nome = storeRes && storeRes[0] && storeRes[0].result;
      if (nome) {
        const badge = document.getElementById('store-badge');
        const label = document.getElementById('store-name-label');
        if (badge && label) {
          label.textContent = nome;
          badge.classList.add('show'); // torna badge visível
        }
      }
    }
  } catch (_) {} // aba pode não ser Saipos — ignorar silenciosamente

  // Inicializa inputs de data com hoje como padrão
  const todayISO = new Date().toISOString().slice(0, 10);
  if ($('pDateFrom') && !$('pDateFrom').value) $('pDateFrom').value = todayISO;
  if ($('pDateTo')   && !$('pDateTo').value)   $('pDateTo').value   = todayISO;

  const res = await chrome.storage.local.get(['saipos_status', 'saiposSearchParams']);
  if (res.saipos_status) {
    isRunning = res.saipos_status.running;
    if (res.saipos_status.sales) allSales = res.saipos_status.sales;
  }
  if (res.saiposSearchParams) {
    const params = res.saiposSearchParams;
    if ($('pDateFrom') && params.dateFrom) $('pDateFrom').value = params.dateFrom;
    if ($('pDateTo') && params.dateTo) $('pDateTo').value = params.dateTo;
    if ($('pTimeFrom')) $('pTimeFrom').value = params.timeFrom || '';
    if ($('pTimeTo')) $('pTimeTo').value = params.timeTo || '';
    if (Array.isArray(params.saleTypes) && params.saleTypes.length > 0) {
      currentSaleTypes = params.saleTypes.map(Number).filter(n => !Number.isNaN(n));
      document.querySelectorAll('#pSaleTypes input').forEach(el => {
        el.checked = currentSaleTypes.includes(Number(el.value));
      });
    }
  }
  await restoreState();
  
  await loadPromos(); // carrega de local ou sync (com fallback automático)
});

const DAYS_SHORT = ['DOM', 'SEG', 'TER', 'QUA', 'QUI', 'SEX', 'SAB'];

function renderPromos() {
  const container = $('hhList');
  if (hhPromos.length === 0) {
    container.innerHTML = '<div class="empty" style="padding:20px"><big>⏰</big>Nenhuma promoção cadastrada.</div>';
    return;
  }

  container.innerHTML = hhPromos.map(p => `
    <div class="hh-item">
      <div class="hh-info">
        <div class="hh-name"><span class="hh-status ${p.active ? 'on' : 'off'}"></span>${p.prod} <span style="opacity:0.5;font-weight:400;font-size:10px">(#${p.saiposId || p.id.substring(0,4)})</span></div>
        <div class="hh-details">📅 ${p.days.map(d => DAYS_SHORT[d]).join(', ')} • ⏰ ${p.startTime} às ${p.endTime}</div>
        <div class="hh-price">
          <span class="p-old">${formatCurrency(p.priceNormal)}</span>
          <span class="p-new">${formatCurrency(p.pricePromo)}</span>
        </div>
      </div>
      <div class="hh-actions">
        <button class="btn-sm b-tgl ${p.active ? '' : 'off'}" data-id="${p.id}">${p.active ? '✅ ATIVO' : '⏸ OFF'}</button>
        <button class="btn-sm b-edit" data-id="${p.id}" style="background:var(--p2);color:white">✏️ EDITAR</button>
        <button class="btn-sm b-del" data-id="${p.id}">🗑 EXCLUIR</button>
      </div>
    </div>
  `).join('');

  // Listeners das ações
  container.querySelectorAll('.b-del').forEach(btn => {
    btn.addEventListener('click', async () => {
      hhPromos = hhPromos.filter(x => x.id !== btn.dataset.id);
      await savePromosToStorage(hhPromos);
      renderPromos();
    });
  });

  container.querySelectorAll('.b-edit').forEach(btn => {
    btn.addEventListener('click', () => {
      const p = hhPromos.find(x => x.id === btn.dataset.id);
      if (p) {
        $('hhEditId').value = p.id;
        $('hhProd').value = p.prod;
        $('hhPriceNormal').value = formatCurrency(p.priceNormal);
        $('hhPricePromo').value = formatCurrency(p.pricePromo);
        $('hhStart').value = p.startTime;
        $('hhEnd').value = p.endTime;
        
        document.querySelectorAll('.day-btn').forEach(b => {
          b.classList.toggle('active', p.days.includes(parseInt(b.dataset.day)));
        });
        
        $('bSaveHH').textContent = '💾 ATUALIZAR PROMOÇÃO';
        $('hhProd').focus();
        // Rola pro topo suavemente
        window.scrollTo({ top: 0, behavior: 'smooth' });
      }
    });
  });

  container.querySelectorAll('.b-tgl').forEach(btn => {
    btn.addEventListener('click', async () => {
      const p = hhPromos.find(x => x.id === btn.dataset.id);
      if (p) {
        p.active = !p.active;
        await savePromosToStorage(hhPromos);
        renderPromos();
      }
    });
  });
}

// ══════════════════════════════════════════════════════════════
// ESTOQUE — catraca com senha, backup e exclusão em massa
// ══════════════════════════════════════════════════════════════
const STOCK_PASSWORD = '314159'; // senha da catraca
let stockUnlocked = false;

function stockLock() {
  stockUnlocked = false;
  $('estoque-locked').style.display  = '';
  $('estoque-unlocked').style.display = 'none';
  $('sptPadlock').classList.remove('open'); // fecha o cadeado
  $('stockPassword').value = '';
  $('lockError').classList.remove('show');
  $('stockOpArea').style.display = 'none'; // esconde log anterior
}

function stockUnlock() {
  stockUnlocked = true;
  // Animação do cadeado abrindo
  $('sptPadlock').classList.add('open');
  // Pequeno delay para ver a animação antes de trocar o painel
  setTimeout(() => {
    $('estoque-locked').style.display   = 'none';
    $('estoque-unlocked').style.display = '';
  }, 450);
}

// Botão "Entrar"
$('btnUnlock').addEventListener('click', () => {
  const val = $('stockPassword').value.trim();
  if (val === STOCK_PASSWORD) {
    $('lockError').classList.remove('show');
    stockUnlock();
  } else {
    $('lockError').classList.add('show');
    $('stockPassword').value = '';
    $('stockPassword').focus();
  }
});

// Enter no campo de senha também tenta desbloquear
$('stockPassword').addEventListener('keydown', e => {
  if (e.key === 'Enter') $('btnUnlock').click();
});

// Botão "Bloquear"
$('btnLock').addEventListener('click', stockLock);

// ── Backup dos Produtos ───────────────────────────────────────
$('btnBackup').addEventListener('click', async () => {
  const btn = $('btnBackup');
  btn.disabled = true;
  btn.textContent = '⏳ Carregando...';

  // Exibe log
  $('stockOpArea').style.display = '';
  stockLogMsg('🔍 Buscando produtos no Saipos...');

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab) throw new Error('Aba do Saipos não encontrada!');

    const res = await chrome.tabs.sendMessage(tab.id, { action: 'BACKUP_PRODUCTS' });
    if (!res) throw new Error('Sem resposta. Recarregue a página do Saipos.');
    if (res.error) throw new Error(res.error);

    const { items, storeId, timestamp } = res;
    stockLogMsg(`✅ ${items.length} produtos encontrados. Baixando...`);

    // Gera CSV + JSON no backup
    const backupData = {
      meta: { storeId, timestamp, total: items.length, geradoPor: 'Saipos Tools' },
      produtos: items.map(x => ({
        id:        x.id_store_item || x.id_item || x.id,
        nome:      x.desc_store_item || x.desc_item || x.name || '',
        preco:     x.variations?.[0]?.price ?? x.price ?? 0,
        categoria: x.id_store_category_item || '',
        habilitado: x.enabled || 'Y',
        _raw: x // objeto completo para restauração futura
      }))
    };

    // Download do arquivo JSON
    const blob = new Blob([JSON.stringify(backupData, null, 2)], { type: 'application/json' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href     = url;
    a.download = `backup_estoque_${(timestamp||new Date().toISOString()).split('T')[0]}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    stockLogMsg(`💾 Backup salvo: ${items.length} produtos`);
  } catch (err) {
    stockLogMsg(`❌ Erro: ${err.message}`);
  } finally {
    btn.disabled = false;
    btn.textContent = '💾 Fazer Backup Agora';
  }
});

// ── Apagar Todo o Estoque ────────────────────────────────────
$('btnDeleteAll').addEventListener('click', () => {
  // Abre overlay de confirmação em vez de confirm() nativo
  $('stockConfirmOverlay').classList.add('show');
});

$('btnCancelDelete').addEventListener('click', () => {
  $('stockConfirmOverlay').classList.remove('show');
});

$('btnConfirmDelete').addEventListener('click', async () => {
  $('stockConfirmOverlay').classList.remove('show');

  const btn = $('btnDeleteAll');
  btn.disabled = true;
  btn.textContent = '⏳ Deletando...';
  $('stockOpArea').style.display = '';
  stockLogMsg('🗑️ Iniciando exclusão de todos os produtos...');

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab) throw new Error('Aba do Saipos não encontrada!');

    const res = await chrome.tabs.sendMessage(tab.id, { action: 'DELETE_ALL_STOCK' });
    if (!res) throw new Error('Sem resposta. Recarregue a página do Saipos.');
    if (res.error) throw new Error(res.error);
    // res.started === true — o progresso vem via STOCK_LOG + STOCK_DELETE_DONE
  } catch (err) {
    stockLogMsg(`❌ Erro: ${err.message}`);
    btn.disabled = false;
    btn.textContent = '🗑️ Apagar Todo o Estoque';
  }
});

// ── Mensagens de progresso vindas do content ─────────────────
chrome.runtime.onMessage.addListener(msg => {
  if (msg.type === 'STOCK_LOG') {
    stockLogMsg(msg.text);
  }
  if (msg.type === 'STOCK_PROGRESS') {
    const pct = msg.total > 0 ? Math.round(msg.current / msg.total * 100) : 0;
    $('stockProgFill').style.width = pct + '%';
    $('stockProgLabel').textContent = `${msg.current} / ${msg.total}`;
  }
  if (msg.type === 'STOCK_DELETE_DONE') {
    const btn = $('btnDeleteAll');
    btn.disabled = false;
    btn.textContent = '🗑️ Apagar Todo o Estoque';
    stockLogMsg(`✅ Concluído — Deletados: ${msg.deleted} | Erros: ${msg.errors}`);
    $('stockProgFill').style.width = '100%';
  }
});

// Adiciona uma linha no log de estoque
function stockLogMsg(text) {
  const container = $('stockLogContent');
  if (!container) return;
  const line = document.createElement('div');
  line.innerHTML = text;
  container.appendChild(line);
  container.scrollTop = container.scrollHeight; // scroll para o fim
}

// ══════════════════════════════════════════════════════════════
// CATRACA DE CONFIGURAÇÕES — controle de acesso por guia
// ══════════════════════════════════════════════════════════════

const LOCK_KEY = 'saipos_tabs_lock';
const PRINTER_COLS_KEY = 'saipos_printer_cols';
const FONT_SIZE_KEY = 'saipos_font_size';
let currentPrinterCols = 42; // padrão: 42 colunas (80mm)
let currentFontSize = 12;    // tamanho de fonte padrão em px
const LOCK_DEFAULTS = {
  password: '314159',
  // Padrão: somente Comissões e Happy Hour visíveis — resto bloqueado
  locked: { log: true, csv: true, estoque: true, resumo: false, happyhour: false, entrega: true }
};

let _lockCallback = null; // callback após senha correta

function applyLockStyles() {
  document.querySelectorAll('.tab').forEach(tab => {
    tab.style.display = lockConfig.locked[tab.dataset.tab] ? 'none' : ''; // oculta completamente se bloqueada
  });
  // Se a aba ativa foi bloqueada, navega para a primeira visível
  const active = document.querySelector('.tab.active');
  if (active && lockConfig.locked[active.dataset.tab]) {
    const first = Array.from(document.querySelectorAll('.tab')).find(t => !lockConfig.locked[t.dataset.tab]);
    if (first) switchToTab(first.dataset.tab);
  }
}

async function loadLockConfig() {
  try {
    const data = await chrome.storage.local.get([LOCK_KEY, PRINTER_COLS_KEY, FONT_SIZE_KEY]);
    if (data[LOCK_KEY]) {
      lockConfig.password = data[LOCK_KEY].password || LOCK_DEFAULTS.password;
      lockConfig.locked   = Object.assign({}, LOCK_DEFAULTS.locked, data[LOCK_KEY].locked || {});
      // LOG e ENTREGA sempre bloqueados independente de config salva anterior
      lockConfig.locked.log     = true;
      lockConfig.locked.entrega = true;
    }
    if (data[PRINTER_COLS_KEY]) currentPrinterCols = parseInt(data[PRINTER_COLS_KEY]) || 42;
    if (data[FONT_SIZE_KEY])    currentFontSize    = parseInt(data[FONT_SIZE_KEY])    || 12;
    applyFontSize();
  } catch (e) {}
  applyLockStyles();
}

function applyFontSize() {
  // body.style.fontSize não cascateia sobre filhos com px explícito no CSS.
  // Injeta <style> dinâmico que sobrescreve cada seletor de painel proporcionalmente.
  let styleEl = document.getElementById('spt-font-override');
  if (!styleEl) {
    styleEl = document.createElement('style');
    styleEl.id = 'spt-font-override';
    document.head.appendChild(styleEl);
  }
  const fs = currentFontSize; // px base escolhido pelo admin
  styleEl.textContent = `
    /* Painéis de conteúdo — escala proporcional ao tamanho escolhido */
    .gc-name          { font-size: ${fs + 1}px !important; }
    .gc-stat span     { font-size: ${Math.max(7, fs - 2)}px !important; }
    .gc-stat b        { font-size: ${fs}px !important; }
    .log-line         { font-size: ${fs}px !important; }
    .alert-tbl td,
    .alert-tbl th     { font-size: ${Math.max(7, fs - 2)}px !important; }
    .sec-label        { font-size: ${Math.max(7, fs - 2)}px !important; }
    .hh-name          { font-size: ${fs}px !important; }
    .hh-details       { font-size: ${Math.max(7, fs - 2)}px !important; }
    .hh-price         { font-size: ${fs}px !important; }
    #progLabel,
    #statusLabel,
    #pctBadge         { font-size: ${Math.max(8, fs - 2)}px !important; }
    .badge            { font-size: ${Math.max(7, fs - 2)}px !important; }
    .empty            { font-size: ${fs}px !important; }
  `;
}

async function saveLockConfig() {
  await chrome.storage.local.set({ [LOCK_KEY]: lockConfig });
  applyLockStyles();
}

// Exibe o modal de senha com callback ao acertar
function showPasswordPrompt(title, sub, onSuccess) {
  _lockCallback = onSuccess;
  $('tlbTitle').textContent  = title;
  $('tlbSub').textContent    = sub;
  $('tlbPwd').value          = '';
  $('tlbError').classList.remove('show');
  $('tabLockOverlay').classList.add('show');
  setTimeout(() => $('tlbPwd').focus(), 80);
}

function tryPassword() {
  const val = $('tlbPwd').value;
  if (val === lockConfig.password) {
    $('tabLockOverlay').classList.remove('show');
    if (_lockCallback) { _lockCallback(); _lockCallback = null; }
  } else {
    $('tlbError').classList.add('show');
    $('tlbPwd').value = '';
    $('tlbPwd').focus();
  }
}

$('tlbConfirm').addEventListener('click', tryPassword);
$('tlbPwd').addEventListener('keydown', e => { if (e.key === 'Enter') tryPassword(); });
$('tlbCancel').addEventListener('click', () => {
  $('tabLockOverlay').classList.remove('show');
  _lockCallback = null;
});

// Botão catraca no header — abre config após senha
$('btnLockConfig').addEventListener('click', () => {
  showPasswordPrompt('⚙️ Configurações de Acesso', 'Digite a senha de administrador', openLockConfig);
});

function openLockConfig() {
  // Monta lista de guias com toggles
  const container = $('lcTabToggles');
  container.innerHTML = '';
  Object.entries(TAB_LABELS).forEach(([key, label]) => {
    const isLocked = !!lockConfig.locked[key];
    const row = document.createElement('div');
    row.className = 'lc-row';
    row.innerHTML = `
      <div><div class="lc-name">${label}</div></div>
      <label class="lc-toggle" title="${isLocked ? 'Bloqueada' : 'Livre'}">
        <input type="checkbox" data-tab-key="${key}" ${isLocked ? 'checked' : ''}>
        <span class="lc-slider"></span>
      </label>`;
    container.appendChild(row);
  });
  $('lcNewPwd').value = '';
  $('lcSaveMsg').style.display = 'none';
  const colsSel = $('lcPrinterCols');
  if (colsSel) colsSel.value = String(currentPrinterCols);
  const fsSel = $('lcFontSize');
  if (fsSel) fsSel.value = String(currentFontSize);
  $('lockConfigOverlay').classList.add('show');
}

$('lcSave').addEventListener('click', async () => {
  // Toggles de guias
  document.querySelectorAll('#lcTabToggles input[data-tab-key]').forEach(inp => {
    lockConfig.locked[inp.dataset.tabKey] = inp.checked;
  });
  // Largura da impressora
  const colsSel = $('lcPrinterCols');
  if (colsSel) {
    currentPrinterCols = parseInt(colsSel.value) || 42;
    await chrome.storage.local.set({ [PRINTER_COLS_KEY]: currentPrinterCols });
  }
  // Tamanho de fonte
  const fsSel = $('lcFontSize');
  if (fsSel) {
    currentFontSize = parseInt(fsSel.value) || 12;
    await chrome.storage.local.set({ [FONT_SIZE_KEY]: currentFontSize });
    applyFontSize();
  }
  // Senha
  const newPwd = $('lcNewPwd').value.trim();
  if (newPwd) lockConfig.password = newPwd;
  await saveLockConfig();
  // Fecha imediatamente após salvar
  $('lockConfigOverlay').classList.remove('show');
  switchToTab('resumo');
});

$('lcClose').addEventListener('click', () => {
  $('lockConfigOverlay').classList.remove('show');
});

// ── Init ─────────────────────────────────────────────────────
checkUrl();
initHH();
loadLockConfig();
