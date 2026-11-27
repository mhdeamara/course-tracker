// Test-harness helper: headless Chrome here often lets a fresh service worker go "redundant" during install unless a
// debugger is attached to it. Attach to every service-worker target of the browser (no effect on app code).
export async function attachSW(port) {
  const v = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json();
  const ws = new WebSocket(v.webSocketDebuggerUrl);
  await new Promise((r) => { ws.onopen = r; });
  let id = 0;
  const send = (method, params = {}, sessionId) => ws.send(JSON.stringify({ id: ++id, method, params, sessionId }));
  ws.onmessage = (m) => {
    const d = JSON.parse(m.data);
    if (d.method === 'Target.attachedToTarget') { const sid = d.params.sessionId; if (process.env.SWLOG) { send('Runtime.enable', {}, sid); send('Network.enable', {}, sid); } send('Runtime.runIfWaitingForDebugger', {}, sid); }
    if (process.env.SWLOG && d.sessionId && /exceptionThrown|consoleAPICalled|loadingFailed/.test(d.method || '')) console.log('SWLOG', d.method, JSON.stringify(d.params).slice(0, 500));
  };
  send('Target.setAutoAttach', { autoAttach: true, waitForDebuggerOnStart: true, flatten: true, filter: [{ type: 'service_worker', exclude: false }, { type: 'page', exclude: true }, { type: 'worker', exclude: true }] });
  return ws;
}
