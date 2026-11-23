import { defineTool } from '@deepseek-ai/dsh-tools';
import { fileURLToPath } from 'node:url';
import { check } from '../../core/storage.js';
import { OWNER_LIFE_TOOL_SOURCES } from '../../core/native/conversation.js';
// Only the daily review section is adapted. World supplies the original alarm
// text and fallback for every other section.
export const REVIEW_ALARM_FILE = fileURLToPath(new URL('../../../../locale/life/review-alarm.md', import.meta.url));
export function installLifeReview(ctx, host, getScope, inFlight) {
    // Core installs self-description and guarded writing even without Life.
    // Life owns only the scheduled review and its home-only dialogue reader.
    const tool = defineTool({
        name: 'read_review_dialogue',
        description: '回顾某个本地日期工作区里当前允许读取的聊天原文。user 是伙伴说的话，assistant 是助手的回复。返回 nextOffset 时可继续读取。partial 表示部分来源无法核实。',
        parameters: { day: { type: 'string', required: true }, offset: { type: 'integer' } },
        output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] },
        execute: ({ day, offset }, exec) => inFlight.run(async () => {
            exec.signal.throwIfAborted();
            const scope = getScope(), id = exec.agent?.id;
            check(id && scope && scope.isHome(id), 'The Life home is unavailable');
            const memory = host.native.memoryFor(id);
            check(memory && host.native.manages(id), 'Review requires an admitted Memory conversation');
            check(typeof day === 'string' && day.length === 10, 'Expected a local date');
            const page = await memory.dialogueForDay(scope.id, scope.sessionIds, { day, timeZone: scope.timeZone, offset });
            exec.signal.throwIfAborted();
            const current = getScope();
            check(current?.id === scope.id && current.isHome(id) && page.items.every(line => current.sessionIds.includes(line.sessionId)), 'Review workspace changed');
            await host.native.useSources(id, page.items.map(line => line.id));
            exec.signal.throwIfAborted();
            check(getScope()?.isHome(id), 'Life paused during the read');
            return JSON.stringify(page);
        }),
    });
    const tools = ctx.tools;
    tools.register(tool, { when: ({ agent }) => Boolean(agent && getScope()?.isHome(agent.id) && host.native.memoryFor(agent.id)) });
    ctx.effect(() => host.native.toolTable.register({ name: tool.name, sources: OWNER_LIFE_TOOL_SOURCES }).revoke);
}
//# sourceMappingURL=review.js.map