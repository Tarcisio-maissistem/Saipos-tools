// ================================================================
// delivery-report.js — Relatório de Entregas (Saipos Tools)
// ================================================================

'use strict';

let APP_STATE = {
  sales: [],
  storeName: '',
  dateRange: null,
  fallback: false,
  uniqueEnt: []
};

// Estado dos filtros aplicados
let filterState = { dateFrom: '', dateTo: '', timeFrom: '', timeTo: '', entregador: '' };

// Retorna vendas filtradas pelo filterState
function getDisplaySales() {
  return APP_STATE.sales.filter(s => {
    const dia  = (s.dateText || '').substring(0, 10); // "2026-04-19"
    const hora = s.dateText && s.dateText.length > 10 ? s.dateText.substring(11, 16) : ''; // "14:30"
    if (filterState.dateFrom  && dia  < filterState.dateFrom)  return false;
    if (filterState.dateTo    && dia  > filterState.dateTo)    return false;
    if (filterState.timeFrom  && hora && hora < filterState.timeFrom) return false;
    if (filterState.timeTo    && hora && hora > filterState.timeTo)   return false;
    if (filterState.entregador) {
      const ent = (s.entregador || '').trim().toUpperCase();
      if (ent !== filterState.entregador.toUpperCase()) return false;
    }
    return true;
  });
}

// Conta filtros ativos
function countActiveFilters() {
  return Object.values(filterState).filter(v => v !== '').length;
}

function fmt(n) {
  return (n || 0).toFixed(2).replace('.', ',').replace(/\B(?=(\d{3})+(?!\d))/g, '.');
}

function escCSV(v) {
  if (v == null) return '';
  const s = String(v);
  if (s.includes(';') || s.includes('"') || s.includes('\n')) return '"' + s.replace(/"/g, '""') + '"';
  return s;
}

function dlCSV(filename, content) {
  const BOM = '\uFEFF';
  const blob = new Blob([BOM + content], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click();
  document.body.removeChild(a); URL.revokeObjectURL(url);
}

function gatherUniqueEntregadores() {
  const set = new Set();
  for (const s of APP_STATE.sales) {
    const ent = (s.entregador || '').trim().toUpperCase();
    if (ent && ent !== 'NÃO INFORMADO') set.add(ent);
  }
  APP_STATE.uniqueEnt = Array.from(set).sort();
}

// Handler para mudança no select inline
window.updateEntregador = function(idx, newValue) {
  if (newValue === '__NEW__') {
    newValue = prompt('Digite o nome do entregador:');
    if (!newValue) {
      render(); // reverte para o estado anterior
      return;
    }
  }
  
  newValue = (newValue || '').trim().toUpperCase();
  
  // Compara como string para evitar falha de tipo (idx pode ser number no JSON)
  const sameId = s => String(s.idx) === String(idx) || String(s._rawId) === String(idx) || String(s.saleId) === String(idx);

  const sale = APP_STATE.sales.find(sameId);
  if (sale) {
    sale.entregador = newValue;

    // Salva no storage (persistência)
    chrome.storage.local.get('saiposDeliveryData', data => {
      const payload = data && data.saiposDeliveryData;
      if (payload && payload.sales) {
        const memSale = payload.sales.find(sameId);
        if (memSale) memSale.entregador = newValue;
        chrome.storage.local.set({ saiposDeliveryData: payload });
      }
    });

    gatherUniqueEntregadores();
    render();
  }
};

function render() {
  const sales    = getDisplaySales(); // respeita filtro ativo
  const { storeName, dateRange, fallback } = APP_STATE;
  const ts = new Date().toLocaleString('pt-BR');

  // Badge de contagem e indicador de filtro ativo
  const total = APP_STATE.sales.length;
  const active = countActiveFilters();
  const countBadge = document.getElementById('countBadge');
  if (countBadge) { countBadge.textContent = sales.length + '/' + total; countBadge.style.display = active > 0 ? '' : 'none'; }
  const filterBadge = document.getElementById('filterBadge');
  if (filterBadge) { filterBadge.textContent = active; filterBadge.style.display = active > 0 ? '' : 'none'; }
  const activeBadge = document.getElementById('filterActiveBadge');
  if (activeBadge) {
    if (active > 0) {
      activeBadge.style.display = '';
      activeBadge.innerHTML = `🔍 Filtro ativo: mostrando ${sales.length} de ${total} entregas — <a href="#" id="lnkClearFilter" style="color:#0369a1">limpar filtro</a>`;
      const lnk = document.getElementById('lnkClearFilter');
      if (lnk) lnk.addEventListener('click', e => { e.preventDefault(); clearFilter(); });
    } else {
      activeBadge.style.display = 'none';
    }
  }

  // Header info
  document.getElementById('hStoreName').textContent = '🏪 ' + (storeName || 'Loja Saipos');
  document.getElementById('hGenTime').textContent =
    'Gerado em ' + ts + ' · Saipos Tools' +
    (dateRange ? ' · ' + (dateRange.start || '') + ' → ' + (dateRange.end || '') : '');
  
  if (fallback) document.getElementById('fallbackWarn').style.display = 'block';

  // ── Totals ───────────────────────────────────────────────────
  const totalPedidos = sales.length;
  const totalVal     = sales.reduce((a, s) => a + s.total, 0);
  const ticketMedio  = totalPedidos > 0 ? totalVal / totalPedidos : 0;

  // ── Entregador map ───────────────────────────────────────────
  const byEntregador = {};
  for (const s of sales) {
    const ent = (s.entregador || 'Não informado').trim().toUpperCase() || 'NÃO INFORMADO';
    if (!byEntregador[ent]) byEntregador[ent] = { count: 0, total: 0 };
    byEntregador[ent].count++;
    byEntregador[ent].total += s.total;
  }

  // ── Cards ────────────────────────────────────────────────────
  const uniqueEntCount = Object.values(byEntregador).filter(e => e.count > 0).length;
  document.getElementById('cardsArea').innerHTML = `
    <div class="card"><div class="cl">Total Entregas</div><div class="cv">${totalPedidos}</div></div>
    <div class="card"><div class="cl">Total (R$)</div><div class="cv">R$ ${fmt(totalVal)}</div></div>
    <div class="card"><div class="cl">Ticket Médio</div><div class="cv">R$ ${fmt(ticketMedio)}</div></div>
    <div class="card warn"><div class="cl">Entregadores</div><div class="cv">${uniqueEntCount}</div></div>
  `;

  // ── Group by date ────────────────────────────────────────────
  const byDate = {};
  for (const s of sales) {
    const dia = (s.dateText || 'Sem data').substring(0, 10);
    if (!byDate[dia]) byDate[dia] = [];
    byDate[dia].push(s);
  }

  // ── Render Tabela Principal ──────────────────────────────────
  let H = '';
  for (const [dia, dsales] of Object.entries(byDate).sort()) {
    const dTotal = dsales.reduce((a, s) => a + s.total, 0);
    H += `
<div class="date-block">
  <div class="date-header">
    <span class="dh-title">📅 ${dia}</span>
    <div class="dh-info">
      <span>${dsales.length} entrega${dsales.length !== 1 ? 's' : ''}</span>
      <span>Total: R$ ${fmt(dTotal)}</span>
    </div>
  </div>
  <div class="date-content">
    <div style="overflow-x:auto">
    <table class="del-table">
      <thead><tr>
        <th>#Pedido</th>
        <th>Hora</th>
        <th>Entregador</th>
        <th>Pagamento</th>
        <th class="tc">Itens registrados</th>
        <th class="tr">Total (R$)</th>
      </tr></thead>
      <tbody>`;

    for (const s of dsales) {
      const hora = s.dateText && s.dateText.length > 10 ? s.dateText.substring(11, 16) : '—';
      const ent  = (s.entregador || '').trim().toUpperCase();
      
      const iden = s.idx || s._rawId || s.saleId;
      
      // Inline select for Entregador
      let opts = `<option value="">-- Selecione / Não Informado --</option>`;
      let hasSel = false;
      for (const ue of APP_STATE.uniqueEnt) {
        const isSel = (ue === ent);
        if (isSel) hasSel = true;
        opts += `<option value="${ue}" ${isSel ? 'selected' : ''}>${ue}</option>`;
      }
      if (ent && ent !== 'NÃO INFORMADO' && !hasSel) {
        opts += `<option value="${ent}" selected>${ent}</option>`;
      }
      opts += `<option value="__NEW__">+ NOVO ENTREGADOR...</option>`;
      
      const selectHtml = `<select class="ent-select" onchange="updateEntregador('${iden}', this.value)" style="${
        (!ent || ent === 'NÃO INFORMADO') 
          ? 'border:1px solid #ff4b4b; background:#fee2e2; color:#b91c1c;' 
          : ''
      }">${opts}</select>`;

      const itensTxt = s.items && s.items.length > 0
        ? s.items.filter(i => !i.itemCancelado).map(i => `${i.qtd}× ${i.nome}`).join(', ')
        : '—';
      const pay = s.pagamento || '—';

      H += `<tr>
        <td><span class="pedido-num">#${s.saleId || s._rawId || '—'}</span></td>
        <td>${hora}</td>
        <td>${selectHtml}</td>
        <td><span class="pay-badge">${pay}</span></td>
        <td class="tc" style="max-width:280px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis" title="${escCSV(itensTxt)}">${itensTxt.length > 60 ? itensTxt.substring(0, 57) + '...' : itensTxt}</td>
        <td class="tr" style="font-family:'IBM Plex Mono',monospace;font-weight:600">R$ ${fmt(s.total)}</td>
      </tr>`;
    }

    H += `</tbody></table></div></div></div>`;
  }
  document.getElementById('reportArea').innerHTML = H;

  // ── Render Entregador summary ────────────────────────────────
  const sorted = Object.entries(byEntregador).sort((a, b) => b[1].total - a[1].total);
  const totalAll = sorted.reduce((a, [, v]) => a + v.total, 0);
  let sumH = '';
  for (const [ent, v] of sorted) {
    const ticket = v.count > 0 ? v.total / v.count : 0;
    sumH += `<tr>
      <td><span class="ent-chip" style="${ent === 'NÃO INFORMADO' ? 'background:#f3f4f6;color:#6b7280' : ''}">${ent}</span></td>
      <td class="tc" style="font-family:'IBM Plex Mono',monospace">${v.count}</td>
      <td class="tr" style="font-family:'IBM Plex Mono',monospace;font-weight:700">R$ ${fmt(v.total)}</td>
      <td class="tr" style="font-family:'IBM Plex Mono',monospace;color:#6b7280">R$ ${fmt(ticket)}</td>
    </tr>`;
  }
  sumH += `<tr class="total-row">
    <td>TOTAL</td>
    <td class="tc">${totalPedidos}</td>
    <td class="tr">R$ ${fmt(totalAll)}</td>
    <td class="tr">R$ ${fmt(totalPedidos > 0 ? totalAll / totalPedidos : 0)}</td>
  </tr>`;
  document.getElementById('sumBody').innerHTML = sumH;
}

// ── Iniciar e Carregar storage ──────────────────────────────────
chrome.storage.local.get('saiposDeliveryData', data => {
  const payload = data && data.saiposDeliveryData;
  if (!payload || !payload.sales || payload.sales.length === 0) {
    document.getElementById('reportArea').innerHTML =
      '<div style="padding:60px;text-align:center;color:#9ca3af;font-size:15px">' +
      '<div style="font-size:40px;margin-bottom:12px">🛵</div>' +
      'Nenhum dado de entrega encontrado.<br><br>' +
      'Faça a extração na página de <b>Vendas por Período</b> do Saipos primeiro.</div>';
    return;
  }
  APP_STATE.sales = payload.sales;
  APP_STATE.storeName = payload.storeName;
  APP_STATE.dateRange = payload.dateRange;
  APP_STATE.fallback = payload.fallback;
  
  gatherUniqueEntregadores();

  // Popula select de entregadores no painel de filtros
  const fEnt = document.getElementById('fEntregador');
  if (fEnt) {
    fEnt.innerHTML = '<option value="">Todos</option>';
    APP_STATE.uniqueEnt.forEach(e => {
      const opt = document.createElement('option');
      opt.value = e; opt.textContent = e;
      fEnt.appendChild(opt);
    });
  }

  render();
});

// ── Lógica de abas ──────────────────────────────────────────────
function switchTab(name) {
  document.getElementById('tabRelatorio').classList.toggle('active', name === 'relatorio');
  document.getElementById('tabFiltros').classList.toggle('active', name === 'filtros');
  document.getElementById('panelRelatorio').style.display = name === 'relatorio' ? '' : 'none';
  document.getElementById('panelFiltros').style.display   = name === 'filtros'   ? '' : 'none';
}
document.getElementById('tabRelatorio').addEventListener('click', () => switchTab('relatorio'));
document.getElementById('tabFiltros').addEventListener('click',   () => switchTab('filtros'));

// ── Lógica de filtros ────────────────────────────────────────────
function applyFilter() {
  filterState.dateFrom   = document.getElementById('fDateFrom').value;
  filterState.dateTo     = document.getElementById('fDateTo').value;
  filterState.timeFrom   = document.getElementById('fTimeFrom').value;
  filterState.timeTo     = document.getElementById('fTimeTo').value;
  filterState.entregador = document.getElementById('fEntregador').value;
  render();
  switchTab('relatorio'); // volta para o relatório após aplicar
}

function clearFilter() {
  filterState = { dateFrom: '', dateTo: '', timeFrom: '', timeTo: '', entregador: '' };
  document.getElementById('fDateFrom').value   = '';
  document.getElementById('fDateTo').value     = '';
  document.getElementById('fTimeFrom').value   = '';
  document.getElementById('fTimeTo').value     = '';
  document.getElementById('fEntregador').value = '';
  render();
}

document.getElementById('btnApplyFilter').addEventListener('click', applyFilter);
document.getElementById('btnClearFilter').addEventListener('click', clearFilter);

// ── Bind botoes ──────────────────────────────────────────────────
document.getElementById('btnPrint').addEventListener('click', () => window.print());
document.getElementById('btnCSV').addEventListener('click', () => {
  const ts2 = new Date().toISOString().slice(0, 10);
  let csv = 'Data;Hora;Pedido;Entregador;Pagamento;Total;Itens\n';
  for (const s of getDisplaySales()) { // exporta apenas o que está filtrado
    const hora = s.dateText && s.dateText.length > 10 ? s.dateText.substring(11, 16) : '';
    const dia  = (s.dateText || '').substring(0, 10);
    const ent  = (s.entregador || '').trim().toUpperCase() || 'Não informado';
    const itensTxt = s.items && s.items.length > 0
      ? s.items.filter(i => !i.itemCancelado).map(i => `${i.qtd}x ${i.nome}`).join(' | ')
      : '';
    csv += [
      escCSV(dia), escCSV(hora),
      escCSV(s.saleId || s._rawId || ''),
      escCSV(ent),
      escCSV(s.pagamento || ''),
      (s.total || 0).toFixed(2).replace('.', ','),
      escCSV(itensTxt)
    ].join(';') + '\n';
  }
  dlCSV('entregas_' + ts2 + '.csv', csv);
});
