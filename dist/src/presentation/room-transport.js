const routes = {
    roomState: { path: '/api/home/state', photo: 'home' },
    roomAction: { path: '/api/home/act' },
    roomGarden: { path: '/api/garden/state', photo: 'garden' },
    roomPlant: { path: '/api/garden/act' },
    roomCare: { path: '/api/garden/control' },
    roomChat: { path: '/api/room/chat', roomLong: true, consoleLong: true },
    roomTelevision: { path: '/api/tv/opinion', roomLong: true, consoleLong: true },
    roomHistory: { path: '/api/room/history', photo: 'history' },
    roomVoice: { path: '/api/room/voice', roomLong: true },
};
const routeDefinitions = routes;
export const ROOM_ENDPOINTS = Object.freeze(Object.keys(routes));
export function isRoomEndpoint(value) {
    return typeof value === 'string' && Object.hasOwn(routes, value);
}
export const ROOM_BROWSER_ROUTES = ROOM_ENDPOINTS.map(endpoint => {
    const route = routeDefinitions[endpoint];
    return [route.path, { endpoint, timeout: route.roomLong ? 310000 : 20000 }];
});
export const ROOM_CONSOLE_TIMEOUTS = {
    defaultTimeout: 15000,
    endpoints: Object.fromEntries(ROOM_ENDPOINTS.filter(endpoint => routeDefinitions[endpoint].consoleLong)
        .map(endpoint => [endpoint, 300000])),
};
export const ROOM_PHOTO_ENDPOINTS = Object.fromEntries(ROOM_ENDPOINTS.flatMap(endpoint => {
    const { photo } = routeDefinitions[endpoint];
    return photo ? [[endpoint, photo]] : [];
}));
const voiceOperations = {
    hear: { method: 'POST' },
    speak: { method: 'POST' },
    voices: { method: 'GET' },
};
export const ROOM_VOICE_PATH = routes.roomVoice.path;
export const ROOM_VOICE_OPERATIONS = Object.keys(voiceOperations);
export function roomVoiceRoute(operation) {
    if (typeof operation !== 'string' || !Object.hasOwn(voiceOperations, operation))
        return;
    const { method } = voiceOperations[operation];
    return { rest: 'voice/' + operation, method };
}
//# sourceMappingURL=room-transport.js.map