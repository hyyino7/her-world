// Build-time adaptations of pinned Pet voice lifetimes. Retain its recorder,
// codec, synthesis queue/cache and provider behavior; bind work to one caller.
export function adaptCompactVoice(path,source) {
  const replace=(before,after)=>{
    if(source.split(before).length!==2)throw Error('Pinned voice lifecycle source changed: '+path+' '+before.slice(0,65));
    source=source.replace(before,()=>after);
  };
  if(path==='src/shared/hear.ts') {
    replace('signal?: AbortSignal): Promise<HearOutcome>', 'signal?: AbortSignal, fetchVoice: typeof fetch = fetch): Promise<HearOutcome>');
    replace('const res = await fetch(url, {', 'const res = await fetchVoice(url, {');
    replace('export async function startRecording(): Promise<HearRecorder> {','export async function startRecording(signal?: AbortSignal): Promise<HearRecorder> {\n  signal?.throwIfAborted();');
    replace('  const ctx = new AudioContext({ sampleRate: HEAR_SAMPLE_RATE });\n  const source = ctx.createMediaStreamSource(stream);\n  const processor = ctx.createScriptProcessor(BLOCK_SAMPLES, 1, 1);',
      '  let ctx: AudioContext | undefined;\n  let source: MediaStreamAudioSourceNode | undefined;\n  let processor: ScriptProcessorNode | undefined;');
    const teardown=`  const teardown = (): void => {
    if (closed) return;
    closed = true;
    processor.onaudioprocess = null;
    try {
      source.disconnect();
      processor.disconnect();
    } catch {
      /* 已经断开：无所谓 */
    }
    for (const track of stream.getTracks()) track.stop();
    void ctx.close();
  };`;
    replace(teardown,'');
    replace('  processor.onaudioprocess = (event) => {',`  const teardown = (): void => {
    if (closed) return;
    closed = true;
    signal?.removeEventListener('abort', teardown);
    if (processor) processor.onaudioprocess = null;
    try { source?.disconnect(); } catch {}
    try { processor?.disconnect(); } catch {}
    for (const track of stream.getTracks()) track.stop();
    void ctx?.close().catch(() => {});
  };
  signal?.addEventListener('abort', teardown, {once:true});
  try {
    signal?.throwIfAborted();
    ctx = new AudioContext({ sampleRate: HEAR_SAMPLE_RATE });
    source = ctx.createMediaStreamSource(stream);
    processor = ctx.createScriptProcessor(BLOCK_SAMPLES, 1, 1);
    processor.onaudioprocess = (event) => {`);
    replace('  await ctx.resume();',`    await ctx.resume();
    signal?.throwIfAborted();
  } catch (error) {
    teardown();
    throw error;
  }`);
  }
  if(path==='src/shared/chat/hear-control.ts') {
    replace('  readonly hearUrl: string;', '  readonly hearUrl: string;\n  readonly active?: () => boolean;\n  readonly fetchVoice?: typeof fetch;');
    replace("  let hearState: HearState = 'idle';", `  let hearState: HearState = 'idle';
  let generation = 0;
  let controller: AbortController | undefined;
  const live = (owner: number) => owner === generation && !controller?.signal.aborted
    && input.isConnected && !document.hidden && opts.active?.() !== false;`);
    replace('    const current = recorder;', '    const owner = generation, signal = controller?.signal;\n    const current = recorder;');
    replace('      const clip = await current.stop();','      const clip = await current.stop();\n      if (!live(owner)) return;');
    replace('      const outcome = await hearAudio(hearUrl, toBase64(clip.wave));', '      const outcome = await hearAudio(hearUrl, toBase64(clip.wave), signal, opts.fetchVoice);');
    replace('      if (!input.isConnected) return; // 等结果的这会儿弹窗被关了','      if (!live(owner)) return;');
    replace('      if (!input.isConnected) return;','      if (!live(owner)) return;');
    replace("      hint.flash('录音出错：' + (e instanceof Error ? e.message : String(e)));", "      if (live(owner)) hint.flash('录音出错：' + (e instanceof Error ? e.message : String(e)));");
    replace("    } finally {\n      hearState = 'idle';\n      paint();\n    }", "    } finally {\n      if (live(owner)) { hearState = 'idle'; paint(); }\n    }");
    replace("    if (hearState !== 'idle') return;", "    if (hearState !== 'idle' || !input.isConnected || document.hidden || opts.active?.() === false) return;\n    const owner = ++generation, abort = controller = new AbortController();");
    replace('      recorder = await startRecording();', '      const next = await startRecording(abort.signal);\n      if (!live(owner)) { next.cancel(); return; }\n      recorder = next;');
    // The start catch must not reset the newer control after a hidden/reopened
    // operation fails or an old permission dialog rejects late.
    replace("    } catch (e) {\n      hearState = 'idle';", "    } catch (e) {\n      if (!live(owner)) return;\n      hearState = 'idle';");
    replace('    dispose: () => {\n      window.clearInterval(hearTimer);', `    dispose: () => {
      generation++;
      controller?.abort();
      controller = undefined;
      window.clearInterval(hearTimer);`);
    replace("      hearState = 'idle';\n    },", "      hearState = 'idle';\n      wasReleasedEarly = false;\n      paint();\n    },");
  }
  if(path==='src/shared/voice.ts') {
    replace('let manualSeq = 0;', 'let manualSeq = 0;\nlet manualRequest: AbortController | undefined;');
    replace('export function speakText(text: string, onPhase?: (phase: SpeakPhase) => void): void {',
      'export function speakText(text: string, onPhase?: (phase: SpeakPhase) => void, fetchVoice: typeof fetch = fetch): void {');
    replace('  void playManual(text, onPhase);', '  void playManual(text, onPhase, fetchVoice);');
    replace('async function playManual(text: string, onPhase?: (phase: SpeakPhase) => void): Promise<void> {\n  const token = ++manualSeq;',
      `async function playManual(text: string, onPhase: ((phase: SpeakPhase) => void) | undefined, fetchVoice: typeof fetch): Promise<void> {
  const token = ++manualSeq;
  manualRequest?.abort();
  const controller = manualRequest = new AbortController();`);
    const from = source.indexOf('async function playManual(');
    if (from < 0) throw Error('Pinned manual speech source changed');
    const start = source.slice(0, from);
    source = source.slice(from);
    replace("const response = await fetch(voiceBase + '/voice/speak', {", "const response = await fetchVoice(voiceBase + '/voice/speak', {");
    replace('signal: speakSignal(),', 'signal: AbortSignal.any([speakSignal(), controller.signal]),');
    replace("  if (manualAudio) {", "  if (token !== manualSeq) return;\n  if (manualAudio) {");
    replace('  if (token !== manualSeq) return; // 等配置期间又被点了一次：这次直接让位\n', '');
    replace('    const objectUrl = URL.createObjectURL(await response.blob());\n    if (token !== manualSeq) return;',
      '    const blob = await response.blob();\n    if (token !== manualSeq) return;\n    const objectUrl = URL.createObjectURL(blob);');
    replace("    if (token === manualSeq) onPhase?.('failed');\n  }",
      "    if (token === manualSeq) onPhase?.('failed');\n  } finally {\n    if (manualRequest === controller) manualRequest = undefined;\n  }");
    source = start + source;
  }
  if(path==='src/host/routes/voice.ts') {
    replace('    const result = await deps.voice.speak(parsed);', '    const result = await deps.voice.speak(parsed, signal);');
  }
  if(path==='src/host/voice/speak.ts') {
    // Preserve the sign when applying the original -50..+100 policy.
    replace('  const percent = Number(rate.slice(1, -1));', '  const percent = Number(rate.slice(0, -1));');
    replace('  speak(raw: unknown): Promise<SpeakResult>;', '  speak(raw: unknown, signal?: AbortSignal): Promise<SpeakResult>;');
    replace('  async function speak(raw: unknown): Promise<SpeakResult> {', '  async function speak(raw: unknown, signal?: AbortSignal): Promise<SpeakResult> {\n    signal?.throwIfAborted();');
    replace('    const cached = await findCached(target);', '    const cached = await findCached(target);\n    signal?.throwIfAborted();');
    replace('      await enqueue(async () => {', '      await enqueue(async () => {\n        signal?.throwIfAborted();');
    replace('        const dir = await ensureCacheDir(userRoot);', '        const dir = await ensureCacheDir(userRoot);\n        signal?.throwIfAborted();');
    replace('        if (provider) await synthesizeWithProvider(provider, { text, voice, rate, target });',
      '        if (provider) await synthesizeWithProvider(provider, { text, voice, rate, target, signal });');
    replace('        else await synthesizeImpl({ signal: AbortSignal.timeout(BUILTIN_TIMEOUT_MS), target, text, voice, rate });',
      '        else await synthesizeImpl({ signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(BUILTIN_TIMEOUT_MS)]) : AbortSignal.timeout(BUILTIN_TIMEOUT_MS), target, text, voice, rate });\n        signal?.throwIfAborted();');
    replace('        await pruneCache(dir);\n      });', '        await pruneCache(dir);\n        signal?.throwIfAborted();\n      });\n      signal?.throwIfAborted();');
    replace('    bytes = await withTimeout(provider.synthesize({ text: input.text, rate: input.rate }), PROVIDER_TIMEOUT_MS);',
      '    input.signal?.throwIfAborted();\n    // Keep ownership of this serial slot until a submitted third-party request\n    // settles; its public contract does not promise cancellation.\n    bytes = await withTimeout(provider.synthesize({ text: input.text, rate: input.rate }), PROVIDER_TIMEOUT_MS);\n    input.signal?.throwIfAborted();');
    replace('  await writeFile(input.target, bytes);', '  input.signal?.throwIfAborted();\n  await writeFile(input.target, bytes);');
  }
  if(path==='src/host/voice/edge.ts') {
    replace('export async function synthesize({ signal, text, voice, rate, target }: SynthInput): Promise<void> {',
      'export async function synthesize({ signal, text, voice, rate, target }: SynthInput): Promise<void> {\n  signal?.throwIfAborted();');
    replace('    const EdgeTTS = mod.EdgeTTS ?? mod.default?.EdgeTTS;', '    signal?.throwIfAborted();\n    const EdgeTTS = mod.EdgeTTS ?? mod.default?.EdgeTTS;');
    replace('    const result = await tts.generate(text, voice, { rate, signal, timeout: SYNTHESIS_TIMEOUT_MS });',
      '    const result = await tts.generate(text, voice, { rate, signal, timeout: SYNTHESIS_TIMEOUT_MS });\n    signal?.throwIfAborted();');
    replace('    await writeFile(staging, result.audio);\n    await rename(staging, target);',
      '    await writeFile(staging, result.audio);\n    signal?.throwIfAborted();\n    await rename(staging, target);');
  }
  return source;
}
