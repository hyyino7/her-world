import type {Context} from '@deepseek-ai/cordis';
import {lstatSync, mkdirSync} from 'node:fs';
import {join} from 'node:path';
import {createRequire} from 'node:module';
import {isDeepStrictEqual} from 'node:util';
import {CONTRACT_VERSION} from '../contracts/version.js';
import {isVoiceRoute, type VoiceProvider, type VoiceRequest, type VoiceResponse} from '../contracts/voice.js';
import {digest} from '../core/storage.js';
import type {PetCoreHost} from '../core/index.js';
import type {HomeBinding} from '../core/workspace.js';

const requireUpstream = createRequire(import.meta.url);
export type {VoiceRequest} from '../contracts/voice.js';

export class CompanionVoice implements VoiceProvider {
  private lifetime = new AbortController();
  private stopped = false;
  private scope?: {binding:HomeBinding; tools:Promise<{voice:unknown; speech:unknown}>};
  constructor(private host: PetCoreHost, private directory: string, private recognizer: () => unknown) {}
  canTranscribe() {
    // Use the same original Pet registry as hear(): external providers take
    // precedence even when no host speech-to-text service has been enabled.
    const registry = requireUpstream('./upstream/host/voice/speech-registry.js') as {activeSpeechProvider():unknown};
    if (registry.activeSpeechProvider()) return true;
    const service = this.recognizer() as {transcribe?:unknown;resolve?:unknown;listProviders?:()=>readonly unknown[]}|undefined;
    return typeof service?.transcribe === 'function' && typeof service.resolve === 'function'
      && typeof service.listProviders === 'function' && service.listProviders().length > 0;
  }
  availability() {
    const speak = !this.stopped && this.host.workspace.status().state === 'ready';
    return {speak, hear:speak && this.canTranscribe()};
  }
  refresh() {
    if (this.scope && !isDeepStrictEqual(this.scope.binding, this.host.workspace.homeScope())) this.release();
  }
  release() { this.lifetime.abort(); this.lifetime = new AbortController(); this.scope = undefined; }
  stop() { this.stopped = true; this.release(); }
  async handle(input: VoiceRequest): Promise<VoiceResponse> {
    if (this.stopped) throw new DOMException('语音组件已撤销', 'AbortError');
    this.refresh();
    const bound = this.host.workspace.homeScope();
    if (!bound?.storageId || !this.directory) throw Error('语音需要已绑定的工作区');
    if (!isVoiceRoute(input.rest)) throw Error('语音操作无效');
    if (input.body && Buffer.byteLength(input.body) > 1_048_576) throw Error('音频过长');
    if (!this.scope) {
      const root = join(this.directory, digest(bound.storageId));
      for (const path of [this.directory,root,join(root,'voice-cache')]) {
        mkdirSync(path, {recursive:true, mode:0o700});
        if (!lstatSync(path).isDirectory()) throw Error('语音缓存目录无效');
      }
      // These upstream modules are generated directly into dist by the build.
      const tools = Promise.all([
        import('./upstream/host/voice/speak.js' as string),
        import('./upstream/host/voice/hear.js' as string),
      ])
        .then(([out, mic]) => ({voice:out.createVoiceService({userRoot:root}), speech:mic.createHearService({speechToText:this.recognizer})}));
      this.scope = {binding:bound, tools};
    }
    const signal = input.signal ? AbortSignal.any([this.lifetime.signal,input.signal]) : this.lifetime.signal;
    const tools = await this.scope.tools;
    const {handleVoiceRoutes} = await import('./upstream/host/routes/voice.js' as string);
    this.refresh();
    signal.throwIfAborted();
    const result = await handleVoiceRoutes(tools, {...input,signal});
    this.refresh();
    signal.throwIfAborted();
    return result;
  }
}
export const name = '70-Voice';
export const inject = ['petCore','profileContext'];
export function apply(ctx: Context, config: {deviceDirectory?:string} = {}) {
  const services = ctx as unknown as {profileContext:{dir:string}; get(key:string):unknown};
  const host = ctx.petCore;
  const voice = new CompanionVoice(host, config.deviceDirectory ?? join(services.profileContext.dir,'chatpet-voice'),
    () => services.get('speechToText'));
  ctx.provide('petVoice',voice);
  ctx.on('pet/core.changed',() => voice.refresh());
  ctx.effect(() => {
    const registration = host.native.voiceTable.register(ctx, voice);
    return () => {
      const revoked = registration.revoke();
      voice.stop();
      return revoked;
    };
  });
  ctx.effect(() => host.workspace.runtime.capabilityTable.register({
    id: 'voice.speech', owner: 'voice', contractVersion: CONTRACT_VERSION, order: 8,
    status: () => {
      const {speak, hear} = voice.availability();
      return {state: !speak ? 'unavailable' : hear ? 'ready' : 'degraded',
        reason: !speak ? 'Bind a workspace to use speech' : hear ? null : 'Speech recognition provider is unavailable',
        supportedOperations: !speak ? [] : hear ? ['speak', 'hear'] : ['speak']};
    },
  }).revoke);
}
declare module '@deepseek-ai/cordis' {interface Context {petVoice: CompanionVoice}}
