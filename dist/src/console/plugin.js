import { CONTRACT_VERSION } from '../contracts/version.js';
import { settingsHandler } from './settings.js';
import { ROOM_ENDPOINTS } from '../presentation/room-transport.js';
export const name = 'her-world';
export const inject = ['connection'];
/** Native owner-only exact routes; no separate server or replacement API dispatcher. */
export function apply(ctx) {
    const native = ctx;
    const handler = settingsHandler(() => ctx.get('petCore'), () => native.get('workspaceRegistry'), () => ctx.get('petDesktop'), () => Object.keys(ctx.get('petWorld')?.modules ?? {}), () => ctx.get('petEmotion'), () => ctx.get('petLife'), () => ctx.get('petRoom'), () => ctx.get('petChannels'), () => ctx.get('petPlatform'), () => ctx.get('petEconomy'));
    for (const endpoint of ['economyView', 'economyAction', 'economySettings', 'presentationTiming', 'presentationMigration', 'foundation', 'self', 'emotionState', 'emotionUpdate', 'roomOpen', 'petPlatformAccess', 'petControlAccess', 'petStandaloneAccess', 'qzoneState', 'qzoneSettings', 'qzoneDraft', 'qzoneRemove', 'groupState', 'groupSettings', 'groupSlang', 'groupResearch', 'channelStatus', 'bridgeSettings', 'messagingSettings', 'lifeView', 'lifeControl', 'lifeAction', 'lifePreferences', 'lifeDates', 'lifeJournal', 'lifeAlbum', 'lifeSearch', 'lifePhoto', 'lifeForgetPhoto', 'snapshot', 'worldView', 'archiveFind', 'archiveRead', 'desktopOpen', 'desktopClose', 'desktopAppearance', 'companion', 'identity', 'quiet', 'preferences', 'initialize', 'profile'].concat(ROOM_ENDPOINTS)) {
        native.connection.fetch.register({ path: `/api/chatpetSettings/${endpoint}`, methods: ['POST'], requestBody: 'buffered',
            async fetch(request) {
                // Connection authenticates the physical request and admits only owner Peers
                // to exact routes. Reuse its browser RPC envelope and client correlation.
                if (request.headers.get('content-type')?.split(';', 1)[0].trim() !== 'application/json')
                    return new Response('Expected JSON', { status: 415 });
                let body;
                try {
                    body = await request.json();
                }
                catch {
                    return new Response('Invalid JSON', { status: 400 });
                }
                if (!body || body.type !== 'client-request' || typeof body.rpcId !== 'string' || body.rpcId.length > 160
                    || body.method !== `chatpetSettings/${endpoint}`)
                    return new Response('Invalid request', { status: 400 });
                const result = await handler(endpoint, body.payload, request.signal, native.connection.browserPeer);
                return Response.json({ type: 'server-response', rpcId: body.rpcId, result }, { headers: { 'Cache-Control': 'no-store' } });
            },
        });
    }
    ctx.inject(['petCore'], scope => {
        scope.effect(() => scope.petCore.workspace.runtime.capabilityTable.register({
            id: 'console.operations', owner: 'console', contractVersion: CONTRACT_VERSION, order: 9,
            status: () => ({ state: 'unavailable', reason: 'Native component is not available', supportedOperations: [] }),
        }).revoke);
    });
}
//# sourceMappingURL=plugin.js.map