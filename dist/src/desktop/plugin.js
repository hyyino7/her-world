import { CONTRACT_VERSION } from '../contracts/version.js';
import { object } from '../core/tables/console.js';
import { registerLifeOutlet } from '../living/outlets.js';
import { desktopFor, registerDesktop } from './index.js';
export const name = '30-Desktop';
export const inject = ['petCore', 'agents', 'sessions'];
const desktopPolicies = [
    {
        row: 7, branch: 'desktop-chat', trustedActor: '无渠道身份的主人输入',
        selectionKey: '按存储绑定选择未归档的原生会话', historyScope: '所选原生会话的历史', preset: 'DSH 默认预设',
        lifecycle: '按请求去重；停止走原生取消；受管轮次首步前恢复图片', bindingCheck: '工作区、路径、存储和窗口代次',
        inherits: 1,
        tools: { description: '沿用第 1 行的主人工具权限', behaviorIds: ['M2A-09'] },
        memoryObservation: { description: '沿用第 1 行观察输入和回复', behaviorIds: ['M2A-09'] },
        emotionUpdate: {
            footer: { description: '沿用第 1 行处理回复 footer', behaviorIds: ['M2A-09'] },
            tool: { description: '沿用第 1 行的情绪工具权限', behaviorIds: ['M2A-10'] },
        },
    },
    {
        row: 9, branch: 'desktop-monologue', trustedActor: '伙伴',
        selectionKey: '当前绑定及唤醒条件', historyScope: '一次性请求', preset: '碎碎念或梦话的原生请求',
        lifecycle: '只发布说话事件；条件改变即取消', bindingCheck: '调用前后校验目标绑定',
        tools: { description: '无工具', behaviorIds: ['M2A-11'] },
        memoryObservation: { description: '无 Memory 读写', behaviorIds: ['M2A-11'] },
        emotionUpdate: {
            footer: { description: '无 footer 情绪更新', behaviorIds: ['M2A-11'] },
            tool: { description: '无情绪工具', behaviorIds: ['M2A-11'] },
        },
    },
];
export function desktopConsoleOperations(desktop) {
    const windowOperation = (open) => async (call) => {
        const input = object(call.input, ['workspaceId']);
        call.checkBinding(input.workspaceId, open);
        call.validate();
        if (open)
            await desktop.start();
        else
            await desktop.closeWindow();
        return desktop.status();
    };
    return {
        operations: { desktopOpen: windowOperation(true), desktopClose: windowOperation(false) },
        status: () => desktop.status(),
    };
}
export function apply(ctx) {
    const host = ctx.petCore;
    registerDesktop(ctx, host);
    const desktop = desktopFor(host);
    ctx.provide('petDesktop', desktop);
    ctx.effect(() => host.native.consoleOperations.register('desktop', desktopConsoleOperations(desktop), ctx).revoke);
    ctx.effect(() => registerLifeOutlet(ctx, host, 'desktop', {
        pause: () => desktop.features?.pause(),
        restore: () => desktop.features?.restore(false),
        present(text, sticker) {
            if (!desktop.presentationAvailable())
                return false;
            desktop.presentLife(text, sticker);
            return true;
        },
    }).revoke);
    ctx.effect(() => host.native.sourceTable.register({
        id: 'desktop', order: 30, sources: [], branches: {}, policyRows: desktopPolicies,
        admit: () => ({ kind: 'unclaimed' }),
        async beforeFirstStep() { await desktop.features?.restoreImages(); },
    }).revoke);
    for (const [order, id, supportedOperations] of [
        [4, 'desktop.presentation', ['send', 'stop', 'fold', 'reopen']],
        [5, 'desktop.body', ['open', 'close', 'drag', 'play']],
    ]) {
        ctx.effect(() => host.workspace.runtime.capabilityTable.register({
            id, owner: 'desktop', contractVersion: CONTRACT_VERSION, order,
            status: () => {
                const bound = host.workspace.status().state === 'ready';
                const running = desktop.status().running;
                return { state: running ? 'ready' : bound ? 'disabled' : 'unavailable',
                    reason: running ? null : bound ? 'Desktop window is closed' : 'Bind a workspace to open the desktop',
                    supportedOperations: [...supportedOperations] };
            },
        }).revoke);
    }
}
//# sourceMappingURL=plugin.js.map