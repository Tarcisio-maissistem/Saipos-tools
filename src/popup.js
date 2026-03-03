// popup.js
let allSales = [];
let isRunning = false;
let isPaused  = false;

const $ = id => document.getElementById(id);

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
  const panel = $('panel-log');
  const empty = panel.querySelector('.empty');
  if (empty) empty.remove();

  const div = document.createElement('div');
  div.className = `log-line ${entry.type || ''}`;
  div.innerHTML = `<span class="ll-time">${entry.time}</span><span class="ll-msg">${entry.msg}</span>`;
  panel.appendChild(div);
  panel.scrollTop = panel.scrollHeight;
}

function setButtons(running) {
  $('bStart').disabled  =  running;
  $('bPause').disabled  = !running;
  $('bStop').disabled   = !running;
  $('bReport').disabled =  running || allSales.length === 0;
}

// ── Check URL ────────────────────────────────────────────────
async function checkUrl() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const ok = tab && tab.url && tab.url.includes('conta.saipos.com');
  $('urlWarn').classList.toggle('show', !ok);
  return ok;
}

// ── Tabs ─────────────────────────────────────────────────────
document.querySelectorAll('.tab').forEach(t => {
  t.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach(x => x.classList.remove('active'));
    document.querySelectorAll('.panel').forEach(x => x.classList.remove('active'));
    t.classList.add('active');
    document.getElementById('panel-' + t.dataset.tab).classList.add('active');
  });
});

// ── Comunicação com content ──────────────────────────────────
async function sendContent(action) {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab) return null;
  return chrome.tabs.sendMessage(tab.id, { action }).catch(() => null);
}

// ── INICIAR ──────────────────────────────────────────────────
$('bStart').addEventListener('click', async () => {
  const ok = await checkUrl();
  if (!ok) return;

  allSales = [];
  $('panel-log').innerHTML = '';
  $('panel-resumo').innerHTML = '<div class="empty"><big>👤</big>Processando...</div>';
  $('panel-alertas').innerHTML = '<div class="empty"><big>⚠️</big>Processando...</div>';

  isRunning = true;
  isPaused  = false;
  setStatus('run', 'Iniciando robô...');
  setProgress(0, 0);
  setButtons(true);

  // Reseta estado no background
  chrome.runtime.sendMessage({ type: 'RESET' }).catch(() => {});

  await sendContent('START');
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

// ── RELATÓRIO ────────────────────────────────────────────────
$('bReport').addEventListener('click', async () => {
  if (allSales.length === 0) return;

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab) return;

  // Extrai nome da loja do Saipos
  const storeResult = await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    func: () => {
      const span = document.querySelector('span.tm-label[uib-tooltip]');
      if (span) {
        const tooltip = span.getAttribute('uib-tooltip');
        if (tooltip) return tooltip;
      }
      if (span) return span.textContent.trim();
      return 'Loja Saipos';
    }
  });
  const storeName = storeResult && storeResult[0] && storeResult[0].result ? storeResult[0].result : 'Loja Saipos';

  // Salva dados no storage para a página de relatório
  await chrome.storage.local.set({
    saiposReportData: {
      sales: allSales,
      storeName: storeName
    }
  });

  // Abre a página de relatório (CSP-compliant)
  chrome.tabs.create({ url: chrome.runtime.getURL('report.html') });
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
    allSales  = msg.sales;
    isRunning = false;
    setStatus('done', `✅ ${allSales.length} vendas concluídas`);
    setButtons(false);
    renderResumo(allSales);
    renderAlertas(allSales);
    addLog({ msg: `🎉 Pronto! ${allSales.length} vendas · abrindo relatório...`, type: 'info', time: new Date().toLocaleTimeString('pt-BR') });
    
    // Abre relatório automaticamente
    setTimeout(() => {
      $('bReport').click();
    }, 500);
  }
});

// ── Render Resumo ────────────────────────────────────────────
function renderResumo(sales) {
  const garcom = {};
  for (const s of sales) {
    if (s.canceled || !s.items) continue;
    for (const item of s.items) {
      if (item.itemCancelado) continue;
      const g  = (item.garcom || '?').toUpperCase().trim();
      const vt = item.valor * item.qtd;
      const ci = s.totalItens > 0 ? (vt / s.totalItens) * s.taxa : 0;
      if (!garcom[g]) garcom[g] = { venda: 0, comissao: 0, qtd: 0 };
      garcom[g].venda    += vt;
      garcom[g].comissao += ci;
      garcom[g].qtd++;
    }
  }

  const panel = $('panel-resumo');
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
  const semTaxa   = sales.filter(s => !s.canceled && s.totalItens > 0 && s.taxa === 0);
  const baixaTaxa = sales.filter(s => {
    if (s.canceled || s.totalItens === 0) return false;
    const p = s.taxa / s.totalItens * 100;
    return p > 0 && p < 9.95;
  });
  const canceladas = sales.filter(s => s.canceled);

  const panel = $('panel-alertas');

  if (!semTaxa.length && !baixaTaxa.length && !canceladas.length) {
    panel.innerHTML = '<div class="empty"><big>✅</big>Sem alertas!</div>';
    return;
  }

  let h = '';

  if (semTaxa.length) {
    h += `<div class="sec-label">❌ Sem taxa (${semTaxa.length})</div>
    <table class="alert-tbl"><thead><tr><th>Mesa</th><th>Cmd</th><th>Horário</th><th>Itens</th><th>Taxa</th></tr></thead><tbody>`;
    for (const s of semTaxa) {
      h += `<tr><td>M${s.mesa}</td><td>C${s.comanda}</td><td>${(s.dateText||'').substring(11)}</td>
            <td>R$ ${fmt(s.totalItens)}</td><td><span class="badge b-zero">0%</span></td></tr>`;
    }
    h += '</tbody></table>';
  }

  if (baixaTaxa.length) {
    h += `<div class="sec-label">⚠️ Taxa &lt; 10% (${baixaTaxa.length})</div>
    <table class="alert-tbl"><thead><tr><th>Mesa</th><th>Cmd</th><th>Horário</th><th>Itens</th><th>%</th></tr></thead><tbody>`;
    for (const s of baixaTaxa) {
      const p = (s.taxa / s.totalItens * 100).toFixed(1).replace('.',',');
      h += `<tr><td>M${s.mesa}</td><td>C${s.comanda}</td><td>${(s.dateText||'').substring(11)}</td>
            <td>R$ ${fmt(s.totalItens)}</td><td><span class="badge b-low">${p}%</span></td></tr>`;
    }
    h += '</tbody></table>';
  }

  if (canceladas.length) {
    h += `<div class="sec-label">🚫 Canceladas (${canceladas.length})</div>
    <table class="alert-tbl"><thead><tr><th>Mesa</th><th>Cmd</th><th>Horário</th><th>Total</th></tr></thead><tbody>`;
    for (const s of canceladas) {
      h += `<tr><td>M${s.mesa}</td><td>C${s.comanda}</td><td>${(s.dateText||'').substring(11)}</td>
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
      $('panel-log').innerHTML = '';
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
      $('panel-resumo').innerHTML = '<div class="empty"><big>👤</big>Processando...</div>';
      $('panel-alertas').innerHTML = '<div class="empty"><big>⚠️</big>Processando...</div>';
      
      if (isPaused) {
        $('bPause').textContent = '▶ RETOMAR';
        setStatus('warn', 'Pausado');
      }
    }

    // Restaura se já terminou
    if (state.status === 'done' && state.sales && state.sales.length > 0) {
      allSales = state.sales;
      setStatus('done', `✅ ${allSales.length} vendas concluídas`);
      setButtons(false);
      renderResumo(allSales);
      renderAlertas(allSales);
    }

  } catch (e) {
    console.log('[Popup] Sem estado para restaurar');
  }
}

// ── Init ─────────────────────────────────────────────────────
checkUrl();
restoreState();
