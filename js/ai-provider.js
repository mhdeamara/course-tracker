/* ai-provider.js — everything the browser knows about the AI provider behind the Edge Function "ai", in one place.
 *
 * The chat (views/chat.js) and the AI page (views/ai.js) never name a provider, a model id, a price or a message
 * format directly: they ask this module. Replacing the provider later means changing this file and the Edge
 * Function (supabase/functions/ai), not the chat state or rendering.
 *   - `name`, `keySecret`: shown in the privacy notice and in setup errors.
 *   - `models`: labels and list prices for the model ids the Edge Function accepts. The server's own list (from the
 *     "usage" answer) wins when it is known; an id missing here is shown as-is.
 *   - `wire`: the message format of the existing backend contract (text / tool call / tool result blocks, stop
 *     reasons). Conversation history is stored in this format because the server expects it back unchanged.
 * Pure module (no DOM): tested in Node. */
(function (root) {
  'use strict';
  const P = {
    id: 'anthropic',
    name: 'Anthropic',
    keySecret: 'ANTHROPIC_API_KEY',
    /** tier → a translated word in the UI (ai.tier.*); price: US$ per million input / output tokens (list price). */
    models: [
      { id: 'claude-haiku-5-5', label: 'Claude Haiku 5.5', short: 'Haiku', tier: 'economy', price: { input: 0.10, output: 0.50 } },
      { id: 'claude-sonnet-5-5', label: 'Claude Sonnet 5.5', short: 'Sonnet', tier: 'balanced', price: { input: 2, output: 10 } },
      { id: 'claude-opus-5-5', label: 'Claude Opus 5.5', short: 'Opus', tier: 'strongest', price: { input: 4, output: 20 } },
    ],
    defaults: { extractModel: 'claude-sonnet-5-5', chatModel: 'claude-haiku-5-5' },
  };
  P.model = (id) => P.models.find((m) => m.id === id) || null;
  /** Model ids to offer: the server's list when known (unknown ids still selectable), else the local list. */
  P.modelIds = (serverIds) => (Array.isArray(serverIds) && serverIds.length ? serverIds.filter((x) => typeof x === 'string') : P.models.map((m) => m.id));
  P.label = (id) => (P.model(id) ? P.model(id).label : String(id || ''));
  P.short = (id) => (P.model(id) ? P.model(id).short : String(id || ''));

  /* ---------- the message format of the backend contract ---------- */
  const textBlocks = (m) => (m && Array.isArray(m.content) ? m.content.filter((b) => b && b.type === 'text') : []);
  P.wire = {
    /** A question typed by you. */
    userText: (text) => ({ role: 'user', content: [{ type: 'text', text }] }),
    /** True for a message you typed (not tool results sent back automatically). */
    isTyped: (m) => !!m && m.role === 'user' && textBlocks(m).length > 0,
    /** The plain text of a message. */
    text: (m) => textBlocks(m).map((b) => b.text).join('\n'),
    /** Tool calls the model asked for in an answer: [{ id, name, input }]. */
    toolCalls: (content) => (Array.isArray(content) ? content : []).filter((b) => b && b.type === 'tool_use').map((b) => ({ id: b.id, name: b.name, input: b.input || {} })),
    /** An answer without its tool calls (a final answer keeps no unanswered calls in the history). */
    withoutToolCalls: (content) => (Array.isArray(content) ? content : []).filter((b) => b && b.type !== 'tool_use'),
    /** The message that carries tool results back: results = [{ id, content, isError }]. */
    toolResults: (results) => ({ role: 'user', content: results.map((r) => Object.assign({ type: 'tool_result', tool_use_id: r.id, content: r.content }, r.isError ? { is_error: true } : {})) }),
    /** Why an answer stopped, in the app's own words: tools · refused · cut · done. */
    stop: (r) => ({ tool_use: 'tools', refusal: 'refused', max_tokens: 'cut' }[r && r.stopReason] || 'done'),
    /** A text block, e.g. to give an empty answer a placeholder. */
    textBlock: (text) => ({ type: 'text', text }),
  };

  root.CT = root.CT || {};
  root.CT.aiProvider = P;
})(typeof window !== 'undefined' ? window : globalThis);
