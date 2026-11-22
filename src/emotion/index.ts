import type { CompanionSettings } from '../core/companion-settings.js';
import type { StreamChunk } from '@deepseek-ai/dsh-llm';
import { ROOM_MOOD_DIMENSIONS, type EmotionRoomMood } from '../contracts/emotion.js';

/** The same strict threshold applies on a timer, after dragging and after an animation ends. */
export function workAnimationEligible(startedAt: number | null, now: number, delaySeconds: number): boolean {
  return startedAt !== null && Number.isFinite(startedAt) && now - startedAt > delaySeconds * 1000;
}

export interface ExpressionAsset { name: string; description: string; label?: string }
export interface ExpressionCatalog { actions: ExpressionAsset[]; stickers: ExpressionAsset[] }
/** Shared semantic vocabulary; optional Room scores remain a separate legacy representation. */
export { COMPANION_FEELINGS } from '../contracts/emotion.js';
export type RoomMood = EmotionRoomMood;
export function readRoomMood(value: unknown): RoomMood | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return;
  const raw = value as Record<string, unknown>;
  const score = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n) && n >= 0 && n <= 100;
  if (!score(raw.mood)) return;
  const dims: RoomMood['dims'] = {};
  if (raw.dims !== undefined) {
    if (!raw.dims || typeof raw.dims !== 'object' || Array.isArray(raw.dims)) return;
    for (const key of ROOM_MOOD_DIMENSIONS) {
      const dimension = (raw.dims as Record<string, unknown>)[key];
      if (dimension === undefined) continue;
      if (!score(dimension)) return;
      dims[key] = dimension;
    }
  }
  return {mood: raw.mood, dims};
}
export interface ReplyIntent {
  action?: string;
  sticker?: string;
  mood?: string;
  /** Semantic feelings, such as anger or boredom; not a numeric happiness conversion. */
  feelings?: string[];
  roomMood?: RoomMood;
  reason?: string;
  feedback?: { playbackId: string; quote: string };
}
export interface ExpressionEvent {
  workspaceId: string; sessionId: string; turn: number; action?: string; sticker?: string; mood?: string;
  feelings?: string[];
  /** Human-readable expression intent for displays without the corresponding asset. */
  actionLabel?: string;
}
export interface PlaybackReceipt {
  workspaceId: string; id: string; name: string;
  status: 'playing' | 'ended' | 'cancelled' | 'failed';
  kind: 'expression' | 'random' | 'idle' | 'work';
}

export function decideExpression(intent: ReplyIntent, catalog: ExpressionCatalog,
  settings: Pick<CompanionSettings, 'stickerProbabilityPercent'>, random = Math.random): Pick<ExpressionEvent, 'action' | 'sticker' | 'mood' | 'feelings'> {
  const decision: Pick<ExpressionEvent, 'action' | 'sticker' | 'mood' | 'feelings'> = {};
  if (catalog.actions.some(item => item.name === intent.action)) decision.action = intent.action;
  if (intent.mood) decision.mood = intent.mood;
  if (intent.feelings) decision.feelings = [...intent.feelings];
  if (catalog.stickers.some(item => item.name === intent.sticker)) {
    const p = settings.stickerProbabilityPercent;
    if (p === 100 || (p > 0 && random() * 100 < p)) decision.sticker = intent.sticker;
  }
  return decision;
}

// A final line, following visible reply text, carries optional expression. The single
// footer makes the two selections share a turn and keeps metadata out of native history.
const FOOTER = '\n<pet-expression>';
const MAX_FOOTER = 1600;

function parseFooter(raw: string): ReplyIntent | undefined {
  if (raw.length > MAX_FOOTER) return;
  const json = raw.trim().replace(/<\/pet-expression>$/, '').trim();
  try {
    const parsed = JSON.parse(json);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return;
    const small = (s: unknown, max: number) => typeof s === 'string' && s.trim().length > 0 && s.length <= max ? s.trim() : undefined;
    const intent: ReplyIntent = {};
    for (const key of ['action', 'sticker', 'mood', 'reason'] as const) {
      const value = small(parsed[key], key === 'mood' ? 48 : 160);
      if (value) intent[key] = value;
    }
    const roomMood = readRoomMood(parsed.roomMood);
    if (intent.mood && roomMood) intent.roomMood = roomMood;
    if (Array.isArray(parsed.feelings) && parsed.feelings.length <= 16 && parsed.feelings.every((item: unknown) => typeof item === 'string' && item.trim() && item.length <= 48)) intent.feelings = [...new Set<string>(parsed.feelings)];
    const playbackId = small(parsed.feedback?.playbackId, 160), quote = small(parsed.feedback?.quote, 240);
    if (playbackId && quote) intent.feedback = { playbackId, quote };
    return intent;
  } catch { return; }
}

interface TextPart { pending: string; inFooter: boolean; overflow: boolean; raw: string; hasVisible: boolean }

export async function* expressionStream(stream: AsyncIterable<StreamChunk>, collect: (intent: ReplyIntent) => void): AsyncGenerator<StreamChunk> {
  const parts = new Map<number, TextPart>();
  let decision: ReplyIntent | undefined;
  let tool = false;
  for await (const chunk of stream) {
    if (chunk.type === 'tool-call-delta' || (chunk.type === 'block-start' && chunk.blockType === 'tool-call')) tool = true;
    if (chunk.type === 'text-delta') {
      let part = parts.get(chunk.index);
      if (!part) { part = { pending: '', inFooter: false, overflow: false, raw: '', hasVisible: false }; parts.set(chunk.index, part); }
      let text = part.pending + chunk.text;
      part.pending = '';
      if (!part.inFooter) {
        const pos = text.indexOf(FOOTER);
        if (pos < 0) {
          let keep = Math.min(FOOTER.length - 1, text.length);
          while (keep > 0 && !text.endsWith(FOOTER.slice(0, keep))) keep--;
          part.pending = text.slice(text.length - keep);
          text = text.slice(0, text.length - keep);
          if (text) { part.hasVisible ||= Boolean(text.trim()); yield { ...chunk, text }; }
          continue;
        }
        const before = text.slice(0, pos);
        if (before) { part.hasVisible ||= Boolean(before.trim()); yield { ...chunk, text: before }; }
        part.inFooter = true;
        text = text.slice(pos + FOOTER.length);
      }
      if (part.raw.length + text.length > MAX_FOOTER) part.overflow = true;
      if (!part.overflow) part.raw += text;
      continue;
    }
    if (chunk.type === 'block-end' && chunk.block.type === 'text') {
      const part = parts.get(chunk.index);
      const pos = chunk.block.text.indexOf(FOOTER);
      const visible = pos < 0 ? chunk.block.text : chunk.block.text.slice(0, pos);
      if (!part?.inFooter && part?.pending) yield { type: 'text-delta', index: chunk.index, text: part.pending };
      if (pos >= 0 && visible.trim()) decision = parseFooter(chunk.block.text.slice(pos + FOOTER.length));
      else if (part?.inFooter && part.hasVisible && !part.overflow) decision = parseFooter(part.raw);
      parts.delete(chunk.index);
      yield pos < 0 ? chunk : { ...chunk, block: { ...chunk.block, text: visible } };
      continue;
    }
    if (chunk.type === 'finish') {
      for (const [index, part] of parts) {
        if (part.pending) yield { type: 'text-delta', index, text: part.pending };
        if (part.inFooter && part.hasVisible && !part.overflow) decision = parseFooter(part.raw);
      }
      if (decision && !tool && chunk.reason.kind === 'stop') collect(decision);
    }
    yield chunk;
  }
}
