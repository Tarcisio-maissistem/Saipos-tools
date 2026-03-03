// background.js
const state = { logs: [], sales: [], progress: {}, status: 'idle', total: 0, paused: false };

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'LOG')      { state.logs.push(msg.entry); if (state.logs.length > 500) state.logs.shift(); }
  if (msg.type === 'PROGRESS') { state.progress = msg; state.status = 'running'; }
  if (msg.type === 'TOTAL')    { state.total = msg.total; }
  if (msg.type === 'DONE')     { state.sales = msg.sales; state.status = 'done'; }
  if (msg.type === 'STATUS')   { state.status = msg.status; }
  if (msg.type === 'PAUSED')   { state.paused = msg.paused; state.progress.paused = msg.paused; }
  if (msg.type === 'RESET')    { state.logs = []; state.sales = []; state.progress = {}; state.status = 'running'; state.total = 0; state.paused = false; }
  if (msg.type === 'GET_STATE') { sendResponse(state); return true; }
  chrome.runtime.sendMessage(msg).catch(() => {});
  sendResponse({ ok: true });
  return true;
});
