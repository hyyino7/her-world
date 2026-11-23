import { CONTRACT_VERSION } from '../contracts/version.js';
import { settingsEndpoints, settingsHandler } from './settings.js';
export const name = 'her-world';
export const inject = ['connection'];
/** Native owner-only exact routes; no separate server or replacement API dispatcher. */
export function apply(ctx) {
    const native = ctx;
    const connection = native.connection;
    const handler = settingsHandler(() => ctx.get('petCore'), () => native.get('workspaceRegistry'), () => Object.keys(ctx.get('petWorld')?.modules ?? {}), () => ctx.get('petEconomy'), ctx);
    const lifetime = new AbortController();
    for (const endpoint of settingsEndpoints) {
        ctx.effect(() => {
            const revoke = connection.fetch.register({
                path: `/api/chatpetSettings/${endpoint}`, methods: ['POST'], requestBody: 'buffered',
                async fetch(request) {
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
                    if (lifetime.signal.aborted)
                        return new Response(null, { status: 404 });
                    const signal = AbortSignal.any([request.signal, lifetime.signal]);
                    const result = await handler(endpoint, body.payload, signal, connection.browserPeer);
                    return Response.json({ type: 'server-response', rpcId: body.rpcId, result }, { headers: { 'Cache-Control': 'no-store' } });
                },
            });
            return () => revoke();
        });
    }
    ctx.inject(['petCore'], scope => {
        scope.effect(() => scope.petCore.workspace.runtime.capabilityTable.register({
            id: 'console.operations', owner: 'console', contractVersion: CONTRACT_VERSION, order: 9,
            status: () => ({ state: 'unavailable', reason: 'Native component is not available', supportedOperations: [] }),
        }).revoke);
    });
    ctx.effect(() => () => lifetime.abort());
}
//# sourceMappingURL=plugin.js.map