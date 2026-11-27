// Tests for the AI workspace logic: the provider module (js/ai-provider.js) and the shared chat state
// (js/views/chat.js) — one request at a time for both surfaces, account isolation, error codes, quota, offline.
// All AI answers are mocked; nothing is sent anywhere.   run with:  node --test tests/ai-chat.test.js
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

globalThis.window = globalThis;
const store = new Map();
Object.defineProperty(globalThis, 'localStorage', { value: { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) }, configurable: true, writable: true });
const nav = { languages: ['he-IL'], language: 'he-IL', onLine: true };
Object.defineProperty(globalThis, 'navigator', { value: nav, configurable: true, writable: true });
globalThis.document = { addEventListener() {}, querySelectorAll: () => [], querySelector: () => null, getElementById: () => null, documentElement: { setAttribute() {} }, activeElement: null, body: {} };
globalThis.addEventListener = () => {};
require('../js/utils.js');
require('../js/i18n.js');
require('../js/model.js');
require('../js/stats.js');
require('../js/gpa.js');
require('../js/agent-tools.js');
require('../js/ai-provider.js');
require('../js/ui.js');
const CT = globalThis.CT;
CT.store = { state: { courses: [], semesters: [], settings: { activeSemesterId: null }, studyLog: [] } };
CT.cloud = { enabled: true, signedIn: () => true };
// the AI page module's role here: settings + the Edge Function call (mocked per test)
let calls = [];
let reply = null; // (body) => Promise
CT.views = { ai: { settings: () => ({ chatModel: 'model-x', extractModel: 'model-x' }), call: (body) => { calls.push(JSON.parse(JSON.stringify(body))); return reply(body); }, noteSpend() {}, ensureUsage: async () => ({ state: 'ok', configured: true }) } };
require('../js/views/chat.js');
const chat = CT.views.chat;
const P = CT.aiProvider;
const I = CT.i18n;
const tick = () => new Promise((r) => setImmediate(r));
const deferred = () => { let res, rej; const p = new Promise((a, b) => { res = a; rej = b; }); return { p, res, rej }; };
const answer = (text, extra = {}) => Object.assign({ content: [{ type: 'text', text }], stopReason: 'end_turn', costUsd: 0.001, model: 'model-x' }, extra);
const reset = () => { chat.forget(); calls = []; nav.onLine = true; store.clear(); };

/* ---------- provider module ---------- */
test('provider: the server list of models wins, unknown ids are still offered and shown as-is', () => {
  assert.deepEqual(P.modelIds(['a', 'b', 3]), ['a', 'b']);
  assert.deepEqual(P.modelIds(null), P.models.map((m) => m.id));
  assert.equal(P.label('some-new-model'), 'some-new-model');
  assert.equal(P.short(P.models[0].id), P.models[0].short);
  assert.ok(P.model(P.defaults.chatModel) && P.model(P.defaults.extractModel));
});

test('provider: the wire format round-trips (typed question, tool calls, tool results, stop reasons)', () => {
  const W = P.wire;
  const q = W.userText('hi');
  assert.ok(W.isTyped(q));
  assert.equal(W.text(q), 'hi');
  const content = [{ type: 'text', text: 'x' }, { type: 'tool_use', id: 't1', name: 'list_items', input: { from: '2026-01-01' } }];
  assert.deepEqual(W.toolCalls(content), [{ id: 't1', name: 'list_items', input: { from: '2026-01-01' } }]);
  assert.deepEqual(W.withoutToolCalls(content), [{ type: 'text', text: 'x' }]);
  const r = W.toolResults([{ id: 't1', content: '{}', isError: true }]);
  assert.equal(r.role, 'user');
  assert.ok(!W.isTyped(r));
  assert.deepEqual(r.content[0], { type: 'tool_result', tool_use_id: 't1', content: '{}', is_error: true });
  assert.equal(W.stop({ stopReason: 'tool_use' }), 'tools');
  assert.equal(W.stop({ stopReason: 'refusal' }), 'refused');
  assert.equal(W.stop({ stopReason: 'max_tokens' }), 'cut');
  assert.equal(W.stop({ stopReason: 'end_turn' }), 'done');
});

test('UI modules never name a provider, a model id or a price (all of it lives in ai-provider.js)', () => {
  for (const f of ['js/views/chat.js', 'js/views/ai.js']) {
    const src = fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
    assert.ok(!/anthropic|claude|haiku|sonnet|opus|\btool_use\b|tool_result|\$\d+\.\d/i.test(src), `${f} has provider-specific text`);
  }
  // the privacy texts take the provider name as a parameter, in both languages
  for (const l of ['he', 'en']) for (const k of ['ai.privacy', 'chat.privacy']) assert.match(I._dicts[l][k], /\{provider\}/);
});

/* ---------- shared chat state ---------- */
test('one request at a time for both surfaces: a second ask while one is running sends nothing', async () => {
  reset();
  const d = deferred();
  reply = () => d.p;
  const first = chat.ask('מה יש לי השבוע?');
  const second = await chat.ask('ועוד שאלה');
  assert.equal(second, false);
  assert.equal(chat.state().busy, true);
  assert.equal(calls.length, 1);
  d.res(answer('תשובה'));
  assert.equal(await first, true);
  assert.equal(chat.state().busy, false);
  assert.equal(chat.state().count, 2);
  assert.equal(calls.length, 1);
});

test('tool rounds run here on local data; only results go back; the history keeps no unanswered tool calls', async () => {
  reset();
  let n = 0;
  reply = async () => (++n === 1
    ? { content: [{ type: 'tool_use', id: 'u1', name: 'list_courses', input: {} }], stopReason: 'tool_use', costUsd: 0.001, model: 'model-x' }
    : answer('אין קורסים'));
  assert.equal(await chat.ask('אילו קורסים?'), true);
  assert.equal(calls.length, 2);
  const sent = calls[1].messages;
  assert.equal(sent[sent.length - 1].content[0].type, 'tool_result');
  assert.equal(sent[sent.length - 1].content[0].tool_use_id, 'u1');
  assert.equal(chat.state().count, 4); // question, tool call, tool result, answer
  const saved = JSON.parse(store.get('ct.ai.chat')).msgs;
  assert.ok(saved.every((m) => !Object.keys(m).some((k) => k === 'tool_use')));
});

test('account isolation: wiping the conversation while an answer is on its way drops that answer', async () => {
  reset();
  const d = deferred();
  reply = () => d.p;
  const p = chat.ask('שאלה פרטית');
  assert.equal(chat.state().count, 1);
  chat.forget(); // sign-out / another account
  d.res(answer('תשובה עם נתונים של החשבון הקודם'));
  assert.equal(await p, false);
  await tick();
  assert.equal(chat.state().count, 0);
  assert.equal(chat.state().busy, false);
  assert.ok(!store.has('ct.ai.chat'));
});

test('errors: known code → its own text; unknown code → generic; the question returns to the field; nothing half-done is kept', async () => {
  reset();
  reply = async () => { throw Object.assign(new Error('RAW upstream detail 500 at x.ts:12'), { code: 'ai-busy' }); };
  assert.equal(await chat.ask('שאלה'), false);
  assert.equal(chat.state().error, 'ai-busy');
  assert.equal(chat.state().draft, 'שאלה');
  assert.equal(chat.state().count, 0);
  I.setLang('en');
  assert.match(chat.errorText('ai-busy'), /busy/);
  assert.equal(chat.errorText('weird-internal'), chat.errorText('server'));
  assert.ok(!chat.errorText('weird-internal').includes('RAW'));
  assert.match(chat.errorText('message-too-long'), /2000/);
  I.setLang('he');
});

test('quota: after "daily-cost" no more requests are sent today', async () => {
  reset();
  reply = async () => { throw Object.assign(new Error('x'), { code: 'daily-cost' }); };
  await chat.ask('q1');
  calls = [];
  assert.equal(await chat.ask('q2'), false);
  assert.equal(calls.length, 0);
  assert.equal(chat.state().error, 'daily-cost');
});

test('limits before sending: too long or offline → nothing is sent', async () => {
  reset();
  // a new day: the quota block from the previous test is per day, so wipe it the same way the app does (new state)
  reply = async () => answer('ok');
  assert.equal(await chat.ask('x'.repeat(2001)), false);
  assert.equal(chat.state().error, 'message-too-long');
  nav.onLine = false;
  assert.equal(await chat.ask('שאלה'), false);
  assert.equal(chat.state().error, 'offline');
  assert.equal(calls.length, 0);
});
