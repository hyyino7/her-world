const VOICE_ROUTES = ['voice/hear', 'voice/speak', 'voice/voices'];
export function isVoiceRoute(rest) {
    return VOICE_ROUTES.some(route => route === rest);
}
//# sourceMappingURL=voice.js.map