// background.js
const state = { logs: [], sales: [], progress: {}, status: 'idle', total: 0, paused: false };

if (chrome.sidePanel) {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
  // Define o painel como desativado por padrão (global) para aparecer apenas no Saipos
  chrome.sidePanel.setOptions({ enabled: false }).catch(() => {});
}

chrome.tabs.onUpdated.addListener((tabId, info, tab) => {
  if (!tab.url) return;
  if (chrome.sidePanel) {
    const isSaipos = tab.url.includes("saipos.com");
    chrome.sidePanel.setOptions({
      tabId,
      enabled: isSaipos,
      path: isSaipos ? 'popup.html' : undefined
    }).catch(() => {});
  }
});

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'LOG')      { state.logs.push(msg.entry); if (state.logs.length > 500) state.logs.shift(); }
  if (msg.type === 'PROGRESS') { state.progress = msg; state.status = 'running'; }
  if (msg.type === 'TOTAL')    { state.total = msg.total; }
  if (msg.type === 'DONE')     { state.sales = msg.sales; state.status = 'done'; }
  if (msg.type === 'STATUS')   { state.status = msg.status; }
  if (msg.type === 'PAUSED')   { state.paused = msg.paused; state.progress.paused = msg.paused; }
  if (msg.type === 'RESET')    { state.logs = []; state.sales = []; state.progress = {}; state.status = 'running'; state.total = 0; state.paused = false; }
  if (msg.type === 'GET_STATE') { sendResponse(state); return true; }

  // Handler: download de arquivo .saiposprt para o SAIPOS Printer
  if (msg.type === 'DOWNLOAD_SAIPOSPRT') {
    // msg.data = base64 string que deve ser salva como texto puro no arquivo .saiposprt
    // O SAIPOS Printer espera ler o conteúdo base64 do arquivo
    const dataUrl = 'data:application/octet-stream;base64,' + btoa(msg.data);
    chrome.downloads.download({
      url: dataUrl,
      filename: msg.fileName,
      saveAs: false
    }, () => {});
    sendResponse({ ok: true });
    return true;
  }

  chrome.runtime.sendMessage(msg).catch(() => {});
  sendResponse({ ok: true });
  return true;
});
