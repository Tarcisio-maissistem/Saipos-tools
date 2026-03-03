// ================================================================
// report.js — Gera relatório HTML completo com comissões
// ================================================================

function fmt(n) {
  if (!n) return '0,00';
  return n.toFixed(2).replace('.', ',').replace(/\B(?=(\d{3})+(?!\d))/g, '.');
}

function pctClass(pct, canceled) {
  if (canceled) return 'c-cancel';
  if (pct === 0)     return 'c-zero';
  if (pct < 9.95)    return 'c-low';
  return 'c-ok';
}

function pctLabel(pct, canceled) {
  if (canceled) return 'CANCELADO';
  return pct.toFixed(1).replace('.', ',') + '%';
}

function gerarRelatorio(sales, storeName = 'Loja Saipos') {
  // Guarda nome da loja globalmente para a função copiarTudo
  window.__SAIPOS_STORE_NAME = storeName;
  
  // ── Agrupa por dia ──────────────────────────────────────────
  const byDate = {};
  for (const s of sales) {
    // data no formato "DD/MM/YYYY HH:MM:SS" ou "DD/MM/YYYY, HH:MM:SS"
    const dia = (s.dateText || 'Sem data').substring(0, 10);
    if (!byDate[dia]) byDate[dia] = [];
    byDate[dia].push(s);
  }

  // ── Totais globais por garçom ────────────────────────────────
  const globalGarcom = {}; // { nome: { venda, comissao, qtdItens } }

  function acumGarcom(nome, venda, comissao) {
    if (!globalGarcom[nome]) globalGarcom[nome] = { venda: 0, comissao: 0, qtd: 0 };
    globalGarcom[nome].venda    += venda;
    globalGarcom[nome].comissao += comissao;
    globalGarcom[nome].qtd++;
  }

  // ── Contadores de alertas ────────────────────────────────────
  let gtItens = 0, gtTaxa = 0, gtCanceladas = 0, gtSemTaxa = 0, gtBaixaTaxa = 0;
  for (const s of sales) {
    if (s.canceled) { gtCanceladas++; continue; }
    gtItens += s.totalItens;
    gtTaxa  += s.taxa;
    const p = s.totalItens > 0 ? s.taxa / s.totalItens * 100 : 0;
    if (s.totalItens > 0 && s.taxa === 0)          gtSemTaxa++;
    if (s.totalItens > 0 && p > 0 && p < 9.95)    gtBaixaTaxa++;
  }

  // ── HTML ─────────────────────────────────────────────────────
  let H = `<!DOCTYPE html><html lang="pt-BR"><head>
<meta charset="UTF-8">
<title>Relatório de Comissões – Saipos Tools</title>
<style>
@import url('https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;600;700&family=IBM+Plex+Sans:wght@400;500;600;700&display=swap');
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
body{font-family:'IBM Plex Sans',sans-serif;background:#f0f2f5;color:#1a1d27;font-size:13px;line-height:1.5}
.page{max-width:1200px;margin:0 auto;padding:28px 16px 80px}

/* ─── Cabeçalho ─── */
.header{display:flex;align-items:center;gap:14px;margin-bottom:24px}
.logo{width:44px;height:44px;background:#0f1117;border-radius:10px;display:flex;align-items:center;justify-content:center;color:#00e5a0;font-family:'IBM Plex Mono',monospace;font-weight:700;font-size:20px;flex-shrink:0}
.header h1{font-family:'IBM Plex Mono',monospace;font-size:20px;font-weight:700;color:#0f1117}
.header .store-name{font-size:14px;color:#00c27c;font-weight:600;margin-top:2px}
.header p{color:#6b7280;font-size:11px}

/* ─── Cards resumo ─── */
.cards{display:flex;gap:10px;flex-wrap:wrap;margin-bottom:24px}
.card{background:#fff;border-radius:10px;padding:14px 18px;flex:1;min-width:140px;box-shadow:0 1px 3px rgba(0,0,0,.08)}
.card .cl{font-size:10px;color:#6b7280;text-transform:uppercase;letter-spacing:.5px;font-weight:600}
.card .cv{font-size:18px;font-weight:700;margin-top:3px;font-family:'IBM Plex Mono',monospace}
.card.ok  .cv{color:#15803d}
.card.warn .cv{color:#b45309}
.card.bad  .cv{color:#b91c1c}

/* ─── Barra de ações ─── */
.toolbar{display:flex;gap:8px;margin-bottom:20px;flex-wrap:wrap}
.btn{display:inline-flex;align-items:center;gap:6px;padding:7px 14px;border:none;border-radius:7px;
     font-family:'IBM Plex Sans',sans-serif;font-size:12px;font-weight:600;cursor:pointer;transition:.15s}
.btn-dark{background:#0f1117;color:#fff}.btn-dark:hover{background:#374151}
.btn-green{background:#00c27c;color:#fff}.btn-green:hover{background:#00a86b}
.btn-outline{background:#fff;color:#374151;border:1px solid #d1d5db}.btn-outline:hover{background:#f9fafb}
.btn:active{transform:scale(.97)}

/* ─── Bloco de data ─── */
.date-block{margin-bottom:24px}
.date-header{background:#0f1117;color:#fff;padding:10px 16px;border-radius:10px 10px 0 0;
             display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px}
.date-header .dh-title{font-family:'IBM Plex Mono',monospace;font-size:14px;font-weight:700}
.date-header .dh-info{display:flex;gap:16px;font-size:11px;opacity:.8;flex-wrap:wrap}
.date-content{background:#fff;border:1px solid #e5e7eb;border-top:none;border-radius:0 0 10px 10px;overflow:hidden}

/* ─── Venda (mesa/comanda) ─── */
.venda-wrap{border-bottom:2px solid #f1f5f9}
.venda-wrap:last-child{border-bottom:none}
.venda-head{background:#f8fafc;padding:8px 14px;display:flex;gap:14px;align-items:center;
            flex-wrap:wrap;border-bottom:1px solid #e5e7eb}
.venda-head .tag{font-size:11px;color:#6b7280}
.venda-head .tag b{color:#1a1d27;font-size:12px}

/* ─── Badges ─── */
.badge{display:inline-block;padding:2px 8px;border-radius:4px;font-size:10px;font-weight:700;letter-spacing:.3px}
.c-ok     {background:#dcfce7;color:#15803d}
.c-low    {background:#fef9c3;color:#92400e}
.c-zero   {background:#fee2e2;color:#b91c1c}
.c-cancel {background:#f3f4f6;color:#6b7280}
.c-item-cancel{background:#fee2e2;color:#991b1b;font-size:9px;padding:1px 5px}

/* ─── Tabela de itens ─── */
.items-table{width:100%;border-collapse:collapse}
.items-table thead th{background:#f1f5f9;padding:6px 12px;text-align:left;font-size:10px;
   text-transform:uppercase;letter-spacing:.4px;color:#64748b;font-weight:600;white-space:nowrap}
.items-table tbody td{padding:6px 12px;border-bottom:1px solid #f1f5f9;font-size:12px;vertical-align:middle}
.items-table tbody tr:last-child td{border-bottom:none}
.items-table tbody tr:hover td{background:#fafafa}
.items-table .tr-cancel td{opacity:.45;text-decoration:line-through}
.garcom-chip{display:inline-block;padding:2px 8px;border-radius:20px;font-size:11px;
             font-weight:600;background:#eff6ff;color:#1d4ed8}
.tr{text-align:right}.tc{text-align:center}

/* ─── Subtotal garçom na venda ─── */
.venda-subtotal{background:#f8fafc;padding:8px 14px;border-top:1px dashed #e5e7eb;
                display:flex;gap:14px;flex-wrap:wrap}
.vs-item .vs-name{font-weight:700;color:#1d4ed8;font-size:11px}
.vs-item .vs-val{color:#6b7280;font-size:10px}

/* ─── Resumo garçom no dia ─── */
.day-summary{background:#f0fdf4;border-top:2px solid #bbf7d0;padding:10px 14px;
             display:flex;gap:18px;flex-wrap:wrap}
.ds-item .ds-name{font-family:'IBM Plex Mono',monospace;font-size:11px;font-weight:700;color:#15803d}
.ds-item .ds-val{color:#6b7280;font-size:10px}

/* ─── Resumo global ─── */
.global-table{width:100%;border-collapse:collapse;background:#fff;border-radius:10px;
              overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,.08);margin-top:28px}
.global-table thead th{background:#0f1117;color:#fff;padding:10px 14px;font-size:11px;
   text-transform:uppercase;letter-spacing:.4px;font-weight:600}
.global-table tbody td{padding:9px 14px;border-bottom:1px solid #f1f5f9;font-size:13px}
.global-table tbody tr:last-child td{border-bottom:none}
.global-table tbody tr:hover td{background:#fafafa}
.global-title{font-family:'IBM Plex Mono',monospace;font-size:15px;font-weight:700;
              margin:28px 0 10px;color:#0f1117}
.btn-copy-garcom{display:inline-flex;align-items:center;gap:4px;padding:4px 10px;border:none;border-radius:5px;
   font-size:11px;font-weight:600;cursor:pointer;background:#eff6ff;color:#1d4ed8;transition:.15s;margin-left:8px}
.btn-copy-garcom:hover{background:#dbeafe;color:#1e40af}
.btn-copy-garcom:active{transform:scale(.95)}
.btn-copy-garcom.copied{background:#dcfce7;color:#15803d}

/* ─── Alertas ─── */
.alertas-wrap{margin-top:28px}
.alerta-section{background:#fff;border-radius:10px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,.08);margin-bottom:14px}
.alerta-header{padding:10px 14px;font-size:12px;font-weight:700;display:flex;align-items:center;gap:8px}
.alerta-header.ah-zero{background:#fee2e2;color:#991b1b}
.alerta-header.ah-low{background:#fef9c3;color:#92400e}
.alerta-header.ah-cancel{background:#f3f4f6;color:#374151}

/* ─── Print ─── */
@media print{
  .toolbar,.btn{display:none!important}
  body{background:#fff}
  .page{padding:0}
  .date-block{page-break-inside:avoid}
}
</style>
</head><body><div class="page">

<div class="header">
  <div class="logo">S</div>
  <div><h1>Relatório de Comissões</h1>
  <div class="store-name">🏪 ${storeName}</div>
  <p>Gerado em ${new Date().toLocaleString('pt-BR')} · Saipos Tools</p></div>
</div>

<div class="cards">
  <div class="card ok"><div class="cl">Total em Itens</div><div class="cv">R$ ${fmt(gtItens)}</div></div>
  <div class="card ok"><div class="cl">Taxa de Serviço</div><div class="cv">R$ ${fmt(gtTaxa)}</div></div>
  <div class="card ok"><div class="cl">Taxa média</div><div class="cv">${gtItens > 0 ? (gtTaxa/gtItens*100).toFixed(1).replace('.',',') : '0,0'}%</div></div>
  <div class="card warn"><div class="cl">Taxa &lt; 10%</div><div class="cv">${gtBaixaTaxa} vendas</div></div>
  <div class="card bad"><div class="cl">Sem Taxa</div><div class="cv">${gtSemTaxa} vendas</div></div>
  <div class="card bad"><div class="cl">Canceladas</div><div class="cv">${gtCanceladas} vendas</div></div>
</div>

<div class="toolbar">
  <button class="btn btn-dark" id="btnCopiarTudo">📋 Copiar Tudo</button>
  <button class="btn btn-green" id="btnImprimir">🖨️ Imprimir</button>
  <button class="btn btn-outline" id="btnCSVItens">📊 CSV Itens</button>
  <button class="btn btn-outline" id="btnCSVGarcons">📊 CSV Garçons</button>
  <button class="btn btn-outline" id="btnCSVVendas">📊 CSV Vendas</button>
  <button class="btn btn-outline" id="btnAlertas">⚠️ Ver Alertas</button>
</div>`;

  // ── Por data ─────────────────────────────────────────────────
  for (const [dia, dsales] of Object.entries(byDate).sort()) {
    const dItens = dsales.reduce((s, v) => s + (!v.canceled ? v.totalItens : 0), 0);
    const dTaxa  = dsales.reduce((s, v) => s + (!v.canceled ? v.taxa : 0), 0);
    const dPct   = dItens > 0 ? dTaxa / dItens * 100 : 0;

    // Garçons do dia
    const dayGarcom = {};

    H += `<div class="date-block" data-dia="${dia}">
<div class="date-header">
  <span class="dh-title">📅 ${dia}</span>
  <div class="dh-info">
    <span>Itens: R$ ${fmt(dItens)}</span>
    <span>Taxa: R$ ${fmt(dTaxa)}</span>
    <span>Média: ${dPct.toFixed(1).replace('.',',')}%</span>
    <span>${dsales.length} vendas</span>
  </div>
</div>
<div class="date-content">`;

    for (const sale of dsales) {
      const pct = sale.totalItens > 0 ? sale.taxa / sale.totalItens * 100 : 0;
      const hora = sale.dateText.length > 10 ? sale.dateText.substring(11) : '';

      H += `<div class="venda-wrap">
<div class="venda-head">
  <div class="tag"><b>Mesa ${sale.mesa || '—'}</b></div>
  <div class="tag">Comanda <b>${sale.comanda || '—'}</b></div>
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
        // Calcula subtotais por garçom nesta venda
        const vGarcom = {};
        for (const item of sale.items) {
          if (item.itemCancelado) continue;
          const g  = (item.garcom || '?').toUpperCase().trim();
          const vt = item.valor * item.qtd;
          const ci = sale.totalItens > 0 ? (vt / sale.totalItens) * sale.taxa : 0;
          if (!vGarcom[g]) vGarcom[g] = { venda: 0, comissao: 0 };
          vGarcom[g].venda    += vt;
          vGarcom[g].comissao += ci;

          // Acumula no dia
          if (!dayGarcom[g]) dayGarcom[g] = { venda: 0, comissao: 0 };
          dayGarcom[g].venda    += vt;
          dayGarcom[g].comissao += ci;

          // Acumula global
          acumGarcom(g, vt, ci);
        }

        // Tabela de itens
        H += `<div style="overflow-x:auto"><table class="items-table">
<thead><tr>
  <th>Item</th><th class="tc">Qtd</th><th>Garçom</th>
  <th class="tr">Valor Unit.</th><th class="tr">Total Item</th>
  <th class="tr">Comissão</th><th class="tr">% Taxa</th>
</tr></thead><tbody>`;

        for (const item of sale.items) {
          const vt  = item.valor * item.qtd;
          const ci  = sale.totalItens > 0 ? (vt / sale.totalItens) * sale.taxa : 0;
          const cls = item.itemCancelado ? ' class="tr-cancel"' : '';
          H += `<tr${cls}>
  <td>${item.nome}${item.itemCancelado ? ' <span class="badge c-item-cancel">CANC</span>' : ''}</td>
  <td class="tc">${item.qtd}</td>
  <td><span class="garcom-chip">${item.garcom || '—'}</span></td>
  <td class="tr">R$ ${fmt(item.valor)}</td>
  <td class="tr">R$ ${fmt(vt)}</td>
  <td class="tr">${item.itemCancelado ? '—' : 'R$ ' + fmt(ci)}</td>
  <td class="tr">${item.itemCancelado ? '—' : '<span class="badge ' + pctClass(pct, false) + '">' + pctLabel(pct, false) + '</span>'}</td>
</tr>`;
        }

        H += `</tbody></table></div>`;

        // Subtotal garçom na venda
        if (Object.keys(vGarcom).length > 0) {
          H += `<div class="venda-subtotal">`;
          for (const [g, v] of Object.entries(vGarcom).sort((a,b) => b[1].comissao - a[1].comissao)) {
            H += `<div class="vs-item">
              <div class="vs-name">👤 ${g}</div>
              <div class="vs-val">Vendeu R$ ${fmt(v.venda)} · Comissão R$ <b>${fmt(v.comissao)}</b></div>
            </div>`;
          }
          H += `</div>`;
        }

      } else {
        H += `<div style="padding:10px 14px;color:#9ca3af;font-size:12px">Sem itens registrados</div>`;
      }

      H += `</div>`; // venda-wrap
    }

    // Resumo garçons do dia
    if (Object.keys(dayGarcom).length > 0) {
      H += `<div class="day-summary">`;
      for (const [g, v] of Object.entries(dayGarcom).sort((a,b) => b[1].comissao - a[1].comissao)) {
        H += `<div class="ds-item">
          <div class="ds-name">👤 ${g}</div>
          <div class="ds-val">Vendas R$ ${fmt(v.venda)} · <b>Comissão R$ ${fmt(v.comissao)}</b></div>
        </div>`;
      }
      H += `</div>`;
    }

    H += `</div></div>`; // date-content, date-block
  }

  // ── Resumo global por garçom ─────────────────────────────────
  H += `<div class="global-title">👤 Resumo Global por Garçom</div>
<table class="global-table">
<thead><tr>
  <th>Garçom</th><th class="tr">Total Vendido</th>
  <th class="tr">Total Comissão</th><th class="tc">Itens</th><th class="tc">Ações</th>
</tr></thead><tbody>`;

  for (const [g, v] of Object.entries(globalGarcom).sort((a,b) => b[1].comissao - a[1].comissao)) {
    const gEncoded = encodeURIComponent(g);
    H += `<tr data-garcom="${g}">
  <td><span class="garcom-chip" style="font-size:13px">${g}</span></td>
  <td class="tr" style="font-family:'IBM Plex Mono',monospace">R$ ${fmt(v.venda)}</td>
  <td class="tr" style="font-family:'IBM Plex Mono',monospace;font-weight:700;color:#0f1117">R$ ${fmt(v.comissao)}</td>
  <td class="tc">${v.qtd}</td>
  <td class="tc"><button class="btn-copy-garcom" data-garcom="${gEncoded}">📋 Copiar</button></td>
</tr>`;
  }
  H += `</tbody></table>`;

  // ── Seção de alertas (oculta por padrão) ────────────────────
  const semTaxa    = sales.filter(s => !s.canceled && s.totalItens > 0 && s.taxa === 0);
  const baixaTaxa  = sales.filter(s => {
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
      H += `<tr><td>M${s.mesa}</td><td>C${s.comanda}</td><td>${s.dateText}</td><td>${s.pagamento}</td><td class="tr">R$ ${fmt(s.totalItens)}</td></tr>`;
    }
    H += `</tbody></table></div>`;
  }

  if (baixaTaxa.length > 0) {
    H += `<div class="alerta-section">
      <div class="alerta-header ah-low">⚠️ Taxa abaixo de 10% (${baixaTaxa.length} vendas)</div>
      <table class="items-table"><thead><tr><th>Mesa</th><th>Comanda</th><th>Data</th><th>Pagamento</th><th class="tr">Itens</th><th class="tr">Taxa</th><th class="tr">%</th></tr></thead><tbody>`;
    for (const s of baixaTaxa) {
      const p = (s.taxa / s.totalItens * 100).toFixed(1).replace('.',',');
      H += `<tr><td>M${s.mesa}</td><td>C${s.comanda}</td><td>${s.dateText}</td><td>${s.pagamento}</td>
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
      H += `<tr><td>M${s.mesa}</td><td>C${s.comanda}</td><td>${s.dateText}</td><td class="tr">R$ ${fmt(s.total)}</td></tr>`;
    }
    H += `</tbody></table></div>`;
  }

  H += `</div>`; // alertas-wrap

  // ── Script interativo ─────────────────────────────────────────
  H += `<script>
// Dados das vendas
const SALES_DATA = ${JSON.stringify(sales)};
const STORE_NAME = '${storeName.replace(/'/g, "\\'")}';
window.__SAIPOS_STORE_NAME = STORE_NAME;

// Event Listeners (CSP-compliant, sem onclick inline)
document.addEventListener('DOMContentLoaded', function() {
  
  // Botão Copiar Tudo
  document.getElementById('btnCopiarTudo').addEventListener('click', copiarTudo);
  
  // Botão Imprimir
  document.getElementById('btnImprimir').addEventListener('click', function() {
    window.print();
  });
  
  // Botões CSV
  document.getElementById('btnCSVItens').addEventListener('click', function() {
    exportarCSV('itens', this);
  });
  document.getElementById('btnCSVGarcons').addEventListener('click', function() {
    exportarCSV('garcons', this);
  });
  document.getElementById('btnCSVVendas').addEventListener('click', function() {
    exportarCSV('vendas', this);
  });
  
  // Botão Alertas
  document.getElementById('btnAlertas').addEventListener('click', toggleAlertas);
  
  // Botões de copiar por garçom (delegação de eventos)
  document.querySelectorAll('.btn-copy-garcom').forEach(function(btn) {
    btn.addEventListener('click', function() {
      const garcomEncoded = this.getAttribute('data-garcom');
      copiarGarcom(garcomEncoded, this);
    });
  });
});

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
  const storeName = window.__SAIPOS_STORE_NAME || 'Loja Saipos';
  const ts = new Date().toLocaleString('pt-BR');
  
  function fmtVal(n) {
    if (!n) return '0,00';
    return n.toFixed(2).replace('.', ',').replace(/\\B(?=(\\d{3})+(?!\\d))/g, '.');
  }
  
  const lines = [];
  lines.push('═══════════════════════════════════════════');
  lines.push('📋 COMISSÃO DE ' + garcom);
  lines.push('🏪 ' + storeName);
  lines.push('📅 ' + ts);
  lines.push('═══════════════════════════════════════════');
  lines.push('');
  
  // Agrupa por dia
  const byDate = {};
  let totalVenda = 0, totalComissao = 0, totalItens = 0;
  
  for (const sale of SALES_DATA) {
    if (sale.canceled || !sale.items) continue;
    
    for (const item of sale.items) {
      if (item.itemCancelado) continue;
      const g = (item.garcom || '?').toUpperCase().trim();
      if (g !== garcom) continue;
      
      const dia = (sale.dateText || 'Sem data').substring(0, 10);
      const hora = sale.dateText && sale.dateText.length > 10 ? sale.dateText.substring(11,16) : '';
      const vt = item.valor * item.qtd;
      const ci = sale.totalItens > 0 ? (vt / sale.totalItens) * sale.taxa : 0;
      
      if (!byDate[dia]) byDate[dia] = [];
      byDate[dia].push({
        hora,
        mesa: sale.mesa || '—',
        comanda: sale.comanda || '—',
        nome: item.nome,
        qtd: item.qtd,
        valor: vt,
        comissao: ci
      });
      
      totalVenda += vt;
      totalComissao += ci;
      totalItens++;
    }
  }
  
  // Gera texto por dia
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
  
  navigator.clipboard.writeText(lines.join('\\n')).then(() => {
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
  const storeName = window.__SAIPOS_STORE_NAME || 'Loja Saipos';
  
  // Função auxiliar para formatar valores
  function fmtVal(n) {
    if (!n) return '0,00';
    return n.toFixed(2).replace('.', ',').replace(/\\B(?=(\\d{3})+(?!\\d))/g, '.');
  }
  
  lines.push('╔══════════════════════════════════════════════════════════════════════╗');
  lines.push('║           RELATÓRIO DE COMISSÕES – SAIPOS TOOLS                      ║');
  lines.push('╠══════════════════════════════════════════════════════════════════════╣');
  lines.push('║  🏪 ' + storeName.padEnd(65) + '║');
  lines.push('║  📅 Gerado em: ' + ts.padEnd(55) + '║');
  lines.push('╚══════════════════════════════════════════════════════════════════════╝');
  
  // Agrupa vendas por data
  const byDate = {};
  for (const s of SALES_DATA) {
    const dia = (s.dateText || 'Sem data').substring(0, 10);
    if (!byDate[dia]) byDate[dia] = [];
    byDate[dia].push(s);
  }
  
  // Totais globais por garçom
  const globalGarcom = {};
  
  // Processa cada dia
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
      lines.push('   ┌─ Mesa: ' + (sale.mesa || '—') + ' | Comanda: ' + (sale.comanda || '—') + ' | Hora: ' + hora + ' | ' + (sale.pagamento || '—'));
      lines.push('   │  Itens: R$ ' + fmtVal(sale.totalItens) + ' | Taxa: R$ ' + fmtVal(sale.taxa) + ' | ' + status);
      
      if (sale.canceled) {
        lines.push('   └─ Venda cancelada');
      } else if (sale.items && sale.items.length > 0) {
        lines.push('   │');
        lines.push('   │  ITENS:');
        lines.push('   │  ' + 'Item'.padEnd(35) + 'Qtd'.padStart(5) + '   Garçom'.padEnd(18) + 'Valor Unit.'.padStart(14) + 'Total'.padStart(14) + 'Comissão'.padStart(14));
        lines.push('   │  ' + '─'.repeat(100));
        
        const vGarcom = {};
        for (const item of sale.items) {
          const vt = item.valor * item.qtd;
          const ci = sale.totalItens > 0 ? (vt / sale.totalItens) * sale.taxa : 0;
          const nome = (item.nome || '?').substring(0, 32);
          const garcom = (item.garcom || '?').toUpperCase().trim();
          const cancelStr = item.itemCancelado ? ' [CANC]' : '';
          
          lines.push('   │  ' + (nome + cancelStr).padEnd(35) + String(item.qtd).padStart(5) + '   ' + garcom.padEnd(15) + ('R$ ' + fmtVal(item.valor)).padStart(14) + ('R$ ' + fmtVal(vt)).padStart(14) + (item.itemCancelado ? '—'.padStart(14) : ('R$ ' + fmtVal(ci)).padStart(14)));
          
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
        
        // Subtotal por garçom na venda
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
    
    // Resumo do dia por garçom
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
  
  // Resumo global
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
  
  // Total geral
  const totalVendido = Object.values(globalGarcom).reduce((a, v) => a + v.venda, 0);
  const totalComissao = Object.values(globalGarcom).reduce((a, v) => a + v.comissao, 0);
  lines.push('');
  lines.push('💰 TOTAL GERAL: Vendido R$ ' + fmtVal(totalVendido) + ' | Comissões R$ ' + fmtVal(totalComissao));
  lines.push('');
  lines.push('─────────────────────────────────────────────────────────────────────────');
  lines.push('Gerado por Saipos Tools | ' + ts);
  
  navigator.clipboard.writeText(lines.join('\\n')).then(() => {
    const btn = document.getElementById('btnCopiarTudo');
    const orig = btn.textContent;
    btn.textContent = '✅ Copiado!';
    btn.style.background = '#15803d';
    setTimeout(() => { btn.textContent = orig; btn.style.background = ''; }, 2500);
  });
}

// ── EXPORTAÇÃO CSV ──────────────────────────────────────────────

function downloadCSV(filename, content) {
  const BOM = '\uFEFF'; // UTF-8 BOM para Excel reconhecer acentos
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

function exportarCSV(tipo, btn) {
  const ts = new Date().toISOString().slice(0,10);
  let csv = '';
  let filename = '';

  if (tipo === 'itens') {
    // CSV com todos os itens detalhados
    filename = 'saipos_itens_' + ts + '.csv';
    csv = 'Data;Mesa;Comanda;Hora;Item;Qtde;Garçom;Valor Unit;Total Item;Taxa Venda;Comissão Item;% Taxa;Cancelado\n';
    
    for (const sale of SALES_DATA) {
      if (sale.canceled || !sale.items) continue;
      const dia = (sale.dateText || '').substring(0, 10);
      const hora = (sale.dateText || '').substring(11, 19);
      const pct = sale.totalItens > 0 ? (sale.taxa / sale.totalItens * 100) : 0;
      
      for (const item of sale.items) {
        const vt = item.valor * item.qtd;
        const comissao = sale.totalItens > 0 ? (vt / sale.totalItens) * sale.taxa : 0;
        csv += [
          escapeCSV(dia),
          escapeCSV(sale.mesa),
          escapeCSV(sale.comanda),
          escapeCSV(hora),
          escapeCSV(item.nome),
          item.qtd,
          escapeCSV(item.garcom),
          fmtNum(item.valor),
          fmtNum(vt),
          fmtNum(sale.taxa),
          item.itemCancelado ? '0,00' : fmtNum(comissao),
          fmtNum(pct) + '%',
          item.itemCancelado ? 'SIM' : ''
        ].join(';') + '\n';
      }
    }
  }
  
  else if (tipo === 'garcons') {
    // CSV resumo por garçom
    filename = 'saipos_garcons_' + ts + '.csv';
    const garcom = {};
    
    for (const sale of SALES_DATA) {
      if (sale.canceled || !sale.items) continue;
      for (const item of sale.items) {
        if (item.itemCancelado) continue;
        const g = (item.garcom || '?').toUpperCase().trim();
        const vt = item.valor * item.qtd;
        const ci = sale.totalItens > 0 ? (vt / sale.totalItens) * sale.taxa : 0;
        if (!garcom[g]) garcom[g] = { venda: 0, comissao: 0, qtd: 0 };
        garcom[g].venda += vt;
        garcom[g].comissao += ci;
        garcom[g].qtd++;
      }
    }
    
    csv = 'Garçom;Total Vendido;Total Comissão;Qtd Itens\n';
    for (const [g, v] of Object.entries(garcom).sort((a,b) => b[1].comissao - a[1].comissao)) {
      csv += [
        escapeCSV(g),
        fmtNum(v.venda),
        fmtNum(v.comissao),
        v.qtd
      ].join(';') + '\n';
    }
  }
  
  else if (tipo === 'vendas') {
    // CSV resumo por venda
    filename = 'saipos_vendas_' + ts + '.csv';
    csv = 'Data;Hora;Mesa;Comanda;Pagamento;Total Itens;Taxa Serviço;% Taxa;Status\n';
    
    for (const sale of SALES_DATA) {
      const dia = (sale.dateText || '').substring(0, 10);
      const hora = (sale.dateText || '').substring(11, 19);
      const pct = sale.totalItens > 0 ? (sale.taxa / sale.totalItens * 100) : 0;
      let status = '';
      if (sale.canceled) status = 'CANCELADA';
      else if (sale.taxa === 0 && sale.totalItens > 0) status = 'SEM TAXA';
      else if (pct < 9.95 && pct > 0) status = 'TAXA BAIXA';
      
      csv += [
        escapeCSV(dia),
        escapeCSV(hora),
        escapeCSV(sale.mesa),
        escapeCSV(sale.comanda),
        escapeCSV(sale.pagamento),
        fmtNum(sale.totalItens),
        fmtNum(sale.taxa),
        fmtNum(pct) + '%',
        status
      ].join(';') + '\n';
    }
  }
  
  downloadCSV(filename, csv);
  
  // Feedback visual
  if (btn) {
    const orig = btn.textContent;
    btn.textContent = '✅ Baixado!';
    btn.style.background = '#15803d';
    btn.style.color = '#fff';
    setTimeout(() => { btn.textContent = orig; btn.style.background = ''; btn.style.color = ''; }, 2500);
  }
}
<\/script>
</div></body></html>`;

  return H;
}

// Exporta globalmente (usado pelo popup via URL)
window.gerarRelatorio = gerarRelatorio;
