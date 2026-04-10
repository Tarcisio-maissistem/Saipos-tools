// report-page.js — Script externo para o relatório (CSP-compliant) v4.6.0

let SALES_DATA = [];
let STORE_NAME = 'Loja Saipos';
let DATE_RANGE = null;
let selectedGarcom = 'TODOS';

// Produtos isentos de comissão/taxa de serviço
const PRODUTOS_ISENTOS = [
  'COUVERT ARTÍSTICO', 'COUVERT ARTISTICO',
  'COVERT ARTÍSTICO', 'COVERT ARTISTICO'
];
function isIsento(nome) {
  if (!nome) return false;
  const n = nome.toUpperCase().trim();
  return PRODUTOS_ISENTOS.some(p => n.includes(p));
}
function calcTotalNaoIsento(items) {
  if (!items) return 0;
  return items.filter(i => !i.itemCancelado && !isIsento(i.nome)).reduce((a, i) => a + i.valor * i.qtd, 0);
}

// Helpers
function fmt(n) {
  if (!n) return '0,00';
  return n.toFixed(2).replace('.', ',').replace(/\B(?=(\d{3})+(?!\d))/g, '.');
}

function pad2(n) {
  return String(n).padStart(2, '0');
}

function fmtMesa(m) {
  if (!m || m === '—') return '—';
  const num = parseInt(m, 10);
  return isNaN(num) ? m : pad2(num);
}

function fmtComanda(c) {
  if (!c || c === '—') return '—';
  const num = parseInt(c, 10);
  return isNaN(num) ? c : pad2(num);
}

function pctClass(pct, canceled) {
  if (canceled) return 'c-cancel';
  if (pct === 0) return 'c-zero';
  if (pct < 9.95) return 'c-low';
  return 'c-ok';
}

function pctLabel(pct, canceled) {
  if (canceled) return 'CANCELADO';
  return pct.toFixed(1).replace('.', ',') + '%';
}

// Carrega dados do storage
chrome.storage.local.get(['saiposReportData'], function(result) {
  if (result.saiposReportData) {
    SALES_DATA = result.saiposReportData.sales || [];
    STORE_NAME = result.saiposReportData.storeName || 'Loja Saipos';
    DATE_RANGE = result.saiposReportData.dateRange || null;
    if (DATE_RANGE && DATE_RANGE.start && DATE_RANGE.end) {
      const fd = (d) => { const p = d.split('-'); return p.length === 3 ? p[2]+'/'+p[1]+'/'+p[0] : d; };
      document.title = 'Relatório ' + fd(DATE_RANGE.start) + ' a ' + fd(DATE_RANGE.end) + ' – Saipos Tools';
    }
    renderReport();
    chrome.storage.local.remove(['saiposReportData']);
  } else {
    document.querySelector('.page').innerHTML = '<div style="text-align:center;padding:60px;color:#991b1b"><h2>❌ Erro</h2><p>Dados do relatório não encontrados.</p><p>Por favor, extraia os dados novamente.</p></div>';
  }
});

function getGlobalGarcom() {
  const globalGarcom = {};
  for (const sale of SALES_DATA) {
    if (sale.canceled || !sale.items) continue;
    const totalNaoIsento = calcTotalNaoIsento(sale.items);
    for (const item of sale.items) {
      if (item.itemCancelado) continue;
      const g = (item.garcom || '?').toUpperCase().trim();
      const vt = item.valor * item.qtd;
      const exempt = isIsento(item.nome);
      const ci = (!exempt && totalNaoIsento > 0) ? (vt / totalNaoIsento) * sale.taxa : 0;
      if (!globalGarcom[g]) globalGarcom[g] = { venda: 0, comissao: 0, qtd: 0 };
      globalGarcom[g].venda += vt;
      globalGarcom[g].comissao += ci;
      globalGarcom[g].qtd++;
    }
  }
  return globalGarcom;
}

function renderReport() {
  const sales = SALES_DATA;
  const storeName = STORE_NAME;
  const globalGarcom = getGlobalGarcom();
  
  const byDate = {};
  for (const s of sales) {
    const dia = (s.dateText || 'Sem data').substring(0, 10);
    if (!byDate[dia]) byDate[dia] = [];
    byDate[dia].push(s);
  }

  let gtItens = 0, gtTaxa = 0, gtCanceladas = 0, gtSemTaxa = 0, gtBaixaTaxa = 0;
  let gtVendasAtivas = 0;
  for (const s of sales) {
    if (s.canceled) { gtCanceladas++; continue; }
    gtVendasAtivas++;
    gtItens += s.totalItens;
    gtTaxa += s.taxa;
    const p = s.totalItens > 0 ? s.taxa / s.totalItens * 100 : 0;
    if (s.totalItens > 0 && s.taxa === 0) gtSemTaxa++;
    if (s.totalItens > 0 && p > 0 && p < 9.95) gtBaixaTaxa++;
  }
  const ticketMedio = gtVendasAtivas > 0 ? gtItens / gtVendasAtivas : 0;

  const garconsList = Object.keys(globalGarcom).sort();

  const totalComissaoGlobal = Object.values(globalGarcom).reduce((a, v) => a + v.comissao, 0);

  // Formata período de datas
  let periodoLabel = '';
  if (DATE_RANGE && DATE_RANGE.start && DATE_RANGE.end) {
    const fmtDate = (d) => { const p = d.split('-'); return p.length === 3 ? p[2]+'/'+p[1]+'/'+p[0] : d; };
    periodoLabel = fmtDate(DATE_RANGE.start) + ' a ' + fmtDate(DATE_RANGE.end);
  } else {
    const dates = sales.filter(s => s.dateText).map(s => s.dateText.substring(0, 10)).sort();
    if (dates.length > 0) periodoLabel = dates[0] + ' a ' + dates[dates.length - 1];
  }

  let H = `
<div class="header">
  <div class="logo">S</div>
  <div><h1>Relatório de Comissões</h1>
  <div class="store-name">🏪 ${storeName}</div>
  ${periodoLabel ? `<div class="store-name" style="font-size:13px;color:#64748b">📅 Período: ${periodoLabel}</div>` : ''}
  <p>Gerado em ${new Date().toLocaleString('pt-BR')} · Saipos Tools</p></div>
</div>

<div class="cards">
  <div class="card ok"><div class="cl">Total em Itens</div><div class="cv">R$ ${fmt(gtItens)}</div></div>
  <div class="card ok"><div class="cl">Taxa de Serviço</div><div class="cv">R$ ${fmt(gtTaxa)}</div></div>
  <div class="card ok"><div class="cl">💰 Total Comissões</div><div class="cv">R$ ${fmt(totalComissaoGlobal)}</div></div>
  <div class="card ok"><div class="cl">Ticket Médio</div><div class="cv">R$ ${fmt(ticketMedio)}</div></div>
  <div class="card ok"><div class="cl">Taxa média</div><div class="cv">${gtItens > 0 ? (gtTaxa/gtItens*100).toFixed(1).replace('.',',') : '0,0'}%</div></div>
  <div class="card warn"><div class="cl">Taxa &lt; 10%</div><div class="cv">${gtBaixaTaxa} vendas</div></div>
  <div class="card bad"><div class="cl">Sem Taxa</div><div class="cv">${gtSemTaxa} vendas</div></div>
  <div class="card bad"><div class="cl">Canceladas</div><div class="cv">${gtCanceladas} vendas</div></div>
</div>

<div class="toolbar">
  <button class="btn btn-dark" id="btnCopiarTudo">📋 Copiar Tudo</button>
  <button class="btn btn-green" id="btnImprimir">🖨️ Imprimir</button>
  <button class="btn btn-blue" id="btnSalvarPDF">📥 Salvar PDF</button>
  <button class="btn btn-outline" id="btnCSVCompleto">📊 Exportar CSV</button>
  <button class="btn btn-outline" id="btnAlertas">⚠️ Ver Alertas</button>
  <label class="print-option"><input type="checkbox" id="chkPrintDaily"> 📅 Separar por dia (impressão)</label>
</div>

<div class="global-section">
  <div class="global-header">
    <div class="global-title">👤 Resumo Global por Garçom</div>
    <div class="filter-wrap">
      <label for="filterGarcom">Filtrar relatório:</label>
      <select id="filterGarcom" class="select-garcom">
        <option value="TODOS" ${selectedGarcom === 'TODOS' ? 'selected' : ''}>📋 Todos os Garçons</option>
        ${garconsList.map(g => `<option value="${g}" ${selectedGarcom === g ? 'selected' : ''}>${g}</option>`).join('')}
      </select>
    </div>
  </div>
  <table class="global-table">
  <thead><tr>
    <th>Garçom</th><th class="tr">Total Vendido</th>
    <th class="tr">Total Comissão</th><th class="tc">Itens</th><th class="tc">Ações</th>
  </tr></thead><tbody>`;

  for (const [g, v] of Object.entries(globalGarcom).sort((a,b) => b[1].comissao - a[1].comissao)) {
    const gEncoded = encodeURIComponent(g);
    const showRow = selectedGarcom === 'TODOS' || selectedGarcom === g;
    H += `<tr data-garcom="${g}" style="${showRow ? '' : 'display:none'}">
  <td><span class="garcom-chip" style="font-size:13px">${g}</span></td>
  <td class="tr" style="font-family:'IBM Plex Mono',monospace">R$ ${fmt(v.venda)}</td>
  <td class="tr" style="font-family:'IBM Plex Mono',monospace;font-weight:700;color:#0f1117">R$ ${fmt(v.comissao)}</td>
  <td class="tc">${v.qtd}</td>
  <td class="tc"><button class="btn-copy-garcom" data-garcom="${gEncoded}">📋 Copiar</button></td>
</tr>`;
  }
  H += `</tbody></table></div>`;

  H += `<div style="margin-top:8px;padding:6px 14px;font-size:11px;color:#92400e;background:#fefce8;border-radius:6px;border:1px solid #fde68a">
    <b>*</b> Produto isento de taxa de serviço — não contabilizado na comissão.
  </div>`;

  for (const [dia, dsales] of Object.entries(byDate).sort()) {
    const dItens = dsales.reduce((s, v) => s + (!v.canceled ? v.totalItens : 0), 0);
    const dTaxa = dsales.reduce((s, v) => s + (!v.canceled ? v.taxa : 0), 0);
    const dPct = dItens > 0 ? dTaxa / dItens * 100 : 0;
    const dayGarcom = {};

    let diaTemGarcom = selectedGarcom === 'TODOS';
    if (!diaTemGarcom) {
      for (const sale of dsales) {
        if (sale.items) {
          for (const item of sale.items) {
            if ((item.garcom || '?').toUpperCase().trim() === selectedGarcom) {
              diaTemGarcom = true;
              break;
            }
          }
        }
        if (diaTemGarcom) break;
      }
    }

    H += `<div class="date-block" data-dia="${dia}" style="${diaTemGarcom ? '' : 'display:none'}">
<div class="date-header date-toggle" data-dia-toggle="${dia}">
  <div style="display:flex;align-items:center;gap:8px">
    <span class="date-toggle-icon">▶</span>
    <span class="dh-title">📅 ${dia}</span>
  </div>
  <div class="dh-info">
    <span>Itens: R$ ${fmt(dItens)}</span>
    <span>Taxa: R$ ${fmt(dTaxa)}</span>
    <span>Média: ${dPct.toFixed(1).replace('.',',')}%</span>
    <span>${dsales.length} vendas</span>
  </div>
</div>
<div class="date-content date-content-collapsible" data-dia-content="${dia}" style="display:none">`;

    for (const sale of dsales) {
      const pct = sale.totalItens > 0 ? sale.taxa / sale.totalItens * 100 : 0;
      const hora = sale.dateText && sale.dateText.length > 10 ? sale.dateText.substring(11) : '';

      let vendaTemGarcom = selectedGarcom === 'TODOS';
      if (!vendaTemGarcom && sale.items) {
        for (const item of sale.items) {
          if ((item.garcom || '?').toUpperCase().trim() === selectedGarcom) {
            vendaTemGarcom = true;
            break;
          }
        }
      }

      H += `<div class="venda-wrap" style="${vendaTemGarcom ? '' : 'display:none'}">
<div class="venda-head">
  <div class="tag"><b>M${fmtMesa(sale.mesa)}</b></div>
  <div class="tag">C<b>${fmtComanda(sale.comanda)}</b></div>
  <div class="tag">Hora <b>${hora}</b></div>
  <div class="tag">Pagamento <b>${sale.pagamento || '—'}</b></div>
  <div class="tag">Itens <b>R$ ${fmt(sale.totalItens)}</b></div>
  <div class="tag">Taxa <b>R$ ${fmt(sale.taxa)}</b></div>
  <span class="badge ${pctClass(pct, sale.canceled)}">${pctLabel(pct, sale.canceled)}</span>
  ${sale.hasItemCanceled && !sale.canceled ? '<span class="badge c-item-cancel">Item Cancelado</span>' : ''}
</div>`;

      if (sale.canceled) {
        H += `<div style="padding:10px 14px;color:#9ca3af;font-size:12px">🚫 Venda cancelada</div>`;
      } else if (sale.items && sale.items.length > 0) {
        const vGarcom = {};
        const totalNaoIsento = calcTotalNaoIsento(sale.items);
        for (const item of sale.items) {
          if (item.itemCancelado) continue;
          const g = (item.garcom || '?').toUpperCase().trim();
          const vt = item.valor * item.qtd;
          const exempt = isIsento(item.nome);
          const ci = (!exempt && totalNaoIsento > 0) ? (vt / totalNaoIsento) * sale.taxa : 0;
          if (!vGarcom[g]) vGarcom[g] = { venda: 0, comissao: 0 };
          vGarcom[g].venda += vt;
          vGarcom[g].comissao += ci;
          if (!dayGarcom[g]) dayGarcom[g] = { venda: 0, comissao: 0 };
          dayGarcom[g].venda += vt;
          dayGarcom[g].comissao += ci;
        }

        H += `<div style="overflow-x:auto"><table class="items-table">
<thead><tr>
  <th>Item</th><th class="tc">Qtd</th><th>Garçom</th>
  <th class="tr">Valor Unit.</th><th class="tr">Total Item</th>
  <th class="tr">Comissão</th><th class="tr">% Taxa</th>
</tr></thead><tbody>`;

        for (const item of sale.items) {
          const vt = item.valor * item.qtd;
          const exempt = isIsento(item.nome);
          const ci = (!exempt && !item.itemCancelado && totalNaoIsento > 0) ? (vt / totalNaoIsento) * sale.taxa : 0;
          const cls = item.itemCancelado ? ' class="tr-cancel"' : '';
          const g = (item.garcom || '?').toUpperCase().trim();
          const showItem = selectedGarcom === 'TODOS' || selectedGarcom === g;
          const isentoMark = (exempt && !item.itemCancelado) ? ' *' : '';
          
          H += `<tr${cls} data-item-garcom="${g}" style="${showItem ? '' : 'display:none'}">
  <td>${item.nome}${item.itemCancelado ? ' <span class="badge c-item-cancel">CANC</span>' : ''}${isentoMark ? ' <span class="badge" style="background:#fef3c7;color:#92400e;font-size:9px">* ISENTO</span>' : ''}</td>
  <td class="tc">${item.qtd}</td>
  <td><span class="garcom-chip">${item.garcom || '—'}</span></td>
  <td class="tr">R$ ${fmt(item.valor)}</td>
  <td class="tr">R$ ${fmt(vt)}</td>
  <td class="tr">${item.itemCancelado ? '—' : (exempt ? 'R$ 0,00 *' : 'R$ ' + fmt(ci))}</td>
  <td class="tr">${item.itemCancelado ? '—' : '<span class="badge ' + pctClass(pct, false) + '">' + pctLabel(pct, false) + '</span>'}</td>
</tr>`;
        }

        H += `</tbody></table></div>`;

        if (Object.keys(vGarcom).length > 0) {
          H += `<div class="venda-subtotal">`;
          for (const [g, v] of Object.entries(vGarcom).sort((a,b) => b[1].comissao - a[1].comissao)) {
            const showSubtotal = selectedGarcom === 'TODOS' || selectedGarcom === g;
            H += `<div class="vs-item" data-subtotal-garcom="${g}" style="${showSubtotal ? '' : 'display:none'}">
              <div class="vs-name">👤 ${g}</div>
              <div class="vs-val">Vendeu R$ ${fmt(v.venda)} · Comissão R$ <b>${fmt(v.comissao)}</b></div>
            </div>`;
          }
          H += `</div>`;
        }
      } else {
        H += `<div style="padding:10px 14px;color:#9ca3af;font-size:12px">Sem itens registrados</div>`;
      }

      H += `</div>`;
    }

    if (Object.keys(dayGarcom).length > 0) {
      H += `<div class="day-summary">`;
      for (const [g, v] of Object.entries(dayGarcom).sort((a,b) => b[1].comissao - a[1].comissao)) {
        const showDay = selectedGarcom === 'TODOS' || selectedGarcom === g;
        H += `<div class="ds-item" data-day-garcom="${g}" style="${showDay ? '' : 'display:none'}">
          <div class="ds-name">👤 ${g}</div>
          <div class="ds-val">Vendas R$ ${fmt(v.venda)} · <b>Comissão R$ ${fmt(v.comissao)}</b></div>
        </div>`;
      }
      H += `</div>`;
    }

    H += `</div></div>`;
  }

  const semTaxa = sales.filter(s => !s.canceled && s.totalItens > 0 && s.taxa === 0);
  const baixaTaxa = sales.filter(s => {
    if (s.canceled || s.totalItens === 0) return false;
    const p = s.taxa / s.totalItens * 100;
    return p > 0 && p < 9.95;
  });
  const canceladas = sales.filter(s => s.canceled);

  H += `<div class="alertas-wrap" id="alertasWrap" style="display:none">
  <div class="global-title">⚠️ Alertas</div>`;

  if (semTaxa.length > 0) {
    H += `<div class="alerta-section">
      <div class="alerta-header ah-zero">❌ Sem taxa de serviço (${semTaxa.length} vendas)</div>
      <table class="items-table"><thead><tr><th>Mesa</th><th>Comanda</th><th>Data</th><th>Pagamento</th><th class="tr">Itens</th></tr></thead><tbody>`;
    for (const s of semTaxa) {
      H += `<tr><td>M${fmtMesa(s.mesa)}</td><td>C${fmtComanda(s.comanda)}</td><td>${s.dateText}</td><td>${s.pagamento}</td><td class="tr">R$ ${fmt(s.totalItens)}</td></tr>`;
    }
    H += `</tbody></table></div>`;
  }

  if (baixaTaxa.length > 0) {
    H += `<div class="alerta-section">
      <div class="alerta-header ah-low">⚠️ Taxa abaixo de 10% (${baixaTaxa.length} vendas)</div>
      <table class="items-table"><thead><tr><th>Mesa</th><th>Comanda</th><th>Data</th><th>Pagamento</th><th class="tr">Itens</th><th class="tr">Taxa</th><th class="tr">%</th></tr></thead><tbody>`;
    for (const s of baixaTaxa) {
      const p = (s.taxa / s.totalItens * 100).toFixed(1).replace('.',',');
      H += `<tr><td>M${fmtMesa(s.mesa)}</td><td>C${fmtComanda(s.comanda)}</td><td>${s.dateText}</td><td>${s.pagamento}</td>
            <td class="tr">R$ ${fmt(s.totalItens)}</td><td class="tr">R$ ${fmt(s.taxa)}</td>
            <td class="tr"><span class="badge c-low">${p}%</span></td></tr>`;
    }
    H += `</tbody></table></div>`;
  }

  if (canceladas.length > 0) {
    H += `<div class="alerta-section">
      <div class="alerta-header ah-cancel">🚫 Vendas canceladas (${canceladas.length})</div>
      <table class="items-table"><thead><tr><th>Mesa</th><th>Comanda</th><th>Data</th><th class="tr">Total</th></tr></thead><tbody>`;
    for (const s of canceladas) {
      H += `<tr><td>M${fmtMesa(s.mesa)}</td><td>C${fmtComanda(s.comanda)}</td><td>${s.dateText}</td><td class="tr">R$ ${fmt(s.total)}</td></tr>`;
    }
    H += `</tbody></table></div>`;
  }

  H += `</div>`;

  // ─── Resumo Diário para Impressão ───
  H += `<div class="daily-summary" id="dailySummary">`;
  
  for (const [dia, dsales] of Object.entries(byDate).sort()) {
    const dayGarcomPrint = {};
    let dayTotalItens = 0;
    let dayTotalTaxa = 0;
    
    for (const sale of dsales) {
      if (sale.canceled || !sale.items) continue;
      dayTotalItens += sale.totalItens;
      dayTotalTaxa += sale.taxa;
      const totalNaoIsento = calcTotalNaoIsento(sale.items);
      
      for (const item of sale.items) {
        if (item.itemCancelado) continue;
        const g = (item.garcom || '?').toUpperCase().trim();
        const vt = item.valor * item.qtd;
        const exempt = isIsento(item.nome);
        const ci = (!exempt && totalNaoIsento > 0) ? (vt / totalNaoIsento) * sale.taxa : 0;
        
        if (!dayGarcomPrint[g]) dayGarcomPrint[g] = { venda: 0, comissao: 0, itens: [] };
        dayGarcomPrint[g].venda += vt;
        dayGarcomPrint[g].comissao += ci;
        dayGarcomPrint[g].itens.push({
          hora: sale.dateText && sale.dateText.length > 10 ? sale.dateText.substring(11, 16) : '',
          mesa: fmtMesa(sale.mesa),
          comanda: fmtComanda(sale.comanda),
          nome: item.nome + (exempt ? ' *' : ''),
          qtd: item.qtd,
          valor: vt,
          comissao: ci
        });
      }
    }
    
    H += `<div class="daily-block">
      <div class="daily-header">
        <span class="dh-date">📅 ${dia}</span>
        <span class="dh-totals">Itens: R$ ${fmt(dayTotalItens)} | Taxa: R$ ${fmt(dayTotalTaxa)} | ${dsales.length} vendas</span>
      </div>`;
    
    for (const [g, v] of Object.entries(dayGarcomPrint).sort((a,b) => b[1].comissao - a[1].comissao)) {
      H += `<table class="daily-garcom-table">
        <thead>
          <tr><th colspan="6" style="background:#e0f2fe;text-align:left;padding:10px 12px;font-size:14px">
            👤 ${g} — Vendas: R$ ${fmt(v.venda)} — <b>Comissão: R$ ${fmt(v.comissao)}</b>
          </th></tr>
          <tr><th>Hora</th><th>Mesa</th><th>Comanda</th><th>Item</th><th class="tr">Qtd</th><th class="tr">Comissão</th></tr>
        </thead>
        <tbody>`;
      
      for (const i of v.itens) {
        H += `<tr>
          <td>${i.hora}</td>
          <td>M${i.mesa}</td>
          <td>C${i.comanda}</td>
          <td>${i.nome.substring(0, 40)}</td>
          <td class="tr">${i.qtd}</td>
          <td class="tr">R$ ${fmt(i.comissao)}</td>
        </tr>`;
      }
      
      H += `<tr class="daily-total-row">
        <td colspan="5" style="text-align:right;font-weight:700">Total ${g}:</td>
        <td class="tr" style="font-weight:700;color:#0f1117">R$ ${fmt(v.comissao)}</td>
      </tr>`;
      H += `</tbody></table>`;
    }
    
    const dayTotalComissao = Object.values(dayGarcomPrint).reduce((a, v) => a + v.comissao, 0);
    H += `<div class="daily-day-total">
      <span>💰 Total Comissões do Dia ${dia}:</span>
      <span style="font-weight:700;font-size:16px">R$ ${fmt(dayTotalComissao)}</span>
    </div>`;
    H += `</div>`;
  }
  
  H += `</div>`;

  document.querySelector('.page').innerHTML = H;
  setupEventListeners();
}

function setupEventListeners() {
  document.getElementById('btnCopiarTudo').addEventListener('click', copiarTudo);
  document.getElementById('btnImprimir').addEventListener('click', function() { window.print(); });
  document.getElementById('btnSalvarPDF').addEventListener('click', salvarPDF);
  document.getElementById('btnCSVCompleto').addEventListener('click', function() { exportarCSVCompleto(this); });
  document.getElementById('btnAlertas').addEventListener('click', toggleAlertas);

  document.getElementById('filterGarcom').addEventListener('change', function() {
    selectedGarcom = this.value;
    applyFilter();
  });

  document.getElementById('chkPrintDaily').addEventListener('change', function() {
    document.body.classList.toggle('print-daily', this.checked);
    const dailyEl = document.getElementById('dailySummary');
    if (dailyEl) {
      dailyEl.classList.toggle('active', this.checked);
    }
  });

  document.querySelectorAll('.btn-copy-garcom').forEach(function(btn) {
    btn.addEventListener('click', function() {
      const garcomEncoded = this.getAttribute('data-garcom');
      copiarGarcom(garcomEncoded, this);
    });
  });

  // Day section toggle (collapsed by default)
  document.querySelectorAll('.date-toggle').forEach(function(header) {
    header.style.cursor = 'pointer';
    header.addEventListener('click', function() {
      const dia = this.getAttribute('data-dia-toggle');
      const content = document.querySelector('[data-dia-content="' + dia + '"]');
      const icon = this.querySelector('.date-toggle-icon');
      if (content) {
        const isVisible = content.style.display !== 'none';
        content.style.display = isVisible ? 'none' : '';
        if (icon) icon.textContent = isVisible ? '▶' : '▼';
      }
    });
  });
}

function salvarPDF() {
  // Obter período das datas do relatório
  const byDate = {};
  for (const s of SALES_DATA) {
    const dia = (s.dateText || 'Sem data').substring(0, 10);
    if (!byDate[dia]) byDate[dia] = [];
    byDate[dia].push(s);
  }
  const dias = Object.keys(byDate).sort();
  const minDate = dias[0] || 'sem-data';
  const maxDate = dias[dias.length - 1] || 'sem-data';
  
  // Formatar datas para nome do arquivo (remover barras)
  const minDateFile = minDate.replace(/\//g, '-');
  const maxDateFile = maxDate.replace(/\//g, '-');
  
  // Nome do arquivo
  let filename;
  if (selectedGarcom === 'TODOS') {
    filename = `Relatorio_Comissoes_${minDateFile}_a_${maxDateFile}`;
  } else {
    filename = `Comissao_${selectedGarcom}_${minDateFile}_a_${maxDateFile}`;
  }
  
  // Atualizar título da página (usado pelo Chrome como nome do PDF)
  const originalTitle = document.title;
  document.title = filename;
  
  // Se está filtrado por garçom, expandir todos os dias para impressão
  if (selectedGarcom !== 'TODOS') {
    document.querySelectorAll('.ind-day-content').forEach(el => {
      el.classList.add('expanded');
    });
    document.querySelectorAll('.ind-toggle-icon').forEach(el => {
      el.textContent = '▼';
    });
  }
  
  // Mostrar instruções
  const btn = document.getElementById('btnSalvarPDF');
  const origText = btn.textContent;
  btn.textContent = '⏳ Salvando...';
  btn.disabled = true;
  
  // Aguardar um momento para atualização do título
  setTimeout(function() {
    window.print();
    
    // Restaurar título original
    setTimeout(function() {
      document.title = originalTitle;
      btn.textContent = origText;
      btn.disabled = false;
    }, 1000);
  }, 100);
}

function applyFilter() {
  const filter = selectedGarcom;
  
  // Filtrar tabela global de garçons
  document.querySelectorAll('.global-table tbody tr').forEach(tr => {
    const g = tr.getAttribute('data-garcom');
    tr.style.display = (filter === 'TODOS' || filter === g) ? '' : 'none';
  });

  // Filtrar blocos de data e vendas
  document.querySelectorAll('.date-block').forEach(block => {
    let blockHasItems = filter === 'TODOS';
    
    block.querySelectorAll('.venda-wrap').forEach(venda => {
      let vendaHasItems = filter === 'TODOS';
      
      venda.querySelectorAll('tr[data-item-garcom]').forEach(tr => {
        const g = tr.getAttribute('data-item-garcom');
        const show = filter === 'TODOS' || filter === g;
        tr.style.display = show ? '' : 'none';
        if (show) vendaHasItems = true;
      });
      
      venda.querySelectorAll('[data-subtotal-garcom]').forEach(el => {
        const g = el.getAttribute('data-subtotal-garcom');
        el.style.display = (filter === 'TODOS' || filter === g) ? '' : 'none';
      });
      
      venda.style.display = vendaHasItems ? '' : 'none';
      if (vendaHasItems) blockHasItems = true;
    });
    
    block.querySelectorAll('[data-day-garcom]').forEach(el => {
      const g = el.getAttribute('data-day-garcom');
      el.style.display = (filter === 'TODOS' || filter === g) ? '' : 'none';
    });
    
    block.style.display = blockHasItems ? '' : 'none';
  });
}

function renderIndividualGarcom(garcom) {
  const byDate = {};
  let totalVenda = 0, totalComissao = 0, totalItens = 0;
  let minDate = null, maxDate = null;
  
  for (const sale of SALES_DATA) {
    if (sale.canceled || !sale.items) continue;
    const totalNaoIsento = calcTotalNaoIsento(sale.items);
    
    for (const item of sale.items) {
      if (item.itemCancelado) continue;
      const g = (item.garcom || '?').toUpperCase().trim();
      if (g !== garcom) continue;
      
      const dia = (sale.dateText || 'Sem data').substring(0, 10);
      const hora = sale.dateText && sale.dateText.length > 10 ? sale.dateText.substring(11, 16) : '';
      const vt = item.valor * item.qtd;
      const exempt = isIsento(item.nome);
      const ci = (!exempt && totalNaoIsento > 0) ? (vt / totalNaoIsento) * sale.taxa : 0;
      
      if (!byDate[dia]) byDate[dia] = { itens: [], totalVenda: 0, totalComissao: 0 };
      byDate[dia].itens.push({
        hora, mesa: fmtMesa(sale.mesa), comanda: fmtComanda(sale.comanda),
        nome: item.nome + (exempt ? ' *' : ''), qtd: item.qtd, valor: vt, comissao: ci
      });
      byDate[dia].totalVenda += vt;
      byDate[dia].totalComissao += ci;
      
      totalVenda += vt;
      totalComissao += ci;
      totalItens++;
      
      if (!minDate || dia < minDate) minDate = dia;
      if (!maxDate || dia > maxDate) maxDate = dia;
    }
  }
  
  const dias = Object.keys(byDate).sort();
  
  let H = `
<div class="individual-header">
  <div class="ih-title">👤 Relatório Individual: <b>${garcom}</b></div>
  <div class="ih-period">Período: ${minDate || '—'} até ${maxDate || '—'}</div>
</div>

<div class="individual-cards">
  <div class="ind-card"><div class="ic-label">Total Vendido</div><div class="ic-value">R$ ${fmt(totalVenda)}</div></div>
  <div class="ind-card highlight"><div class="ic-label">💰 Comissão Total</div><div class="ic-value">R$ ${fmt(totalComissao)}</div></div>
  <div class="ind-card"><div class="ic-label">Itens Vendidos</div><div class="ic-value">${totalItens}</div></div>
  <div class="ind-card"><div class="ic-label">Dias Trabalhados</div><div class="ic-value">${dias.length}</div></div>
</div>
`;
  
  for (const dia of dias) {
    const dData = byDate[dia];
    const diaId = dia.replace(/\//g, '-');
    H += `
<div class="ind-day-block">
  <div class="ind-day-header" data-toggle="${diaId}">
    <span class="ind-day-date">📅 ${dia}</span>
    <span class="ind-day-stats">${dData.itens.length} itens | Vendas: R$ ${fmt(dData.totalVenda)} | <b>Comissão: R$ ${fmt(dData.totalComissao)}</b></span>
    <span class="ind-toggle-icon">▶</span>
  </div>
  <div class="ind-day-content" id="day-${diaId}">
  <table class="ind-items-table">
    <thead>
      <tr><th>Hora</th><th>Mesa</th><th>Comanda</th><th>Item</th><th class="tr">Qtd</th><th class="tr">Valor</th><th class="tr">Comissão</th></tr>
    </thead>
    <tbody>`;
    
    for (const i of dData.itens) {
      H += `<tr>
        <td>${i.hora}</td>
        <td>M${i.mesa}</td>
        <td>C${i.comanda}</td>
        <td>${i.nome.substring(0, 35)}</td>
        <td class="tr">${i.qtd}</td>
        <td class="tr">R$ ${fmt(i.valor)}</td>
        <td class="tr">R$ ${fmt(i.comissao)}</td>
      </tr>`;
    }
    
    H += `</tbody>
    <tfoot>
      <tr class="ind-day-total">
        <td colspan="6" style="text-align:right;font-weight:700">Comissão do Dia:</td>
        <td class="tr" style="font-weight:700;color:#15803d;font-size:14px">R$ ${fmt(dData.totalComissao)}</td>
      </tr>
    </tfoot>
  </table>
  </div>
</div>`;
  }
  
  H += `
<div class="ind-grand-total">
  <div class="igt-title">📊 TOTAL GERAL — ${garcom}</div>
  <div class="igt-period">Período: ${minDate || '—'} até ${maxDate || '—'}</div>
  <div class="igt-summary">
    <div class="igt-item"><span>Total Vendido:</span><span>R$ ${fmt(totalVenda)}</span></div>
    <div class="igt-item"><span>Itens Vendidos:</span><span>${totalItens}</span></div>
    <div class="igt-item highlight"><span>💰 COMISSÃO TOTAL:</span><span>R$ ${fmt(totalComissao)}</span></div>
  </div>
</div>`;
  
  return H;
}

function setupDayToggleListeners() {
  document.querySelectorAll('.ind-day-header[data-toggle]').forEach(header => {
    header.addEventListener('click', function() {
      const dayId = this.getAttribute('data-toggle');
      const content = document.getElementById('day-' + dayId);
      const icon = this.querySelector('.ind-toggle-icon');
      
      if (content) {
        const isExpanded = content.classList.contains('expanded');
        content.classList.toggle('expanded');
        if (icon) {
          icon.textContent = isExpanded ? '▶' : '▼';
        }
      }
    });
  });
}

function toggleAlertas() {
  const el = document.getElementById('alertasWrap');
  const btn = document.getElementById('btnAlertas');
  if (el.style.display === 'none') {
    el.style.display = 'block';
    btn.textContent = '✖ Ocultar Alertas';
  } else {
    el.style.display = 'none';
    btn.textContent = '⚠️ Ver Alertas';
  }
}

function copiarGarcom(garcomEncoded, btn) {
  const garcom = decodeURIComponent(garcomEncoded).toUpperCase().trim();
  const ts = new Date().toLocaleString('pt-BR');

  function fmtVal(n) {
    if (!n) return '0,00';
    return n.toFixed(2).replace('.', ',').replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  }

  const lines = [];
  lines.push('═══════════════════════════════════════════');
  lines.push('📋 COMISSÃO DE ' + garcom);
  lines.push('🏪 ' + STORE_NAME);
  lines.push('📅 ' + ts);
  lines.push('═══════════════════════════════════════════');
  lines.push('');

  const byDate = {};
  let totalVenda = 0, totalComissao = 0, totalItens = 0;

  for (const sale of SALES_DATA) {
    if (sale.canceled || !sale.items) continue;
    const totalNaoIsento = calcTotalNaoIsento(sale.items);
    for (const item of sale.items) {
      if (item.itemCancelado) continue;
      const g = (item.garcom || '?').toUpperCase().trim();
      if (g !== garcom) continue;

      const dia = (sale.dateText || 'Sem data').substring(0, 10);
      const hora = sale.dateText && sale.dateText.length > 10 ? sale.dateText.substring(11,16) : '';
      const vt = item.valor * item.qtd;
      const exempt = isIsento(item.nome);
      const ci = (!exempt && totalNaoIsento > 0) ? (vt / totalNaoIsento) * sale.taxa : 0;

      if (!byDate[dia]) byDate[dia] = [];
      byDate[dia].push({
        hora, mesa: fmtMesa(sale.mesa), comanda: fmtComanda(sale.comanda),
        nome: item.nome + (exempt ? ' *' : ''), qtd: item.qtd, valor: vt, comissao: ci
      });

      totalVenda += vt;
      totalComissao += ci;
      totalItens++;
    }
  }

  for (const [dia, itens] of Object.entries(byDate).sort()) {
    const diaTotal = itens.reduce((a,i) => a + i.comissao, 0);
    lines.push('📅 ' + dia + ' (' + itens.length + ' itens)');
    lines.push('─────────────────────────────────────────');
    for (const i of itens) {
      lines.push('  ' + i.hora + ' | M' + i.mesa + ' C' + i.comanda + ' | ' + i.nome.substring(0,25).padEnd(25) + ' x' + i.qtd + ' | R$ ' + fmtVal(i.comissao));
    }
    lines.push('  Subtotal dia: R$ ' + fmtVal(diaTotal));
    lines.push('');
  }

  lines.push('═══════════════════════════════════════════');
  lines.push('📊 RESUMO ' + garcom);
  lines.push('   Total vendido: R$ ' + fmtVal(totalVenda));
  lines.push('   Total itens: ' + totalItens);
  lines.push('   💰 COMISSÃO: R$ ' + fmtVal(totalComissao));
  lines.push('═══════════════════════════════════════════');

  navigator.clipboard.writeText(lines.join('\n')).then(() => {
    const orig = btn.innerHTML;
    btn.innerHTML = '✅ Copiado!';
    btn.classList.add('copied');
    setTimeout(() => {
      btn.innerHTML = orig;
      btn.classList.remove('copied');
    }, 2000);
  });
}

function copiarTudo() {
  const lines = [];
  const ts = new Date().toLocaleString('pt-BR');

  function fmtVal(n) {
    if (!n) return '0,00';
    return n.toFixed(2).replace('.', ',').replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  }

  lines.push('╔══════════════════════════════════════════════════════════════════════╗');
  lines.push('║           RELATÓRIO DE COMISSÕES – SAIPOS TOOLS                      ║');
  lines.push('╠══════════════════════════════════════════════════════════════════════╣');
  lines.push('║  🏪 ' + STORE_NAME.padEnd(65) + '║');
  lines.push('║  📅 Gerado em: ' + ts.padEnd(55) + '║');
  lines.push('╚══════════════════════════════════════════════════════════════════════╝');

  const byDate = {};
  for (const s of SALES_DATA) {
    const dia = (s.dateText || 'Sem data').substring(0, 10);
    if (!byDate[dia]) byDate[dia] = [];
    byDate[dia].push(s);
  }

  const globalGarcom = {};

  for (const [dia, vendas] of Object.entries(byDate).sort((a,b) => a[0].localeCompare(b[0]))) {
    const totalDia = vendas.filter(s => !s.canceled).reduce((a,s) => a + s.totalItens, 0);
    const taxaDia = vendas.filter(s => !s.canceled).reduce((a,s) => a + s.taxa, 0);
    const dayGarcom = {};

    lines.push('');
    lines.push('┌──────────────────────────────────────────────────────────────────────┐');
    lines.push('│  📅 ' + dia + '    |    Vendas: ' + vendas.length + '    |    Total: R$ ' + fmtVal(totalDia) + '    |    Taxa: R$ ' + fmtVal(taxaDia));
    lines.push('└──────────────────────────────────────────────────────────────────────┘');

    for (const sale of vendas) {
      const pct = sale.totalItens > 0 ? sale.taxa / sale.totalItens * 100 : 0;
      const hora = sale.dateText && sale.dateText.length > 10 ? sale.dateText.substring(11) : '';
      const status = sale.canceled ? '🚫 CANCELADO' : (pct >= 9.95 ? '✅ ' + pct.toFixed(1).replace('.',',') + '%' : '⚠️ ' + pct.toFixed(1).replace('.',',') + '%');

      lines.push('');
      lines.push('   ┌─ M' + fmtMesa(sale.mesa) + ' C' + fmtComanda(sale.comanda) + ' | Hora: ' + hora + ' | ' + (sale.pagamento || '—'));
      lines.push('   │  Itens: R$ ' + fmtVal(sale.totalItens) + ' | Taxa: R$ ' + fmtVal(sale.taxa) + ' | ' + status);

      if (sale.canceled) {
        lines.push('   └─ Venda cancelada');
      } else if (sale.items && sale.items.length > 0) {
        lines.push('   │');
        lines.push('   │  ITENS:');
        lines.push('   │  ' + 'Item'.padEnd(35) + 'Qtd'.padStart(5) + '   Garçom'.padEnd(18) + 'Valor Unit.'.padStart(14) + 'Total'.padStart(14) + 'Comissão'.padStart(14));
        lines.push('   │  ' + '─'.repeat(100));

        const vGarcom = {};
        const totalNaoIsento = calcTotalNaoIsento(sale.items);
        for (const item of sale.items) {
          const vt = item.valor * item.qtd;
          const exempt = isIsento(item.nome);
          const ci = (!exempt && !item.itemCancelado && totalNaoIsento > 0) ? (vt / totalNaoIsento) * sale.taxa : 0;
          const nome = (item.nome || '?').substring(0, 32);
          const garcom = (item.garcom || '?').toUpperCase().trim();
          const cancelStr = item.itemCancelado ? ' [CANC]' : '';
          const isentoStr = (exempt && !item.itemCancelado) ? ' *' : '';

          lines.push('   │  ' + (nome + cancelStr + isentoStr).padEnd(35) + String(item.qtd).padStart(5) + '   ' + garcom.padEnd(15) + ('R$ ' + fmtVal(item.valor)).padStart(14) + ('R$ ' + fmtVal(vt)).padStart(14) + (item.itemCancelado ? '—'.padStart(14) : ('R$ ' + fmtVal(ci)).padStart(14)));

          if (!item.itemCancelado) {
            if (!vGarcom[garcom]) vGarcom[garcom] = { venda: 0, comissao: 0 };
            vGarcom[garcom].venda += vt;
            vGarcom[garcom].comissao += ci;

            if (!dayGarcom[garcom]) dayGarcom[garcom] = { venda: 0, comissao: 0 };
            dayGarcom[garcom].venda += vt;
            dayGarcom[garcom].comissao += ci;

            if (!globalGarcom[garcom]) globalGarcom[garcom] = { venda: 0, comissao: 0, qtd: 0 };
            globalGarcom[garcom].venda += vt;
            globalGarcom[garcom].comissao += ci;
            globalGarcom[garcom].qtd++;
          }
        }

        if (Object.keys(vGarcom).length > 0) {
          lines.push('   │');
          lines.push('   │  SUBTOTAL POR GARÇOM:');
          for (const [g, v] of Object.entries(vGarcom).sort((a,b) => b[1].comissao - a[1].comissao)) {
            lines.push('   │  👤 ' + g.padEnd(20) + 'Vendeu: R$ ' + fmtVal(v.venda).padStart(10) + '    Comissão: R$ ' + fmtVal(v.comissao));
          }
        }
        lines.push('   └─');
      }
    }

    if (Object.keys(dayGarcom).length > 0) {
      lines.push('');
      lines.push('   ════════════════════════════════════════════════════════════════════');
      lines.push('   📊 RESUMO DO DIA ' + dia + ':');
      for (const [g, v] of Object.entries(dayGarcom).sort((a,b) => b[1].comissao - a[1].comissao)) {
        lines.push('      👤 ' + g.padEnd(20) + 'Total Vendido: R$ ' + fmtVal(v.venda).padStart(12) + '    Comissão: R$ ' + fmtVal(v.comissao));
      }
      lines.push('   ════════════════════════════════════════════════════════════════════');
    }
  }

  lines.push('');
  lines.push('');
  lines.push('╔══════════════════════════════════════════════════════════════════════╗');
  lines.push('║                    📊 RESUMO GLOBAL POR GARÇOM                        ║');
  lines.push('╠══════════════════════════════════════════════════════════════════════╣');
  lines.push('║  Garçom                    Total Vendido        Total Comissão   Qtd  ║');
  lines.push('╠══════════════════════════════════════════════════════════════════════╣');

  for (const [g, v] of Object.entries(globalGarcom).sort((a,b) => b[1].comissao - a[1].comissao)) {
    lines.push('║  ' + g.padEnd(22) + ('R$ ' + fmtVal(v.venda)).padStart(16) + ('R$ ' + fmtVal(v.comissao)).padStart(20) + String(v.qtd).padStart(8) + '  ║');
  }

  lines.push('╚══════════════════════════════════════════════════════════════════════╝');

  const totalVendido = Object.values(globalGarcom).reduce((a, v) => a + v.venda, 0);
  const totalComissao = Object.values(globalGarcom).reduce((a, v) => a + v.comissao, 0);
  lines.push('');
  lines.push('💰 TOTAL GERAL: Vendido R$ ' + fmtVal(totalVendido) + ' | Comissões R$ ' + fmtVal(totalComissao));
  lines.push('');
  lines.push('─────────────────────────────────────────────────────────────────────────');
  lines.push('Gerado por Saipos Tools | ' + ts);

  navigator.clipboard.writeText(lines.join('\n')).then(() => {
    const btn = document.getElementById('btnCopiarTudo');
    const orig = btn.textContent;
    btn.textContent = '✅ Copiado!';
    btn.style.background = '#15803d';
    setTimeout(() => { btn.textContent = orig; btn.style.background = ''; }, 2500);
  });
}

function downloadCSV(filename, content) {
  const BOM = '\uFEFF';
  const blob = new Blob([BOM + content], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function escapeCSV(val) {
  if (val == null) return '';
  const str = String(val);
  if (str.includes(';') || str.includes('"') || str.includes('\n')) {
    return '"' + str.replace(/"/g, '""') + '"';
  }
  return str;
}

function fmtNum(n) {
  return (n || 0).toFixed(2).replace('.', ',');
}

function exportarCSVCompleto(btn) {
  const ts = new Date().toISOString().slice(0,10);
  let csv = '';
  const filename = 'saipos_relatorio_completo_' + ts + '.csv';

  csv += '=== ITENS DETALHADOS ===\n';
  csv += 'Data;Mesa;Comanda;Hora;Item;Qtde;Garçom;Valor Unit;Total Item;Taxa Venda;Comissão Item;% Taxa;Cancelado;Isento\n';
  
  for (const sale of SALES_DATA) {
    if (sale.canceled || !sale.items) continue;
    const dia = (sale.dateText || '').substring(0, 10);
    const hora = (sale.dateText || '').substring(11, 19);
    const pct = sale.totalItens > 0 ? (sale.taxa / sale.totalItens * 100) : 0;
    const totalNaoIsento = calcTotalNaoIsento(sale.items);
    
    for (const item of sale.items) {
      const vt = item.valor * item.qtd;
      const exempt = isIsento(item.nome);
      const comissao = (!exempt && !item.itemCancelado && totalNaoIsento > 0) ? (vt / totalNaoIsento) * sale.taxa : 0;
      csv += [
        escapeCSV(dia), 'M' + fmtMesa(sale.mesa), 'C' + fmtComanda(sale.comanda), escapeCSV(hora),
        escapeCSV(item.nome), item.qtd, escapeCSV(item.garcom), fmtNum(item.valor),
        fmtNum(vt), fmtNum(sale.taxa), item.itemCancelado ? '0,00' : fmtNum(comissao),
        fmtNum(pct) + '%', item.itemCancelado ? 'SIM' : '', exempt ? 'SIM' : ''
      ].join(';') + '\n';
    }
  }

  csv += '\n\n';

  csv += '=== RESUMO POR GARÇOM ===\n';
  csv += 'Garçom;Total Vendido;Total Comissão;Qtd Itens\n';
  
  const garcom = {};
  for (const sale of SALES_DATA) {
    if (sale.canceled || !sale.items) continue;
    const totalNaoIsento = calcTotalNaoIsento(sale.items);
    for (const item of sale.items) {
      if (item.itemCancelado) continue;
      const g = (item.garcom || '?').toUpperCase().trim();
      const vt = item.valor * item.qtd;
      const exempt = isIsento(item.nome);
      const ci = (!exempt && totalNaoIsento > 0) ? (vt / totalNaoIsento) * sale.taxa : 0;
      if (!garcom[g]) garcom[g] = { venda: 0, comissao: 0, qtd: 0 };
      garcom[g].venda += vt;
      garcom[g].comissao += ci;
      garcom[g].qtd++;
    }
  }
  
  for (const [g, v] of Object.entries(garcom).sort((a,b) => b[1].comissao - a[1].comissao)) {
    csv += [escapeCSV(g), fmtNum(v.venda), fmtNum(v.comissao), v.qtd].join(';') + '\n';
  }

  csv += '\n\n';

  csv += '=== VENDAS ===\n';
  csv += 'Data;Hora;Mesa;Comanda;Pagamento;Total Itens;Taxa Serviço;% Taxa;Status\n';
  
  for (const sale of SALES_DATA) {
    const dia = (sale.dateText || '').substring(0, 10);
    const hora = (sale.dateText || '').substring(11, 19);
    const pct = sale.totalItens > 0 ? (sale.taxa / sale.totalItens * 100) : 0;
    let status = '';
    if (sale.canceled) status = 'CANCELADA';
    else if (sale.taxa === 0 && sale.totalItens > 0) status = 'SEM TAXA';
    else if (pct < 9.95 && pct > 0) status = 'TAXA BAIXA';
    
    csv += [
      escapeCSV(dia), escapeCSV(hora), 'M' + fmtMesa(sale.mesa), 'C' + fmtComanda(sale.comanda),
      escapeCSV(sale.pagamento), fmtNum(sale.totalItens), fmtNum(sale.taxa),
      fmtNum(pct) + '%', status
    ].join(';') + '\n';
  }
  
  downloadCSV(filename, csv);
  
  if (btn) {
    const orig = btn.textContent;
    btn.textContent = '✅ Baixado!';
    btn.style.background = '#15803d';
    btn.style.color = '#fff';
    setTimeout(() => { btn.textContent = orig; btn.style.background = ''; btn.style.color = ''; }, 2500);
  }
}
