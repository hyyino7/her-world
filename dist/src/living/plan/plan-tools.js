import { planOverview } from './tool-context.js';
import { PLAN_COMPARISONS } from './plan.js';
import { defineTool } from '@deepseek-ai/dsh-tools';
import { OWNER_LIFE_TOOL_SOURCES } from '../../core/native/conversation.js';
import { isHistoryObject } from '../../core/native/history-maintenance.js';
import { BODY_METRIC_NAMES, PLAN_BODY_ACTIONS, PLAN_ECONOMY_OPERATION_NAMES, PLAN_GARDEN_OPERATIONS, PLAN_GARDEN_OPERATION_NAMES } from '../../contracts/behavior.js';
import { registerLifeToolPolicy } from './tool-policy.js';
const output = { schema: { type: 'string' }, render: (_, value) => [{ type: 'text', text: value }] };
export const lifePlanReadToolDeclaration = {
    name: 'life_plan_read', sources: OWNER_LIFE_TOOL_SOURCES,
    historyOverview(_args, value) {
        if (isHistoryObject(value) && typeof value.revision === 'number' && (value.plan === null || isHistoryObject(value.plan)))
            return planOverview(value);
    },
};
const activityFields = {
    id: { type: 'string', required: true, description: 'Stable activity identifier: 1–48 letters, numbers, underscores, dots or hyphens.' },
    activity: { type: 'string', required: true, description: 'Short activity label, at most 80 characters; it does not replace the required executable fields.' },
    presentationSlot: { type: 'string', description: 'Optional registered visual slot compatible with the real operation. Omit for normal shared activity selection. It cannot create food, items, reading content, a transaction, a different emotion or a new activity; unsupported/missing portrayal remains a gap.' },
};
const timedActivityFields = {
    durationMinutes: { type: 'number', description: 'Positive duration for hold/room only. Choose durationMinutes or until, or omit both for explicit-control waiting, allowed only as the last step. nextConsiderAt does not finish a step.' },
    until: { type: 'string', description: 'ISO end time with an explicit timezone, for hold/room only. Do not combine with durationMinutes.' },
};
function gardenOperationsFor(branch) {
    return PLAN_GARDEN_OPERATION_NAMES.filter(operation => PLAN_GARDEN_OPERATIONS[operation].branch === branch)
        .sort((a, b) => PLAN_GARDEN_OPERATIONS[a].order - PLAN_GARDEN_OPERATIONS[b].order);
}
const gardenOperation = {
    required: true,
    description: 'One explicit existing garden operation, using type (never operation). Read room_garden with type=state for current plots, crops, seeds, inventory, coins and tasks. The program validates availability and balances and settles only against actual execution receipts.',
    oneOf: [
        { type: 'object', properties: { type: { type: 'string', const: gardenOperationsFor('noFields')[0], required: true } }, additionalProperties: false },
        { type: 'object', properties: {
                type: { type: 'string', enum: gardenOperationsFor('plot'), required: true },
                plotId: { type: 'integer', required: true, description: 'Existing plot id returned by room_garden state.' },
            }, additionalProperties: false },
        { type: 'object', properties: {
                type: { type: 'string', const: gardenOperationsFor('plotAndCrop')[0], required: true },
                plotId: { type: 'integer', required: true, description: 'Existing plot id returned by room_garden state.' },
                cropId: { type: 'string', required: true, description: 'Existing crop id returned by room_garden state; planting consumes an available seed.' },
            }, additionalProperties: false },
        { type: 'object', properties: {
                type: { type: 'string', enum: gardenOperationsFor('cropTrade'), required: true },
                cropId: { type: 'string', required: true, description: 'Existing crop id returned by room_garden state.' },
                quantity: { type: 'integer', description: 'Transaction quantity. Omit for the existing garden default of one; available funds, inventory and quantity limits are checked by the garden program.' },
            }, additionalProperties: false },
        { type: 'object', properties: {
                type: { type: 'string', const: gardenOperationsFor('quantity')[0], required: true },
                quantity: { type: 'integer', description: 'Transaction quantity. Omit for the existing garden default of one; available funds and quantity limits are checked by the garden program.' },
            }, additionalProperties: false },
    ],
};
const planStepBranches = {
    hold: {
        kind: { type: 'string', required: true, description: 'Continue an activity at the current position without a new body/garden operation.' },
        ...timedActivityFields,
    },
    room: {
        kind: { type: 'string', required: true, description: 'Stay at the target position until duration/until, or explicit control when last. For arrival-only travel use move.' },
        room: { type: 'string', required: true, description: 'Exact existing room identifier from room_state; do not invent a location.' },
        spot: { type: 'string', required: true, description: 'Exact spot identifier belonging to the selected room in room_state.' },
        ...timedActivityFields,
    },
    move: {
        kind: { type: 'string', required: true, description: 'Travel to room/spot and finish on actual arrival, including when already there. No durationMinutes/until.' },
        room: { type: 'string', required: true, description: 'Exact existing room identifier from room_state.' },
        spot: { type: 'string', required: true, description: 'Exact existing spot in the selected room.' },
    },
    body: {
        kind: { type: 'string', required: true },
        action: { type: 'string', enum: PLAN_BODY_ACTIONS, required: true, description: 'Existing bodily action. feed and water are free basic food/drinking water; paid catalog foods require kind=economy and type=consume. No durationMinutes/until; completion follows the actual body result.' },
    },
    garden: {
        kind: { type: 'string', required: true }, garden: gardenOperation,
    },
    economy: {
        kind: { type: 'string', required: true },
        economy: { type: 'object', required: true, properties: {
                type: { type: 'string', enum: PLAN_ECONOMY_OPERATION_NAMES, required: true },
                itemId: { type: 'string', required: true, description: 'Stable item id returned by the economy catalog. Actual holdings, configured prices and quantities are validated by the program.' },
                quantity: { type: 'integer', required: true, description: 'Positive whole-item count. consume requires exactly one food item; a stable operation receipt prevents duplicate effects or payment.' },
            }, additionalProperties: false },
    },
    read: {
        kind: { type: 'string', required: true },
        reading: { type: 'object', required: true, properties: {
                itemId: { type: 'string', required: true, description: 'Owned reading item id from the economy library.' },
                segment: { type: 'integer', required: true, description: 'Nonnegative actual segment number from the reading catalog. The step waits for the model to read returned text and explicitly confirm that segment; an animation cannot finish it.' },
            }, additionalProperties: false },
    },
};
const [firstStep, secondStep, ...remainingSteps] = Object.entries(planStepBranches)
    .map(([kind, { kind: { type, ...kindFields }, ...fields }]) => ({
    type: 'object', properties: { ...activityFields, kind: { type, const: kind, ...kindFields }, ...fields }, additionalProperties: false,
}));
const planStepSchema = { oneOf: [firstStep, secondStep, ...remainingSteps] };
/** Normal owner conversations use the same Life authority, never a per-chat plan. */
export function registerPlanTools(ctx, host, life) {
    const scope = (agent) => {
        if (!agent || agent.session.header.agentPreset === 'chatpet-channel-guest' || host.native.isGuest(agent.id))
            return;
        const status = host.workspace.status();
        if (status.state !== 'ready' || !status.target || ctx.petWorld.sessionStatus(agent.session)?.state !== 'ready')
            return;
        const registry = ctx.get('workspaceRegistry');
        const current = registry?.get(status.target.id);
        if (current?.path !== status.target.path || !current.sessionIds.includes(agent.id) || registry.archivedSessionIds.includes(agent.id))
            return;
        return status.target.id;
    };
    const checked = (agent) => {
        const id = scope(agent);
        if (!id || !agent || !host.native.manages(agent.id))
            throw Error('Life planning requires an admitted owner conversation in the current workspace');
        return id;
    };
    const admission = (agent, signal) => {
        signal.throwIfAborted();
        const id = checked(agent);
        return { id, validate: () => { signal.throwIfAborted(); if (checked(agent) !== id)
                throw Error('Life conversation or workspace admission changed'); } };
    };
    const catalog = [
        { ...lifePlanReadToolDeclaration, ...defineTool({ name: lifePlanReadToolDeclaration.name, description: '读取同一个伙伴跨会话保存的当前生活计划、版本、活动和进度。无计划也是有效状态。', parameters: { view: { type: 'string', enum: ['overview', 'full'], description: 'Autonomous turns default to overview; full retains the original snapshot.' } }, output,
                execute: async ({ view }, exec) => {
                    const guard = admission(exec.agent, exec.signal);
                    const state = await life.readPlan(guard.id, guard.validate);
                    return JSON.stringify((view ?? (host.native.isAutonomous(exec.agent.id) ? 'overview' : 'full')) === 'overview' ? planOverview(state) : state);
                } }) },
        { sources: OWNER_LIFE_TOOL_SOURCES, ...defineTool({ name: 'life_plan_update', description: '提交或明确替换持久生活计划。先读版本；可长期保持活动、休息或无安排。move 表示前往位置并在实际到达后结束；room 表示到指定位置持续活动，hold 表示原地持续活动，不会入睡。决定睡觉须提交 body、action=sleep，实际入睡后才算睡着；nextConsiderAt 只设置思考时间。无限持续活动只能放在最后；nextConsiderAt 只唤醒思考，不结束活动。body 必须给 action；room/move 必须使用 room_state 中的 room/spot；garden 必须给 garden:{type:...}，先用 room_garden 的 state 查询目标和资源，巡视使用 type=visit。身体和园艺操作以真实执行结果结束，后续持续休息可另加 hold。economy 用目录中的真实 itemId 购买、出售或消费；收菜、出售、补种与消费都由你明确决定，不因成熟自动执行。read 指定已持有书本的实际片段，必须取得内容并确认才算读过，动画不代表阅读完成。计划只表达意图，程序验证并执行，不能声称已经完成。不要为每个动画片段或普通聊天重建计划。', parameters: {
                    expectedRevision: { type: 'integer', required: true },
                    plan: { type: 'object', required: true, properties: {
                            goal: { type: 'string', required: true }, reason: { type: 'string', required: true }, nextConsiderAt: { oneOf: [{ type: 'string' }, { type: 'null' }], required: true, description: 'ISO time with timezone, or null to wait for an explicit event. Finishing the last finite activity is one such event. Empty steps with null explicitly choose quiet waiting. No fixed interval.' },
                            steps: { type: 'array', required: true, description: 'Ordered explicit activities. Empty steps are valid quiet waiting. Each kind has its own required fields; labels alone cannot execute an activity.', items: planStepSchema },
                            reconsiderWhen: { type: 'array', items: { type: 'object', properties: { metric: { type: 'string', enum: [...BODY_METRIC_NAMES], required: true }, comparison: { type: 'string', enum: [...PLAN_COMPARISONS], required: true }, value: { type: 'number', required: true } }, additionalProperties: false } },
                        }, additionalProperties: false },
                }, output, execute: async (args, exec) => { const guard = admission(exec.agent, exec.signal); return JSON.stringify(await life.updatePlan(guard.id, args.expectedRevision, args.plan, guard.validate)); } }) },
        { sources: OWNER_LIFE_TOOL_SOURCES, ...defineTool({ name: 'life_read_segment', description: '读取当前生活计划正在执行的真实读物片段。先读计划及版本，使用当前执行的原operationId；返回实际文字和持久receiptToken。取得内容不会自动推进书签，也不代表读懂。读到返回文字后才可明确调用life_read_confirm。沿用当前原生会话，不创建第二个阅读代理。', parameters: {
                    expectedRevision: { type: 'integer', required: true }, operationId: { type: 'string', required: true },
                }, output, execute: async (args, exec) => { const guard = admission(exec.agent, exec.signal); return JSON.stringify(await life.readPlannedSegment(guard.id, args.expectedRevision, args.operationId, guard.validate)); } }) },
        { sources: OWNER_LIFE_TOOL_SOURCES, ...defineTool({ name: 'life_read_confirm', description: '仅在你已经取得并实际阅读life_read_segment返回的文字后，确认当前原operationId及该真实片段的receiptToken。程序核对持有权、内容版本、计划版本与取消状态后推进书签；不记录你已读懂，不以动画或口头意图推进进度。', parameters: {
                    expectedRevision: { type: 'integer', required: true }, operationId: { type: 'string', required: true }, receiptToken: { type: 'string', required: true },
                }, output, execute: async (args, exec) => { const guard = admission(exec.agent, exec.signal); return JSON.stringify(await life.confirmPlannedReading(guard.id, args.expectedRevision, args.operationId, args.receiptToken, guard.validate)); } }) },
        { sources: OWNER_LIFE_TOOL_SOURCES, ...defineTool({ name: 'life_plan_keep', description: '考虑后明确保留当前生活计划、活动和进度，不重建或重复派工。先读版本并说明继续或等待的原因；nextConsiderAt可保留原时间、选择新时间或明确为null等待事件。无计划时请用life_plan_update保存安排或空步骤等待，失败的活动要修订计划，已暂停的活动须明确恢复。普通查看不必调用。', parameters: {
                    expectedRevision: { type: 'integer', required: true }, reason: { type: 'string', required: true },
                    nextConsiderAt: { oneOf: [{ type: 'string' }, { type: 'null' }], required: true },
                }, output, execute: async (args, exec) => { const guard = admission(exec.agent, exec.signal); return JSON.stringify(await life.keepPlan(guard.id, args.expectedRevision, args.reason, args.nextConsiderAt, guard.validate)); } }) },
        { sources: OWNER_LIFE_TOOL_SOURCES, ...defineTool({ name: 'life_activity_control', description: '明确暂停、恢复或取消当前生活计划。普通聊天不必暂停；暂停保留进度，恢复不重新消费已完成步骤。自主生活关闭时只能暂停或取消，不能偷偷开启。', parameters: {
                    expectedRevision: { type: 'integer', required: true }, action: { type: 'string', enum: ['pause', 'resume', 'cancel'], required: true }, reason: { type: 'string', required: true },
                }, output, execute: async (args, exec) => { const guard = admission(exec.agent, exec.signal); return JSON.stringify(await life.controlPlan(guard.id, args.expectedRevision, args.action, args.reason, guard.validate)); } }) },
    ];
    registerLifeToolPolicy(ctx, host.native.toolTable);
    return catalog.map(tool => registerPlanTool(ctx, host.native.toolTable, tool, ({ agent }) => !!scope(agent)));
}
export function registerPlanTool(ctx, table, tool, when) {
    const dispose = ctx.tools.register(tool, { when });
    const { name, sources = ['owner'], historyOverview } = tool;
    ctx.effect(() => table.register({ name, sources, historyOverview }).revoke);
    return dispose;
}
//# sourceMappingURL=plan-tools.js.map