import type {Context} from '@deepseek-ai/cordis';
import type {Agent} from '@deepseek-ai/dsh-agent';
import type {GenerateOptions, TokenUsage} from '@deepseek-ai/dsh-llm';
import type {PetCoreHost} from '../index.js';
import {sameHomeBinding} from '../home-binding.js';
import {appendUsage, usageDay, type UsageRow} from './ledger.js';
import {recordGap} from './gaps.js';

export function installUsageListener(ctx: Context, host: PetCoreHost, agentFor: (id: string) => Agent | undefined) {
  const warned = new Set<string>();
  const warn = (message: string) => ctx.logger('chatpet-usage').warn(message);
  function capture(options: GenerateOptions) {
    const {sessionId, purpose, provider, model, reasoningEffort} = options;
    const local = sessionId === 'dsh-pet' && purpose?.startsWith('chatpet-');
    if (!local && (!sessionId || !host.native.nativeScopeFor(sessionId))) return;
    const scope = host.workspace.homeScope();
    const agent = !local && sessionId ? agentFor(sessionId) : undefined;
    const presets = (ctx as unknown as {get(name: 'agentPresets'): {composedPreset(ctx: Context): string | undefined} | undefined}).get('agentPresets');
    const preset = local ? '无会话' : agent && presets?.composedPreset(agent.ctx) || '未声明';
    const entry = local ? (purpose === 'chatpet-whisper' || purpose === 'chatpet-dream' ? purpose : 'unknown')
      : host.native.usageEvidence.step(sessionId!) ?? (purpose ? 'maintenance' : 'unknown');
    return {scope, fields: {started_at: Date.now(), session_id: local ? null : sessionId!, entry, preset,
      purpose: purpose ?? null, provider, model, requested_effort: reasoningEffort ?? null}};
  }
  return ctx.on('llm/stream', async function* (options, next) {
    let call: ReturnType<typeof capture>;
    try { call = capture(options); }
    catch { warn('读取用量归属失败'); }
    if (!call) { yield* next(); return; }
    let outcome = 'cancelled', usage: TokenUsage | undefined;
    try {
      for await (const chunk of next()) {
        if (chunk.type === 'usage') usage = {...chunk.usage};
        if (chunk.type === 'finish') outcome = chunk.reason.kind;
        yield chunk;
      }
    } catch (error) { outcome = 'error'; throw error; }
    finally {
      const {scope, fields} = call, ended_at = Date.now(), day = usageDay(ended_at);
      let gap: 'unbound' | 'rebound' | 'writeFailed' | undefined;
      try {
        if (!scope) gap = 'unbound';
        else if (!sameHomeBinding(host.workspace.homeScope(), scope)) gap = 'rebound';
        else {
          const row: UsageRow = {...fields, ended_at, day, outcome,
            input_miss: usage?.inputTokens ?? null, output: usage?.outputTokens ?? null,
            cache_read: usage?.cacheReadTokens ?? null, cache_write: usage?.cacheWriteTokens ?? null,
            reasoning: usage?.reasoningTokens ?? null};
          appendUsage(scope.path, row);
          if (row.entry === 'unknown') {
            const key = JSON.stringify([row.preset, row.purpose]);
            if (!warned.has(key)) { warned.add(key); warn('用量未归类 ' + key); }
          }
        }
      } catch { gap = 'writeFailed'; }
      if (gap) {
        try { recordGap(host.workspace.runtime.store, day, gap); }
        catch { warn('用量漏记计数写入失败'); }
        warn('用量漏记 ' + gap);
      }
    }
  }, {global: true});
}
