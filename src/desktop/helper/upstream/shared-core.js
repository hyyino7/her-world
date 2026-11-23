// Generated from PC2005-cloud/dsh-pet c7ea8b28e2a8b04a495a3b472a871dff6969ccca (MIT).
(() => { const modules = {"src/client/pet/animation/animation.ts": function(exports, require) {
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createOwnAnimation = createOwnAnimation;
/**
 * 自播动画链：A/B 双缓冲换源、blob 生命周期、点播回执，以及「这一段播完之后该做什么」的判定。
 *
 * 只碰 video 元素与自己的内部状态；React 状态（anim / once / seq / 气泡 / 朝向）不在本模块里改，
 * 需要改的地方以 {@link EndedCue} / {@link FreezeCue} 的形式返回，由组件执行。
 * 必须始终成立：同一时刻只有一个 pending 换源（世代号丢弃迟到的加载），且回执先于任何 return 上报。
 * @module dsh-pet/src/client/pet/animation/animation
 */
const pickers_ts_1 = require("src/shared/pickers.ts");
const cues_ts_1 = require("src/client/pet/animation/cues.ts");
const asset_loader_ts_1 = require("src/client/pet/animation/asset-loader.ts");
const assets_ts_1 = require("src/client/pet/animation/assets.ts");
const media_ts_1 = require("src/client/pet/animation/media.ts");
/** 换源失败与打断的原因，落进回执的 `reason` 字段。 */
const REASON_ASSET_LOAD = 'asset-load';
const REASON_PLAY_REJECTED = 'play-rejected';
const REASON_DECODE = 'decode-error';
const REASON_SUPERSEDED = 'superseded';
const REASON_FROZEN = 'frozen';
/** 资源超时（ms）：DSH WebServer 偶发 stalled，超时就丢弃本次换源。 */
const ASSET_FETCH_TIMEOUT_MS = 10_000;
/** 日志时间戳：与其余宠物日志同一格式，便于对照同一次事件。 */
const stamp = (petId) => new Date().toTimeString().slice(0, 8) + ' pet=' + petId;
/**
 * 造动画链。
 *
 * @param deps - 元素、配置与回调。
 * @returns 换源、播完判定、冻结控制与清理。
 */
function createOwnAnimation(deps) {
    /** 当前前台槽位：0 = A，1 = B。 */
    let front = 0;
    /** 挂起的换源；`null` = 没有换源在等首帧。 */
    let pending = null;
    /** 换源世代号，只增不减。 */
    let gen = 0;
    /** 待消费的点播地址，一次性取走。 */
    let cueUrl = null;
    /** 正在播的点播编号。 */
    let playing = null;
    /** 冻结标志：只挡自动来源，显式指令照常。 */
    let frozen = deps.initiallyFrozen;
    /** 两个槽位各自的 blob 地址，换源时先释放旧的。 */
    const blobUrl = { a: null, b: null };
    const loader = deps.loader ?? (0, asset_loader_ts_1.createAssetLoader)(ASSET_FETCH_TIMEOUT_MS);
    /** 挂载标志：卸载后迟到的加载结果直接丢弃。 */
    let mounted = true;
    const slotOf = (index) => (index === 0 ? 'a' : 'b');
    const elementOf = (index) => (index === 0 ? deps.videoA() : deps.videoB());
    const frontVideo = () => elementOf(front);
    /** 上报并清掉「正在播」的编号；`keep` 为真时不清（同一编号继续播）。 */
    const reportOnce = (playbackId, status, reason) => {
        if (playing === playbackId)
            playing = null;
        deps.report(playbackId, status, reason);
    };
    const switchTo = (next, nextOnce, cuePlaybackId) => {
        // 一次性消费点播编号：清空会再跑一趟 effect，那一趟落入防重分支。
        if (cuePlaybackId !== null)
            deps.clearCuePlayback();
        // url 交接位同样一次性取走，且必须早于任何 return：否则防重分支提前返回时，
        // 它会留到下一次普通换源，把那个动画误播成这个地址。
        const cfg = deps.cfg();
        const url = cueUrl;
        cueUrl = null;
        if (next === '')
            return;
        if (pending !== null && pending.anim === next && pending.once === nextOnce) {
            // 防重命中仍要让点播有回执，避免调用方干等超时。
            if (cuePlaybackId !== null) {
                playing = cuePlaybackId;
                deps.report(cuePlaybackId, 'playing');
            }
            return;
        }
        if ((0, pickers_ts_1.isEventAnim)(cfg.animations.events, next)) {
            console.log('[dsh-pet] ' + stamp(cfg.id) + ' switch ' + next + ' once=' + nextOnce);
        }
        const swapGen = (gen += 1);
        pending = { anim: next, once: nextOnce, gen: swapGen };
        const targetIndex = front === 0 ? 1 : 0;
        const el = elementOf(targetIndex);
        if (el === null)
            return;
        el.loop = !nextOnce;
        el.muted = true;
        el.autoplay = true;
        el.playsInline = true;
        el.onended = nextOnce ? (event) => deps.onEnded(handleEnded(event)) : null;
        // 元素级解码失败只补一条回执，不改播放控制；换源时与 onended 一起清掉。
        el.onerror = cuePlaybackId === null ? null : () => reportOnce(cuePlaybackId, 'failed', REASON_DECODE);
        // fetch + blob 一次拿全文件，绕开 video 流式加载在 DSH WebServer 上偶发的 stalled。
        const assetUrl = (0, assets_ts_1.animationAssetUrl)({
            cueUrl: url,
            assetRoot: cfg.assetRoot ?? '',
            id: cfg.id,
            anim: next,
            ext: (0, media_ts_1.thumbExt)(),
        });
        loader.load(assetUrl, {
            onObjectUrl: (objectUrl) => {
                if (!mounted) {
                    loader.release(objectUrl); // 已卸载：不留无人回收的地址。
                    return;
                }
                if (pending?.gen !== swapGen) {
                    loader.release(objectUrl); // 已被更新的切换覆盖：本次加载作废。
                    return;
                }
                const slot = slotOf(targetIndex);
                const previous = blobUrl[slot];
                if (previous !== null)
                    loader.release(previous);
                blobUrl[slot] = objectUrl;
                el.src = objectUrl;
                el.load();
            },
            onError: (error) => {
                if (!mounted)
                    return; // 卸载后的 abort：静默。
                if (pending?.gen !== swapGen)
                    return; // 已被更新的切换覆盖。
                pending = null; // 释放挂起的换源，避免后续点击困在防重循环里。
                if (cuePlaybackId !== null)
                    reportOnce(cuePlaybackId, 'failed', REASON_ASSET_LOAD);
                console.warn('[dsh-pet] 素材加载失败 pet=' +
                    cfg.id +
                    ' anim=' +
                    next +
                    '：' +
                    (error instanceof Error ? error.message : String(error)) +
                    '（已释放本次切换）');
            },
        });
        const onReady = () => {
            el.removeEventListener('loadeddata', onReady);
            if (pending?.gen !== swapGen)
                return;
            const outgoing = elementOf(front);
            el.classList.add('is-front');
            if (outgoing !== null && outgoing !== el) {
                outgoing.classList.remove('is-front');
                // 降级为背景的视频若继续播完，残留的 onended 会掐断当前前台动画：清 handler 并停播。
                outgoing.onended = null;
                outgoing.onerror = null;
                outgoing.pause();
                // 被换下的点播若没播完，如实回 cancelled（补的是点击、拖拽这类非点播打断）。
                if (playing !== null && playing !== cuePlaybackId)
                    reportOnce(playing, 'cancelled', REASON_SUPERSEDED);
            }
            front = front === 0 ? 1 : 0;
            pending = null;
            playing = cuePlaybackId;
            el.style.transform = deps.facing() === 'right' ? 'scaleX(-1)' : '';
            el.play()
                .then(() => {
                // 只有 play() 兑现才代表确实开始出画，loadeddata 只代表可解码。
                if (cuePlaybackId !== null)
                    deps.report(cuePlaybackId, 'playing');
            })
                .catch(() => {
                if (cuePlaybackId !== null)
                    reportOnce(cuePlaybackId, 'failed', REASON_PLAY_REJECTED);
            });
            deps.onFrontReady(el);
        };
        el.addEventListener('loadeddata', onReady);
    };
    const handleEnded = (event) => {
        // 只认前台元素的 ended：后台即便有残留事件也丢弃，防止掐断当前动画。
        const endedOn = event === undefined ? null : event.currentTarget;
        if (endedOn !== null && !endedOn.classList.contains('is-front'))
            return { kind: 'ignore' };
        // 回执放在拖拽守卫之前：「播完」是既成事实，不该受动画链推进逻辑影响。
        const done = playing;
        if (done !== null) {
            playing = null; // 先清再上报，后续换源不会把它当成被打断。
            deps.report(done, 'ended');
        }
        if (deps.isDragging())
            return { kind: 'ignore' };
        // 冻结时不推进：下面每条分支都会按当前工作状态换源，effect 的门禁拦不住。
        if (frozen)
            return { kind: 'ignore' };
        const cue = (0, cues_ts_1.decideEndedCue)({
            animations: deps.cfg().animations,
            current: deps.currentAnim(),
            workState: deps.workStatus()?.state,
        });
        const petId = deps.cfg().id;
        if (cue.kind === 'work-rotate') {
            console.log('[dsh-pet] ' + stamp(petId) + ' workStatus 档内轮换: ' + deps.currentAnim() + ' -> ' + cue.anim);
        }
        else if (cue.kind === 'work-replay') {
            console.log('[dsh-pet] ' + stamp(petId) + ' workStatus 循环续播: ' + deps.currentAnim());
        }
        else if (cue.kind === 'event-done') {
            console.log('[dsh-pet] ' + stamp(petId) + ' 事件动画播完 ended anim=' + deps.currentAnim());
        }
        return cue;
    };
    return {
        switchTo,
        handleEnded,
        stopLoopingFront: () => {
            const el = frontVideo();
            if (el === null)
                return;
            el.loop = false;
            el.onended = (event) => deps.onEnded(handleEnded(event));
        },
        setCueUrl: (url) => {
            cueUrl = url;
        },
        setFrozen: (next) => {
            if (frozen === next)
                return null;
            frozen = next;
            if (next) {
                frontVideo()?.pause();
                // 冻结打断了正在播的点播：解冻不会接回来，所以是 cancelled 而不是暂停。
                if (playing !== null)
                    reportOnce(playing, 'cancelled', REASON_FROZEN);
                return { kind: 'frozen' };
            }
            return { kind: 'resumed' };
        },
        isFrozen: () => frozen,
        frontVideo,
        playingPlayback: () => playing,
        dispose: () => {
            mounted = false;
            loader.abortAll();
            if (blobUrl.a !== null)
                loader.release(blobUrl.a);
            if (blobUrl.b !== null)
                loader.release(blobUrl.b);
            blobUrl.a = null;
            blobUrl.b = null;
        },
    };
}

},
"src/client/pet/animation/asset-loader.ts": function(exports, require) {
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createAssetLoader = createAssetLoader;
/**
 * 造素材加载器。
 *
 * @param timeoutMs - 单次请求的超时（ms）；到点即中断，避免请求无限挂着。
 * @returns 加载、批量中断与释放。
 */
function createAssetLoader(timeoutMs) {
    /** 在途请求：销毁时统一中断，否则卸载后完成的响应会创建无人回收的地址。 */
    const inflight = new Set();
    return {
        load: (url, handlers) => {
            const controller = new AbortController();
            inflight.add(controller);
            const timer = window.setTimeout(() => controller.abort(), timeoutMs);
            const settle = () => {
                window.clearTimeout(timer);
                inflight.delete(controller);
            };
            fetch(url, { cache: 'default', signal: controller.signal })
                .then((response) => {
                if (!response.ok)
                    throw new Error('asset HTTP ' + response.status);
                return response.blob();
            })
                .then((blob) => {
                settle();
                handlers.onObjectUrl(URL.createObjectURL(blob));
            })
                .catch((error) => {
                settle();
                handlers.onError(error);
            });
        },
        abortAll: () => {
            for (const controller of inflight)
                controller.abort();
            inflight.clear();
        },
        release: (objectUrl) => {
            URL.revokeObjectURL(objectUrl);
        },
    };
}

},
"src/client/pet/animation/assets.ts": function(exports, require) {
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.animationAssetUrl = animationAssetUrl;
/**
 * 动画素材的地址拼装：点播给了完整 url 就用它，否则按「素材根 + 动画名 + 扩展名」拼宿主路由。
 * 两段都过 `encodeURIComponent`——动画名与素材根都允许中文与空格，不编码会让路由匹配不上。
 * 扩展名由调用方探测后传入（`thumbExt()` 读 UA），本模块不碰浏览器环境。
 * @module dsh-pet/src/client/pet/animation/assets
 */
const constants_ts_1 = require("src/shared/constants.ts");
/**
 * 拼一次动画的素材地址。
 *
 * @param source - 地址来源与标识。
 * @returns 可直接 fetch 的地址；`cueUrl` 优先。
 */
function animationAssetUrl(source) {
    if (source.cueUrl)
        return source.cueUrl;
    const root = source.assetRoot === '' ? source.id : source.assetRoot;
    return constants_ts_1.ROUTE_PATH + '/thumb/' + encodeURIComponent(root) + '/' + encodeURIComponent(source.anim) + source.ext;
}

},
"src/client/pet/animation/cues.ts": function(exports, require) {
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.decideEndedCue = decideEndedCue;
/**
 * 动画链的两个判定结果与「播完之后做什么」的纯决策。
 *
 * 只回答「这一段播完了该进哪条分支」，不碰 DOM、不读时钟、不上报回执——
 * 回执与停顿门禁由动画链处理，React 状态由组件按结果改。
 * @module dsh-pet/src/client/pet/animation/cues
 */
const pickers_ts_1 = require("src/shared/pickers.ts");
/** 工作状态是否处在「非终态」：终态（success / error）与空闲都不续播档位动画。 */
const isWorkActive = (state) => state !== null && state !== undefined && state !== 'success' && state !== 'error';
/**
 * 决定播完之后进哪条分支。
 *
 * @param input - 动画池、刚播完的动画与当前工作状态。
 * @returns 分支判定；拖拽中与冻结由调用方在更前面拦掉。
 */
function decideEndedCue(input) {
    const { animations, current, workState } = input;
    const isEvent = (0, pickers_ts_1.isEventAnim)(animations.events, current);
    if (isEvent && isWorkActive(workState)) {
        // 多候选档位播完轮换到下一候选，长时间状态不单段重复。
        const nextWork = (0, pickers_ts_1.nextWorkStatusAnim)(animations.events?.workStatus ?? [], current);
        if (nextWork !== null)
            return { kind: 'work-rotate', anim: nextWork };
        // 单候选档位意外 ended 时续播同一段。
        if ((0, pickers_ts_1.poolIncludes)(animations.events?.workStatus ?? [], current))
            return { kind: 'work-replay' };
    }
    if (isEvent)
        return { kind: 'event-done' };
    if (animations.turn.includes(current))
        return { kind: 'turn' };
    if (animations.drag.includes(current) || animations.clicks.includes(current))
        return { kind: 'interaction-done' };
    return { kind: 'random' };
}

},
"src/client/pet/animation/media.ts": function(exports, require) {
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.prefersMov = prefersMov;
exports.thumbExt = thumbExt;
/**
 * 动画素材的容器格式探测：决定这次会话用 `.mov`（HEVC-alpha）还是 `.webm`（VP9-alpha）。
 * 只有 macOS 与 iOS 的 WebKit（Safari / WKWebView）需要 mov——`canPlayType` 判不出来：Safari 能解码 VP9 webm
 * 却会丢弃 alpha，表现成黑底；「能解码」与「透明还在」是两件事，后者没有 Web API 可查询。
 * 判断结果按会话缓存一次，扩展名不会在运行中来回变。
 * @module dsh-pet/src/client/pet/animation/media
 */
const constants_ts_1 = require("src/shared/constants.ts");
/** 本次会话已定论的扩展名，`null` = 尚未判断。 */
let resolvedExt = null;
/**
 * 是否优先要 mov：macOS 与 iOS 的 WebKit 才要；其余按 Chromium/Firefox 处理。
 *
 * @returns 需要 HEVC-alpha 时返回 true。
 */
function prefersMov() {
    const ua = navigator.userAgent;
    // iOS 上所有浏览器（含 CriOS / FxiOS / EdgiOS）都是 WebKit，同样丢弃 alpha；
    // 必须排在下面的排除之前，否则 FxiOS 会被误判成原生支持。
    if (/iPhone|iPad|iPod/i.test(ua))
        return true;
    // Chromium 系（含 Electron 桌面端）与 Firefox 原生支持 VP9-alpha，不需要 mov。
    if (/Chrome|Chromium|Edg|OPR|Firefox|FxiOS/i.test(ua))
        return false;
    return /Mac/i.test(navigator.platform || ua); // 余下按 WebKit 处理，且限定 macOS。
}
/**
 * 取本次会话使用的动画扩展名（含点）。显式常量优先，否则按渲染端判断。
 * 宿主对缺失的 `.mov` 会退回同名 `.webm`，所以这里只管「要哪一种」。
 *
 * @returns `.mov` 或 `.webm`。
 */
function thumbExt() {
    if (resolvedExt === null) {
        // ANIMATION_EXT 的静态类型被窄化为 '.webm'，但用户会把它改成 .mov；
        // 按 string 读才能表达这条显式意图，否则 TS 判为恒不相等。
        const explicit = constants_ts_1.ANIMATION_EXT;
        resolvedExt = explicit === '.mov' || prefersMov() ? '.mov' : '.webm';
    }
    return resolvedExt;
}

},
"src/shared/avatar.ts": function(exports, require) {
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.LOGO_URL = void 0;
exports.avatarUrl = avatarUrl;
/**
 * 宠物头像地址的唯一拼装处：聊天面板的消息头像与设置页的预览都用它。
 *
 * 不放 client/chat 里：设置页也要用，而设置页不该反向依赖对话面板的数据访问模块。
 * @module dsh-pet/src/shared/avatar
 */
const constants_ts_1 = require("src/shared/constants.ts");
/** 插件 logo 地址：没上传过头像时宿主回发的默认图。 */
exports.LOGO_URL = constants_ts_1.ROUTE_PATH + '/logo';
/**
 * 宠物头像地址：按素材根取，没上传过的由宿主回退默认 logo。
 *
 * 参数名刻意用 `root` 而不是 `pet`：它和其它端点的 `pet`（宠物实例 id，如 `main`）不是一回事，
 * 这里是素材根（目录前缀，如 `baimao`）。同名不同义会让第三方按 `pet` 的既有语义调用后静默拿到默认图。
 *
 * `v` 只用于破缓存——换过头像后同一 URL 会被浏览器记住，带上本次渲染的版本号才会重新取图。
 *
 * @param assetRoot - 宠物所属条目（素材根）；空串按「只有默认 logo」处理。
 * @param version - 本次渲染的版本号，打开面板 / 刷新 / 上传成功时换一个。
 */
function avatarUrl(assetRoot, version) {
    const root = assetRoot.trim();
    const query = root === '' ? '' : 'root=' + encodeURIComponent(root) + '&';
    return constants_ts_1.ROUTE_PATH + '/logo?' + query + 'v=' + version;
}

},
"src/shared/balance/handlers/custom.ts": function(exports, require) {
"use strict";
/**
 * custom 形态：把第三方交来的节点树从视图里取出来。
 *
 * 本文件不产生文案，也不决定长什么样——布局、字号、颜色、进度条全由对方在树里声明。校验不在这里：
 * 解析层（parseCustomNode）已把 tag、样式与容量裁过一遍，到这里的数据视为可信，渲染器不再过滤。
 *
 * @module dsh-pet/src/shared/balance/handlers/custom
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.customHandler = void 0;
/** custom 形态的展示规则：只有百分比与节点树有值，行数据一律为空。 */
exports.customHandler = {
    /** 百分比由第三方直接给（他才知道自己那套额度的分母）；没给则不播档位动画 */
    percent: (v) => v.custom?.percent,
    /** 行数据是内置形态的展示语言，custom 不参与，返回空数组兜底而不是错乱的行 */
    rows: () => [],
    detail: () => [],
    views: (v) => v.custom?.views,
};

},
"src/shared/balance/handlers/index.ts": function(exports, require) {
"use strict";
/**
 * 形态到展示规则的分发表，也是余额展示按形态分发的唯一入口。
 *
 * 刻意写成 `Record<BalanceShape, ShapeHandler>` 而不是若干 if/switch：给 BalanceShape 加形态却
 * 忘了补 handler 时，类型检查会直接报缺少属性，而不是静默走进别的分支。
 *
 * @module dsh-pet/src/shared/balance/handlers/index
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.HANDLERS = void 0;
const custom_ts_1 = require("src/shared/balance/handlers/custom.ts");
const money_ts_1 = require("src/shared/balance/handlers/money.ts");
const points_ts_1 = require("src/shared/balance/handlers/points.ts");
const windows_ts_1 = require("src/shared/balance/handlers/windows.ts");
/** 每种形态的展示规则；新增形态必须在此补齐，否则类型检查报错。 */
exports.HANDLERS = {
    windows: windows_ts_1.windowsHandler,
    money: money_ts_1.moneyHandler,
    points: points_ts_1.pointsHandler,
    custom: custom_ts_1.customHandler,
};

},
"src/shared/balance/handlers/money.ts": function(exports, require) {
"use strict";
/**
 * money 形态：账户金额的已用百分比与气泡文案。
 *
 * 不同币种不能相加金额，但比例是无量纲的，所以不需要汇率——各币种按自己的基准算剩余比例后叠加。
 *
 * @module dsh-pet/src/shared/balance/handlers/money
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.moneyHandler = void 0;
/**
 * 各币种按自己的基准算剩余比例，相加后折算成已用百分比。
 *
 * 没有基准的币种跳过，不替它猜一个；一个带基准的币种都没有则返回 undefined，不播档位动画。
 */
function moneyPercent(v) {
    let remaining = 0;
    let based = 0;
    for (const w of v.wallets ?? []) {
        const total = Number(w.total);
        const full = Number(w.fullBalance);
        if (!Number.isFinite(total) || !Number.isFinite(full) || full <= 0)
            continue;
        remaining += total / full; // 负数（透支）会拉低剩余量，最终被夹到「已用完」
        based++;
    }
    if (based === 0)
        return undefined;
    return Math.max(0, Math.min(100, 100 - remaining * 100));
}
/**
 * 一行「余额（峰/谷）¥x.xx」。
 *
 * 只显示 total 非 0 的币种：负数要显示（透支是真的欠钱），正好 0 的不占地方；CNY 优先，
 * 用符号拼接、以「/」分隔；全为 0 时兜底 ¥0.00，否则气泡会空一行。档位装饰只有提供该计价
 * 规则的服务商才有，没有就不加括号那一段。
 */
function moneyRows(v) {
    const visible = (v.wallets ?? [])
        .filter((w) => Number(w.total) !== 0)
        .sort((a, b) => (a.currency === 'CNY' ? 0 : 1) - (b.currency === 'CNY' ? 0 : 1));
    const amount = visible.length > 0 ? visible.map((w) => (w.currency === 'USD' ? '$' : '¥') + w.total).join('/') : '¥0.00';
    if (!v.tier)
        return [{ role: 'label', text: '余额 ' + amount }];
    return [
        { role: 'label', text: '余额（' },
        { role: 'tier', tier: v.tier, text: v.tier === 'peak' ? '峰' : '谷' },
        { role: 'label', text: '）' + amount },
    ];
}
/** money 形态的展示规则：百分比按币种基准折算，收成一行业务气泡。 */
exports.moneyHandler = {
    percent: moneyPercent,
    rows: moneyRows,
};

},
"src/shared/balance/handlers/points.ts": function(exports, require) {
"use strict";
/**
 * points 形态：积分或点数余额（非货币）的已用百分比与气泡文案。
 *
 * 与 money 的区别只在语义：单位是数据带出的后缀，绝不套货币符号；数学是同一套，单位在比值里
 * 被约掉，同样没有汇率问题。
 *
 * @module dsh-pet/src/shared/balance/handlers/points
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.pointsHandler = void 0;
/**
 * 与 money 同一套「按基准折算」的数学，数据来自 points 而非 wallets。
 *
 * 没有基准或基准非法则返回 undefined，不播档位动画，也不替服务商猜一个。
 */
function pointsPercent(v) {
    const total = Number(v.points?.total);
    const full = Number(v.points?.full);
    if (!Number.isFinite(total) || !Number.isFinite(full) || full <= 0)
        return undefined;
    return Math.max(0, Math.min(100, 100 - (total / full) * 100));
}
/**
 * 一行「余额 800 积分」。
 *
 * 单位是数据带出的后缀，绝不套货币符号——$/¥ 那套判断只属于 money；0 也照常显示，0 积分是真实读数。
 */
function pointsRows(v) {
    const p = v.points;
    if (!p)
        return [{ role: 'label', text: '积分数据不可用' }];
    return [{ role: 'label', text: '余额 ' + p.total + ' ' + p.unit }];
}
/** points 形态的展示规则：百分比按积分基准折算，气泡只拼数字与单位。 */
exports.pointsHandler = {
    percent: pointsPercent,
    rows: pointsRows,
};

},
"src/shared/balance/handlers/shape.ts": function(exports, require) {
"use strict";
/**
 * 一种展示形态需要提供的展示规则，由 handlers/index.ts 装配成 `Record<BalanceShape, ShapeHandler>`。
 *
 * 拆成 percent、rows、detail 与 views，是为了让一个形态的全部展示知识待在一个文件里：
 * 加形态只需写一个新 handler，不必在主流程里插分支。
 *
 * @module dsh-pet/src/shared/balance/handlers/shape
 */
Object.defineProperty(exports, "__esModule", { value: true });

},
"src/shared/balance/handlers/windows.ts": function(exports, require) {
"use strict";
/**
 * windows 形态：三窗口用量的百分比口径、气泡文案与最紧迫窗口判定。
 *
 * 与服务商无关——各窗口满额度与滚动窗时长都由数据带出，这里不写死任何服务商的额度。
 *
 * @module dsh-pet/src/shared/balance/handlers/windows
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.windowsHandler = exports.DEFAULT_ROLLING_LABEL = exports.WINDOW_LABELS = void 0;
exports.urgentWindow = urgentWindow;
exports.resetInText = resetInText;
const tone_ts_1 = require("src/shared/balance/tone.ts");
/**
 * 周与月的窗口展示名，供气泡与联想框文案使用。
 *
 * 滚动窗的时长是服务商自己的业务事实（如 5 小时），不走这张表，见 DEFAULT_ROLLING_LABEL。
 */
exports.WINDOW_LABELS = {
    weekly: '周',
    monthly: '月',
};
/**
 * 滚动窗展示名的兜底，服务商应随数据带 rollingLabel，缺省时才用它。
 *
 * 缺一个标签会让气泡出现空档，而 5h 是当前两个滚动窗口服务商的共同取值。
 */
exports.DEFAULT_ROLLING_LABEL = '5h';
/** 取窗口展示名：滚动窗用服务商自报值，周与月走固定表 */
function windowLabel(v, w) {
    if (w === 'rolling')
        return v.rollingLabel ?? exports.DEFAULT_ROLLING_LABEL;
    return exports.WINDOW_LABELS[w];
}
/** 各窗口的满额度，全部来自数据 */
function windowQuotas(v) {
    return { rolling: v.rollingCapUsd, weekly: v.weeklyCapUsd, monthly: v.monthlyCapUsd };
}
/**
 * 取最先告急的一个窗口，所有 windows 形态的服务商共用同一套判定。
 *
 * 满额度齐全时按绝对口径比剩余额度（USD）；有窗口给不出满额度时退化为比已用百分比——
 * 两窗额度量级不同，缺一个还硬比绝对剩余会反直觉。不存在的窗口直接跳过，不补 0。
 *
 * 绝对口径的副作用是滚动窗通常先报（额度最小），这一行为刻意保留，两端一致。
 */
function urgentWindow(v) {
    // 只有 windows 形态有「窗口」概念：money（账户余额）与 points（积分）都没有可告急的窗口
    if (v.shape !== 'windows')
        return undefined;
    const quotas = windowQuotas(v);
    const resets = {
        rolling: v.rollingResetsAt,
        weekly: v.weeklyResetsAt,
        monthly: v.monthlyResetsAt,
    };
    const present = ['rolling', 'weekly', 'monthly'].filter((w) => v[w] !== undefined);
    if (present.length === 0)
        return undefined;
    const allQuotas = present.every((w) => {
        const quota = quotas[w];
        return quota !== undefined && quota > 0;
    });
    let best;
    for (const w of present) {
        const percent = v[w] ?? 0;
        const quota = quotas[w];
        const cand = {
            label: windowLabel(v, w),
            percent,
            quotaUsd: quota,
            remainingUsd: allQuotas && quota !== undefined ? (quota * (100 - percent)) / 100 : undefined,
            resetsAt: resets[w],
        };
        if (best === undefined) {
            best = cand;
            continue;
        }
        const moreUrgent = allQuotas ? (cand.remainingUsd ?? 0) < (best.remainingUsd ?? 0) : cand.percent > best.percent;
        if (moreUrgent)
            best = cand;
    }
    return best;
}
/**
 * 把重置时间转成一句相对文案，保留一位小数。
 *
 * 四天及以上报「N.x 天」，不足四天报「N.x 小时」；已过重置点报「已重置」，时间未知返回空串。
 */
function resetInText(iso) {
    if (!iso)
        return '';
    const t = new Date(iso).getTime();
    if (!Number.isFinite(t))
        return '';
    const delta = t - Date.now();
    if (delta <= 0)
        return '已重置';
    const hoursF = delta / 3_600_000;
    if (hoursF >= 96)
        return (Math.round((hoursF / 24) * 10) / 10).toFixed(1) + ' 天';
    return Math.max(0.1, Math.round(hoursF * 10) / 10).toFixed(1) + ' 小时';
}
/** 三窗口取最大值，只有月窗口时就是它本身 */
function windowsPercent(v) {
    return Math.max(v.rolling ?? 0, v.weekly ?? 0, v.monthly ?? 0);
}
/** 把 resetInText 的三种返回翻成一句提示：空串 = 时间未知，'已重置' = 已经过点，其余 = 倒计时。 */
function resetPhrase(reset) {
    if (reset === '')
        return '重置时间未知';
    return reset === '已重置' ? reset : reset + '重置';
}
/** 两行：最紧迫窗口的已用百分比与重置倒计时 */
function windowsRows(v) {
    const w = urgentWindow(v);
    if (!w)
        return [{ role: 'label', text: '额度数据不可用' }];
    const reset = resetInText(w.resetsAt);
    return [
        { role: 'label', text: w.label + '额度已用 ' + Math.round(w.percent) + '%' },
        { role: 'sub', text: resetPhrase(reset) },
    ];
}
/**
 * 展开态每个存在的窗口一行：窗口名、进度条、已用百分比与重置倒计时。
 *
 * 只列存在的窗口，rolling 与 weekly 缺省表示该服务商没有这个窗口，不补 0、不画空条。
 */
function windowsDetail(v) {
    const resets = {
        rolling: v.rollingResetsAt,
        weekly: v.weeklyResetsAt,
        monthly: v.monthlyResetsAt,
    };
    const rows = [];
    for (const w of ['rolling', 'weekly', 'monthly']) {
        const percent = v[w];
        if (percent === undefined)
            continue;
        // 与收起态同一套重置文案，两端原样渲染。
        const reset = resetInText(resets[w]);
        const usedText = Math.round(percent) + '%';
        const resetText = resetPhrase(reset);
        rows.push({
            role: 'quota',
            text: windowLabel(v, w) + ' ' + usedText + ' ' + resetText,
            label: windowLabel(v, w),
            percent,
            tone: (0, tone_ts_1.quotaTone)(percent),
            usedText,
            resetText,
        });
    }
    return rows.length > 0 ? rows : windowsRows(v);
}
/** 紧凑计数：1.2B / 96.0M / 478.3K，千以下取整。固定一位小数——同一页三个数字宽度稳定，不随取值跳动。 */
function compactCount(n) {
    if (n >= 1e9)
        return (n / 1e9).toFixed(1) + 'B';
    if (n >= 1e6)
        return (n / 1e6).toFixed(1) + 'M';
    if (n >= 1e3)
        return (n / 1e3).toFixed(1) + 'K';
    return String(Math.round(n));
}
/**
 * 第三页：本期累计用量。一行 `usage` 承载整张卡，两端摆成三行两列——
 * 「Token / 总量」「输入 / 输出」「本期请求数 / 花费」，总量是唯一的大字。
 *
 * 服务商没给这项数据时返回 undefined，由页数判定决定气泡只有两页；给的一半数字不会被拼进来。
 */
function windowsUsage(v) {
    const u = v.usage;
    if (!u)
        return undefined;
    const total = compactCount(u.totalTokens);
    const input = compactCount(u.inputTokens) + ' 入';
    const output = compactCount(u.outputTokens) + ' 出';
    const period = '本期 ' + u.requests + ' 次';
    const spend = '$' + u.spentUsd.toFixed(2);
    // 比例条用真实占比：输入通常占绝对多数，条看起来几乎单色是事实，不做最小宽度放大。
    const sum = u.inputTokens + u.outputTokens;
    const inputPercent = sum > 0 ? (u.inputTokens / sum) * 100 : undefined;
    return [
        {
            role: 'usage',
            text: 'Token ' + total + ' · ' + input + ' / ' + output + ' · ' + period + ' · ' + spend,
            title: 'Token',
            total,
            input,
            output,
            period,
            spend,
            inputPercent,
        },
    ];
}
/** windows 形态的展示规则：百分比取三窗口最大，展开态逐窗口一行，有用量时多一页。 */
exports.windowsHandler = {
    percent: windowsPercent,
    rows: windowsRows,
    detail: windowsDetail,
    usage: windowsUsage,
};

},
"src/shared/balance/index.ts": function(exports, require) {
"use strict";
/**
 * 余额的共享纯逻辑层入口：解析 /state 里的余额叶子、生成气泡行数据、算宠物档位。
 *
 * 不负责取数——余额由 host 定时刷新并写入 /state（两端共享同一份结果），也不依赖 React 与 DOM。
 * 必须始终成立：不认识任何具体服务商，解析失败返回 null 而不抛异常（1s 轮询里抛一次会打断整拍）。
 *
 * @module dsh-pet/src/shared/balance/index
 */
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __exportStar = (this && this.__exportStar) || function(m, exports) {
    for (var p in m) if (p !== "default" && !Object.prototype.hasOwnProperty.call(exports, p)) __createBinding(exports, m, p);
};
Object.defineProperty(exports, "__esModule", { value: true });
__exportStar(require("src/shared/balance/types.ts"), exports);
__exportStar(require("src/shared/balance/tone.ts"), exports);
__exportStar(require("src/shared/balance/parse.ts"), exports);
__exportStar(require("src/shared/balance/percent.ts"), exports);
__exportStar(require("src/shared/balance/view.ts"), exports);
__exportStar(require("src/shared/balance/notice.ts"), exports);
// 形态展示规则与公共窗口工具。
__exportStar(require("src/shared/balance/handlers/index.ts"), exports);
__exportStar(require("src/shared/balance/handlers/windows.ts"), exports);

},
"src/shared/balance/notice.ts": function(exports, require) {
"use strict";
/**
 * 余额不可用时「要不要弹文字说明」的判定。
 *
 * 判定本身无状态：只比对传入的 lastKey，调用方负责保存返回的 key。
 * 两端（浏览器 overlay 与桌面外壳）必须走同一份判定，各写一份必然漂移。
 *
 * @module dsh-pet/src/shared/balance/notice
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.decideBalanceNotice = decideBalanceNotice;
/**
 * 判定本次是否弹气泡，并给出供下次比较的原因 key。
 *
 * 显式请求（`/balance` 命令、桌面「查看余额」菜单）一律弹：用户问了就该有答复，包括「不支持」这件事；
 * 自动轮询只在原因（含服务商）变化时弹一次，首次检测到也算变化，否则每 30 分钟刷同一句话。
 *
 * @param state - 当前余额状态；只读，本函数不修改它。
 * @param lastKey - 上次提示的原因 key，null 表示尚未提示过。
 * @param explicit - 是否由用户显式请求触发。
 * @returns 是否弹，以及本次要存下的 key（ok 状态为 null）。
 */
function decideBalanceNotice(state, lastKey, explicit) {
    if (state.ok)
        return { show: false, key: null };
    const key = state.reason + ':' + state.provider;
    return { show: explicit || key !== lastKey, key };
}

},
"src/shared/balance/parse.ts": function(exports, require) {
"use strict";
/**
 * 解析层：把 host 写进 /state 叶子的原始响应裁成客户端视图。
 *
 * 白名单透传——字段逐个挑选，没写进来的静默丢弃（新增字段必须在这里补上）；形状不认识或字段
 * 非法返回 null，让调用方跳过这一拍。绝不抛异常：1s 轮询里抛一次会打断整拍，其余叶子也不渲染。
 *
 * @module dsh-pet/src/shared/balance/parse
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.CUSTOM_LIMITS = exports.CUSTOM_STYLE_KEYS = exports.CUSTOM_TAGS = void 0;
exports.toBalanceState = toBalanceState;
// 自定义气泡节点树的白名单：第三方交来的树是外部输入，解析层负责裁进「一个气泡能画出来」的
// 范围，渲染器只画不再校验。
/** 合法 tag：只开放排版布局需要的几个；`script`、`style`、`iframe`、`svg` 之类一律不认，非法 tag 整树作废。 */
exports.CUSTOM_TAGS = ['div', 'span', 'i', 'b', 'strong', 'em', 'img'];
/**
 * 合法内联样式键（camelCase，与 React style 对象同形）：覆盖 flex 布局、盒模型、文字、圆角与背景。
 *
 * 刻意不含 position、zIndex、transform 与 inset：气泡悬在宠物头顶，那几样会让内容跑出气泡、
 * 盖住宠物本体或宿主页面。
 */
exports.CUSTOM_STYLE_KEYS = new Set([
    'display',
    'flex',
    'flexDirection',
    'flexWrap',
    'alignItems',
    'justifyContent',
    'gap',
    'margin',
    'marginTop',
    'marginRight',
    'marginBottom',
    'marginLeft',
    'padding',
    'paddingTop',
    'paddingRight',
    'paddingBottom',
    'paddingLeft',
    'width',
    'height',
    'minWidth',
    'maxWidth',
    'minHeight',
    'maxHeight',
    'color',
    'fontSize',
    'fontWeight',
    'fontStyle',
    'lineHeight',
    'letterSpacing',
    'textAlign',
    'textDecoration',
    'whiteSpace',
    'verticalAlign',
    'fontVariantNumeric',
    'background',
    'backgroundColor',
    'border',
    'borderTop',
    'borderBottom',
    'borderLeft',
    'borderRight',
    'borderRadius',
    'overflow',
    'opacity',
]);
/** 样式值里一律禁止的片段：外部资源、表达式、注释截断。要图请用 `img` 节点（地址另有限制）。 */
const BANNED_STYLE_VALUE = /url\(|expression|javascript:|vbscript:|@import|\\|\/\*/i;
/**
 * 节点树的容量上限：气泡宽度只有约 155px，且悬在宠物头顶。
 *
 * 超限分两种处理：文本截断（内容还能看）与整树作废（少画一块会得到一棵骗人的树，不如这一拍不显示）。
 */
exports.CUSTOM_LIMITS = {
    /** 深度上限，根为 0，超出整树作废 */
    maxDepth: 6,
    /** 全树节点数上限，超出整树作废 */
    maxNodes: 200,
    /** 单节点子节点数上限，超出整树作废 */
    maxChildren: 24,
    /** 单段文本上限，超出截断 */
    maxText: 120,
    /** 单条样式值上限，超出只丢该属性 */
    maxStyleValue: 64,
    /** img 地址上限，含 scheme */
    maxSrc: 512,
    /** 多页页数上限：页多了点不过来，也容易撑破气泡容量 */
    maxViews: 4,
};
/**
 * 递归解析并校验一个节点，把外部输入转成视图树。
 *
 * 任一节点不合法即整树返回 null：部分渲染会得到一棵缺了一块的气泡，比这一拍不显示更误导人；
 * 单个样式属性非法只丢那一条，不值得为此整树作废。
 *
 * @param raw - 外部节点；类型未知，逐层校验后才进入视图树。
 * @param depth - 当前深度，根为 0。
 * @param budget - 全树节点计数，跨递归共享。
 * @returns 合法节点；不合法返回 null，调用方据此跳过这一拍。
 */
function parseCustomNode(raw, depth, budget) {
    if (!raw || typeof raw !== 'object')
        return null;
    if (depth >= exports.CUSTOM_LIMITS.maxDepth)
        return null;
    budget.nodes += 1;
    if (budget.nodes > exports.CUSTOM_LIMITS.maxNodes)
        return null;
    const n = raw;
    const tag = typeof n.tag === 'string' ? n.tag : '';
    if (!exports.CUSTOM_TAGS.includes(tag))
        return null;
    const node = { tag: tag };
    // 文本超长截断而不作废：第三方写得长很常见，截断后气泡仍然可读。
    if (typeof n.text === 'string' && n.text.length > 0)
        node.text = n.text.slice(0, exports.CUSTOM_LIMITS.maxText);
    // img 地址只认 http 与 https：`file:` 会让渲染进程读到本地任意文件。
    if (tag === 'img') {
        const src = typeof n.src === 'string' ? n.src.trim() : '';
        if (!/^https?:\/\//i.test(src) || src.length > exports.CUSTOM_LIMITS.maxSrc)
            return null;
        node.src = src;
    }
    // 样式键走白名单，值逐条过滤：超长、含外部资源引用或为空只丢这一条。
    if (n.style && typeof n.style === 'object' && !Array.isArray(n.style)) {
        const style = {};
        for (const [k, v] of Object.entries(n.style)) {
            if (!exports.CUSTOM_STYLE_KEYS.has(k))
                continue;
            if (typeof v !== 'string')
                continue;
            const value = v.trim();
            if (value === '' || value.length > exports.CUSTOM_LIMITS.maxStyleValue)
                continue;
            if (BANNED_STYLE_VALUE.test(value))
                continue;
            style[k] = value;
        }
        if (Object.keys(style).length > 0)
            node.style = style;
    }
    if (Array.isArray(n.children)) {
        if (n.children.length > exports.CUSTOM_LIMITS.maxChildren)
            return null;
        const children = [];
        for (const child of n.children) {
            const parsed = parseCustomNode(child, depth + 1, budget);
            if (parsed === null)
                return null;
            children.push(parsed);
        }
        if (children.length > 0)
            node.children = children;
    }
    return node;
}
/** 可选数字：缺省返回 undefined，出现但非法返回 null，调用方据此跳过这一拍而不是把坏数字送进展示层。 */
function optNum(value) {
    if (value === undefined || value === null)
        return undefined;
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
}
/**
 * 解析区间累计用量：缺省返回 undefined（服务商没有这项数据），出现但不完整或非法返回 null。
 *
 * 五个数字缺一不可——少一个就拼不出一页可信的用量，宁可这一拍整片不显示，也不拿 0 顶替。
 */
function parseUsage(raw) {
    if (raw === undefined)
        return undefined;
    if (!raw || typeof raw !== 'object')
        return null;
    const u = raw;
    const fields = [u.totalTokens, u.inputTokens, u.outputTokens, u.requests, u.spentUsd].map(optNum);
    if (fields.some((n) => typeof n !== 'number'))
        return null;
    const [totalTokens, inputTokens, outputTokens, requests, spentUsd] = fields;
    return { totalTokens, inputTokens, outputTokens, requests, spentUsd };
}
/**
 * 把 host 的余额原始响应（`sections.balance` 叶子）转成客户端视图。
 *
 * 形状非法或 shape 不认识返回 null，消费端据此跳过这一拍；这里不抛异常，理由见模块头。
 * 取数失败不在这里发生：host 取数失败会以 `ok:false` 写进状态，这里正常映射成不可用视图。
 */
function toBalanceState(raw) {
    if (!raw || typeof raw !== 'object')
        return null;
    const r = raw;
    const provider = String(r.provider ?? 'unknown');
    if (r.ok !== true) {
        const reason = r.reason === 'unsupported' || r.reason === 'credential-missing' || r.reason === 'fetch-error'
            ? r.reason
            : 'fetch-error';
        return { provider, ok: false, reason, message: typeof r.message === 'string' ? r.message : undefined };
    }
    const d = r.data;
    if (!d || typeof d !== 'object')
        return null;
    if (r.shape === 'windows') {
        const monthly = optNum(d.monthly);
        const rolling = optNum(d.rolling);
        const weekly = optNum(d.weekly);
        const rollingCapUsd = optNum(d.rollingCapUsd);
        const weeklyCapUsd = optNum(d.weeklyCapUsd);
        const monthlyCapUsd = optNum(d.monthlyCapUsd);
        const usage = parseUsage(d.usage);
        // 月度窗口是这份数据的底线：缺了或非法即认不出响应，滚动窗、周窗口与各窗口额度都是可选。
        if (monthly === undefined || monthly === null)
            return null;
        // 可选窗口出现但非法，同样整拍跳过：不把坏数字送进展示层。
        if (rolling === null ||
            weekly === null ||
            rollingCapUsd === null ||
            weeklyCapUsd === null ||
            monthlyCapUsd === null ||
            usage === null) {
            return null;
        }
        return {
            provider,
            shape: 'windows',
            ok: true,
            rolling,
            weekly,
            monthly,
            rollingCapUsd,
            weeklyCapUsd,
            monthlyCapUsd,
            // 没有用量就不带这个键：页数由「键在不在」判定，写 undefined 会让消费方两种写法都判一次。
            ...(usage ? { usage } : {}),
            rollingLabel: typeof d.rollingLabel === 'string' && d.rollingLabel.length > 0 ? d.rollingLabel : undefined,
            rollingResetsAt: typeof d.rollingResetsAt === 'string' ? d.rollingResetsAt : undefined,
            weeklyResetsAt: typeof d.weeklyResetsAt === 'string' ? d.weeklyResetsAt : undefined,
            monthlyResetsAt: typeof d.monthlyResetsAt === 'string' ? d.monthlyResetsAt : undefined,
        };
    }
    if (r.shape === 'money') {
        // 多币种：每项必须有 currency 与 total，granted、toppedUp 缺省记 '0.00'（只用于展示分项，
        // 不参与档位），fullBalance 缺省表示该币种没有基准。单条结构不合法就丢掉这一条——少一个
        // 币种比整拍不渲染好。
        const raw = Array.isArray(d.wallets) ? d.wallets : [];
        const wallets = [];
        for (const item of raw) {
            if (!item || typeof item !== 'object')
                continue;
            const w = item;
            if (typeof w.currency !== 'string' || w.currency.length === 0)
                continue;
            if (typeof w.total !== 'string' || w.total.length === 0)
                continue;
            wallets.push({
                currency: w.currency,
                total: w.total,
                granted: typeof w.granted === 'string' && w.granted.length > 0 ? w.granted : '0.00',
                toppedUp: typeof w.toppedUp === 'string' && w.toppedUp.length > 0 ? w.toppedUp : '0.00',
                fullBalance: typeof w.fullBalance === 'string' && w.fullBalance.length > 0 ? w.fullBalance : undefined,
            });
        }
        // 一个钱包都没有即认不出响应：host 侧空钱包是按 fetch-error 写的，走到这里说明结构坏了。
        if (wallets.length === 0)
            return null;
        return {
            provider,
            shape: 'money',
            ok: true,
            wallets,
            tier: d.tier === 'peak' || d.tier === 'idle' ? d.tier : undefined,
        };
    }
    if (r.shape === 'points') {
        // unit 与 total 缺一不可：没有单位拼不出「800 积分」，没有数字更无从展示。
        // full 缺省或为空串都表示没有基准，不参与档位折算，与 money 的 fullBalance 同口径。
        if (typeof d.unit !== 'string' || d.unit.length === 0)
            return null;
        if (typeof d.total !== 'string' || d.total.length === 0)
            return null;
        return {
            provider,
            shape: 'points',
            ok: true,
            points: {
                unit: d.unit,
                total: d.total,
                full: typeof d.full === 'string' && d.full.length > 0 ? d.full : undefined,
            },
        };
    }
    if (r.shape === 'custom') {
        // 两种写法归一：views 多页优先，rows 加可选 detailRows 是老两页写法；两种都给时以 views 为准，
        // 别让新旧混用变成整拍失败。
        let views = [];
        if (Array.isArray(d.views) && d.views.length > 0) {
            if (d.views.length > exports.CUSTOM_LIMITS.maxViews)
                return null;
            for (const raw of d.views) {
                const page = parseCustomNode(raw, 0, { nodes: 0 });
                // 任一页非法即整拍跳过：不做「前几页正常、翻到后面崩」的半坏状态。
                if (!page)
                    return null;
                views.push(page);
            }
        }
        else {
            const rows = parseCustomNode(d.rows, 0, { nodes: 0 });
            if (!rows)
                return null;
            views = [rows];
            if (d.detailRows !== undefined) {
                const detail = parseCustomNode(d.detailRows, 0, { nodes: 0 });
                // 给了却非法同样整拍跳过：静默丢掉「可切页」会让第三方以为点了有效果。
                if (!detail)
                    return null;
                views.push(detail);
            }
        }
        // 百分比夹到 0 至 100：越界是数据错误，不代表耗尽或未消耗；非法值则不播档位动画。
        const pct = typeof d.percent === 'number' && Number.isFinite(d.percent) ? Math.max(0, Math.min(100, d.percent)) : undefined;
        return { provider, shape: 'custom', ok: true, custom: { views, percent: pct } };
    }
    return null;
}

},
"src/shared/balance/percent.ts": function(exports, require) {
"use strict";
/**
 * 档位百分比入口与档位索引：宠物动画的驱动依据。
 *
 * 百分比口径按形态分派给各自的 handler（windows 取三窗口最大，money 与 points 按基准折算），
 * 这里只保留入口与服务商无关的档位切分。
 *
 * @module dsh-pet/src/shared/balance/percent
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.balancePercent = balancePercent;
exports.balanceEventIndex = balanceEventIndex;
const index_ts_1 = require("src/shared/balance/handlers/index.ts");
/**
 * 取已用百分比（0 = 未消耗，100 = 耗尽）；给不出百分比语义的形态返回 undefined，不替服务商猜一个。
 *
 * 具体口径见各 handler：windows 取三窗口最大，money 按各币种自己的基准折算后叠加（不需要汇率），
 * points 按同一单位内的比值折算。
 */
function balancePercent(v) {
    return index_ts_1.HANDLERS[v.shape].percent(v);
}
/**
 * 已用百分比对应的档位索引：20% 一档，仅恰好 100% 取最高档 5。
 *
 * 索引与成品配置里的余额档位动画一一对应。
 */
function balanceEventIndex(p) {
    if (p === 100)
        return 5;
    const i = Math.floor(p / 20);
    return i < 5 ? i : 4;
}

},
"src/shared/balance/tone.ts": function(exports, require) {
"use strict";
/**
 * 进度条配色档位：阈值只此一份，两端共用。
 *
 * 独立成叶子模块是为了避开循环依赖——handlers/* 需要 quotaTone，而 view.ts 又要分发到 handlers。
 *
 * @module dsh-pet/src/shared/balance/tone
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.QUOTA_CRIT_PERCENT = exports.QUOTA_WARN_PERCENT = void 0;
exports.quotaTone = quotaTone;
exports.QUOTA_WARN_PERCENT = 70;
exports.QUOTA_CRIT_PERCENT = 90;
/** 按已用百分比取配色档位。 */
function quotaTone(percent) {
    if (percent >= exports.QUOTA_CRIT_PERCENT)
        return 'crit';
    if (percent >= exports.QUOTA_WARN_PERCENT)
        return 'warn';
    return 'ok';
}

},
"src/shared/balance/types.ts": function(exports, require) {
"use strict";
/**
 * 余额层的类型定义：wire 入参、已解析视图、气泡行数据与自定义节点树。
 *
 * 纯类型文件，唯一的导入是 `import type`，编译后消失，因此不依赖任何逻辑模块，也不会引入循环依赖。
 *
 * @module dsh-pet/src/shared/balance/types
 */
Object.defineProperty(exports, "__esModule", { value: true });

},
"src/shared/balance/view.ts": function(exports, require) {
"use strict";
/**
 * 气泡行数据的主出口：把余额状态转成气泡行，浏览器与桌面共用同一份内容与文案。
 *
 * 纯函数，不碰 DOM 与 React；形态相关的文案也不在这里，本模块只负责不可用状态的说明行，
 * 其余按形态查分发表。必须始终成立：不可用时绝不伪造数字。
 *
 * @module dsh-pet/src/shared/balance/view
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.balanceBubbleView = balanceBubbleView;
exports.balanceDetailView = balanceDetailView;
exports.balancePageCount = balancePageCount;
exports.balancePageView = balancePageView;
exports.customViews = customViews;
exports.customClickable = customClickable;
const index_ts_1 = require("src/shared/balance/handlers/index.ts");
/**
 * 不可用状态的气泡行：显式给出原因，绝不伪造数字。
 *
 * 次要行为空的会被剔除——空 div 在气泡里会白占一行高度。
 */
function unavailableRows(state) {
    const rows = state.reason === 'unsupported'
        ? [
            { role: 'error', text: '当前服务商暂不支持余额查询' },
            { role: 'sub', text: '当前服务商：' + state.provider },
        ]
        : state.reason === 'credential-missing'
            ? [
                // host 的 message 已自带「缺少凭证 X」前缀，这里原样展示，不再加前缀。
                { role: 'error', text: '缺少余额查询凭证' },
                { role: 'sub', text: state.message ?? '' },
            ]
            : [
                { role: 'error', text: '余额查询失败' },
                { role: 'sub', text: state.message ?? '' },
            ];
    return rows.filter((r) => r.role !== 'quota' && r.text !== '');
}
/**
 * 把余额状态渲染成气泡行数据。
 *
 * 形态文案由各 handler 提供；custom 形态返回空数组——它走节点树这条并行通道（见下方 customViews），
 * 空数组只在误用行数据时兜底成空气泡。不可用时显式展示原因，绝不伪造数字。
 */
function balanceBubbleView(state) {
    if (!state.ok)
        return unavailableRows(state);
    return index_ts_1.HANDLERS[state.shape].rows(state);
}
/**
 * 展开态的气泡行，点开余额气泡后显示。
 *
 * 只有 windows 有三窗口读数可展开，每个存在的窗口一行；money 与 points 没有窗口概念，
 * 回落到收起态视图，避免点了一下却什么都没变的空交互。
 */
function balanceDetailView(state) {
    if (!state.ok)
        return unavailableRows(state);
    const handler = index_ts_1.HANDLERS[state.shape];
    return handler.detail ? handler.detail(state) : handler.rows(state);
}
/**
 * 余额气泡的可翻页数：不可用只有一页说明；windows 至少两页（收起态 + 窗口明细），
 * 服务商给了区间用量就多一页；custom 以节点树页数为准，其余形态点开没有新内容。
 *
 * 页数与 {@link balancePageView} 必须同源：两边各判一次就会翻出一页空白。
 */
function balancePageCount(state) {
    if (!state.ok)
        return 1;
    if (state.shape === 'custom')
        return Math.max(1, customViews(state)?.length ?? 1);
    if (state.shape !== 'windows')
        return 1;
    return state.usage ? 3 : 2;
}
/**
 * 指定页的气泡行数据：windows 下 0 为收起态、1 为窗口明细、2 为区间用量。
 *
 * 越界页回落到最后一页有内容的页，不返回空数组——空白气泡比停在前一页更像坏了。
 */
function balancePageView(state, page) {
    if (!state.ok)
        return unavailableRows(state);
    const handler = index_ts_1.HANDLERS[state.shape];
    if (state.shape !== 'windows' || page <= 0)
        return handler.rows(state);
    if (page === 1 || !state.usage)
        return balanceDetailView(state);
    return handler.usage?.(state) ?? balanceDetailView(state);
}
// 自定义气泡（custom 形态）走节点树这条并行通道：行数据由插件定好长什么样，只填文案；
// 节点树把布局本身交给第三方。两种通道按 shape 互斥，两端渲染入口各判一次即可，其余展示逻辑共用。
/**
 * 多页节点树：只对 custom 形态有值，其余形态返回 undefined，调用方据此回落行数据。
 * 第一项是初始页；多于一项时气泡可点，点一下切下一页，末页回第一页。
 */
function customViews(state) {
    if (!state.ok || state.shape !== 'custom')
        return undefined;
    const views = index_ts_1.HANDLERS[state.shape].views?.(state);
    return views && views.length > 0 ? views : undefined;
}
/**
 * custom 气泡是否可点切页，两端据此决定气泡可不可点。
 *
 * 只有一页时点开也没有别的内容，保持不可点，气泡继续不挡页面。
 */
function customClickable(state) {
    return (customViews(state)?.length ?? 0) > 1;
}

},
"src/shared/bubble-hold.ts": function(exports, require) {
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.BUBBLE_HOLD_IDLE = exports.BUBBLE_HOLD_MAX_MS = exports.BUBBLE_HOLD_TAIL_MS = void 0;
exports.utteranceToHold = utteranceToHold;
exports.reduceBubbleHold = reduceBubbleHold;
/** 播完（或失败）后再留这么久，让人看完最后一个字（ms）。 */
exports.BUBBLE_HOLD_TAIL_MS = 1_500;
/**
 * 一句播报最多把气泡挂多久（ms）。
 *
 * 口径是「合成超时 + 截断后可念的最长语音 + 尾巴」再留余量：超过它说明语音那条线
 * 已经断了，气泡不能跟着一起挂死。
 */
exports.BUBBLE_HOLD_MAX_MS = 50_000;
/**
 * 把一句播报的开始/结束翻成气泡的挂起/收尾。
 *
 * 两端同用这一份：订阅者拿到的是 voice 的 `start`/`end`，而状态机只认 `hold`/`release`。
 * 少翻一次就会静默落空——事件走不到 `hold`，气泡按 `show` 自己的时长收起；桌面端是纯 JS，
 * 传错形状不会有任何类型报错，所以这条链路只能靠共用同一份实现来保证两端不漂移。
 *
 * @param event - 播报的开始或结束事件。
 * @returns 对应的收起计划事件。
 */
function utteranceToHold(event) {
    return { kind: event.kind === 'start' ? 'hold' : 'release', seq: event.seq };
}
/** 收起状态的初值；两端都从这里开始。 */
exports.BUBBLE_HOLD_IDLE = { on: false, delayMs: null, holdSeq: null };
/**
 * 推进一步。
 *
 * 气泡没点亮时 `hold` 与 `release` 一律忽略：那说明这一句没有气泡可挂
 * （`duration: 0` 或已经被清空），让它们点亮气泡会凭空多出一个泡。
 *
 * @param state - 当前状态。
 * @param event - 这一次发生了什么。
 * @returns 新状态；无事发生时返回同一引用，调用方据此跳过重排计时器。
 */
function reduceBubbleHold(state, event) {
    if (event.kind === 'show')
        return { delayMs: Math.max(0, event.durationMs), holdSeq: null, on: true };
    if (event.kind === 'clear')
        return exports.BUBBLE_HOLD_IDLE;
    if (event.kind === 'hide')
        return state.on ? exports.BUBBLE_HOLD_IDLE : state;
    if (!state.on)
        return state;
    if (event.kind === 'hold') {
        if (state.holdSeq === event.seq)
            return state; // 同一句重复通知：不重置上限
        return { delayMs: exports.BUBBLE_HOLD_MAX_MS, holdSeq: event.seq, on: true };
    }
    // release 只认当前这句：上一句迟到的收尾不能把这一句的等待提前结束。
    if (state.holdSeq !== event.seq)
        return state;
    return { delayMs: exports.BUBBLE_HOLD_TAIL_MS, holdSeq: null, on: true };
}

},
"src/shared/chat/capture.ts": function(exports, require) {
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.captureDisplayFrame = captureDisplayFrame;
/**
 * 浏览器侧截屏：抓一帧桌面，立刻停流，再交给同一套预算编码。
 *
 * 只抓一帧、不保留流；用户取消选择或页面策略禁止 display-capture 时抛错，
 * 由弹窗把原因显示出来（浏览器不允许时只能改用上传）。
 * @module dsh-pet/src/shared/chat/capture
 */
const encode_ts_1 = require("src/shared/chat/encode.ts");
/** 等到视频真正有尺寸。 */
function waitForFrame(video) {
    if (video.videoWidth > 0)
        return Promise.resolve();
    return new Promise((resolve) => {
        video.onloadeddata = () => resolve();
    });
}
/**
 * 截取当前屏幕的一帧。
 *
 * @returns 已压进预算的图片。
 * @throws 环境不支持、用户取消或页面策略禁止 display-capture 时。
 */
async function captureDisplayFrame() {
    const media = navigator.mediaDevices;
    if (!media || typeof media.getDisplayMedia !== 'function')
        throw new Error('当前环境不支持截屏');
    const stream = await media.getDisplayMedia({ video: true, audio: false });
    try {
        const video = document.createElement('video');
        video.srcObject = stream;
        video.muted = true;
        await video.play();
        await waitForFrame(video);
        const canvas = document.createElement('canvas');
        canvas.width = video.videoWidth || 1280;
        canvas.height = video.videoHeight || 720;
        canvas.getContext('2d')?.drawImage(video, 0, 0, canvas.width, canvas.height);
        return (0, encode_ts_1.encodeCanvas)(canvas);
    }
    finally {
        for (const track of stream.getTracks())
            track.stop();
    }
}

},
"src/shared/chat/dialog.ts": function(exports, require) {
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.mountChatDialog = mountChatDialog;
/**
 * 对话输入弹窗的挂载与生命周期：定位、关闭、发送。
 * 两端共用同一份实现；它只经注入的 baseUrl/surface 说话，不读配置、不读写记忆。
 * 回复不经响应回传展示：POST 的响应里也有正文，但本组件不用它——回复统一从 /state 的
 * pets.<id>.say 走气泡展示，onSent 只用来催促调用方取一拍。
 * @module dsh-pet/src/shared/chat/dialog
 */
const constants_ts_1 = require("src/shared/constants.ts");
const dom_ts_1 = require("src/shared/chat/dom.ts");
const enter_ts_1 = require("src/shared/chat/enter.ts");
const send_ts_1 = require("src/shared/chat/send.ts");
const styles_ts_1 = require("src/shared/chat/styles.ts");
/** 点弹窗外或按 Esc 关闭；返回解绑函数。 */
function bindDismiss(root, isClosed, onDismiss) {
    const onPointerDown = (e) => {
        if (isClosed() || root.contains(e.target))
            return;
        onDismiss();
    };
    const onKeyDown = (e) => {
        if (e.key === 'Escape')
            onDismiss();
    };
    document.addEventListener('mousedown', onPointerDown, true);
    document.addEventListener('keydown', onKeyDown, true);
    return () => {
        document.removeEventListener('mousedown', onPointerDown, true);
        document.removeEventListener('keydown', onKeyDown, true);
    };
}
/** 回车发送：成功后回调、失败把原因写进 err 行，不伪造回复。 */
function bindSend(binding) {
    let sending = false;
    const doSend = () => {
        if (binding.isClosed() || sending)
            return;
        if (binding.isEncoding()) {
            binding.notify('图片还在处理，稍等一下');
            return;
        }
        const text = binding.input.value.trim();
        if (!text)
            return;
        sending = true;
        binding.input.disabled = true;
        (0, send_ts_1.sendChat)(binding.url, text, binding.attachment())
            .then((state) => {
            if (state.ok)
                binding.onOk();
            else {
                binding.err.textContent = '对话失败：' + (state.message ?? state.reason);
                binding.err.style.display = 'block';
            }
        })
            .catch((e) => {
            binding.err.textContent = '对话异常：' + String(e && e.message ? e.message : e);
            binding.err.style.display = 'block';
        })
            .finally(() => {
            sending = false;
            binding.input.disabled = false;
            if (!binding.isClosed())
                binding.input.focus();
        });
    };
    // 回车要让开输入法：组合中的回车是上屏键，长按重复的回车只该被吞掉、不该插换行
    const ime = (0, enter_ts_1.createCompositionWatch)();
    binding.input.addEventListener('compositionstart', ime.start);
    binding.input.addEventListener('compositionend', () => ime.end(performance.now()));
    binding.input.addEventListener('keydown', (e) => {
        const action = (0, enter_ts_1.decideEnter)(e, ime, performance.now());
        if (action === 'ignore')
            return;
        e.preventDefault();
        if (action === 'send')
            doSend();
    });
}
/**
 * 由对话地址推导识别地址：两端传进来的都是 `.../chat`，去掉尾段换成 `/voice/hear`。
 *
 * @param baseUrl - 已含挂载前缀的对话地址。
 * @returns 同前缀下的识别地址。
 */
function hearUrlOf(baseUrl) {
    return baseUrl.replace(/\/chat$/, '') + '/voice/hear';
}
/** 挂载一个对话输入弹窗（两端共用；位置为视口坐标，超出 clamp 矩形自动夹回）。
 *  输入框 + 上传/截屏两枚图标按钮 + 图片预览（本轮只有界面与本地预览，编码与发送待接入）。
 *  回车即发送：发送成功后弹窗关闭并调 onSent。Esc 或点弹窗外关闭；生成失败留在弹窗内显式提示。
 *  clamp 由调用方给：桌面传「窗口 ∩ 工作区」，宠物贴边时弹窗照样完整显示、窗口零移动。 */
function mountChatDialog(opts) {
    (0, styles_ts_1.injectChatCss)();
    const { petId, surface, x, y, onSent, onClose, clamp } = opts;
    const baseUrl = opts.baseUrl ?? constants_ts_1.ROUTE_PATH + '/chat';
    // `surface` 必填（宿主校验）；这个 URL 只用于 POST 发送——GET 读记忆那条路不需要它
    const withPet = baseUrl + '?pet=' + encodeURIComponent(petId) + '&surface=' + surface;
    const c = clamp && Number.isFinite(clamp.x + clamp.y + clamp.w + clamp.h)
        ? clamp
        : { x: 0, y: 0, w: window.innerWidth, h: window.innerHeight };
    const dom = (0, dom_ts_1.createChatDom)({ capture: opts.capture, hearUrl: opts.hearUrl ?? hearUrlOf(baseUrl) });
    const { root, input, err } = dom;
    /** 以 (x,y) 落点，超出 clamp 矩形夹回。 */
    const place = () => {
        const r = root.getBoundingClientRect();
        root.style.left = Math.max(c.x + 4, Math.min(x, c.x + c.w - r.width - 4)) + 'px';
        root.style.top = Math.max(c.y + 4, Math.min(y, c.y + c.h - r.height - 4)) + 'px';
    };
    let closed = false;
    let unbindDismiss = () => { };
    const close = () => {
        if (closed)
            return;
        closed = true;
        unbindDismiss();
        dom.dispose();
        dom.clearAttach();
        root.remove();
        if (onClose)
            onClose();
    };
    unbindDismiss = bindDismiss(root, () => closed, close);
    bindSend({
        input,
        err,
        url: withPet,
        isClosed: () => closed,
        onOk: () => {
            close();
            if (onSent)
                onSent();
        },
        attachment: () => dom.getAttachment(),
        isEncoding: () => dom.isEncoding(),
        notify: (text) => dom.flash(text),
    });
    // 截屏按钮的接线在 dom 里（依赖注入的 capture），这里只负责发送与关闭
    dom.resizeInput(); // append 后再量一次（此时样式已生效）
    place();
    if (opts.initialImage)
        void dom.setImageFile(opts.initialImage);
    if (opts.initialEncoded)
        dom.setEncoded(opts.initialEncoded);
    input.focus();
    return {
        el: root,
        close,
        startHear: dom.startHear,
        stopHear: dom.stopHear,
        isHearing: dom.isHearing,
        setEncoded: dom.setEncoded,
        setImageFile: dom.setImageFile,
        flash: dom.flash,
    };
}

},
"src/shared/chat/dom.ts": function(exports, require) {
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createChatDom = createChatDom;
/**
 * 对话弹窗的 DOM 装配：输入框、上传/截屏/按住说话三枚按钮、待发送图片缩略图、提示行与错误行。
 * 只建元素并把能力接上，不发送、不定位、不管关闭；录音的状态机在 chat/hear-control。
 * @module dsh-pet/src/shared/chat/dom
 */
const encode_ts_1 = require("src/shared/chat/encode.ts");
const hear_control_ts_1 = require("src/shared/chat/hear-control.ts");
const image_pick_ts_1 = require("src/shared/chat/image-pick.ts");
const icons_ts_1 = require("src/shared/chat/icons.ts");
const styles_ts_1 = require("src/shared/chat/styles.ts");
/** 提示自动收起的时间（ms）。 */
const HINT_MS = 2200;
/** 造一枚图标按钮（图标 + 无障碍标签）。 */
function iconButton(title, icon) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'dsh-pet-chat-btn';
    btn.title = title;
    btn.setAttribute('aria-label', title);
    btn.appendChild(icon);
    return btn;
}
/** 输入框宽度随文本自适应：宽度按测量值，封顶后由高度接住折行。 */
function enableAutoResize(input, root) {
    let measureCtx = null;
    const resize = () => {
        const ctx = measureCtx ?? (measureCtx = document.createElement('canvas').getContext('2d'));
        ctx.font = getComputedStyle(input).font; // 每次取当前计算样式（挂载前后都准）
        const textW = ctx.measureText(input.value || ' ').width;
        const w = Math.max(styles_ts_1.CHAT_MIN_W, Math.min(Math.ceil(textW + styles_ts_1.CHAT_H_PAD), styles_ts_1.CHAT_MAX_W));
        root.style.width = w + 'px'; // 根宽度跟随 → 夹回仍按实际宽
        input.style.height = 'auto';
        input.style.height = Math.max(input.scrollHeight, 22) + 'px';
    };
    input.addEventListener('input', resize);
    return resize;
}
/**
 * 建好弹窗的全部元素并挂到 `document.body` 下。
 *
 * @param opts - 可选的截屏实现（不传时按钮只给"当前环境不支持"的提示）与识别地址
 *   （录不了时按住说话的按钮照样在，点它给一句原因）。
 * @returns 元素引用与行为（清理附件、临时提示、自适应、释放计时器）。
 */
function createChatDom(opts = {}) {
    const root = document.createElement('div');
    root.className = 'dsh-pet-chat';
    const input = document.createElement('textarea');
    input.className = 'dsh-pet-chat-input';
    input.placeholder = '说点什么…';
    input.maxLength = 2000;
    input.rows = 1;
    const err = document.createElement('div');
    err.className = 'dsh-pet-chat-err';
    err.style.display = 'none';
    const hint = document.createElement('div');
    hint.className = 'dsh-pet-chat-hint';
    let hintTimer = 0;
    /** 常驻提示：录音与识别期间一直显示，由调用点自己收。 */
    const showHint = (text) => {
        window.clearTimeout(hintTimer);
        hint.textContent = text;
        hint.style.display = 'block';
    };
    const hideHint = () => {
        window.clearTimeout(hintTimer);
        hint.style.display = 'none';
    };
    const flash = (text) => {
        showHint(text);
        hintTimer = window.setTimeout(hideHint, HINT_MS);
    };
    const pickBtn = iconButton('上传图片', (0, icons_ts_1.pictureIcon)());
    const shotBtn = iconButton('截取当前屏幕', (0, icons_ts_1.cameraIcon)());
    const hearUrl = typeof opts.hearUrl === 'string' ? opts.hearUrl : '';
    const micBtn = iconButton('按住说话', (0, icons_ts_1.micIcon)());
    const fileInput = document.createElement('input');
    fileInput.type = 'file';
    fileInput.accept = image_pick_ts_1.IMAGE_ACCEPT;
    fileInput.style.display = 'none';
    const attach = document.createElement('div');
    attach.className = 'dsh-pet-chat-attach';
    const thumb = document.createElement('img');
    thumb.className = 'dsh-pet-chat-thumb';
    thumb.alt = '已选图片';
    const attachX = document.createElement('button');
    attachX.type = 'button';
    attachX.className = 'dsh-pet-chat-attach-x';
    attachX.textContent = '✕';
    attachX.title = '移除图片';
    attachX.setAttribute('aria-label', '移除图片');
    attach.append(thumb, attachX);
    const actions = document.createElement('div');
    actions.className = 'dsh-pet-chat-actions';
    actions.append(pickBtn, shotBtn, micBtn, fileInput, attach);
    root.append(input, actions, hint, err);
    document.body.appendChild(root);
    const resizeInput = enableAutoResize(input, root);
    let attachment;
    let encoding = false;
    let capturing = false;
    const clearAttach = () => {
        attachment = undefined;
        attach.dataset.on = '0';
        thumb.removeAttribute('src');
        fileInput.value = '';
    };
    /** 把编码结果挂上去：上传与截屏两条路共用这一处落点。 */
    const applyEncoded = (encoded) => {
        if (!root.isConnected)
            return false; // 编码完成前弹窗已关
        attachment = { mediaType: encoded.mediaType, data: encoded.base64 };
        thumb.src = encoded.previewUrl;
        attach.dataset.on = '1';
        return true;
    };
    const setImageFile = async (file) => {
        if (!(0, image_pick_ts_1.isImageFile)(file)) {
            flash('只支持 PNG / JPEG / WebP / GIF');
            return false;
        }
        encoding = true;
        pickBtn.disabled = true;
        try {
            return applyEncoded(await (0, encode_ts_1.encodeImageFile)(file));
        }
        catch (e) {
            flash('读图失败：' + (e instanceof Error ? e.message : String(e)));
            return false;
        }
        finally {
            encoding = false;
            pickBtn.disabled = false;
        }
    };
    pickBtn.addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', () => {
        const file = fileInput.files && fileInput.files[0];
        if (file)
            void setImageFile(file);
    });
    attachX.addEventListener('click', clearAttach);
    // 粘贴图片：截图工具通常先把图放剪贴板，Ctrl+V 比"存盘再选文件"少两步。
    // 挂在根元素上而不是输入框：焦点可能停在 ✕ / 按钮上，事件照样冒泡到这里；纯文本不拦截。
    root.addEventListener('paste', (e) => {
        const file = (0, image_pick_ts_1.firstImageFromClipboard)(e.clipboardData);
        if (!file)
            return;
        e.preventDefault();
        void setImageFile(file);
    });
    // 截屏：有实现就抓一帧（流在实现里立刻停掉，不留长连接）；没有就说明当前环境不支持
    if (opts.capture) {
        const capture = opts.capture;
        shotBtn.addEventListener('click', () => {
            if (capturing)
                return;
            capturing = true;
            shotBtn.disabled = true;
            void capture()
                .then((encoded) => applyEncoded(encoded))
                .catch((e) => flash('截屏失败：' + (e instanceof Error ? e.message : String(e))))
                .finally(() => {
                capturing = false;
                shotBtn.disabled = false;
            });
        });
    }
    else {
        shotBtn.addEventListener('click', () => flash('当前环境不支持截屏，先用上传试试'));
    }
    // 按住说话：状态机、录音与结果落点都在 chat/hear-control，这里只把元素与提示行交过去。
    const hear = (0, hear_control_ts_1.createHearControl)({
        micBtn,
        input,
        hint: { show: showHint, hide: hideHint, flash },
        resizeInput,
        hearUrl,
    });
    resizeInput(); // 以占位符为初始宽度
    return {
        root,
        input,
        err,
        shotBtn,
        resizeInput,
        clearAttach,
        setImageFile,
        setEncoded: applyEncoded,
        getAttachment: () => attachment,
        isEncoding: () => encoding || capturing,
        flash,
        startHear: hear.start,
        stopHear: hear.stop,
        isHearing: hear.isHearing,
        dispose: () => {
            window.clearTimeout(hintTimer);
            hear.dispose();
        },
    };
}

},
"src/shared/chat/encode.ts": function(exports, require) {
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.IMAGE_QUALITIES = exports.IMAGE_MAX_SIDE = exports.IMAGE_MAX_BYTES = void 0;
exports.attachmentBytes = attachmentBytes;
exports.targetSize = targetSize;
exports.loadImage = loadImage;
exports.bytesToBase64 = bytesToBase64;
exports.encodeCanvas = encodeCanvas;
exports.encodeImageFile = encodeImageFile;
/**
 * 对话图片的压缩与编码：把一张文件或一块画布压进宿主可接受的预算，产出可发送的 base64。
 * 纯计算（尺寸换算、字节反推）与 DOM（解码、canvas）分开，前者可单测。
 * 预算依据：宿主按 1 MiB 请求体拒绝，base64 膨胀 4/3，所以解码后上限取 640 KiB。
 * 解码与 base64 编码两个小件（{@link loadImage}、{@link bytesToBase64}）也供设置页的头像上传感复用——
 * 头像的预算与质量阶梯不同，但「怎么把文件读成图、怎么读成规范 base64」只有这一份实现。
 * @module dsh-pet/src/shared/chat/encode
 */
const image_pick_ts_1 = require("src/shared/chat/image-pick.ts");
/** 单张图片的字节上限（解码后）。 */
exports.IMAGE_MAX_BYTES = 640 * 1024;
/** 长边上限：再大对"看清报错文字"没有收益，只会挤占请求体。 */
exports.IMAGE_MAX_SIDE = 2048;
/** 质量阶梯：从高到低，第一档进预算就停。 */
exports.IMAGE_QUALITIES = [0.85, 0.75, 0.65, 0.55];
/** 预览缩略图的长边（像素）：只用于弹窗里那枚 24×24。 */
const PREVIEW_SIDE = 96;
/** 按 base64 长度反推字节数（不重新解码）。 */
function attachmentBytes(base64) {
    const pad = base64.endsWith('==') ? 2 : base64.endsWith('=') ? 1 : 0;
    return Math.floor((base64.length * 3) / 4) - pad;
}
/** 缩到长边上限后的目标尺寸；不放大。 */
function targetSize(width, height, maxSide = exports.IMAGE_MAX_SIDE) {
    const scale = Math.min(1, maxSide / Math.max(width, height));
    return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}
/**
 * 把文件解码成 `<img>`。
 *
 * 用 `FileReader` 的 data URL 而不是 `URL.createObjectURL`：桌面 helper 的 CSP 是
 * `img-src 'self' http: https: data:`，不含 `blob:`，objectURL 在那边会被拦成 onerror
 * （表现为"这个文件解不出图片"，而浏览器端正常）。
 *
 * @param file - 用户选中的图片文件。
 * @returns 解码完成的图片元素。
 * @throws 文件读不出来或解不出图片时。
 */
function loadImage(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onerror = () => reject(new Error('这个文件读不出来'));
        reader.onload = () => {
            const url = typeof reader.result === 'string' ? reader.result : '';
            if (!url) {
                reject(new Error('这个文件读不出来'));
                return;
            }
            const img = new Image();
            img.onload = () => resolve(img);
            img.onerror = () => reject(new Error('这个文件解不出图片'));
            img.src = url;
        };
        reader.readAsDataURL(file);
    });
}
/**
 * 字节 → 规范 base64（分块，避免 String.fromCharCode 参数过多爆栈）。
 *
 * @param bytes - 已读进内存的原始字节。
 * @returns 不带 data: 前缀的规范 base64。
 */
function bytesToBase64(bytes) {
    let bin = '';
    const CHUNK = 0x8000;
    for (let i = 0; i < bytes.length; i += CHUNK) {
        bin += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
    }
    return btoa(bin);
}
/** 把源按目标尺寸画进一张新画布。 */
function drawToCanvas(source, size) {
    const canvas = document.createElement('canvas');
    canvas.width = size.width;
    canvas.height = size.height;
    canvas.getContext('2d')?.drawImage(source, 0, 0, size.width, size.height);
    return canvas;
}
/** 缩略图：96px、JPEG 0.72，几 KB 就够 24×24 显示。 */
function previewOf(source, width, height) {
    return drawToCanvas(source, targetSize(width, height, PREVIEW_SIDE)).toDataURL('image/jpeg', 0.72);
}
/**
 * 把一块画布压进预算：按质量阶梯转 JPEG，第一档进预算就停。
 *
 * @param canvas - 已按目标尺寸画好的画布（文件与截屏共用这条）。
 * @returns 载荷与预览；压不进预算时抛错。
 */
function encodeCanvas(canvas) {
    const { width, height } = canvas;
    const previewUrl = previewOf(canvas, width, height);
    const floor = exports.IMAGE_QUALITIES[exports.IMAGE_QUALITIES.length - 1];
    for (const quality of exports.IMAGE_QUALITIES) {
        const dataUrl = canvas.toDataURL('image/jpeg', quality);
        const base64 = dataUrl.slice(dataUrl.indexOf(',') + 1);
        const bytes = attachmentBytes(base64);
        if (bytes <= exports.IMAGE_MAX_BYTES || quality === floor) {
            return { base64, mediaType: 'image/jpeg', bytes, width, height, resized: true, previewUrl };
        }
    }
    throw new Error('无法压到预算内');
}
/**
 * 把一张图片文件编码成可发送的附件。
 *
 * 原图够小就原样发送（不重编码：JPEG 再压一次会掉画质，动图也能保住）；
 * 超限才缩到长边上限、按质量阶梯逐档压到预算内。
 *
 * @param file - 已通过 `isImageFile` 的文件。
 * @returns 载荷与预览；压不进预算时抛错（调用方提示用户换图）。
 */
async function encodeImageFile(file) {
    const mediaType = (0, image_pick_ts_1.imageMediaTypeOf)(file);
    if (!mediaType)
        throw new Error('不是可发送的图片');
    const img = await loadImage(file);
    const width = img.naturalWidth || img.width;
    const height = img.naturalHeight || img.height;
    const raw = new Uint8Array(await file.arrayBuffer());
    if (raw.length <= exports.IMAGE_MAX_BYTES && Math.max(width, height) <= exports.IMAGE_MAX_SIDE) {
        return {
            base64: bytesToBase64(raw),
            mediaType,
            bytes: raw.length,
            width,
            height,
            resized: false,
            previewUrl: previewOf(img, width, height),
        };
    }
    const target = targetSize(width, height);
    return encodeCanvas(drawToCanvas(img, target));
}

},
"src/shared/chat/enter.ts": function(exports, require) {
"use strict";
/**
 * 对话输入框「回车发送」的判据：只有真按回车、且输入法没在管这个键时才发。
 * 桌面端与浏览器端共用；组合态由 compositionstart / compositionend 转进来，本模块不碰 DOM、不读时钟。
 * @module dsh-pet/src/shared/chat/enter
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.COMPOSITION_SETTLE_MS = void 0;
exports.createCompositionWatch = createCompositionWatch;
exports.decideEnter = decideEnter;
/** 组合结束后仍算「上屏那一下」的静默窗（ms）：Safari 会先 compositionend 再派发 keydown。 */
exports.COMPOSITION_SETTLE_MS = 80;
/**
 * 造一个空组合态。
 *
 * @returns 供 `compositionstart` / `compositionend` 与 {@link decideEnter} 共用的句柄。
 */
function createCompositionWatch() {
    let composing = false;
    // 用 -Infinity 当「从未结束过」：任何时刻的静默窗判定都为假，不必额外分支
    let endedAt = Number.NEGATIVE_INFINITY;
    return {
        start: () => {
            composing = true;
        },
        end: (at) => {
            composing = false;
            endedAt = at;
        },
        isComposing: () => composing,
        endedWithin: (now) => now - endedAt < exports.COMPOSITION_SETTLE_MS,
    };
}
/**
 * 这一次回车归谁。
 *
 * @param event - 键盘事件里与输入法相关的字段。
 * @param watch - 这个输入框的组合态。
 * @param now - 当前时刻（ms），必须与 {@link CompositionWatch.end} 用同一时钟。
 * @returns `send` 发送；`swallow` 拦下默认行为但不发；`ignore` 不干预（输入法或换行自己处理）。
 */
function decideEnter(event, watch, now) {
    if (event.key !== 'Enter' || event.shiftKey)
        return 'ignore';
    // 组合中的回车归输入法：此时 preventDefault 可能打断上屏，连拦都不拦
    if (event.isComposing === true || event.keyCode === 229 || watch.isComposing())
        return 'ignore';
    // 长按产生的重复回车：既不该发送，也不该每一下插一个换行
    if (event.repeat === true)
        return 'swallow';
    // 刚上屏那一下：组合已经提交，拦下默认行为只是别留下一个空行
    if (watch.endedWithin(now))
        return 'swallow';
    return 'send';
}

},
"src/shared/chat/hear-control.ts": function(exports, require) {
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createHearControl = createHearControl;
/**
 * 「按住说话」的控件：话筒按钮的四种状态、录音、识别结果落点。
 *
 * 单独成模块是因为它有独立的失败模式与生命周期：麦克风被拒、采到静音、宿主没开识别、
 * 网络失败各不相同，且带着一个四态状态机与两个定时器——和「上传图片、截屏」没有共同变化原因。
 * 不建 DOM、不管弹窗开合、不发送；元素与提示行由调用方（chat/dom）交进来。
 * @module dsh-pet/src/shared/chat/hear-control
 */
const hear_ts_1 = require("src/shared/hear.ts");
/**
 * 造一个按住说话控件。
 *
 * @param opts - 话筒按钮、输入框、提示行、尺寸重算与识别地址。
 * @returns 开始、收尾与释放三个动作。
 */
function createHearControl(opts) {
    const { micBtn, input, hint, resizeInput, hearUrl } = opts;
    let hearState = 'idle';
    let generation = 0;
    let controller;
    const live = (owner) => owner === generation && !controller?.signal.aborted
        && input.isConnected && !document.hidden && opts.active?.() !== false;
    let recorder = null;
    let hearTimer = 0;
    /** 还没拿到麦克风就松手了：等 startRecording 一返回立刻收尾，避免麦克风一直开着。 */
    let wasReleasedEarly = false;
    /** 按钮外观：录音阶段画红，识别阶段禁用（避免连点开两次）。 */
    const paint = () => {
        if (hearState === 'starting' || hearState === 'recording')
            micBtn.dataset.hear = 'recording';
        else
            delete micBtn.dataset.hear;
        micBtn.disabled = hearState === 'transcribing';
    };
    /** 现在录不了的原因；能录时给空串。 */
    const blockedReason = () => {
        if (!(0, hear_ts_1.canRecord)())
            return '当前地址不支持录音：用 https 或 localhost 打开才有麦克风';
        if (hearUrl === '')
            return '这个入口没有接上识别地址';
        return '';
    };
    /** 把识别结果接在光标处（替换当前选区），并把焦点交回输入框。 */
    const insertText = (text) => {
        const from = input.selectionStart ?? input.value.length;
        const to = input.selectionEnd ?? from;
        input.value = input.value.slice(0, from) + text + input.value.slice(to);
        const caret = from + text.length;
        input.setSelectionRange(caret, caret);
        resizeInput();
        // 桌面端靠 focusin 向主进程补一次系统键盘焦点（X11 上 DOM 焦点不等于键盘焦点）
        input.focus();
    };
    /** 失败原因翻成人话；宿主给的 message 有就附上，方便对着日志排查。 */
    const describeFailure = (outcome) => {
        if (outcome.reason === 'unsupported')
            return '这个宿主没开语音识别';
        if (outcome.reason === 'bad-request')
            return '音频没通过宿主校验';
        if (outcome.reason === 'network')
            return '识别请求失败：' + outcome.message;
        return '识别失败：' + (outcome.message || '未知原因');
    };
    /** 收尾：停采集 → 判误触 → 判静音 → 送宿主 → 文字落进输入框。失败只提示，不动已输入的文字。 */
    const stop = async () => {
        const owner = generation, signal = controller?.signal;
        const current = recorder;
        if (!current)
            return;
        recorder = null;
        window.clearInterval(hearTimer);
        // 误触（按一下就松）：静默丢弃。弹窗留着、提示不留——录到几十毫秒跟麦克风好坏无关，
        // 报「没听到声音」只会把人引到错误的方向。
        if (current.elapsedMs() < hear_ts_1.MIN_RECORD_MS) {
            current.cancel();
            hearState = 'idle';
            paint();
            hint.hide();
            return;
        }
        hearState = 'transcribing';
        paint();
        hint.show('识别中…');
        try {
            const clip = await current.stop();
            if (!live(owner))
                return;
            if (clip === null) {
                hint.flash('没录到声音');
                return;
            }
            if (clip.peak < hear_ts_1.SILENCE_PEAK) {
                // 麦克风开着却没信号（设备静音 / 耳机没戴上）：不白送一次识别
                hint.flash('没听到声音，检查一下麦克风');
                return;
            }
            if (!live(owner))
                return;
            const outcome = await (0, hear_ts_1.hearAudio)(hearUrl, (0, hear_ts_1.toBase64)(clip.wave), signal, opts.fetchVoice);
            if (!live(owner))
                return;
            if (!outcome.ok) {
                hint.flash(describeFailure(outcome));
                return;
            }
            const text = outcome.text.trim();
            if (text === '') {
                hint.flash('没听清，再说一次');
                return;
            }
            hint.hide();
            insertText(text);
        }
        catch (e) {
            if (live(owner))
                hint.flash('录音出错：' + (e instanceof Error ? e.message : String(e)));
        }
        finally {
            if (live(owner)) {
                hearState = 'idle';
                paint();
            }
        }
    };
    /** 开录：先要麦克风，拿到了才开始计时。 */
    const start = async () => {
        const blocked = blockedReason();
        if (blocked !== '') {
            hint.flash(blocked);
            return;
        }
        if (hearState !== 'idle' || !input.isConnected || document.hidden || opts.active?.() === false)
            return;
        const owner = ++generation, abort = controller = new AbortController();
        // 焦点交还出去：按住说话不看焦点，可输入框一旦吃着键盘，落进来的 v 就会变成字符。
        // 识别完由 insertText 重新聚焦，回车发送照旧。
        if (document.activeElement === input)
            input.blur();
        hearState = 'starting';
        wasReleasedEarly = false;
        paint();
        hint.show('正在打开麦克风…');
        try {
            const next = await (0, hear_ts_1.startRecording)(abort.signal);
            if (!live(owner)) {
                next.cancel();
                return;
            }
            recorder = next;
        }
        catch (e) {
            if (!live(owner))
                return;
            hearState = 'idle';
            paint();
            hint.flash('打不开麦克风：' + (e instanceof Error ? e.message : String(e)));
            return;
        }
        if (wasReleasedEarly) {
            void stop();
            return;
        }
        hearState = 'recording';
        paint();
        hearTimer = window.setInterval(() => {
            const rec = recorder;
            if (!rec)
                return;
            if (rec.elapsedMs() >= hear_ts_1.MAX_RECORD_MS) {
                void stop(); // 上限到了自动收尾，不必等松手
                return;
            }
            const total = Math.floor(rec.elapsedMs() / 1000);
            hint.show('录音中 ' + Math.floor(total / 60) + ':' + String(total % 60).padStart(2, '0') + ' · 松开结束');
        }, 200);
    };
    micBtn.addEventListener('pointerdown', (e) => {
        if (e.button !== 0)
            return;
        e.preventDefault(); // 别把焦点从输入框抢走，也别触发选区
        try {
            // 捕获指针：松手时鼠标可能已经移出按钮甚至移出窗口，靠它才收得到 pointerup
            micBtn.setPointerCapture(e.pointerId);
        }
        catch {
            /* 指针已经不在了（窗口失焦/合成事件）：收不到松手就等 24 秒上限兜底 */
        }
        void start();
    });
    /** 松手或指针被系统抢走（切窗口）都算说完；还在等麦克风时先记下，等它回来立刻收尾。 */
    const onRelease = () => {
        if (hearState === 'starting') {
            wasReleasedEarly = true;
            return;
        }
        if (hearState === 'recording')
            void stop();
    };
    micBtn.addEventListener('pointerup', onRelease);
    micBtn.addEventListener('pointercancel', onRelease);
    return {
        start: () => void start(),
        stop: () => void stop(),
        isHearing: () => hearState === 'recording',
        dispose: () => {
            generation++;
            controller?.abort();
            controller = undefined;
            window.clearInterval(hearTimer);
            // 关弹窗时麦克风必须立刻松手：录音中直接丢弃，不等识别
            if (recorder) {
                recorder.cancel();
                recorder = null;
            }
            hearState = 'idle';
            wasReleasedEarly = false;
            paint();
        },
    };
}

},
"src/shared/chat/hear-hold.ts": function(exports, require) {
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.HEAR_HOTKEY_HINT = void 0;
exports.isHearHotkey = isHearHotkey;
exports.createHearHold = createHearHold;
/**
 * 「按住说话」的悬停快捷键：按住 `M` 开录，松手收尾。
 *
 * 管的是「按下到松开」这一段，不是一次按键。首次按下与其他悬停键同一条判据
 * （{@link isBareKey}：输入框、contenteditable 里打字不算），否则拼音里的 m 会被当成开录；
 * 进入按住状态后不再判焦点——开录时输入框已 blur，期间系统持续补发的 keydown 必须照单全收，
 * 漏一个就会往框里灌字符。
 * 只做判定与状态，不碰 DOM 与录音。
 * @module dsh-pet/src/shared/chat/hear-hold
 */
const hotkey_ts_1 = require("src/shared/hotkey.ts");
/** 目标键的小写形式：判定与状态机共用这一份，避免两处各写一个字面量。 */
const HEAR_KEY = 'm';
/** 快捷键的显示文案（设置页用）。与 {@link isHearHotkey} 的按键保持同一份事实。 */
exports.HEAR_HOTKEY_HINT = 'M 键';
/**
 * 这次按下该不该被「按住说话」接走：与其他悬停键共用同一条判据。
 *
 * @param e - 键盘事件。
 * @returns 裸按 `M`（含大写）、且焦点不在可编辑元素上时为 true。
 */
function isHearHotkey(e) {
    return (0, hotkey_ts_1.isBareKey)(e, HEAR_KEY);
}
/**
 * 造一个按住状态机。
 *
 * @param hooks - 前置判据与按下/松开动作。
 * @returns 供调用方接线的三个处理器。
 */
function createHearHold(hooks) {
    let holding = false;
    /** 只比键名：按住期间焦点已交给输入框，不能再套「不在可编辑元素里」那道判据。 */
    const sameKey = (key) => String(key).toLowerCase() === HEAR_KEY;
    const release = () => {
        if (!holding)
            return;
        holding = false;
        hooks.onRelease();
    };
    return {
        onKeyDown(e) {
            // 按住中：同一个键的事件（主要是自动重复）全部吃掉，一个漏网的就会打进输入框
            if (holding)
                return sameKey(e.key);
            if (e.repeat === true || !isHearHotkey(e) || !hooks.isArmed())
                return false;
            holding = true;
            hooks.onPress();
            return true;
        },
        onKeyUp(e) {
            if (sameKey(e.key))
                release();
        },
        release,
    };
}

},
"src/shared/chat/hotkey.ts": function(exports, require) {
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CAPTURE_HOTKEY_HINT = exports.CHAT_HOTKEY_HINT = exports.isTypingTarget = void 0;
exports.isChatHotkey = isChatHotkey;
exports.isCaptureHotkey = isCaptureHotkey;
/**
 * 悬停快捷键的判据：鼠标停在某只宠物上时，按 `L` 打开对话、按 `S` 截图。
 * 按键规则归 shared/hotkey，本模块只绑定「哪个键 + 菜单文案」。
 * @module dsh-pet/src/shared/chat/hotkey
 */
const hotkey_ts_1 = require("src/shared/hotkey.ts");
var hotkey_ts_2 = require("src/shared/hotkey.ts");
Object.defineProperty(exports, "isTypingTarget", { enumerable: true, get: function () { return hotkey_ts_2.isTypingTarget; } });
/** 快捷键的显示文案（菜单项右侧灰字）。与 {@link isChatHotkey} 的按键保持同一份事实。 */
exports.CHAT_HOTKEY_HINT = 'L 键';
/** 截图的显示文案；没有菜单项，只给设置页那张卡用。 */
exports.CAPTURE_HOTKEY_HINT = 'S 键';
/**
 * 这次按键该不该打开对话。
 *
 * @param e - 键盘事件。
 * @returns 裸按 `L`（含大写）时为 true，输入框里打字则为 false。
 */
function isChatHotkey(e) {
    return (0, hotkey_ts_1.isBareKey)(e, 'l');
}
/**
 * 这次按键该不该截图。
 *
 * @param e - 键盘事件。
 * @returns 裸按 `S`（含大写）时为 true，输入框里打字则为 false。
 */
function isCaptureHotkey(e) {
    return (0, hotkey_ts_1.isBareKey)(e, 's');
}

},
"src/shared/chat/icons.ts": function(exports, require) {
"use strict";
/**
 * 对话弹窗里的三枚内联 SVG 图标。
 * 不用 emoji：同一个符号在不同字体回退链下会被渲染成异体字形（上传用的 🖼 在 Windows 上就是如此）。
 * @module dsh-pet/src/shared/chat/icons
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.pictureIcon = pictureIcon;
exports.micIcon = micIcon;
exports.cameraIcon = cameraIcon;
/** SVG 图标共用的描边属性：一条线宽、随文字颜色。 */
const ICON_ATTRS = {
    fill: 'none',
    stroke: 'currentColor',
    'stroke-width': '1.8',
    'stroke-linecap': 'round',
    'stroke-linejoin': 'round',
    'aria-hidden': 'true',
};
/** 造一个 SVG 子元素（属性原样写入，命名空间固定 SVG）。 */
function svgNode(tag, attrs) {
    const node = document.createElementNS('http://www.w3.org/2000/svg', tag);
    for (const [name, value] of Object.entries(attrs))
        node.setAttribute(name, value);
    return node;
}
/** 图片图标：外框 + 太阳 + 山脊。 */
function pictureIcon(size = 16) {
    const svg = svgNode('svg', {
        viewBox: '0 0 24 24',
        width: String(size),
        height: String(size),
        ...ICON_ATTRS,
    });
    svg.append(svgNode('rect', { x: '3', y: '3', width: '18', height: '18', rx: '2' }), svgNode('circle', { cx: '8.5', cy: '8.5', r: '1.5' }), svgNode('path', { d: 'M21 15l-5-5L5 21' }));
    return svg;
}
/** 话筒图标：话筒胶囊 + 拾音弧 + 支架。 */
function micIcon(size = 16) {
    const svg = svgNode('svg', {
        viewBox: '0 0 24 24',
        width: String(size),
        height: String(size),
        ...ICON_ATTRS,
    });
    svg.append(svgNode('rect', { x: '9', y: '2', width: '6', height: '11', rx: '3' }), svgNode('path', { d: 'M5.5 11a6.5 6.5 0 0 0 13 0' }), svgNode('path', { d: 'M12 17.5V21' }), svgNode('path', { d: 'M8.5 21h7' }));
    return svg;
}
/** 相机图标：机身 + 镜头。 */
function cameraIcon(size = 16) {
    const svg = svgNode('svg', {
        viewBox: '0 0 24 24',
        width: String(size),
        height: String(size),
        ...ICON_ATTRS,
    });
    svg.append(svgNode('path', { d: 'M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z' }), svgNode('circle', { cx: '12', cy: '13', r: '4' }));
    return svg;
}

},
"src/shared/chat/image-pick.ts": function(exports, require) {
"use strict";
/**
 * 对话图片的挑选与本地预览：判断是不是图、读成 data URL 给缩略图。
 * 不压缩、不编码、不发网络——真正送图的那一步在接入时另加，预算逻辑也会落在这里。
 * @module dsh-pet/src/shared/chat/image-pick
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.IMAGE_ACCEPT = exports.IMAGE_TYPES = void 0;
exports.imageMediaTypeOf = imageMediaTypeOf;
exports.isImageFile = isImageFile;
exports.dragHasFiles = dragHasFiles;
exports.firstImageFile = firstImageFile;
exports.firstImageFromClipboard = firstImageFromClipboard;
/** 与宿主附件服务白名单一致的图片类型。 */
exports.IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'];
/** `<input type=file>` 的 accept 值，与 {@link IMAGE_TYPES} 保持同一份事实。 */
exports.IMAGE_ACCEPT = exports.IMAGE_TYPES.join(',');
/** 扩展名兜底：拖拽或部分系统来源不给 `file.type`。 */
const IMAGE_EXT = {
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    webp: 'image/webp',
    gif: 'image/gif',
};
/**
 * 文件的图片媒体类型：声明类型在白名单内就用它，否则按扩展名兜底。
 *
 * @param file - 用户选中、拖入或粘贴的文件。
 * @returns 白名单内的类型；认不出返回 undefined。
 */
function imageMediaTypeOf(file) {
    const declared = String(file.type || '').toLowerCase();
    if (exports.IMAGE_TYPES.includes(declared))
        return declared;
    const ext = String(file.name || '')
        .split('.')
        .pop()
        ?.toLowerCase();
    return ext === undefined ? undefined : IMAGE_EXT[ext];
}
/**
 * 这个文件是不是可发送的图片。
 *
 * @param file - 用户选中或拖入的文件。
 * @returns 声明类型在白名单内，或扩展名命中兜底表时为 true。
 */
function isImageFile(file) {
    return imageMediaTypeOf(file) !== undefined;
}
/** 这次拖拽是否带着文件（决定 dragover 要不要 preventDefault）。 */
function dragHasFiles(e) {
    const types = e.dataTransfer?.types;
    if (!types)
        return false;
    return Array.from(types).includes('Files');
}
/** 拖入的文件里第一张可发送的图片；没有返回 undefined。 */
function firstImageFile(dataTransfer) {
    const files = dataTransfer?.files;
    if (!files)
        return undefined;
    for (const file of Array.from(files)) {
        if (isImageFile(file))
            return file;
    }
    return undefined;
}
/**
 * 剪贴板里第一张可发送的图片。
 *
 * 先看 `files`（截图工具、资源管理器复制文件都会填），再回退 `items`：
 * 个别来源只把图放进 items（`kind === 'file'`），只读 files 会表现为"粘了没反应"且不报错。
 *
 * @param data - 粘贴事件的 clipboardData 或其结构子集。
 * @returns 第一张图片；纯文本粘贴返回 undefined（调用方据此不拦截默认行为）。
 */
function firstImageFromClipboard(data) {
    if (!data)
        return undefined;
    const files = data.files;
    if (files) {
        for (const file of Array.from(files)) {
            if (isImageFile(file))
                return file;
        }
    }
    const items = data.items;
    if (!items)
        return undefined;
    for (const item of Array.from(items)) {
        if (item.kind !== 'file')
            continue;
        const file = item.getAsFile();
        if (file && isImageFile(file))
            return file;
    }
    return undefined;
}

},
"src/shared/chat/index.ts": function(exports, require) {
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CHAT_CSS = exports.sendChat = exports.isTypingTarget = exports.isChatHotkey = exports.isCaptureHotkey = exports.CHAT_HOTKEY_HINT = exports.CAPTURE_HOTKEY_HINT = exports.isImageFile = exports.firstImageFromClipboard = exports.firstImageFile = exports.dragHasFiles = exports.isHearHotkey = exports.createHearHold = exports.mountChatDialog = void 0;
var dialog_ts_1 = require("src/shared/chat/dialog.ts");
Object.defineProperty(exports, "mountChatDialog", { enumerable: true, get: function () { return dialog_ts_1.mountChatDialog; } });
var hear_hold_ts_1 = require("src/shared/chat/hear-hold.ts");
Object.defineProperty(exports, "createHearHold", { enumerable: true, get: function () { return hear_hold_ts_1.createHearHold; } });
Object.defineProperty(exports, "isHearHotkey", { enumerable: true, get: function () { return hear_hold_ts_1.isHearHotkey; } });
var image_pick_ts_1 = require("src/shared/chat/image-pick.ts");
Object.defineProperty(exports, "dragHasFiles", { enumerable: true, get: function () { return image_pick_ts_1.dragHasFiles; } });
Object.defineProperty(exports, "firstImageFile", { enumerable: true, get: function () { return image_pick_ts_1.firstImageFile; } });
Object.defineProperty(exports, "firstImageFromClipboard", { enumerable: true, get: function () { return image_pick_ts_1.firstImageFromClipboard; } });
Object.defineProperty(exports, "isImageFile", { enumerable: true, get: function () { return image_pick_ts_1.isImageFile; } });
var hotkey_ts_1 = require("src/shared/chat/hotkey.ts");
Object.defineProperty(exports, "CAPTURE_HOTKEY_HINT", { enumerable: true, get: function () { return hotkey_ts_1.CAPTURE_HOTKEY_HINT; } });
Object.defineProperty(exports, "CHAT_HOTKEY_HINT", { enumerable: true, get: function () { return hotkey_ts_1.CHAT_HOTKEY_HINT; } });
Object.defineProperty(exports, "isCaptureHotkey", { enumerable: true, get: function () { return hotkey_ts_1.isCaptureHotkey; } });
Object.defineProperty(exports, "isChatHotkey", { enumerable: true, get: function () { return hotkey_ts_1.isChatHotkey; } });
Object.defineProperty(exports, "isTypingTarget", { enumerable: true, get: function () { return hotkey_ts_1.isTypingTarget; } });
var send_ts_1 = require("src/shared/chat/send.ts");
Object.defineProperty(exports, "sendChat", { enumerable: true, get: function () { return send_ts_1.sendChat; } });
var styles_ts_1 = require("src/shared/chat/styles.ts");
Object.defineProperty(exports, "CHAT_CSS", { enumerable: true, get: function () { return styles_ts_1.CHAT_CSS; } });

},
"src/shared/chat/send.ts": function(exports, require) {
"use strict";
/**
 * 对话发送：把一句输入交给宿主 `POST /chat`，只回执成败。
 * 正文展示不走这里——回复统一从 `/state` 的 `pets.<id>.say` 读。
 * @module dsh-pet/src/shared/chat/send
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.sendChat = sendChat;
/** 对话要等 LLM 生成回复，比碎碎念（30s）放宽一倍 */
const SEND_TIMEOUT_MS = 60_000;
/**
 * 发送一句对话（携带记忆去宿主生成回复并写入记忆）。
 * 网络或解析失败显式抛错，调用方决定报错方式，绝不静默伪造回复。
 *
 * @param baseUrl - 已含 `?pet=&surface=` 的完整对话地址。
 * @param text - 用户输入正文（宿主会 trim 并校验 2000 字上限）。
 * @param attachment - 可选的一张图片；不传时请求体只有 `text`，与旧版逐字一致。
 * @returns 成功，或归一化后的失败原因与文案。
 * @throws 响应不是 JSON 对象时。
 */
async function sendChat(baseUrl, text, attachment) {
    const res = await fetch(baseUrl, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(attachment ? { text, attachment } : { text }),
        signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
    });
    const raw = await res.json().catch(() => null);
    if (!raw || typeof raw !== 'object') {
        throw new Error('dsh-pet: 对话响应非法');
    }
    const o = raw;
    if (o.ok !== true) {
        return {
            ok: false,
            reason: o.reason === 'provider-missing' || o.reason === 'generate-error' || o.reason === 'config-error'
                ? o.reason
                : 'bad-request',
            message: typeof o.message === 'string' ? o.message : undefined,
        };
    }
    return { ok: true };
}

},
"src/shared/chat/styles.ts": function(exports, require) {
"use strict";
/**
 * 对话弹窗的样式与尺寸参数：两端注入同一份 CSS。
 * 只放静态字符串与常量，不建 DOM、不读运行时状态。
 * @module dsh-pet/src/shared/chat/styles
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.CHAT_H_PAD = exports.CHAT_MAX_W = exports.CHAT_MIN_W = exports.CHAT_CSS = void 0;
exports.injectChatCss = injectChatCss;
/** 弹窗样式。
 *  一条自适应输入框（无标题）+ 一行图标按钮（上传 / 截屏 / 按住说话）+ 可选的图片预览；
 *  初始 160px，随输入增宽、封顶 340px 后折行增高；回车发送，Esc 或点外关闭。
 *  宽度由 JS 按文本测量覆盖根元素宽度。 */
exports.CHAT_CSS = [
    '.dsh-pet-chat{position:fixed;z-index:2147483001;width:160px;max-width:80vw;',
    'background:rgba(255,255,255,.98);border:1px solid rgba(0,0,0,.12);border-radius:10px;',
    'box-shadow:0 10px 32px rgba(0,0,0,.22);color:#2b2b2b;font-size:14px;line-height:1.5;',
    // 字体与桌宠气泡同款（上首软糖体，两端均已注入 @font-face），风格一致不显正式。
    // 字体族走全局配置变量 --dsh-pet-font-family：弹窗挂在 body 下、继承不到宠物根容器，由两端注入在 documentElement。
    // 字号保持固定 14px：配置里的 font.size 只作用于气泡与悬浮提示。
    "font-family:var(--dsh-pet-font-family,'ShangshouSoftCandy','Yuanti SC','YouYuan','幼圆','Comic Sans MS','PingFang SC','Microsoft YaHei',sans-serif);",
    'user-select:none}',
    '.dsh-pet-chat *{box-sizing:border-box}',
    '.dsh-pet-chat-input{display:block;width:100%;border:none;outline:none;background:transparent;',
    'padding:8px 11px 9px;font-size:14px;line-height:1.45;color:#2b2b2b;font-family:inherit;',
    'resize:none;overflow:hidden;white-space:pre-wrap;overflow-wrap:anywhere}',
    '.dsh-pet-chat-input::placeholder{color:rgba(43,43,43,.45)}',
    '.dsh-pet-chat-input:disabled{opacity:.55}',
    // 操作行：上传 / 截屏 / 按住说话三枚图标按钮（无边框、悬停才显底）
    '.dsh-pet-chat-actions{display:flex;align-items:center;gap:6px;padding:0 8px 7px}',
    '.dsh-pet-chat-btn{display:inline-flex;align-items:center;justify-content:center;width:24px;height:24px;',
    'border:none;border-radius:6px;background:transparent;color:rgba(43,43,43,.62);font-size:14px;line-height:1;',
    'cursor:pointer;transition:background .15s,color .15s}',
    '.dsh-pet-chat-btn:hover{background:rgba(0,0,0,.06);color:rgba(43,43,43,.9)}',
    '.dsh-pet-chat-btn:disabled{opacity:.45;cursor:default}',
    '.dsh-pet-chat-btn svg{display:block}',
    // 话筒：录音中常亮红底 + 呼吸，告诉用户「正在听」。状态由 dom 写在 data-hear 上。
    '.dsh-pet-chat-btn[data-hear="recording"]{color:#e5484d;background:rgba(229,72,77,.14)}',
    '.dsh-pet-chat-btn[data-hear="recording"]:hover{background:rgba(229,72,77,.2);color:#e5484d}',
    '.dsh-pet-chat-btn[data-hear="recording"] svg{animation:dsh-pet-hear-pulse 1s ease-in-out infinite}',
    '@keyframes dsh-pet-hear-pulse{0%,100%{opacity:1}50%{opacity:.4}}',
    // 已选图片：跟在两枚按钮右侧的一枚小图，不占额外一行
    '.dsh-pet-chat-attach{display:none;align-items:center;gap:4px;margin-left:2px}',
    '.dsh-pet-chat-attach[data-on="1"]{display:inline-flex}',
    '.dsh-pet-chat-thumb{width:24px;height:24px;object-fit:cover;border-radius:4px;',
    'border:1px solid rgba(0,0,0,.1);flex:0 0 auto;background:rgba(0,0,0,.06)}',
    '.dsh-pet-chat-attach-x{border:none;background:transparent;color:rgba(43,43,43,.45);cursor:pointer;',
    'font-size:12px;line-height:1;padding:2px 3px;border-radius:4px}',
    '.dsh-pet-chat-attach-x:hover{background:rgba(0,0,0,.08);color:rgba(43,43,43,.85)}',
    '.dsh-pet-chat-hint{display:none;color:rgba(43,43,43,.55);font-size:12px;padding:0 12px 8px}',
    '.dsh-pet-chat-err{color:#d94f3d;font-size:12px;padding:0 12px 8px;white-space:pre-wrap;overflow-wrap:anywhere}',
].join('');
/** 输入框宽度自适应参数：初始小宽，随文本增宽，封顶后折行增高。 */
exports.CHAT_MIN_W = 160;
exports.CHAT_MAX_W = 340;
/** 输入框水平 padding 补偿（11×2） */
exports.CHAT_H_PAD = 22;
let chatCssInjected = false;
/** 把弹窗样式注入文档一次；重复挂载不会重复插入。 */
function injectChatCss() {
    if (chatCssInjected || typeof document === 'undefined')
        return;
    chatCssInjected = true;
    const tag = document.createElement('style');
    tag.dataset.plugin = 'dsh-pet';
    tag.dataset.pluginCss = 'dsh-pet/chat';
    tag.textContent = exports.CHAT_CSS;
    document.head.appendChild(tag);
}

},
"src/shared/config.ts": function(exports, require) {
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.isDesktopVisible = exports.isWebVisible = exports.PET_DISPLAYS = void 0;
exports.flattenConfigPets = flattenConfigPets;
/** 显示位置白名单。 */
exports.PET_DISPLAYS = ['web', 'desktop', 'both', 'none'];
/** 该宠物是否参与浏览器半侧渲染。 */
const isWebVisible = (display) => display === 'web' || display === 'both';
exports.isWebVisible = isWebVisible;
/** 该宠物是否参与桌面模式（Electron 透明窗）渲染。 */
const isDesktopVisible = (display) => display === 'desktop' || display === 'both';
exports.isDesktopVisible = isDesktopVisible;
/** 把成品聚合拍平成渲染用宠物列表。
 *  条目级字段（animations / physics / font 等）由所属条目一份、多实例共享；assetRoot 取条目 key，
 *  即素材根。非 main 条目打 extra 标记：文件宠物在设置页不可编辑、保存时排除。 */
function flattenConfigPets(merged) {
    const out = [];
    for (const [entry, conf] of Object.entries(merged)) {
        const list = Array.isArray(conf?.pets) ? conf.pets : [];
        for (const p of list) {
            out.push({
                ...p,
                animations: conf.animations,
                animationWeights: conf.animationWeights,
                eventsRefreshSec: conf.eventsRefreshSec,
                physics: conf.physics,
                font: conf.font,
                confineToScreen: conf.confineToScreen,
                workStatusTexts: conf.workStatusTexts,
                // 睡觉文案：渲染端要能「睡着时点对话/碎碎念就弹拒绝台词」，所以必须在拍平时带出来
                // （与 workStatusTexts 同一类条目级字段：多实例共享所属条目那一份）。
                sleepStartTexts: conf.sleepStartTexts,
                sleepEndTexts: conf.sleepEndTexts,
                sleepRefuseTexts: conf.sleepRefuseTexts,
                whisperModel: conf.whisperModel,
                chatModel: conf.chatModel,
                // 表情包三件套：右键「配图」菜单要按配置里的清单与顺序分组，客户端不读磁盘，
                // 所以只能在拍平时一并带出；文件是否存在由宿主在生成时校验（见 host/memes 的池判定）。
                memes: conf.memes,
                chatImageEnabled: conf.chatImageEnabled,
                chatAnimationEnabled: conf.chatAnimationEnabled,
                chatImageLimit: conf.chatImageLimit,
                assetRoot: entry,
                extra: entry !== 'main',
            });
        }
    }
    return out;
}

},
"src/shared/constants.ts": function(exports, require) {
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ANIMATION_EXT = exports.PET_ALPHA_FIX_ENABLED = exports.ROUTE_PATH = exports.ROUTE_SEGMENT = exports.PET_REF_WIDTH = exports.SLINGSHOT_DOUBLE_MS = exports.MIN_REACHABLE_PX = exports.DRAG_THRESHOLD = exports.HIT_BOX = exports.FEET_Y = exports.CANVAS_H = void 0;
exports.mountPrefixOf = mountPrefixOf;
exports.routePathOf = routePathOf;
/**
 * 共享常量叶子：画布几何、播放扩展名与插件 HTTP 挂载路径。
 * 路径对两端语义不同——宿主只认服务端路由段，浏览器才带挂载前缀，因此拆成两个导出。
 * 不 import 任何模块：宿主半侧直接引本文件，不经 shared/index 桶（桶里有 DOM 挂载代码）。
 * @module dsh-pet/src/shared/constants
 */
/** thumb 画布高度。 */
exports.CANVAS_H = 360;
/** thumb 画布上脚底的 y 坐标（人物站在 y=330 线上）。 */
exports.FEET_Y = 330;
/** 点击与拖拽的命中矩形（thumb 640×360 像素坐标）。 */
exports.HIT_BOX = { x0: 200, y0: 50, x1: 440, y1: 335 };
/** 拖拽判定阈值（px）。 */
exports.DRAG_THRESHOLD = 5;
/** 越界摆放的可见下限（px）：命中区至少留这么多在可视区内，右键才点得到。
 *  网页端由 clampReachableBox 在提交位置时夹取，桌面端由窗口落位按同一条规则留边界。 */
exports.MIN_REACHABLE_PX = 24;
/** 弹弓窗口（ms）：两次按下之间的间隔小于它即按弹弓算，与这次拖了多久、何时松手无关。
 *  只认左键，没有待拉状态（换算见 physics.ts）。 */
exports.SLINGSHOT_DOUBLE_MS = 200;
/** 移动距离的缩放基准（px）：配置里的 minDist/maxDist 是基准宠物宽 462px 下的像素，
 *  运行时按「实际 size / 基准」等比缩放，任何缩放下行进距离都与人物自身大小成比例。 */
exports.PET_REF_WIDTH = 462;
/**
 * 宿主注册的路由段：服务端路径，永远不带浏览器挂载前缀。
 * 路由注册、匹配与桌面/独立模式拼地址都用它；带了前缀的地址在服务端是错的路由。
 */
exports.ROUTE_SEGMENT = '/dsh-pet-7340';
/**
 * 从文档基准地址取出挂载前缀（baseURI 的目录部分）。
 *
 * dsh 返回 index 时注入 `<base href="./">`，baseURI 因此正是「宿主提供 UI 的那个目录」，
 * 也是浏览器解析相对请求的基准；反代/应用网关把 UI 挂在子路径下时，缺的就是这一段前缀。
 *
 * @param baseURI - 文档基准地址；宿主进程、桌面本地页与 Node 测试都没有它。
 * @returns 去掉尾部斜杠的目录部分；空串、非 http(s)、非法地址一律 `''`，且不抛异常。
 */
function mountPrefixOf(baseURI) {
    if (baseURI === undefined || baseURI === '')
        return '';
    try {
        const url = new URL(baseURI);
        if (url.protocol !== 'http:' && url.protocol !== 'https:')
            return '';
        return url.pathname.replace(/\/+$/, '');
    }
    catch {
        return '';
    }
}
/**
 * 一处算出浏览器侧地址：挂载前缀 + 路由段，供模块加载与单测共用。
 *
 * @param baseURI - 文档基准地址；缺省时按无前缀处理。
 * @returns 请求与素材的公共前缀，形如 `/app/x/dsh-pet-7340`。
 */
function routePathOf(baseURI) {
    return mountPrefixOf(baseURI) + exports.ROUTE_SEGMENT;
}
/**
 * 浏览器侧地址：请求、素材与 CSS url() 都按文档基准解析，必须带挂载前缀。
 * 无 `document` 的三处（宿主、桌面 Helper 的主进程侧、独立模式）取到的是纯路由段。
 */
exports.ROUTE_PATH = routePathOf(typeof document === 'undefined' ? undefined : document.baseURI);
/**
 * 是否给视频挂 1/255 alpha 修正滤镜。开着能去掉 WebM 背景那层淡灰矩形，但会掉帧：滤镜每帧
 * 按视频尺寸重算，桌宠越大越明显，动起来会卡顿。灰框只在多只宠物重叠时才看得出来，单只基本
 * 没差别，所以默认关闭。
 */
exports.PET_ALPHA_FIX_ENABLED = false;
/** 播放动画扩展名（集中开关）：默认 .webm（VP9-alpha）两端可直接透明播放；
 *  macOS 的 Safari/WKWebView 不认 webm alpha（渲染黑底），需改为 .mov（HEVC-with-Alpha）——
 *  素材从仓库 Release 的 assets-mov tag 取，放进 main-animation/mov/ 后重新构建；
 *  npm 包用户改产物里的同名常量。 */
exports.ANIMATION_EXT = '.webm';

},
"src/shared/display-hotkey.ts": function(exports, require) {
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DISPLAY_HOTKEY_HINTS = exports.DISPLAY_ORDER = void 0;
exports.displayOfHotkey = displayOfHotkey;
/**
 * 显示位置的数字键：`1` 仅网页、`2` 仅桌面、`3` 两者、`4` 都不。
 *
 * 顺序与右键「显示位置」子菜单同源（见 {@link displayMenuBranch}），菜单键帽也由这里出。
 * 每个键作用于鼠标停着的那只宠物；`3`/`4` 会让它从网页端消失，因此这两个键是单向门。
 * @module dsh-pet/src/shared/display-hotkey
 */
const hotkey_ts_1 = require("src/shared/hotkey.ts");
/** 数字键对应的显示位置，下标从 1 起；改顺序等于改快捷键，必须同步菜单。 */
exports.DISPLAY_ORDER = ['web', 'desktop', 'both', 'none'];
/** 菜单项右侧的键帽文案；下标与 {@link DISPLAY_ORDER} 对齐。 */
exports.DISPLAY_HOTKEY_HINTS = exports.DISPLAY_ORDER.map((_, index) => String(index + 1) + ' 键');
/**
 * 这次按键该切到哪个显示位置。
 *
 * @param e - 键盘事件。
 * @returns `1`-`4` 对应的显示位置；不是这四个裸键（或在输入框里打字）时 undefined。
 */
function displayOfHotkey(e) {
    for (let index = 0; index < exports.DISPLAY_ORDER.length; index += 1) {
        if ((0, hotkey_ts_1.isBareKey)(e, String(index + 1)))
            return exports.DISPLAY_ORDER[index];
    }
    return undefined;
}

},
"src/shared/displays.ts": function(exports, require) {
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.translateRects = exports.regionHoleRatio = exports.regionArea = exports.rebaseCenter = exports.clampPointToRegion = exports.clampPointInRect = exports.resolveRect = exports.nearestIndex = exports.distToRectSq = exports.indexAtPoint = exports.rectAtPoint = exports.pointInRect = exports.boundingRect = exports.rectBottom = exports.rectRight = void 0;
/** 矩形右缘（不含）。 */
const rectRight = (r) => r.x + r.width;
exports.rectRight = rectRight;
/** 矩形下缘（不含）。 */
const rectBottom = (r) => r.y + r.height;
exports.rectBottom = rectBottom;
/** 外接矩形：视口原点与比例换算仍取它，但边界判定一律走并集；空列表返回 0×0。 */
const boundingRect = (rects) => {
    if (rects.length === 0)
        return { x: 0, y: 0, width: 0, height: 0 };
    let x0 = Infinity;
    let y0 = Infinity;
    let x1 = -Infinity;
    let y1 = -Infinity;
    for (const r of rects) {
        x0 = Math.min(x0, r.x);
        y0 = Math.min(y0, r.y);
        x1 = Math.max(x1, (0, exports.rectRight)(r));
        y1 = Math.max(y1, (0, exports.rectBottom)(r));
    }
    return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
};
exports.boundingRect = boundingRect;
/** 点是否落在矩形内（右/下缘不含）：相邻两屏缝隙为 0 时，点归左/上那块。 */
const pointInRect = (r, x, y) => x >= r.x && x < (0, exports.rectRight)(r) && y >= r.y && y < (0, exports.rectBottom)(r);
exports.pointInRect = pointInRect;
/** 点被哪块屏覆盖；无则 null。重叠时取列表中第一块（与 Chromium「先发现者优先」一致）。 */
const rectAtPoint = (rects, x, y) => {
    for (const r of rects)
        if ((0, exports.pointInRect)(r, x, y))
            return r;
    return null;
};
exports.rectAtPoint = rectAtPoint;
/** 同 rectAtPoint，返回下标（−1 = 无覆盖）；抛掷要用下标记住当前所在屏。 */
const indexAtPoint = (rects, x, y) => {
    for (let i = 0; i < rects.length; i++)
        if ((0, exports.pointInRect)(rects[i], x, y))
            return i;
    return -1;
};
exports.indexAtPoint = indexAtPoint;
/** 点到矩形的最短距离平方（点在矩形内为 0）。 */
const distToRectSq = (r, x, y) => {
    const dx = Math.max(r.x - x, 0, x - (0, exports.rectRight)(r));
    const dy = Math.max(r.y - y, 0, y - (0, exports.rectBottom)(r));
    return dx * dx + dy * dy;
};
exports.distToRectSq = distToRectSq;
/** 离点最近的屏下标；空列表返回 −1。用于宠物落在空洞或屏幕被拔掉后归位。 */
const nearestIndex = (rects, x, y) => {
    let best = -1;
    let bestD = Infinity;
    for (let i = 0; i < rects.length; i++) {
        const d = (0, exports.distToRectSq)(rects[i], x, y);
        if (d < bestD) {
            bestD = d;
            best = i;
        }
    }
    return best;
};
exports.nearestIndex = nearestIndex;
/** 点所在屏；不在任何屏上时取最近的那块（列表为空才返回 null）。 */
const resolveRect = (rects, x, y) => {
    const hit = (0, exports.rectAtPoint)(rects, x, y);
    if (hit)
        return hit;
    const i = (0, exports.nearestIndex)(rects, x, y);
    return i < 0 ? null : rects[i];
};
exports.resolveRect = resolveRect;
/** 把点夹进指定矩形（右/下缘留 1px，保证结果仍满足 pointInRect）。 */
const clampPointInRect = (r, x, y) => ({
    x: Math.min(Math.max(x, r.x), (0, exports.rectRight)(r) - 1),
    y: Math.min(Math.max(y, r.y), (0, exports.rectBottom)(r) - 1),
});
exports.clampPointInRect = clampPointInRect;
/** 把点夹进并集：已在并集内原样返回，否则夹进最近的那块屏。用于显示器拔插后把落在空洞里的宠物拉回可见区。 */
const clampPointToRegion = (rects, x, y) => {
    if ((0, exports.rectAtPoint)(rects, x, y))
        return { x, y };
    const i = (0, exports.nearestIndex)(rects, x, y);
    return i < 0 ? { x, y } : (0, exports.clampPointInRect)(rects[i], x, y);
};
exports.clampPointToRegion = clampPointToRegion;
/**
 * 显示器拓扑变化后重定位宠物中心：世界坐标守恒，只有点不落在任何屏上才夹到最近屏。
 * 参数与返回值都是新视口的相对坐标；视口原点随拓扑平移，直接拿旧坐标去夹会让宠物每次开合都漂一次。
 */
const rebaseCenter = (center, fromView, toView, areas) => (0, exports.clampPointToRegion)(areas, center.x + fromView.x - toView.x, center.y + fromView.y - toView.y);
exports.rebaseCenter = rebaseCenter;
/** 并集面积（各屏不重叠时等于面积和；重叠会重复计，仅作诊断）。 */
const regionArea = (rects) => rects.reduce((s, r) => s + r.width * r.height, 0);
exports.regionArea = regionArea;
/** 外接矩形中不属于任何屏的面积占比 0~1（诊断用；矩形不重叠时精确）。 */
const regionHoleRatio = (rects) => {
    const hull = (0, exports.boundingRect)(rects);
    const hullArea = hull.width * hull.height;
    if (hullArea <= 0)
        return 0;
    return Math.max(0, 1 - (0, exports.regionArea)(rects) / hullArea);
};
exports.regionHoleRatio = regionHoleRatio;
/** 整体平移一组矩形（屏幕坐标 → 视口相对坐标：减去视口原点）。 */
const translateRects = (rects, dx, dy) => rects.map((r) => ({ x: r.x + dx, y: r.y + dy, width: r.width, height: r.height }));
exports.translateRects = translateRects;

},
"src/shared/focus-session.ts": function(exports, require) {
"use strict";
/**
 * 跳会话指令的解析：把 `sections.focusSession` 的 data 收窄成「该跳」或「跳过」。
 *
 * 这是一次性信号，两条判据缺一不可：`ts` 必须新于本地水位（否则同一条会重复跳），
 * 且不能太旧（页面隔很久才打开时，不该被一条早已过时的点击拽走）。
 * @module dsh-pet/src/shared/focus-session
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.FOCUS_REPLAY_WINDOW_MS = void 0;
exports.readFocusSession = readFocusSession;
/** 重放窗口（ms）：超过这个时长的旧信号不再补跳。 */
exports.FOCUS_REPLAY_WINDOW_MS = 10_000;
/**
 * 解析一条跳会话信号。
 *
 * @param raw - 叶子的 `data`；形状非法时返回 null。
 * @param now - 当前时刻（ms）；由调用方注入，便于测试。
 * @param lastTs - 本地已处理过的最大 `ts`；小于等于它的一律跳过。
 * @returns 该执行的跳转；不该跳时为 null。
 */
function readFocusSession(raw, now, lastTs) {
    if (!raw || typeof raw !== 'object')
        return null;
    const { sessionId, ts } = raw;
    if (typeof sessionId !== 'string' || sessionId === '')
        return null;
    if (typeof ts !== 'number' || !Number.isFinite(ts))
        return null;
    // 同一条信号只处理一次：页面首拉补跳与随后那一拍增量读到的是同一个 ts。
    if (ts <= lastTs)
        return null;
    if (now - ts > exports.FOCUS_REPLAY_WINDOW_MS)
        return null;
    return { sessionId, ts };
}

},
"src/shared/fonts.ts": function(exports, require) {
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.BUBBLE_METRICS = exports.BUBBLE_OVERLAP_RATIO = exports.TIP_FONT_BASE_PX = exports.BUBBLE_FONT_BASE_PX = exports.FONT_REF_SIZE = exports.DEFAULT_FONT = exports.FONT_SIZE_MAX = exports.FONT_SIZE_MIN = exports.FONT_PRESETS = void 0;
exports.fontStackOf = fontStackOf;
exports.resolveFontPx = resolveFontPx;
exports.bubbleMaxHeightPx = bubbleMaxHeightPx;
exports.bubbleTopMarginPx = bubbleTopMarginPx;
/** 字体预设清单：顺序即设置页下拉框的显示顺序（第一项为默认）。
 *  candy 是唯一随包发布的字体，CSS 名 "ShangshouSoftCandy" 由我们自己起，改名须同步两端的 @font-face。
 *  其余都是系统字体，机器上没装时由字体栈后面的兜底自然回退，不报错也不空白。 */
exports.FONT_PRESETS = [
    {
        id: 'candy',
        stack: '"ShangshouSoftCandy","Yuanti SC","YouYuan","幼圆","Comic Sans MS","PingFang SC","Microsoft YaHei",sans-serif',
    },
    { id: 'yahei', stack: '"Microsoft YaHei","PingFang SC",sans-serif' },
    { id: 'youyuan', stack: '"YouYuan","Yuanti SC",sans-serif' },
    { id: 'kaiti', stack: '"KaiTi","STKaiti",serif' },
    { id: 'simsun', stack: '"SimSun","Songti SC",serif' },
    { id: 'comic', stack: '"Comic Sans MS","Comic Sans",cursive' },
    { id: 'system', stack: 'system-ui,sans-serif' },
];
/** 字号合法区间（px，含端点）：与宿主半侧 fontValid 同一口径——设置页据此即时提示，宿主据此拦截手改。 */
exports.FONT_SIZE_MIN = 4;
exports.FONT_SIZE_MAX = 200;
/** font 段默认值（与内置 config.jsonc 的 font 段一致）：462 宽宠物的气泡 21px，且随宠物大小缩放。
 *  不含 font 字段的配置因此仍按既有观感渲染。 */
exports.DEFAULT_FONT = {
    family: 'candy',
    size: 21,
    followPet: true,
};
/** 按 id 取字体栈；id 非法或缺失回退清单首项（软糖体），渲染层不再自行兜底。 */
function fontStackOf(id) {
    return (exports.FONT_PRESETS.find((p) => p.id === id) ?? exports.FONT_PRESETS[0]).stack;
}
/** 基准宠物宽度（px）：字号换算的锚点，等于内置配置的默认 size，也是既有 CSS 系数的设计基准。 */
exports.FONT_REF_SIZE = 462;
/** 基准宽度下的气泡正文字号（px）＝ 0.0455 × 462 ≈ 21.02。 */
exports.BUBBLE_FONT_BASE_PX = 0.0455 * exports.FONT_REF_SIZE;
/** 基准宽度下的悬浮提示字号（px）＝ 0.026 × 462 ≈ 12.01。 */
exports.TIP_FONT_BASE_PX = 0.026 * exports.FONT_REF_SIZE;
/** 气泡与悬浮提示的最终字号（px），两端共用同一份换算以免漂移。
 *  字号 = 基准 px × (font.size ÷ 默认字号) × (followPet ? 宠物宽 ÷ 462 : 1)。
 *  followPet=false 时退化为固定在 462 宽的字号；配置被手改坏则按默认口径处理，绝不产出 NaN 或 0。
 *  @param font - 该宠物的 font 配置，缺失按 DEFAULT_FONT。
 *  @param size - 该宠物的宽度 px。 */
function resolveFontPx(font, size) {
    const own = Number(font?.size);
    // 用户层字号相对默认字号的倍率（默认字号 = DEFAULT_FONT.size）
    const ratio = Number.isFinite(own) && own > 0 ? own / exports.DEFAULT_FONT.size : 1;
    const w = Number(size);
    const follow = font?.followPet !== false;
    const scale = follow && Number.isFinite(w) && w > 0 ? w / exports.FONT_REF_SIZE : 1;
    return {
        bubble: exports.BUBBLE_FONT_BASE_PX * ratio * scale,
        tip: exports.TIP_FONT_BASE_PX * ratio * scale,
    };
}
/** 气泡底边探出宠物盒顶边的比例（对应气泡 CSS 的 bottom: calc(100% - size×0.108)）。
 *  探出的这段同样计入气泡可用的垂直空间，见 bubbleTopMarginPx。 */
exports.BUBBLE_OVERLAP_RATIO = 0.108;
/** 气泡布局度量（em，基准 = 气泡正文最终字号 --f）。
 *  系数与两端渲染层 .dsh-pet-bubble 的 CSS、shared/whisper.ts 的 MEME_BUBBLE_CSS 同源，
 *  改任何一条 CSS 系数都必须同步这里，否则桌面窗口上边距会算少、气泡顶端被窗口切掉。 */
exports.BUBBLE_METRICS = {
    lineHeight: 1.6,
    padY: 0.4835,
    subScale: 0.7692,
    imgWidth: 7.4725,
    imgMargin: 0.3736,
    /** 配图长宽比上限（内置 assets/memes 全为 128 宽、高不超过 128） */
    imgMaxRatio: 1,
};
/** 气泡最大高度（px）：两行文本（余额气泡的主行 + 次要行）加一张配图。桌面端据此定窗口上边距。 */
function bubbleMaxHeightPx(font, size) {
    const f = resolveFontPx(font, size).bubble;
    const m = exports.BUBBLE_METRICS;
    return (m.padY * 2 * f + m.lineHeight * f + m.lineHeight * m.subScale * f + m.imgWidth * m.imgMaxRatio * f + m.imgMargin * f);
}
/** 桌面窗口的最小上边距（px）：至少要容得下整只气泡。
 *  气泡底边落在宠物盒顶边下方 0.108 × 尺寸 处，故余量 = 气泡最大高度 − 这一段。
 *  默认配置（462px 宠物 / 21px 字号）算得 195px，仍小于既有余量 231px，窗口尺寸不变。 */
function bubbleTopMarginPx(font, size) {
    const overlap = (Number(size) || 0) * exports.BUBBLE_OVERLAP_RATIO;
    return Math.max(0, Math.ceil(bubbleMaxHeightPx(font, size) - overlap));
}

},
"src/shared/hear.ts": function(exports, require) {
"use strict";
/**
 * 端侧语音输入：录一段话，拼成宿主认可的 WAV，`POST /voice/hear` 换回文字。
 *
 * 格式口径（16kHz / 单声道 / PCM16）与宿主 provider 的校验是同一份事实——这里只按它产出，
 * 不再各自校验一遍；真对不上时宿主会回一条可读的失败说明。
 * 只负责「麦克风 → WAV → 文字」，不碰界面：按钮状态、文字落点都归调用方（chat/dom）。
 * @module dsh-pet/src/shared/hear
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.MIN_RECORD_MS = exports.SILENCE_PEAK = exports.MAX_RECORD_MS = exports.HEAR_SAMPLE_RATE = void 0;
exports.canRecord = canRecord;
exports.floatToPcm16 = floatToPcm16;
exports.peakOf = peakOf;
exports.encodeWave = encodeWave;
exports.toBase64 = toBase64;
exports.hearAudio = hearAudio;
exports.startRecording = startRecording;
/** 采样率：宿主 provider 只收 16kHz。 */
exports.HEAR_SAMPLE_RATE = 16000;
/**
 * 单次录音上限（ms）。
 *
 * 24 秒 × 32000 B/s ≈ 750KB，base64 后仍落在宿主 1MiB 的请求体里（上限 768KiB 音频）；
 * 再长就必须先想办法分片，那是另一件事。
 */
exports.MAX_RECORD_MS = 24_000;
/** 判静音的峰值阈值（0..1）：低于它视为没听到声音，不白送一次识别。 */
exports.SILENCE_PEAK = 0.002;
/**
 * 短于它的录音按误触处理。
 *
 * 快捷键按住说话时，一次误碰只会录到几十毫秒；这种片段既不值得送去识别，
 * 也不该报「没听到声音」——它跟麦克风有没有声毫无关系。
 */
exports.MIN_RECORD_MS = 300;
/** 等识别结果的上限（ms）：宿主自己 30s 超时，这里留点余量先等它回结构化失败。 */
const HEAR_TIMEOUT_MS = 40_000;
/** 每块采集的样本数：1024 样本 @16kHz = 64ms，松手后等待补齐尾音的时长也按它算。 */
const BLOCK_SAMPLES = 1024;
/** 松手后等最后一块音频落袋（ms）：比一块略长，避免把最后半句话砍掉。 */
const TAIL_SETTLE_MS = 80;
/** 浏览器能不能录音；非安全上下文（http 且非 localhost）下 `mediaDevices` 根本不存在。 */
function canRecord() {
    return typeof navigator !== 'undefined' && typeof navigator.mediaDevices?.getUserMedia === 'function';
}
/**
 * 浮点采样转 16 位整型：超范围先夹紧，负半轴按 32768 缩放，免得 -1 溢出成正数。
 *
 * @param samples - Web Audio 给的 [-1,1] 浮点采样。
 * @returns 可直接写进 WAV 的 16 位采样。
 */
function floatToPcm16(samples) {
    const out = new Int16Array(samples.length);
    for (let i = 0; i < samples.length; i++) {
        const v = samples[i] < -1 ? -1 : samples[i] > 1 ? 1 : samples[i];
        out[i] = v < 0 ? v * 0x8000 : v * 0x7fff;
    }
    return out;
}
/**
 * 量峰值：静音判定只关心「有没有声音进来」，不关心它有多响。
 *
 * @param pcm - 16 位采样。
 * @returns 峰值归一到 0..1；空数组给 0。
 */
function peakOf(pcm) {
    let peak = 0;
    for (let i = 0; i < pcm.length; i++) {
        const v = pcm[i] < 0 ? -pcm[i] : pcm[i];
        if (v > peak)
            peak = v;
    }
    return peak / 0x8000;
}
/**
 * 拼一个裸 PCM 的 WAV：44 字节头 + 采样数据。
 *
 * 头里每个字段宿主都会校验（`fmt ` 长度 16、PCM=1、单声道、16bit、byteRate 自洽），
 * 所以这里按固定偏移逐字节写，不做「挑一个能用的模板」那种取巧。
 *
 * @param pcm - 16 位采样。
 * @param sampleRate - 采样率；缺省 16kHz。
 * @returns 完整 WAV 字节。
 */
function encodeWave(pcm, sampleRate = exports.HEAR_SAMPLE_RATE) {
    const dataBytes = pcm.length * 2;
    const bytes = new Uint8Array(44 + dataBytes);
    const view = new DataView(bytes.buffer);
    /** 写 4 字节 ASCII 标记（RIFF/WAVE/fmt /data），全是大写或小写字母，不用考虑编码。 */
    const ascii = (offset, text) => {
        for (let i = 0; i < text.length; i++)
            bytes[offset + i] = text.charCodeAt(i);
    };
    ascii(0, 'RIFF');
    view.setUint32(4, 36 + dataBytes, true);
    ascii(8, 'WAVE');
    ascii(12, 'fmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true); // 1 = PCM
    view.setUint16(22, 1, true); // 单声道
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * 2, true); // byteRate = 采样率 × 声道 × 位深/8
    view.setUint16(32, 2, true); // blockAlign = 声道 × 位深/8
    view.setUint16(34, 16, true);
    ascii(36, 'data');
    view.setUint32(40, dataBytes, true);
    for (let i = 0; i < pcm.length; i++)
        view.setInt16(44 + i * 2, pcm[i], true);
    return bytes;
}
/**
 * 字节转 base64（不带 data: 前缀）。
 *
 * 分段转换：一次性展开几十万字节会撑爆参数栈，而这里是允许 750KB 的量级。
 *
 * @param bytes - 原始字节。
 * @returns 规范 base64。
 */
function toBase64(bytes) {
    const BASE64_CHUNK_BYTES = 8192;
    let binary = '';
    for (let offset = 0; offset < bytes.length; offset += BASE64_CHUNK_BYTES) {
        const end = Math.min(offset + BASE64_CHUNK_BYTES, bytes.length);
        for (let i = offset; i < end; i++)
            binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
}
/** 把宿主的失败原因收敛到自己认识的几种；其余一律按生成失败处理。 */
function reasonOf(raw) {
    return raw === 'unsupported' || raw === 'bad-request' ? raw : 'generate-error';
}
/**
 * 把一段 WAV（base64）交给宿主识别。
 *
 * @param url - 已含挂载前缀的识别地址。
 * @param audio - 规范 base64（不带 data: 前缀）。
 * @returns 文字或失败分类；网络异常也收敛成 outcome，不向上抛。
 */
async function hearAudio(url, audio, signal, fetchVoice = fetch) {
    const timeout = AbortSignal.timeout(HEAR_TIMEOUT_MS);
    try {
        const res = await fetchVoice(url, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ audio }),
            signal: signal === undefined ? timeout : AbortSignal.any([signal, timeout]),
        });
        const raw = await res.json().catch(() => null);
        if (!raw || typeof raw !== 'object') {
            return { ok: false, reason: 'network', message: '识别响应不是 JSON' };
        }
        const body = raw;
        if (body.ok === true && typeof body.text === 'string')
            return { ok: true, text: body.text };
        return {
            ok: false,
            reason: reasonOf(body.reason),
            message: typeof body.message === 'string' ? body.message : '',
        };
    }
    catch (e) {
        return { ok: false, reason: 'network', message: e instanceof Error ? e.message : String(e) };
    }
}
/**
 * 开一次录音。
 *
 * 用 `AudioContext({ sampleRate: 16000 })` 让浏览器自己做重采样（硬件通常是 48k），
 * 拿到的就已是目标采样率的单声道浮点；`ScriptProcessor` 虽已标记废弃，但它不需要
 * 额外的 worklet 模块文件——`file://` 页面加载 worklet 会被源头限制卡住。
 *
 * @returns 录音句柄。
 * @throws {Error} 拿不到麦克风时（没权限、设备被占、非安全上下文）——原文交给调用方展示。
 */
async function startRecording(signal) {
    signal?.throwIfAborted();
    const stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1 } });
    let ctx;
    let source;
    let processor;
    const chunks = [];
    const maxSamples = Math.floor((exports.MAX_RECORD_MS / 1000) * exports.HEAR_SAMPLE_RATE);
    let frames = 0;
    let closed = false;
    const teardown = () => {
        if (closed)
            return;
        closed = true;
        signal?.removeEventListener('abort', teardown);
        if (processor)
            processor.onaudioprocess = null;
        try {
            source?.disconnect();
        }
        catch { }
        try {
            processor?.disconnect();
        }
        catch { }
        for (const track of stream.getTracks())
            track.stop();
        void ctx?.close().catch(() => { });
    };
    signal?.addEventListener('abort', teardown, { once: true });
    try {
        signal?.throwIfAborted();
        ctx = new AudioContext({ sampleRate: exports.HEAR_SAMPLE_RATE });
        source = ctx.createMediaStreamSource(stream);
        processor = ctx.createScriptProcessor(BLOCK_SAMPLES, 1, 1);
        processor.onaudioprocess = (event) => {
            if (frames >= maxSamples)
                return;
            const samples = event.inputBuffer.getChannelData(0);
            const room = maxSamples - frames;
            const take = samples.length > room ? samples.subarray(0, room) : samples;
            // 必须复制：inputBuffer 的底层数组每帧复用，直接存引用会得到一堆相同的数据
            chunks.push(new Float32Array(take));
            frames += take.length;
        };
        source.connect(processor);
        processor.connect(ctx.destination);
        // 上下文默认可能是 suspended（没有用户手势时）；调用方就在 pointerdown 里，够格恢复
        await ctx.resume();
        signal?.throwIfAborted();
    }
    catch (error) {
        teardown();
        throw error;
    }
    return {
        elapsedMs: () => (frames / exports.HEAR_SAMPLE_RATE) * 1000,
        async stop() {
            // 采集比释放晚一块：先让最后一块落袋，否则每次都会砍掉几十毫秒的尾音
            await new Promise((resolve) => setTimeout(resolve, TAIL_SETTLE_MS));
            teardown();
            if (frames === 0)
                return null;
            const all = new Float32Array(frames);
            let offset = 0;
            for (const chunk of chunks) {
                all.set(chunk, offset);
                offset += chunk.length;
            }
            const pcm = floatToPcm16(all);
            return { wave: encodeWave(pcm), peak: peakOf(pcm) };
        },
        cancel: teardown,
    };
}

},
"src/shared/hotkey.ts": function(exports, require) {
"use strict";
/**
 * 悬停快捷键的通用判据：哪一次按键该被宠物截走。
 *
 * 纯函数，两端共用；各功能只声明自己那一个键（见 chat/hotkey 与 todo/hotkey）。
 * 桌面端只在窗口已聚焦时收得到按键——透明穿透窗默认不抢焦点。
 * @module dsh-pet/src/shared/hotkey
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.isTypingTarget = isTypingTarget;
exports.isBareKey = isBareKey;
/** 这些地方按键属于打字，不能抢：输入框、文本域、下拉、contenteditable。 */
function isTypingTarget(target) {
    const el = target;
    if (!el || typeof el.tagName !== 'string')
        return false;
    const tag = el.tagName.toLowerCase();
    if (tag === 'input' || tag === 'textarea' || tag === 'select')
        return true;
    return el.isContentEditable === true;
}
/**
 * 是不是一次「裸按某键」。
 *
 * @param e - 键盘事件（只读 key 与修饰键、target）。
 * @param key - 目标键的小写形式，如 `'t'`。
 * @returns 键名匹配（大小写不敏感）、不带 Ctrl/Meta/Alt，且焦点不在可编辑元素上时为 true。
 */
function isBareKey(e, key) {
    if (e.ctrlKey || e.metaKey || e.altKey)
        return false;
    if (String(e.key).toLowerCase() !== key)
        return false;
    return !isTypingTarget(e.target);
}

},
"src/shared/index.ts": function(exports, require) {
"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __exportStar = (this && this.__exportStar) || function(m, exports) {
    for (var p in m) if (p !== "default" && !Object.prototype.hasOwnProperty.call(exports, p)) __createBinding(exports, m, p);
};
Object.defineProperty(exports, "__esModule", { value: true });
/**
 * 共享层出口：浏览器半侧 bundle 与桌面 shared-core 共用同一份纯逻辑。
 * 不负责配置的读取、合并与校验：成品配置由宿主半侧的 readAllConfig 给出，本层只把它拍平。
 * 宿主半侧不得 import 本目录（DSH 单文件加载约束会拆 chunk），其实现自包含、改动须与本层同步。
 * menu / chat / score-popup / todo / tooltip 导出 DOM 样式与挂载：数据与判据仍是纯函数，渲染两端共用同一份。
 * 本文件是打包入口：scripts/build-desktop-core.mjs 把它打成 shared-core.js，产物以 window.PetShared
 * 暴露全部符号供桌面 JS 取用（那一侧没有类型检查）。
 * @module dsh-pet/src/shared/index
 */
__exportStar(require("src/shared/types.ts"), exports);
__exportStar(require("src/shared/constants.ts"), exports);
__exportStar(require("src/shared/pickers.ts"), exports);
__exportStar(require("src/shared/displays.ts"), exports);
__exportStar(require("src/shared/motion.ts"), exports);
__exportStar(require("src/shared/balance/index.ts"), exports);
__exportStar(require("src/shared/whisper.ts"), exports);
__exportStar(require("src/shared/config.ts"), exports);
__exportStar(require("src/shared/fonts.ts"), exports);
__exportStar(require("src/shared/notify.ts"), exports);
__exportStar(require("src/shared/menu.ts"), exports);
__exportStar(require("src/shared/chat/index.ts"), exports);
__exportStar(require("src/shared/physics.ts"), exports);
__exportStar(require("src/shared/score.ts"), exports);
__exportStar(require("src/shared/score-popup.ts"), exports);
__exportStar(require("src/shared/work-status.ts"), exports);
__exportStar(require("src/shared/state.ts"), exports);
__exportStar(require("src/shared/bubble-hold.ts"), exports);
__exportStar(require("src/shared/display-hotkey.ts"), exports);
__exportStar(require("src/shared/sleep-hotkey.ts"), exports);
__exportStar(require("src/shared/todo/index.ts"), exports);
__exportStar(require("src/shared/tooltip.ts"), exports);
__exportStar(require("src/shared/voice.ts"), exports);

},
"src/shared/menu.ts": function(exports, require) {
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.mountContextMenu = exports.MENU_CSS = exports.memeThumbUrl = exports.groupMemes = exports.buildMemeBranch = exports.readMenuItems = exports.isSleepAllowedAction = exports.isNoMirrorAnimation = exports.displayMenuBranch = exports.buildMoreBranch = exports.buildMenuTree = exports.MORE_MENU_LABEL = void 0;
var tree_ts_1 = require("src/shared/menu/tree.ts");
Object.defineProperty(exports, "MORE_MENU_LABEL", { enumerable: true, get: function () { return tree_ts_1.MORE_MENU_LABEL; } });
Object.defineProperty(exports, "buildMenuTree", { enumerable: true, get: function () { return tree_ts_1.buildMenuTree; } });
Object.defineProperty(exports, "buildMoreBranch", { enumerable: true, get: function () { return tree_ts_1.buildMoreBranch; } });
Object.defineProperty(exports, "displayMenuBranch", { enumerable: true, get: function () { return tree_ts_1.displayMenuBranch; } });
Object.defineProperty(exports, "isNoMirrorAnimation", { enumerable: true, get: function () { return tree_ts_1.isNoMirrorAnimation; } });
Object.defineProperty(exports, "isSleepAllowedAction", { enumerable: true, get: function () { return tree_ts_1.isSleepAllowedAction; } });
Object.defineProperty(exports, "readMenuItems", { enumerable: true, get: function () { return tree_ts_1.readMenuItems; } });
var memes_ts_1 = require("src/shared/menu/memes.ts");
Object.defineProperty(exports, "buildMemeBranch", { enumerable: true, get: function () { return memes_ts_1.buildMemeBranch; } });
Object.defineProperty(exports, "groupMemes", { enumerable: true, get: function () { return memes_ts_1.groupMemes; } });
Object.defineProperty(exports, "memeThumbUrl", { enumerable: true, get: function () { return memes_ts_1.memeThumbUrl; } });
var css_ts_1 = require("src/shared/menu/css.ts");
Object.defineProperty(exports, "MENU_CSS", { enumerable: true, get: function () { return css_ts_1.MENU_CSS; } });
var mount_ts_1 = require("src/shared/menu/mount.ts");
Object.defineProperty(exports, "mountContextMenu", { enumerable: true, get: function () { return mount_ts_1.mountContextMenu; } });

},
"src/shared/menu/css.ts": function(exports, require) {
"use strict";
/**
 * 右键菜单样式：只列选择器与规则，注入由挂载侧统一负责。
 *
 * 不含交互逻辑。菜单是覆盖在网页与桌面内容之上的浮层，需要固定对比度，所以自带一套
 * 浅色调色盘、不读宿主 `--dsw-*` 变量：跟随主题会在深色背景上糊成一片，桌面渲染进程
 * 也不注入那组 token，两端看起来会不一样。
 * 必须始终成立：菜单配色只出现在本文件，调用方不得另行覆盖。
 * @module dsh-pet/src/shared/menu/css
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.MENU_CSS = void 0;
/** 菜单样式 —— 两端注入同一份。每级面板是独立的绝对定位盒子，位置由 JS 内联写入，互不嵌套。 */
exports.MENU_CSS = [
    // 浮层固定浅色：对比度与两端口径一致，优先于跟随宿主主题。
    '.dsh-pet-menu{position:fixed;left:0;top:0;z-index:2147483000;color:#2b2b2b;font-size:13px;line-height:1.5;',
    "font-family:'Microsoft YaHei UI','Segoe UI','PingFang SC',sans-serif;user-select:none;pointer-events:auto}",
    '.dsh-pet-menu,.dsh-pet-menu *{box-sizing:border-box}',
    '.dsh-pet-menu-column{position:absolute;min-width:150px;max-width:300px;padding:4px;',
    'background:rgba(255,255,255,.98);border:1px solid rgba(0,0,0,.12);border-radius:8px;',
    'box-shadow:0 8px 28px rgba(0,0,0,.2);max-height:min(62vh,460px);overflow-y:auto;',
    // 自定义滚动条：Chromium 系走 ::-webkit-scrollbar，Firefox 走 scrollbar-width/scrollbar-color；
    // thumb 用 border + background-clip 内缩留白，与圆角白底协调。
    'scrollbar-width:thin;scrollbar-color:rgba(0,0,0,.22) transparent}',
    '.dsh-pet-menu-column::-webkit-scrollbar{width:8px;height:8px}',
    '.dsh-pet-menu-column::-webkit-scrollbar-track{background:transparent}',
    '.dsh-pet-menu-column::-webkit-scrollbar-thumb{background:rgba(0,0,0,.16);border-radius:4px;',
    'border:2px solid transparent;background-clip:content-box}',
    '.dsh-pet-menu-column::-webkit-scrollbar-thumb:hover{background:rgba(43,99,255,.4);',
    'border:2px solid transparent;background-clip:content-box}',
    '.dsh-pet-menu-column::-webkit-scrollbar-corner{background:transparent}',
    '.dsh-pet-menu-item{position:relative;display:flex;align-items:center;justify-content:space-between;',
    'gap:14px;padding:5px 12px;border-radius:6px;white-space:nowrap;cursor:default}',
    '.dsh-pet-menu-item:hover{background:rgba(43,99,255,.14)}',
    // 文字占满剩余宽度：菜单项是 space-between 的 flex 行，label 吃掉弹性空间后，箭头与 hint 才会贴右。
    // 按类名选而不是 `>span:first-child`——带缩略图的项里第一个子节点是 img。
    '.dsh-pet-menu-label{flex:1 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis}',
    // 配图缩略图：裁成方形小图，不参与拉伸；行高由它撑到 28+padding。
    '.dsh-pet-menu-thumb{width:28px;height:28px;border-radius:4px;object-fit:cover;flex:none;',
    'background:rgba(0,0,0,.06)}',
    // 带图的项：图与文字之间收窄（默认 14px 是给「文字 ↔ 箭头」的间距）
    '.dsh-pet-menu-item-pic{gap:8px}',
    // 右侧快捷键提示（菜单项 hint）：与 label 同一 flex 行，space-between 自动贴右
    '.dsh-pet-menu-hint{color:#9aa0a6;font-size:12px;flex:none;white-space:nowrap}',
    '.dsh-pet-menu-arrow{color:#9aa0a6;font-size:12px;flex:none}',
].join('');

},
"src/shared/menu/memes.ts": function(exports, require) {
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.groupMemes = groupMemes;
exports.memeThumbUrl = memeThumbUrl;
exports.buildMemeBranch = buildMemeBranch;
/**
 * 可用图的名称清单：描述为空的不算。
 *
 * 与宿主的池判定同口径（`host/memes` 的 readMemePool 要求描述非空）：模型靠描述才认得出这张图，
 * 没描述的条目即使文件存在也进不了对话与碎碎念。顺序保留配置里的书写顺序。
 */
function usableNames(memes) {
    if (!memes || typeof memes !== 'object' || Array.isArray(memes))
        return [];
    const out = [];
    for (const [name, desc] of Object.entries(memes)) {
        if (!name.trim())
            continue;
        if (typeof desc !== 'string' || desc.trim() === '')
            continue;
        out.push(name);
    }
    return out;
}
/**
 * 按配置把可用图分成两组。
 *
 * @param source - 条目级表情包配置。
 * @returns 对话组（开关关闭时为空）与其余组。
 */
function groupMemes(source) {
    const names = usableNames(source.memes);
    const limit = Math.floor(Number(source.chatImageLimit));
    // 与宿主 limitPool 同口径：0 / 负数 / 非有限数 = 不限制，取全量。
    const unlimited = !Number.isFinite(limit) || limit <= 0;
    const take = source.chatImageEnabled !== true ? 0 : unlimited ? names.length : Math.min(limit, names.length);
    return { chat: names.slice(0, take), other: names.slice(take) };
}
/** 单张图 → 菜单叶子：点它就是「用这张图说一句」；给了缩略图地址就带上，菜单据此画小图。 */
function memeLeaf(name, thumbOf) {
    const leaf = { label: name, action: 'whisper', image: name };
    if (thumbOf)
        leaf.thumb = thumbOf(name);
    return leaf;
}
/**
 * 表情包图片地址：`<前缀>/pic/memes/<素材根>/<名称>.png`。
 *
 * 两端前缀不同（浏览器是路由前缀、桌面是绝对地址），素材根缺省按 `main`——与宿主 /pic 的
 * 归属语义一致：素材根 = 条目 key，决定走哪条目录链。名称含中文，必须整段编码。
 *
 * @param baseUrl - 路由前缀或绝对地址（不含结尾斜杠）。
 * @param assetRoot - 条目 key（= 素材根）；缺省或空串按 `main`。
 * @param name - 表情包名称（配置里的键，不含扩展名）。
 * @returns 可直接用作 img src 的完整地址。
 */
function memeThumbUrl(baseUrl, assetRoot, name) {
    const root = assetRoot && assetRoot.trim() !== '' ? assetRoot : 'main';
    return baseUrl + '/pic/memes/' + encodeURIComponent(root) + '/' + encodeURIComponent(name) + '.png';
}
/**
 * 造「配图」菜单分支；没有可用图时返回 null（调用方据此不插入这一项）。
 *
 * 分组为空就不出现：开关关着时只剩「其他」一组，只有一组也照常带这层子菜单——
 * 平铺会让图名混进「查看余额 / 碎碎念」那一列，反而看不出它们是配图。
 *
 * @param source - 条目级表情包配置。
 * @param thumbOf - 可选：名称 → 缩略图地址。给了菜单每项就带小图，缺省只有文字。
 * @returns 「配图 →（纳入对话的配图 / 其他）」两级分支。
 */
function buildMemeBranch(source, thumbOf) {
    const { chat, other } = groupMemes(source);
    const leaf = (name) => memeLeaf(name, thumbOf);
    const groups = [];
    if (chat.length > 0)
        groups.push({ label: '纳入对话的配图', children: chat.map(leaf) });
    if (other.length > 0)
        groups.push({ label: '其他', children: other.map(leaf) });
    if (groups.length === 0)
        return null;
    return { label: '配图', children: groups };
}

},
"src/shared/menu/mount.ts": function(exports, require) {
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.mountContextMenu = mountContextMenu;
const position_ts_1 = require("src/shared/menu/position.ts");
function isBranchNode(n) {
    return 'children' in n && Array.isArray(n.children);
}
/** 挂载一个系统风格右键菜单（级联子菜单）到 document.body，位置为视口坐标。
 *  结构：根容器零尺寸，每级面板平级挂载、按触发项屏幕位置贴边定位（优先父面板右侧，
 *  放不下翻到父面板左侧，且不与任何已展开面板重叠）。
 *  级联：悬停分支展开子面板，移到同面板的非分支项收起子面板；指针在菜单树内移动不关闭整棵菜单，
 *  整体离开（root mouseleave，软 200ms）才关闭。
 *  clamp：允许占用的矩形（视口局部坐标）；桌面传「窗口 ∩ 工作区」——宠物贴边时窗口外扩的部分
 *  会被 OS 裁掉，约束进去即可完整显示，窗口与宠物零移动。 */
function mountContextMenu(opts) {
    const { tree, x, y, onAction, onClose, clamp } = opts;
    // 防御：clamp 含非有限值（如坐标来源缺失变成 NaN）时回落整个视口，否则面板会落到 (0,0)
    const c = clamp && Number.isFinite(clamp.x + clamp.y + clamp.w + clamp.h)
        ? clamp
        : { x: 0, y: 0, w: window.innerWidth, h: window.innerHeight };
    const root = document.createElement('div');
    root.className = 'dsh-pet-menu';
    root.style.left = '0px';
    root.style.top = '0px';
    root.addEventListener('contextmenu', (e) => e.preventDefault());
    let closed = false;
    /** 每个面板当前展开的子面板（无 = 未展开）；hideChain 会沿链清除 */
    const openChild = new Map();
    /** 指针整体离开菜单树的兜底关闭定时器（root mouseover 重新进入即取消） */
    let leaveTimer = null;
    /** 关闭某面板及其后代面板整条链（display:none + 清 openChild 链） */
    const hideChain = (panel) => {
        panel.style.display = 'none';
        const child = openChild.get(panel);
        if (child) {
            openChild.delete(panel);
            hideChain(child);
        }
    };
    /** 把子面板摆到触发项旁边：优先父面板右侧，放不下翻到父面板左侧，
     *  且不与任何已展开面板重叠；贴边时夹进 clamp。 */
    const showPanel = (panel, item) => {
        const rect = item.getBoundingClientRect();
        panel.style.left = '';
        panel.style.top = '';
        panel.style.display = 'block';
        const parentEl = item.parentElement;
        const pr = parentEl ? parentEl.getBoundingClientRect() : rect;
        const pick = (0, position_ts_1.pickPanelPosition)({
            panel: { w: panel.offsetWidth, h: panel.offsetHeight },
            item: { left: rect.left, right: rect.right, top: rect.top },
            parent: { left: pr.left, right: pr.right, top: pr.top },
            others: Array.from(root.querySelectorAll('.dsh-pet-menu-column'))
                .filter((p) => p !== panel && p.style.display !== 'none')
                .map((p) => {
                const b = p.getBoundingClientRect();
                return { left: b.left, top: b.top, right: b.right, bottom: b.bottom };
            }),
            clamp: { x: c.x, y: c.y, w: c.w, h: c.h },
        });
        panel.style.left = pick.left + 'px';
        panel.style.top = pick.top + 'px';
    };
    /** 构建一层面板；分支项的子面板平级挂到 root 下、不嵌套。
     *  面板先入 DOM、子面板后入，层级越深绘制越靠上（子菜单盖在父菜单上层）。 */
    const buildPanel = (nodes) => {
        const panel = document.createElement('div');
        panel.className = 'dsh-pet-menu-column';
        panel.style.display = 'none';
        // 桌面 clamp：把列高封顶到可视矩形内（否则 62vh 相对的是窗口高度，可视区更小时仍会溢出被裁）
        if (clamp)
            panel.style.maxHeight = Math.min(460, Math.max(120, c.h - 16)) + 'px';
        root.appendChild(panel);
        for (const node of nodes) {
            const item = document.createElement('div');
            item.className = 'dsh-pet-menu-item';
            if (isBranchNode(node)) {
                item.classList.add('dsh-pet-menu-branch');
                const label = document.createElement('span');
                label.className = 'dsh-pet-menu-label';
                label.textContent = node.label;
                const arrow = document.createElement('span');
                arrow.className = 'dsh-pet-menu-arrow';
                arrow.textContent = '▸';
                item.appendChild(label);
                item.appendChild(arrow);
                const childPanel = buildPanel(node.children); // 递归：子面板已入树（晚于本面板）
                // 悬停分支：先收掉本面板其它分支已展开的子面板链，再展开当前的。
                // 指针在本菜单树内移动绝不自动收起——跨 4px 缝隙或面板间隙都不会触发关闭。
                item.addEventListener('mouseenter', () => {
                    const prev = openChild.get(panel);
                    if (prev && prev !== childPanel)
                        hideChain(prev);
                    openChild.set(panel, childPanel);
                    showPanel(childPanel, item);
                });
            }
            else {
                // 叶子项不展开子菜单；进入时收起同面板已展开的子面板链，否则它会一直挂着
                item.addEventListener('mouseenter', () => {
                    const prev = openChild.get(panel);
                    if (prev)
                        hideChain(prev);
                });
                // 缩略图必须在 label 之前：菜单项是 flex 行，图片靠左、文字紧随其后。
                // 只给配图叶子带 thumb，其余项结构不变（不占位、不改变行高）。
                if (node.thumb) {
                    const thumb = document.createElement('img');
                    thumb.className = 'dsh-pet-menu-thumb';
                    thumb.src = node.thumb;
                    thumb.alt = '';
                    thumb.draggable = false;
                    // 菜单面板可滚动：可视区外的图不必立刻下载（27 张原图共约 4.6MB）。
                    thumb.loading = 'lazy';
                    thumb.decoding = 'async';
                    item.appendChild(thumb);
                    // 图与文字的间距单独收窄（菜单默认 14px 是给「文字 ↔ 箭头」的，配图看着太散）
                    item.classList.add('dsh-pet-menu-item-pic');
                }
                const label = document.createElement('span');
                label.className = 'dsh-pet-menu-label';
                label.textContent = node.label;
                item.appendChild(label);
                // 右侧灰色提示（如快捷键）：与 label 同一 flex 行，space-between 自动贴右
                if (node.hint) {
                    const hint = document.createElement('span');
                    hint.className = 'dsh-pet-menu-hint';
                    hint.textContent = node.hint;
                    item.appendChild(hint);
                }
                item.addEventListener('click', (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    close();
                    onAction(node);
                });
            }
            panel.appendChild(item);
        }
        return panel;
    };
    const rootPanel = buildPanel(tree);
    rootPanel.style.display = 'block';
    // 必须先 append 到文档：未入文档时量不到面板尺寸，一切「静默无显示」
    document.body.appendChild(root);
    // 根面板定位：按 (x,y) 下落，超出 clamp 矩形时夹回（与子面板同一套逻辑但无触发项）
    rootPanel.style.left = '';
    rootPanel.style.top = '';
    const rw = rootPanel.offsetWidth;
    const rh = rootPanel.offsetHeight;
    rootPanel.style.left = Math.max(c.x + 4, Math.min(x, c.x + c.w - rw - 4)) + 'px';
    rootPanel.style.top = Math.max(c.y + 4, Math.min(y, c.y + c.h - rh - 4)) + 'px';
    // 指针整体离开菜单树（离开全部面板的并集）→ 200ms 后关闭整棵菜单；
    // 期间任何指针移动（mouseover 冒泡到 root）都视为仍在菜单内，取消关闭
    root.addEventListener('mouseleave', () => {
        if (leaveTimer !== null)
            window.clearTimeout(leaveTimer);
        leaveTimer = window.setTimeout(() => {
            leaveTimer = null;
            close();
        }, 200);
    });
    root.addEventListener('mouseover', () => {
        if (leaveTimer !== null) {
            window.clearTimeout(leaveTimer);
            leaveTimer = null;
        }
    });
    const onDocPointerDown = (e) => {
        if (closed)
            return;
        if (root.contains(e.target))
            return;
        close();
    };
    const onDocKeyDown = (e) => {
        if (closed)
            return;
        if (e.key === 'Escape')
            close();
    };
    document.addEventListener('mousedown', onDocPointerDown, true);
    document.addEventListener('keydown', onDocKeyDown, true);
    const close = () => {
        if (closed)
            return;
        closed = true;
        if (leaveTimer !== null)
            window.clearTimeout(leaveTimer);
        leaveTimer = null;
        document.removeEventListener('mousedown', onDocPointerDown, true);
        document.removeEventListener('keydown', onDocKeyDown, true);
        root.remove();
        if (onClose)
            onClose();
    };
    return { el: root, close };
}

},
"src/shared/menu/position.ts": function(exports, require) {
"use strict";
/**
 * 面板落点几何：决定级联子菜单摆在父面板的哪一侧，保证不与任何已展开面板重叠。
 * 纯函数，不碰 DOM；调用方只负责读矩形与写样式。
 * @module dsh-pet/src/shared/menu/position
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.pickPanelPosition = pickPanelPosition;
/** 面板与边界、面板之间的间距（px）。 */
const PANEL_GAP = 4;
/**
 * 决定子面板的落点：优先不与任何已展开面板重叠，其次贴边。
 *
 * @param input - 面板尺寸、触发项/父面板矩形、其它面板矩形与 clamp 范围。
 * @returns 面板左上角在视口坐标里的落点。
 */
function pickPanelPosition(input) {
    const { panel, item, parent, others, clamp } = input;
    const minLeft = clamp.x + PANEL_GAP;
    const minTop = clamp.y + PANEL_GAP;
    const maxLeft = clamp.x + clamp.w - PANEL_GAP - panel.w;
    const maxTop = clamp.y + clamp.h - PANEL_GAP - panel.h;
    /** 夹进 clamp；面板比 clamp 还宽/高时贴左上角。 */
    const clampX = (v) => Math.max(minLeft, Math.min(v, Math.max(minLeft, maxLeft)));
    const clampY = (v) => Math.max(minTop, Math.min(v, Math.max(minTop, maxTop)));
    const hitsOther = (left, top) => others.some((b) => left < b.right && left + panel.w > b.left && top < b.bottom && top + panel.h > b.top);
    const fitsClamp = (left, top) => left >= minLeft - 0.5 && left <= maxLeft + 0.5 && top >= minTop - 0.5 && top <= maxTop + 0.5;
    const topAtItem = clampY(item.top);
    const topAtParent = clampY(parent.top);
    // 以父面板（不是触发项）为基准：触发项长在父面板里，按它往左翻必然盖回父面板。
    const cands = [
        { left: parent.right + PANEL_GAP, top: topAtItem },
        { left: parent.left - PANEL_GAP - panel.w, top: topAtItem },
        { left: parent.right + PANEL_GAP, top: topAtParent },
        { left: parent.left - PANEL_GAP - panel.w, top: topAtParent },
    ];
    const ideal = cands.find((cd) => fitsClamp(cd.left, cd.top) && !hitsOther(cd.left, cd.top));
    if (ideal)
        return ideal;
    // 次优：夹进 clamp 后仍要避开其它面板——贴边但不重叠，好过完整落位但压住上层。
    const fitted = cands
        .map((cd) => ({ left: clampX(cd.left), top: clampY(cd.top) }))
        .find((cd) => !hitsOther(cd.left, cd.top));
    if (fitted)
        return fitted;
    // 兜底：窗口太窄，任何落点都会压到——贴父面板右侧夹取，宁可贴边也不叠在一起。
    return { left: clampX(parent.right + PANEL_GAP), top: clampY(topAtItem) };
}

},
"src/shared/menu/tree.ts": function(exports, require) {
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.leaf = exports.MORE_MENU_LABEL = exports.displayMenuBranch = exports.isSleepAllowedAction = void 0;
exports.readMenuItems = readMenuItems;
exports.buildMoreBranch = buildMoreBranch;
exports.buildMenuTree = buildMenuTree;
exports.isNoMirrorAnimation = isNoMirrorAnimation;
/**
 * 菜单树构建：从动画清单与第三方注册项拼出层级，并做镜像动画过滤。
 *
 * 不碰 DOM；输入是配置与注册数据，输出是纯对象树。
 * 必须始终成立：同一份输入必得同一棵树，层级顺序稳定。
 * @module dsh-pet/src/shared/menu/tree
 */
const display_hotkey_ts_1 = require("src/shared/display-hotkey.ts");
/** 睡着时仍然放行的菜单动作：维护类、「叫醒它」本身，以及第三方菜单项。
 *  第三方要做什么由它自己决定——真去驱动宠物时会带占用锁调接口，宿主闸门在那一层再判
 *  （锁优先）。在渲染端先拦掉，等于让「更多」里的第三方入口在睡觉时整体失效。 */
const SLEEP_ALLOWED_ACTIONS = ['sleep', 'wake', 'home', 'set-display', 'reload', 'third-party'];
/** 该菜单动作在睡着时是否放行（两端共用：对话弹窗、待办面板、动作点播都是渲染端行为，宿主闸门拦不到）。 */
const isSleepAllowedAction = (action) => action !== undefined && SLEEP_ALLOWED_ACTIONS.includes(action);
exports.isSleepAllowedAction = isSleepAllowedAction;
/** 四个显示位置的菜单文案；键是 {@link DISPLAY_ORDER} 的元素，顺序以那边为准。 */
const DISPLAY_LABELS = {
    web: '仅网页',
    desktop: '仅桌面',
    both: '两者',
    none: '都不',
};
/** 「显示位置」子菜单：两端注入同一份，文案与设置页的显示位置下拉框一致。
 *  两端各写一份必然漂移，而这一项语义对称：桌面端用它把宠物送走，浏览器端用它送到桌面。
 *  「都不」是单向门（恢复入口是设置页），其余三个值都能从某一端改回来。
 *  右侧键帽由 `1`-`4` 数字键的同一份顺序派生，改顺序只改 {@link DISPLAY_ORDER}。 */
const displayMenuBranch = () => ({
    label: '显示位置',
    children: display_hotkey_ts_1.DISPLAY_ORDER.map((display, index) => ({
        label: DISPLAY_LABELS[display],
        action: 'set-display',
        display,
        hint: display_hotkey_ts_1.DISPLAY_HOTKEY_HINTS[index],
    })),
});
exports.displayMenuBranch = displayMenuBranch;
/** 第三方菜单项统一收在这个一级菜单下（宿主自己的菜单项不进这里）。 */
exports.MORE_MENU_LABEL = '更多';
/** 从 /state 的 sections.menu.data 里读出本端要显示的第三方菜单项。
 *  target 等于本端身份或 both 才收；target 缺失或不认识时按 both 处理——老宿主没有这个字段，
 *  宁可在两端都显示，也不要让一个正在用的第三方菜单凭空消失。
 *  快照来自网络，字段一律按「可能不存在」处理：坏条目静默丢弃，不能让一条数据搞崩菜单。 */
function readMenuItems(data, surface) {
    if (!data || typeof data !== 'object')
        return [];
    const items = data.items;
    if (!Array.isArray(items))
        return [];
    const out = [];
    for (const item of items) {
        if (!item || typeof item !== 'object')
            continue;
        const rec = item;
        // 端过滤：只认三个字面量，其余（缺失 / 写坏）一律当 both
        const rawTarget = rec.target;
        const target = rawTarget === 'web' || rawTarget === 'desktop' || rawTarget === 'both' ? rawTarget : 'both';
        if (target !== 'both' && target !== surface)
            continue;
        const owner = rec.owner;
        const label = rec.label;
        if (typeof owner === 'string' && owner !== '' && typeof label === 'string' && label !== '') {
            out.push({ owner, label });
        }
    }
    return out;
}
/** 「更多」：第三方菜单项的固定容器；没有第三方项时返回 null，菜单里不出现空的「更多」。
 *
 *  层级只按 label 是否重名决定：label 在全部第三方项里唯一 → 直接平铺（`更多 / 弹弓`）；
 *  label 重名 → 每个 owner 各占一个子菜单（`更多 / owner / label`），靠它区分同名项。
 *  重名只可能跨 owner（同一 owner 内 label 按 Map 去重，见 host/menu 的注册表），子项仍是原
 *  label——点击上报的 (owner, label) 与平铺时完全一致，两端点击处理不用分叉。 */
function buildMoreBranch(items) {
    const labelCount = new Map();
    for (const item of items)
        labelCount.set(item.label, (labelCount.get(item.label) ?? 0) + 1);
    const children = [];
    // owner → 该 owner 的重名子菜单；第一次遇到它的重名项时按当时顺序插进 children（保持注册顺序）
    const branches = new Map();
    for (const item of items) {
        if ((labelCount.get(item.label) ?? 0) === 1) {
            children.push({ label: item.label, action: 'third-party', owner: item.owner });
            continue;
        }
        let branch = branches.get(item.owner);
        if (branch === undefined) {
            branch = { label: item.owner, children: [] };
            branches.set(item.owner, branch);
            children.push(branch);
        }
        branch.children.push({ label: item.label, action: 'third-party', owner: item.owner });
    }
    return children.length > 0 ? { label: exports.MORE_MENU_LABEL, children } : null;
}
/** 事件名 → 分类标签（无映射时用事件名本身）。 */
const EVENT_LABELS = {
    balance: '余额档位',
    whisper: '碎碎念',
    workStatus: '工作状态',
};
/** 把动画名包成叶子。 */
const leaf = (anim) => ({ label: anim, anim });
exports.leaf = leaf;
/** 由成品 animations 配置推导菜单树：一级「动作」→ 二级分类 → 三级动画名；空池与空分类自动省略。 */
function buildMenuTree(animations) {
    const groups = [];
    const pools = [
        ['待机', animations.idle],
        ['转向', animations.turn],
        ['拖拽', animations.drag],
        ['点击回应', animations.clicks],
        ['移动', animations.moves.actions.map((m) => m.name)],
    ];
    for (const [label, pool] of pools) {
        if (pool.length)
            groups.push({ label, children: pool.map(exports.leaf) });
    }
    // 随机动作分类：noMirror 分类照样可点播，播放端朝右时强制朝左（见 isNoMirrorAnimation）
    const cats = (animations.categories ?? []).filter((c) => c.actions.length > 0);
    for (const c of cats) {
        groups.push({ label: c.id, children: c.actions.map(exports.leaf) });
    }
    // 事件动画：每个事件一个分类，不来自随机链；数组槽位展平为逐个叶子，候选都可点播预览。
    const events = animations.events ?? {};
    for (const key of Object.keys(events)) {
        const pool = events[key] ?? [];
        const names = [];
        for (const slot of pool) {
            if (typeof slot === 'string')
                names.push(slot);
            else
                names.push(...slot);
        }
        if (names.length)
            groups.push({ label: EVENT_LABELS[key] ?? key, children: names.map(exports.leaf) });
    }
    if (!groups.length)
        return [];
    return [{ label: '动作', children: groups }];
}
/** 该动画是否属于 noMirror 分类（文字类）：朝右镜像时点播前强制朝左，避免文字镜像。 */
function isNoMirrorAnimation(categories, anim) {
    return (categories ?? []).some((c) => c.noMirror === true && c.actions.includes(anim));
}

},
"src/shared/menu/types.ts": function(exports, require) {
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });

},
"src/shared/motion.ts": function(exports, require) {
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.fitWindowInArea = exports.anchorPixel = exports.planMove = void 0;
/**
 * 移动几何、角落定位与窗口落位：纯计算，无 DOM / ref，可独立单测。
 * 移动规划归一化为视口比例，px 换算由调用方完成；角落定位返回宠物根节点左上角的像素坐标。
 * 不负责 rAF 驱动与样式写入，那些在各端的薄壳里。
 * 依赖共享层的选择函数与显示器几何，保证两端算出同一条路线。
 * @module dsh-pet/src/shared/motion
 */
const pickers_ts_1 = require("src/shared/pickers.ts");
const displays_ts_1 = require("src/shared/displays.ts");
/** 计算一次移动的起点/终点比例坐标；目标越出边界（含边距）时返回 null。
 *  sideAllow = 左右透明边余量：边界按身体贴边而不是按整个视频盒贴边，宠物能走到屏幕边缘、身体不越界。
 *  areas 传入时（桌面多显示器）改判工作区并集：缝隙两侧都有屏即可骑缝走过，外接矩形的空洞走不进去；
 *  不传时按 W/H 单矩形判定，浏览器半侧行为不变。 */
const planMove = (o) => {
    const side = o.sideAllow ?? 0;
    const distance = (0, pickers_ts_1.randomBetween)(o.minDist, o.maxDist);
    const target = o.cx + o.dir * distance;
    if (o.areas && o.areas.length > 0) {
        // 身体左右缘各外扩 margin 后都得落在某块屏上（可以分属不同屏 = 允许骑缝行走）
        const bodyHalf = o.halfW - side;
        if (!(0, displays_ts_1.rectAtPoint)(o.areas, target - bodyHalf - o.margin, o.cy))
            return null;
        if (!(0, displays_ts_1.rectAtPoint)(o.areas, target + bodyHalf + o.margin, o.cy))
            return null;
    }
    else {
        // margin 语义 =「身体到屏幕边缘的安全距」：盒中心可到 margin + halfW - side（身体左缘 = margin）
        const leftBound = o.margin + o.halfW - side;
        const rightBound = o.W - o.margin - o.halfW + side;
        if (target < leftBound || target > rightBound)
            return null;
    }
    return {
        startRatio: o.cx / o.W,
        startYRatio: o.cy / o.H,
        targetRatio: target / o.W,
        totalRatio: Math.abs(target - o.cx) / o.W,
    };
};
exports.planMove = planMove;
/**
 * 角落 + 边距 → 宠物根节点左上角像素坐标，与浏览器半侧 overlay 的 CSS 角落语义一致。
 * area 传入时角落取那块屏而不是视口外接矩形：不规则布局下外接矩形的角落可能不属于任何屏，
 * 配了该角落的宠物会开机即隐身，所以桌面端必须传主屏工作区。不传时按 W/H，overlay 行为不变。
 */
const anchorPixel = (o) => {
    const height = (o.size * 9) / 16;
    const a = o.area ?? { x: 0, y: 0, width: o.W, height: o.H };
    const left = a.x + o.marginX;
    const top = a.y + o.marginY;
    const right = a.x + a.width - o.size - o.marginX;
    const bottom = a.y + a.height - height - o.marginY;
    switch (o.corner) {
        case 'top-left':
            return { x: left, y: top };
        case 'top-right':
            return { x: right, y: top };
        case 'bottom-left':
            return { x: left, y: bottom };
        case 'bottom-right':
            return { x: right, y: bottom };
    }
};
exports.anchorPixel = anchorPixel;
/** 单轴钳制：窗口比工作区还大（max < min）时贴住起点，与窗口管理器的行为一致。 */
const clampAxis = (want, min, max) => Math.min(Math.max(want, min), Math.max(min, max));
/**
 * 本体位置 → 窗口落位：窗口尺寸固定，本体在窗口内的偏移随之变化。
 *
 * @remarks
 * 钳窗口的平台允许的窗口位置不含工作区外，探不出去的那一截转成本体在窗口内的偏移，本体落脚点因此
 * 不受钳制影响；`area` 缺省表示该平台不钳窗口，此时偏移恒等于余量。越界那截由窗口裁掉，与网页端
 * 的可见下限同一条规则：宠物能挂出去，但命中区永远留一角可点。
 * @param o - 几何输入：本体位置、窗口与本体尺寸、期望余量、越界允许量、所在屏工作区。
 * @returns 窗口落位与本体偏移；调用方按 { x, y, width, height } 摆窗口，按偏移摆本体。
 */
const fitWindowInArea = (o) => {
    const wantX = o.bodyX - o.insetX;
    const wantY = o.bodyY - o.insetY;
    if (!o.area)
        return { x: wantX, y: wantY, offsetX: o.insetX, offsetY: o.insetY };
    const area = o.area;
    const reach = o.reach ?? { left: 0, right: 0, top: 0, bottom: 0 };
    // 本体能摆到哪：工作区再外扩 reach。越界那截由窗口裁掉，命中区仍留一角可点
    const bodyX = clampAxis(o.bodyX, area.x - reach.left, (0, displays_ts_1.rectRight)(area) - o.bodyWidth + reach.right);
    const bodyY = clampAxis(o.bodyY, area.y - reach.top, (0, displays_ts_1.rectBottom)(area) - o.bodyHeight + reach.bottom);
    // 窗口只跟着本体走，但被系统钳在工作区内；差出来的那截就是本体在窗口内的偏移
    const x = clampAxis(bodyX - o.insetX, area.x, (0, displays_ts_1.rectRight)(area) - o.width);
    const y = clampAxis(bodyY - o.insetY, area.y, (0, displays_ts_1.rectBottom)(area) - o.height);
    return { x, y, offsetX: bodyX - x, offsetY: bodyY - y };
};
exports.fitWindowInArea = fitWindowInArea;

},
"src/shared/notify.ts": function(exports, require) {
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.MAX_BODY = exports.NOTIFY_ICONS = void 0;
exports.truncate = truncate;
exports.frameToToast = frameToToast;
/**
 * 系统通知：DSH 事件帧 → toast 文案的映射，只随浏览器半侧走。
 * 帧由宿主半侧监听 DSH 宿主事件生成（见 host/notify-events.ts），浏览器轮询 /notify 的增量队列消费本映射。
 * 桌面模式是宠物本体，不重复实现通知（宠物不等于通知，「两端一致」只约束宠物行为）。
 * 纯函数无副作用：帧形状不匹配或不认识的类型一律返回 null，不弹也不报错。
 * @module dsh-pet/src/shared/notify
 */
/** 通知图标文件名（不含扩展名）；浏览器半侧拼完整 URL：/dsh-pet-7340/pic/<name>.png。 */
exports.NOTIFY_ICONS = {
    done: 'notify-done',
    error: 'notify-error',
    truncated: 'notify-truncated',
    approval: 'notify-approval',
    question: 'notify-question',
    test: 'notify-test',
};
/** 文案截断长度上限（字符）。 */
exports.MAX_BODY = 80;
/** 会话名在标题里的截断上限（字符）：名字只是认人用，太长会把事件类型挤出标题那一行。 */
const MAX_SESSION_NAME = 30;
/** 文案截断（与弹窗一致：超长只留前 80 字符）。 */
function truncate(text) {
    return text.length > exports.MAX_BODY ? text.slice(0, exports.MAX_BODY) + '…' : text;
}
/** 会话名 → 能放进标题的名字：去掉首尾空白并截断；没有名字时返回 undefined。 */
function sessionNameOf(sessionTitle) {
    const name = sessionTitle?.trim();
    if (!name)
        return undefined;
    return name.length > MAX_SESSION_NAME ? name.slice(0, MAX_SESSION_NAME) + '…' : name;
}
/** 「会话名 · 事件」形式的标题；没有会话名时只留事件类型。 */
function composeTitle(sessionTitle, label) {
    const name = sessionNameOf(sessionTitle);
    return name ? name + ' · ' + label : label;
}
/**
 * 帧 → toast 文案；不认识的类型或 turn/end 的非弹分支（aborted 等）返回 null。
 *
 * @param frame - 宿主半侧转发的通知帧。
 * @param sessionTitle - 这条帧所属会话的显示名；有它时标题带上会话名，用户同时开着多个会话也能认出是哪一条。
 *   取不到就传 undefined，标题回落固定文案，不影响弹窗。
 */
function frameToToast(frame, sessionTitle) {
    switch (frame.type) {
        case 'session/event': {
            const ev = (frame.event ?? {});
            if (ev.type !== 'turn/end')
                return null;
            const kind = ev.data?.reason?.kind;
            if (kind === 'completed') {
                const text = typeof ev.data?.text === 'string' ? ev.data.text.trim() : '';
                // 完成通知的标题就是会话名本身：正文已经在讲「这条回复讲了什么」，
                // 再缀一个「对话完成」只是占位，多会话时反而挤掉了认人的信息。
                return {
                    title: sessionNameOf(sessionTitle) ?? '对话完成',
                    body: text ? truncate(text) : '',
                    icon: exports.NOTIFY_ICONS.done,
                };
            }
            if (kind === 'error')
                return {
                    title: composeTitle(sessionTitle, '生成失败'),
                    body: ev.data?.reason?.error?.message ?? '',
                    icon: exports.NOTIFY_ICONS.error,
                };
            if (kind === 'max-tokens')
                return {
                    title: composeTitle(sessionTitle, '输出被截断'),
                    body: '已达到输出 token 上限',
                    icon: exports.NOTIFY_ICONS.truncated,
                };
            // aborted（用户/父代理取消）、interrupted（崩溃恢复）等：不弹
            return null;
        }
        case 'approval/requested': {
            const toolName = typeof frame.toolName === 'string' ? frame.toolName : '';
            const reason = typeof frame.reason === 'string' && frame.reason ? frame.reason : '';
            return {
                title: composeTitle(sessionTitle, '正在申请权限'),
                body: (toolName ? '工具「' + toolName + '」' : '') + (reason ? '：' + reason : ''),
                icon: exports.NOTIFY_ICONS.approval,
            };
        }
        case 'question/requested': {
            const q = (Array.isArray(frame.questions) && frame.questions[0]?.question) || '';
            return { title: composeTitle(sessionTitle, '模型在等你回答'), body: q, icon: exports.NOTIFY_ICONS.question };
        }
        case 'host/agent-error': {
            return {
                title: '生成失败',
                body: typeof frame.message === 'string' ? frame.message : '',
                icon: exports.NOTIFY_ICONS.error,
            };
        }
        default:
            return null;
    }
}

},
"src/shared/pet-size.ts": function(exports, require) {
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SIZE_PERCENT_DEFAULT = exports.SIZE_PERCENT_MIN = void 0;
exports.isValidSizePercent = isValidSizePercent;
exports.resolvePetSizePx = resolvePetSizePx;
/**
 * 宠物实际渲染宽度的解析：把「像素上限 + 人物占屏百分比」合成画框宽度（px）。
 *
 * 百分比说的是**人物本体**占屏宽多少，而 stage 是 16:9 画框、两侧各留 0.3125 的透明边，
 * 所以换算要除以人物占画框的比例（{@link BODY_WIDTH_RATIO}）。纯函数，不读 DOM。
 * @module dsh-pet/src/shared/pet-size
 */
const constants_ts_1 = require("src/shared/constants.ts");
/** 人物本体宽度占画框宽度的比例；由命中框反推（240/640），不在别处再写一份 0.375。 */
const BODY_WIDTH_RATIO = (constants_ts_1.HIT_BOX.x1 - constants_ts_1.HIT_BOX.x0) / 640;
/** 百分比下限（%）：小于它等于没写。不设上限——填 150 就是「人物比屏还宽」，由 `size` 决定画框最终多大。 */
exports.SIZE_PERCENT_MIN = 1;
/** 默认值：人物占屏宽的 20%——小屏不糊脸，宽屏下实际仍被 `size` 这个画框上限夹住。 */
exports.SIZE_PERCENT_DEFAULT = 20;
/**
 * 百分比是否可用：必须是有限数字，且不小于下限。
 *
 * @param value - 配置里的原始值，可能未定义。
 * @returns 可用时 true 并把类型收窄为 number；`undefined`、字符串、`NaN`、`< 1` 均为 false。
 */
function isValidSizePercent(value) {
    return typeof value === 'number' && Number.isFinite(value) && value >= exports.SIZE_PERCENT_MIN;
}
/**
 * 取本次挂载使用的宽度。
 *
 * @param sizePx - 配置里的画框宽度，同时是百分比的上限（百分比算出的画框超过它就取它）。
 * @param sizePercent - 人物占屏宽的百分比；缺省按 {@link SIZE_PERCENT_DEFAULT} 处理。
 * @param viewportWidthPx - 调用时刻的视口宽（CSS 像素）；非正数表示拿不到，直接回落到 `sizePx`。
 * @returns 实际渲染的画框宽度，单位 px。
 */
function resolvePetSizePx(sizePx, sizePercent, viewportWidthPx) {
    const percent = sizePercent ?? exports.SIZE_PERCENT_DEFAULT;
    if (!isValidSizePercent(percent))
        return sizePx;
    if (!Number.isFinite(viewportWidthPx) || viewportWidthPx <= 0)
        return sizePx;
    const bodyWidthPx = (viewportWidthPx * percent) / 100;
    return Math.min(sizePx, bodyWidthPx / BODY_WIDTH_RATIO);
}

},
"src/shared/physics.ts": function(exports, require) {
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.bodyPixelBox = exports.springStep = exports.softClampSpeed = exports.trimTrail = exports.throwVelocity = exports.slingshotVelocity = exports.slingshotRefDist = exports.slingshotPower = exports.pullAngle = exports.estimateReleaseVelocity = exports.throwSubsteps = exports.throwStepRegion = exports.throwStep = exports.throwSpace = exports.throwBoundsIn = exports.throwBounds = exports.screenOfBox = exports.squashScale = exports.landingSquash = exports.TRAIL_KEEP_MS = exports.THROW_SPEED_ANCHOR = exports.SUBSTEP_PX = exports.SUBSTEP_MAX = exports.SQ_SQUASH = exports.SQ_SOFT_SPEED = exports.SQ_MAX_SQUASH = exports.SQ_HARD_SPEED = exports.SQ_DURATION_MS = exports.SPRING_K = exports.SPRING_C = exports.SLINGSHOT_REF_RATIO = exports.SEG_MIN_DT_MS = exports.REST_TANGENT = exports.REST_NORMAL_EPS = exports.REST_NORMAL = exports.RESTITUTION = exports.RELEASE_WINDOW_MS = exports.RELEASE_STALE_MS = exports.PET_BOUNCE_E = exports.PEAK_WEIGHT = exports.MIN_SPAN_MS = exports.MAX_THROW_SPEED = exports.MAX_STEP_DT = exports.GROUND_FRICTION = exports.GRAVITY = exports.DEFAULT_THROW_POWER = exports.DEFAULT_PHYSICS = exports.DEAD_ZONE_SPEED = exports.ACCEL_REF = exports.ACCEL_GAIN_MAX = void 0;
exports.rectsOverlap = exports.overlapPush = exports.collidePet = void 0;
/**
 * 拖拽抛掷物理的公开出口：常量、弹簧、挤压、抛掷与碰撞。
 *
 * 只做再导出，不含逻辑；子模块按变化原因分居 ./physics/。
 * 必须始终成立：浏览器半侧与桌面 Helper 消费同一份实现，手感不得分叉。
 * @module dsh-pet/src/shared/physics
 */
var constants_ts_1 = require("src/shared/physics/constants.ts");
Object.defineProperty(exports, "ACCEL_GAIN_MAX", { enumerable: true, get: function () { return constants_ts_1.ACCEL_GAIN_MAX; } });
Object.defineProperty(exports, "ACCEL_REF", { enumerable: true, get: function () { return constants_ts_1.ACCEL_REF; } });
Object.defineProperty(exports, "DEAD_ZONE_SPEED", { enumerable: true, get: function () { return constants_ts_1.DEAD_ZONE_SPEED; } });
Object.defineProperty(exports, "DEFAULT_PHYSICS", { enumerable: true, get: function () { return constants_ts_1.DEFAULT_PHYSICS; } });
Object.defineProperty(exports, "DEFAULT_THROW_POWER", { enumerable: true, get: function () { return constants_ts_1.DEFAULT_THROW_POWER; } });
Object.defineProperty(exports, "GRAVITY", { enumerable: true, get: function () { return constants_ts_1.GRAVITY; } });
Object.defineProperty(exports, "GROUND_FRICTION", { enumerable: true, get: function () { return constants_ts_1.GROUND_FRICTION; } });
Object.defineProperty(exports, "MAX_STEP_DT", { enumerable: true, get: function () { return constants_ts_1.MAX_STEP_DT; } });
Object.defineProperty(exports, "MAX_THROW_SPEED", { enumerable: true, get: function () { return constants_ts_1.MAX_THROW_SPEED; } });
Object.defineProperty(exports, "MIN_SPAN_MS", { enumerable: true, get: function () { return constants_ts_1.MIN_SPAN_MS; } });
Object.defineProperty(exports, "PEAK_WEIGHT", { enumerable: true, get: function () { return constants_ts_1.PEAK_WEIGHT; } });
Object.defineProperty(exports, "PET_BOUNCE_E", { enumerable: true, get: function () { return constants_ts_1.PET_BOUNCE_E; } });
Object.defineProperty(exports, "RELEASE_STALE_MS", { enumerable: true, get: function () { return constants_ts_1.RELEASE_STALE_MS; } });
Object.defineProperty(exports, "RELEASE_WINDOW_MS", { enumerable: true, get: function () { return constants_ts_1.RELEASE_WINDOW_MS; } });
Object.defineProperty(exports, "RESTITUTION", { enumerable: true, get: function () { return constants_ts_1.RESTITUTION; } });
Object.defineProperty(exports, "REST_NORMAL", { enumerable: true, get: function () { return constants_ts_1.REST_NORMAL; } });
Object.defineProperty(exports, "REST_NORMAL_EPS", { enumerable: true, get: function () { return constants_ts_1.REST_NORMAL_EPS; } });
Object.defineProperty(exports, "REST_TANGENT", { enumerable: true, get: function () { return constants_ts_1.REST_TANGENT; } });
Object.defineProperty(exports, "SEG_MIN_DT_MS", { enumerable: true, get: function () { return constants_ts_1.SEG_MIN_DT_MS; } });
Object.defineProperty(exports, "SLINGSHOT_REF_RATIO", { enumerable: true, get: function () { return constants_ts_1.SLINGSHOT_REF_RATIO; } });
Object.defineProperty(exports, "SPRING_C", { enumerable: true, get: function () { return constants_ts_1.SPRING_C; } });
Object.defineProperty(exports, "SPRING_K", { enumerable: true, get: function () { return constants_ts_1.SPRING_K; } });
Object.defineProperty(exports, "SQ_DURATION_MS", { enumerable: true, get: function () { return constants_ts_1.SQ_DURATION_MS; } });
Object.defineProperty(exports, "SQ_HARD_SPEED", { enumerable: true, get: function () { return constants_ts_1.SQ_HARD_SPEED; } });
Object.defineProperty(exports, "SQ_MAX_SQUASH", { enumerable: true, get: function () { return constants_ts_1.SQ_MAX_SQUASH; } });
Object.defineProperty(exports, "SQ_SOFT_SPEED", { enumerable: true, get: function () { return constants_ts_1.SQ_SOFT_SPEED; } });
Object.defineProperty(exports, "SQ_SQUASH", { enumerable: true, get: function () { return constants_ts_1.SQ_SQUASH; } });
Object.defineProperty(exports, "SUBSTEP_MAX", { enumerable: true, get: function () { return constants_ts_1.SUBSTEP_MAX; } });
Object.defineProperty(exports, "SUBSTEP_PX", { enumerable: true, get: function () { return constants_ts_1.SUBSTEP_PX; } });
Object.defineProperty(exports, "THROW_SPEED_ANCHOR", { enumerable: true, get: function () { return constants_ts_1.THROW_SPEED_ANCHOR; } });
Object.defineProperty(exports, "TRAIL_KEEP_MS", { enumerable: true, get: function () { return constants_ts_1.TRAIL_KEEP_MS; } });
var squash_ts_1 = require("src/shared/physics/squash.ts");
Object.defineProperty(exports, "landingSquash", { enumerable: true, get: function () { return squash_ts_1.landingSquash; } });
Object.defineProperty(exports, "squashScale", { enumerable: true, get: function () { return squash_ts_1.squashScale; } });
var throw_ts_1 = require("src/shared/physics/throw.ts");
Object.defineProperty(exports, "screenOfBox", { enumerable: true, get: function () { return throw_ts_1.screenOfBox; } });
Object.defineProperty(exports, "throwBounds", { enumerable: true, get: function () { return throw_ts_1.throwBounds; } });
Object.defineProperty(exports, "throwBoundsIn", { enumerable: true, get: function () { return throw_ts_1.throwBoundsIn; } });
Object.defineProperty(exports, "throwSpace", { enumerable: true, get: function () { return throw_ts_1.throwSpace; } });
Object.defineProperty(exports, "throwStep", { enumerable: true, get: function () { return throw_ts_1.throwStep; } });
Object.defineProperty(exports, "throwStepRegion", { enumerable: true, get: function () { return throw_ts_1.throwStepRegion; } });
Object.defineProperty(exports, "throwSubsteps", { enumerable: true, get: function () { return throw_ts_1.throwSubsteps; } });
var release_ts_1 = require("src/shared/physics/release.ts");
Object.defineProperty(exports, "estimateReleaseVelocity", { enumerable: true, get: function () { return release_ts_1.estimateReleaseVelocity; } });
Object.defineProperty(exports, "pullAngle", { enumerable: true, get: function () { return release_ts_1.pullAngle; } });
Object.defineProperty(exports, "slingshotPower", { enumerable: true, get: function () { return release_ts_1.slingshotPower; } });
Object.defineProperty(exports, "slingshotRefDist", { enumerable: true, get: function () { return release_ts_1.slingshotRefDist; } });
Object.defineProperty(exports, "slingshotVelocity", { enumerable: true, get: function () { return release_ts_1.slingshotVelocity; } });
Object.defineProperty(exports, "throwVelocity", { enumerable: true, get: function () { return release_ts_1.throwVelocity; } });
Object.defineProperty(exports, "trimTrail", { enumerable: true, get: function () { return release_ts_1.trimTrail; } });
var spring_ts_1 = require("src/shared/physics/spring.ts");
Object.defineProperty(exports, "softClampSpeed", { enumerable: true, get: function () { return spring_ts_1.softClampSpeed; } });
Object.defineProperty(exports, "springStep", { enumerable: true, get: function () { return spring_ts_1.springStep; } });
var collide_ts_1 = require("src/shared/physics/collide.ts");
Object.defineProperty(exports, "bodyPixelBox", { enumerable: true, get: function () { return collide_ts_1.bodyPixelBox; } });
Object.defineProperty(exports, "collidePet", { enumerable: true, get: function () { return collide_ts_1.collidePet; } });
Object.defineProperty(exports, "overlapPush", { enumerable: true, get: function () { return collide_ts_1.overlapPush; } });
Object.defineProperty(exports, "rectsOverlap", { enumerable: true, get: function () { return collide_ts_1.rectsOverlap; } });

},
"src/shared/physics/collide.ts": function(exports, require) {
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.overlapPush = exports.collidePet = exports.rectsOverlap = exports.bodyPixelBox = void 0;
/**
 * 宠物之间的碰撞：包围盒换算、重叠判定与一次弹性分离。
 *
 * 不做多体求解，也不改渲染；只回答「撞没撞、撞后速度多少」。
 * 必须始终成立：只算一次分离，不迭代求解。
 * @module dsh-pet/src/shared/physics/collide
 */
const constants_ts_1 = require("src/shared/constants.ts");
const constants_ts_2 = require("src/shared/physics/constants.ts");
/** 身体包围盒（HIT_BOX 命中框比例换算到视口像素）：碰撞相交检测的几何。
 *  box = 宠物包围盒左上角（浏览器 root 的 left/top、桌面窗口位置）；
 *  bottomPad = 舞台脚底垫高（stage 被 translateY 下移的量）。 */
const bodyPixelBox = (o) => {
    const h = (o.size * 9) / 16;
    return {
        left: o.x + (constants_ts_1.HIT_BOX.x0 / 640) * o.size,
        top: o.y + o.bottomPad + (constants_ts_1.HIT_BOX.y0 / 360) * h,
        right: o.x + (constants_ts_1.HIT_BOX.x1 / 640) * o.size,
        bottom: o.y + o.bottomPad + (constants_ts_1.HIT_BOX.y1 / 360) * h,
    };
};
exports.bodyPixelBox = bodyPixelBox;
/** 两矩形是否相交（碰撞检测）。 */
const rectsOverlap = (a, b) => a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
exports.rectsOverlap = rectsOverlap;
/** 飞行中的宠物撞到另一只：近乎弹性碰撞（动量守恒 + 恢复系数 0.995），质量 ∝ size²。
 *  法向 = 两包围盒中心连线，法向速度按一维动量公式重分配，切向分量各自保留（无切向摩擦）。
 *  返回 null = 中心重合定不出法向，或两者正在分离（避免重叠帧反复弹跳抖动）。
 *  impactSpeed 是法向相对速度，供触觉反馈换算强度。 */
const collidePet = (fly, hit) => {
    const hf = (fly.size * 9) / 16 / 2;
    const hh = (hit.size * 9) / 16 / 2;
    const cx = hit.x + hit.size / 2 - (fly.x + fly.size / 2);
    const cy = hit.y + hh - (fly.y + hf);
    const dist = Math.hypot(cx, cy);
    if (dist < 1e-6)
        return null; // 中心重合：无法定碰撞法向，跳过本帧
    const nx = cx / dist;
    const ny = cy / dist;
    // 相对速度在法向的投影（碰撞方向 = fly → hit，正 = 正在接近）
    const vrel = (fly.vx - hit.vx) * nx + (fly.vy - hit.vy) * ny;
    if (vrel <= 0)
        return null; // 正在分离：不再弹（避免重叠帧反复触发）
    const e = constants_ts_2.PET_BOUNCE_E;
    const m1 = fly.size * fly.size;
    const m2 = hit.size * hit.size;
    const v1n = fly.vx * nx + fly.vy * ny;
    const v2n = hit.vx * nx + hit.vy * ny;
    const v1n2 = ((m1 - e * m2) * v1n + (1 + e) * m2 * v2n) / (m1 + m2);
    const v2n2 = ((m2 - e * m1) * v2n + (1 + e) * m1 * v1n) / (m1 + m2);
    // 组合：切向分量（原速度 − 法向分量）不变 + 新法向分量
    return {
        fvx: fly.vx - v1n * nx + v1n2 * nx,
        fvy: fly.vy - v1n * ny + v1n2 * ny,
        hvx: hit.vx - v2n * nx + v2n2 * nx,
        hvy: hit.vy - v2n * ny + v2n2 * ny,
        impactSpeed: vrel,
    };
};
exports.collidePet = collidePet;
/**
 * 两个身体框重叠时的最短推出位移：只算几何、不碰速度。
 *
 * 速度交换（{@link collidePet}）在两者正在分离时返回 null，光靠它会让已经插在一起的两只
 * 直接穿过去；补这一个纯位移量才能把它们推开。
 *
 * @param a - 自己的身体框。
 * @param b - 对方的身体框。
 * @returns 推 a 离 b 的位移（各让一半）；不重叠时返回 `null`。
 */
const overlapPush = (a, b) => {
    const ox = Math.min(a.right, b.right) - Math.max(a.left, b.left);
    const oy = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
    if (ox <= 0 || oy <= 0)
        return null;
    const alongX = ox <= oy;
    const sign = alongX
        ? (a.left + a.right) / 2 >= (b.left + b.right) / 2
            ? 1
            : -1
        : (a.top + a.bottom) / 2 >= (b.top + b.bottom) / 2
            ? 1
            : -1;
    return alongX ? { dx: (sign * ox) / 2, dy: 0 } : { dx: 0, dy: (sign * oy) / 2 };
};
exports.overlapPush = overlapPush;

},
"src/shared/physics/constants.ts": function(exports, require) {
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PET_BOUNCE_E = exports.SUBSTEP_MAX = exports.SUBSTEP_PX = exports.SLINGSHOT_REF_RATIO = exports.THROW_SPEED_ANCHOR = exports.SQ_MAX_SQUASH = exports.SQ_HARD_SPEED = exports.SQ_SOFT_SPEED = exports.SQ_DURATION_MS = exports.SQ_SQUASH = exports.MAX_STEP_DT = exports.REST_NORMAL_EPS = exports.REST_TANGENT = exports.REST_NORMAL = exports.DEFAULT_THROW_POWER = exports.DEFAULT_PHYSICS = exports.GROUND_FRICTION = exports.RESTITUTION = exports.GRAVITY = exports.ACCEL_GAIN_MAX = exports.ACCEL_REF = exports.PEAK_WEIGHT = exports.MAX_THROW_SPEED = exports.DEAD_ZONE_SPEED = exports.SEG_MIN_DT_MS = exports.MIN_SPAN_MS = exports.RELEASE_STALE_MS = exports.RELEASE_WINDOW_MS = exports.TRAIL_KEEP_MS = exports.SPRING_C = exports.SPRING_K = void 0;
/** 拖拽弹簧刚度：越大跟手越紧。 */
exports.SPRING_K = 200;
/** 拖拽弹簧阻尼：ζ = c/(2√k) ≈ 1.06，过阻尼，不 overshoot。 */
exports.SPRING_C = 30;
/** 拖拽轨迹保留窗口（ms）：只留最近这一段做初速估算。 */
exports.TRAIL_KEEP_MS = 200;
/** 初速估算窗口（ms）。 */
exports.RELEASE_WINDOW_MS = 150;
/** 松手前停顿超过它即温柔放下（不带残余速度），即使之前甩过。 */
exports.RELEASE_STALE_MS = 150;
/** 窗口太短视为不可估算（ms）。 */
exports.MIN_SPAN_MS = 20;
/** 分段速度的最小 dt（ms）：高回报率鼠标事件可低至 1ms，过小 dt 会把抖动放大成虚假峰值。 */
exports.SEG_MIN_DT_MS = 8;
/** 低于此速度即不抛（原地放下），px/s。 */
exports.DEAD_ZONE_SPEED = 500;
/** 甩出速度软上限（px/s）：cap×(1-e^(-s/cap))，任意力度仍单调可区分，渐近不超过 cap。 */
exports.MAX_THROW_SPEED = 3600;
/** 初速大小 = 端点均值×(1-w) + 窗口峰值×w，弥补快甩时位移集中在窗口内一小段的低估。 */
exports.PEAK_WEIGHT = 0.5;
/** 参考加速度（px/s²）：末段加速达到它即吃满增益。 */
exports.ACCEL_REF = 8000;
/** 加速度增益上限：仍在加速的甩动最多放大 60%。 */
exports.ACCEL_GAIN_MAX = 0.6;
// 抛掷物理默认值：与内置 config 的 physics 段一致，运行时以成品配置为准
/** 抛掷重力（px/s²）。 */
exports.GRAVITY = 1400;
/** 碰边恢复系数：每次反弹保留约 78% 速度。 */
exports.RESTITUTION = 0.78;
/** 接触面切向摩擦（/s）：撞墙、落地、撞顶后沿接触面方向的速度衰减率；0 = 四面都像冰面。 */
exports.GROUND_FRICTION = 2.5;
/** 抛掷物理的默认参数（与内置配置一致；仅作配置缺失时的兜底）。 */
exports.DEFAULT_PHYSICS = {
    gravity: exports.GRAVITY,
    restitution: exports.RESTITUTION,
    groundFriction: exports.GROUND_FRICTION,
    ceilingBounce: true,
    throwPower: 1,
    petCollision: true,
    hapticEnabled: true,
    tiltGravity: true,
    shakeThrow: true,
};
/** 总力度默认量（throwPower=1 即现状）。 */
exports.DEFAULT_THROW_POWER = 1;
/** 接触面法向速度低于它就贴住（px/s）：否则重力持续压向同一面时每帧都被反弹，表现为贴面抖动。 */
exports.REST_NORMAL = 40;
/** 接触面切向速度低于它认为已静止（px/s）。 */
exports.REST_TANGENT = 15;
/** 判静止时法向速度的容差（px/s）：比 {@link REST_NORMAL} 严得多，只用于确认「已经贴住」。 */
exports.REST_NORMAL_EPS = 1;
/** 单步最大 dt（s）：防后台标签页卡顿恢复后的巨帧跳变。 */
exports.MAX_STEP_DT = 0.05;
/** 下压幅度：高度压到 55%。 */
exports.SQ_SQUASH = 0.55;
/** 挤压时长（ms）。 */
exports.SQ_DURATION_MS = 220;
/** 落地冲击速度基准：低于此即轻落（按下限幅度）。 */
exports.SQ_SOFT_SPEED = 300;
/** 落地冲击速度上限：达到或超过此即重砸（吃满最大下压）。 */
exports.SQ_HARD_SPEED = 1500;
/** 落地最大下压幅度（与点击一致）；轻落下限 0.8——重力 1400px/s²、恢复 0.78 下典型落地速度
 *  400~1500px/s，映射太保守会让常规甩抛的落地 Q 弹不明显，故底部留底限。 */
exports.SQ_MAX_SQUASH = 0.55;
/** 抛掷指令的力度锚点：power = 1.0 对应软钳速之前的 1200 px/s（实际初速被压到约 1021 px/s）。 */
exports.THROW_SPEED_ANCHOR = 1200;
/** 弹弓（双击第二下按住拖）：力度 = 拉距，与手速无关。
 *  拉距只负责换成初速度，之后照旧走 throwStep / throwStepRegion，重力、反弹、摩擦、Q 弹都不变。
 *  方向 = 拉的反方向；力度不设上限——软钳速是为手速抖动设的，拉得远与拉得更远必须能区分开。
 *  刻度与 throwVelocity 同源：power = 1 对应 THROW_SPEED_ANCHOR，并乘同一个 physics.throwPower。
 *  「一倍力度」的参考拉距 = 宠物宽 × SLINGSHOT_REF_RATIO。 */
exports.SLINGSHOT_REF_RATIO = 0.6;
// 积分细分：弹弓没有速度上限，靠拆步保证一帧内的落地与反弹不被跳过，不是力度上限
/** 单步允许的最大位移（px）：一帧位移超过它就拆成多步积分。 */
exports.SUBSTEP_PX = 8;
/** 单帧最多拆几步（兜底：极端速度下别把一帧拖成几百次积分）。 */
exports.SUBSTEP_MAX = 64;
/** 多宠物碰撞恢复系数：能量损失约 0.5%（e = 0.995，接近完全弹性）。 */
exports.PET_BOUNCE_E = 0.995;

},
"src/shared/physics/contact.ts": function(exports, require) {
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.isRestingOnContacts = exports.resolveContact = exports.CONTACT_NORMALS = void 0;
const constants_ts_1 = require("src/shared/physics/constants.ts");
/** 每个接触面的单位法向（nx, ny），朝向可通行的一侧。 */
exports.CONTACT_NORMALS = {
    left: { nx: 1, ny: 0 },
    right: { nx: -1, ny: 0 },
    ceiling: { nx: 0, ny: 1 },
    floor: { nx: 0, ny: -1 },
};
/**
 * 求一次接触后的速度：法向按恢复系数反弹，低于阈值即贴住归零；切向只按摩擦衰减。
 *
 * @param speed - 撞击后的速度（px/s），法向分量由接触面决定，不要求是竖直或水平。
 * @param edge - 撞到的边。
 * @param physics - 恢复系数与切向摩擦。
 * @param dt - 本步时长（s），摩擦按它换算衰减量。
 * @returns 出射速度；法向 / 切向分量供 {@link isRestingOnContacts} 判静止。
 */
const resolveContact = (speed, edge, physics, dt) => {
    const { nx, ny } = exports.CONTACT_NORMALS[edge];
    const tx = -ny;
    const ty = nx;
    const vn = speed.vx * nx + speed.vy * ny;
    const vt = speed.vx * tx + speed.vy * ty;
    // 法向速度低于阈值就归零：否则重力持续压向同一面时每帧都被反弹回去，表现为贴面抖动。
    const normalSpeed = Math.abs(vn) < constants_ts_1.REST_NORMAL ? 0 : Math.abs(vn) * physics.restitution;
    // 切向只衰减、不改方向：撞墙时它是 vy，落地与撞顶时它是 vx。
    const tangentSpeed = vt * Math.max(0, 1 - physics.groundFriction * dt);
    return {
        vx: normalSpeed * nx + tangentSpeed * tx,
        vy: normalSpeed * ny + tangentSpeed * ty,
        normalSpeed,
        tangentSpeed,
    };
};
exports.resolveContact = resolveContact;
/**
 * 本步接触是否都已静止：每个接触面的法向速度≈0 且切向速度低于阈值。
 *
 * @param edges - 本步接触到的边；空数组表示没碰到任何面。
 * @param speed - 求完接触后的速度（px/s）。
 * @returns 全部接触面都贴住且切向低速时为 `true`。
 */
const isRestingOnContacts = (edges, speed) => {
    if (edges.length === 0)
        return false;
    return edges.every((edge) => {
        const { nx, ny } = exports.CONTACT_NORMALS[edge];
        const normal = Math.abs(speed.vx * nx + speed.vy * ny);
        const tangent = Math.abs(speed.vx * -ny + speed.vy * nx);
        return normal < constants_ts_1.REST_NORMAL_EPS && tangent < constants_ts_1.REST_TANGENT;
    });
};
exports.isRestingOnContacts = isRestingOnContacts;

},
"src/shared/physics/release.ts": function(exports, require) {
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.estimateReleaseVelocity = exports.slingshotVelocity = exports.pullAngle = exports.slingshotPower = exports.slingshotRefDist = exports.throwVelocity = exports.trimTrail = void 0;
const constants_ts_1 = require("src/shared/physics/constants.ts");
const spring_ts_1 = require("src/shared/physics/spring.ts");
/** 剔除保留窗口外的旧采样；采样按时间追加，所以只需从头裁。 */
const trimTrail = (trail, now) => {
    const cutoff = now - constants_ts_1.TRAIL_KEEP_MS;
    let i = 0;
    while (i < trail.length && trail[i].t < cutoff)
        i++;
    return i === 0 ? trail : trail.slice(i);
};
exports.trimTrail = trimTrail;
/** 抛掷指令（POST /throw 的 angle + power）→ 初速度 (vx, vy)，px/s。
 *  angle 单位度，0 = 正右、逆时针为正——屏幕 y 向下，所以 vy 取负（往上抛写 90，不是 270）。
 *  初速 = power × THROW_SPEED_ANCHOR 再过既有软上限，任意 power 都单调可区分且不超过 MAX_THROW_SPEED。
 *  两端共用本函数，保证接口抛掷的初速换算严格一致。 */
const throwVelocity = (angleDeg, power) => {
    const speed = (0, spring_ts_1.softClampSpeed)(power * constants_ts_1.THROW_SPEED_ANCHOR);
    const rad = (angleDeg * Math.PI) / 180;
    return { vx: Math.cos(rad) * speed, vy: -Math.sin(rad) * speed };
};
exports.throwVelocity = throwVelocity;
/** 「一倍力度」的参考拉距（px），随宠物尺寸缩放——小宠物不必拖同样远才炸。 */
const slingshotRefDist = (size) => (size > 0 ? size * constants_ts_1.SLINGSHOT_REF_RATIO : 0);
exports.slingshotRefDist = slingshotRefDist;
/** 拉距 → 力度倍率（px / 参考拉距）：线性、单调、不夹取；0 拉距 = 0 力度。 */
const slingshotPower = (dist, size) => {
    const ref = (0, exports.slingshotRefDist)(size);
    if (!(ref > 0) || !(dist > 0) || !Number.isFinite(dist))
        return 0;
    return dist / ref;
};
exports.slingshotPower = slingshotPower;
/** 拉向量（起点 → 松手点，屏幕坐标，y 向下）→ 弹射角度（度）：弹的是拉的反方向，角度约定同 throwVelocity。 */
const pullAngle = (pullX, pullY) => (Math.atan2(pullY, -pullX) * 180) / Math.PI;
exports.pullAngle = pullAngle;
/** 弹弓初速：角度约定与力度锚点同 throwVelocity，但没有软上限（任意 power 都单调可区分）。 */
const slingshotVelocity = (angleDeg, power, throwPower = constants_ts_1.DEFAULT_THROW_POWER) => {
    const speed = constants_ts_1.THROW_SPEED_ANCHOR * Math.max(0, power) * Math.max(0, throwPower);
    // 0 力度直接给 0（而不是算出来 cos/sin 的 -0）：叶子里的速度要能当普通数字比较
    if (speed === 0)
        return { vx: 0, vy: 0 };
    const rad = (angleDeg * Math.PI) / 180;
    return { vx: Math.cos(rad) * speed, vy: -Math.sin(rad) * speed };
};
exports.slingshotVelocity = slingshotVelocity;
/** 由拖拽轨迹估算松手初速 (vx, vy)，px/s。
 *  方向取窗口首末端点的位移（抗抖）；大小 = 端点平均与窗口峰值按 PEAK_WEIGHT 加权，
 *  末段仍在加速时按 ACCEL_REF 给增益（最多 ACCEL_GAIN_MAX），再过软钳速。
 *  软钳速之后整体乘 physics.throwPower，让初速与死区判定一起线性缩放。
 *  返回 null = 温柔放下（轨迹为空 / 停留过久 / 窗口太短 / 峰值低于死区），调用方不抛。 */
const estimateReleaseVelocity = (trail, now, physics = constants_ts_1.DEFAULT_PHYSICS) => {
    if (trail.length === 0)
        return null;
    const last = trail[trail.length - 1];
    if (now - last.t > constants_ts_1.RELEASE_STALE_MS)
        return null;
    const win = trail.filter((s) => now - s.t <= constants_ts_1.RELEASE_WINDOW_MS);
    if (win.length < 2)
        return null;
    const t0 = win[0].t;
    const x0 = win[0].x;
    const y0 = win[0].y;
    const t1 = win[win.length - 1].t;
    const x1 = win[win.length - 1].x;
    const y1 = win[win.length - 1].y;
    const spanMs = t1 - t0;
    if (spanMs < constants_ts_1.MIN_SPAN_MS)
        return null;
    const baseVx = ((x1 - x0) / spanMs) * 1000;
    const baseVy = ((y1 - y0) / spanMs) * 1000;
    const baseSpeed = Math.hypot(baseVx, baseVy);
    if (baseSpeed < 1e-6)
        return null; // 窗口内几乎纯抖动：没有可靠方向，按原地放下处理
    // 分段速度（过密采样向前合并，dt 下限 SEG_MIN_DT_MS）
    const segSpeeds = [];
    let px = x0;
    let py = y0;
    let pt = t0;
    for (const s of win.slice(1)) {
        const dt = s.t - pt;
        if (dt >= constants_ts_1.SEG_MIN_DT_MS) {
            segSpeeds.push({ speed: (Math.hypot(s.x - px, s.y - py) / dt) * 1000, tEnd: s.t });
            px = s.x;
            py = s.y;
            pt = s.t;
        }
    }
    const peakSpeed = segSpeeds.length ? Math.max(...segSpeeds.map((v) => v.speed)) : baseSpeed;
    // 末段加速度：末段峰值速度相对首段的斜率，仍在加速的甩动据此放大初速
    let accel = 0;
    if (segSpeeds.length >= 2) {
        const lastSeg = segSpeeds[segSpeeds.length - 1];
        const firstSeg = segSpeeds[0];
        accel = (lastSeg.speed - firstSeg.speed) / Math.max((lastSeg.tEnd - firstSeg.tEnd) / 1000, constants_ts_1.MIN_SPAN_MS / 1000);
    }
    const speedBeforeClamp = ((1 - constants_ts_1.PEAK_WEIGHT) * baseSpeed + constants_ts_1.PEAK_WEIGHT * peakSpeed) *
        (1 + Math.min(Math.max(accel, 0) / constants_ts_1.ACCEL_REF, 1) * constants_ts_1.ACCEL_GAIN_MAX);
    const speed = (0, spring_ts_1.softClampSpeed)(speedBeforeClamp) * physics.throwPower;
    if (speed < constants_ts_1.DEAD_ZONE_SPEED)
        return null;
    return { vx: (baseVx / baseSpeed) * speed, vy: (baseVy / baseSpeed) * speed };
};
exports.estimateReleaseVelocity = estimateReleaseVelocity;

},
"src/shared/physics/spring.ts": function(exports, require) {
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.softClampSpeed = exports.springStep = void 0;
/**
 * 跟手弹簧与限速：把指针位移变成平滑的跟手速度。
 *
 * 不读时钟、不写状态；dt 由调用方按帧传入。
 * 必须始终成立：dt 需小于 MAX_STEP_DT，否则阶跃过大。
 * @module dsh-pet/src/shared/physics/spring
 */
const constants_ts_1 = require("src/shared/physics/constants.ts");
/** 过阻尼弹簧单轴速度步进：调用方随后 x += v*dt。
 *  power = 总力度（K/C 同乘：系统形态不变，收敛速度快 p 倍，即更跟手或更松）。 */
const springStep = (v, x, target, dt, power = constants_ts_1.DEFAULT_THROW_POWER) => v + ((target - x) * constants_ts_1.SPRING_K - v * constants_ts_1.SPRING_C) * power * dt;
exports.springStep = springStep;
/** 软钳速：cap×(1-e^(-s/cap))，任意速度下单调可区分、渐近不超过 cap。
 *  抛掷指令与拖拽甩抛走同一条限速，手感一致。 */
const softClampSpeed = (speed) => {
    if (speed <= 0)
        return 0;
    return constants_ts_1.MAX_THROW_SPEED * (1 - Math.exp(-speed / constants_ts_1.MAX_THROW_SPEED));
};
exports.softClampSpeed = softClampSpeed;

},
"src/shared/physics/squash.ts": function(exports, require) {
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.squashScale = exports.landingSquash = void 0;
/**
 * 落地挤压：按冲击速度换算出瞬时压扁比例。
 *
 * 不做碰撞检测、不改位置；只回答「这一下该压多扁」。
 * 必须始终成立：返回值落在 [SQ_MAX_SQUASH, 0.8]，超出即视为调用方算错了速度。
 * @module dsh-pet/src/shared/physics/squash
 */
const constants_ts_1 = require("src/shared/physics/constants.ts");
/** 落地冲击速度 → 下压幅度（速度越大压得越狠），结果作为 startSquash 的 squash 参数。 */
const landingSquash = (impactSpeed) => {
    const t = Math.min(Math.max((Math.abs(impactSpeed) - constants_ts_1.SQ_SOFT_SPEED) / (constants_ts_1.SQ_HARD_SPEED - constants_ts_1.SQ_SOFT_SPEED), 0), 1);
    return Math.min(0.8, 1 - t * (1 - constants_ts_1.SQ_MAX_SQUASH));
};
exports.landingSquash = landingSquash;
/** Q 弹挤压曲线：u∈[0,1] 进度 → scaleY。
 *  下压段（0~0.45）ease-in 压缩，回弹段（0.45~1）easeOutBack 带回约 4% 过冲，两端共用同一曲线。 */
const squashScale = (u, squash = constants_ts_1.SQ_SQUASH) => {
    if (u < 0.45) {
        const p = u / 0.45;
        return 1 - (1 - squash) * p * p;
    }
    const p = (u - 0.45) / 0.55;
    // easeOutBack 的标准过冲系数
    const c1 = 1.70158;
    const c3 = c1 + 1;
    const f = 1 + c3 * Math.pow(p - 1, 3) + c1 * Math.pow(p - 1, 2);
    return Math.min(1.12, squash + (1 - squash) * Math.max(f, 0));
};
exports.squashScale = squashScale;

},
"src/shared/physics/throw.ts": function(exports, require) {
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.throwSubsteps = exports.throwStepRegion = exports.throwStep = exports.screenOfBox = exports.throwSpace = exports.throwBoundsIn = exports.throwBounds = void 0;
const displays_ts_1 = require("src/shared/displays.ts");
const constants_ts_1 = require("src/shared/physics/constants.ts");
const contact_ts_1 = require("src/shared/physics/contact.ts");
/** 由 W/H/size 计算抛掷碰撞边界：身体（盒内缩 sideAllow）贴屏幕边缘才反弹。 */
const throwBounds = (o) => {
    const h = (o.size * 9) / 16;
    return { minX: -o.sideAllow, minY: 0, maxX: o.W - o.size + o.sideAllow, maxY: o.H - h };
};
exports.throwBounds = throwBounds;
/** 同 throwBounds，但基于任意一块工作区矩形（原点不必是 0）；area 取整个视口时两者逐位相同。 */
const throwBoundsIn = (area, size, sideAllow) => {
    const h = (size * 9) / 16;
    return {
        minX: area.x - sideAllow,
        minY: area.y,
        maxX: (0, displays_ts_1.rectRight)(area) - size + sideAllow,
        maxY: (0, displays_ts_1.rectBottom)(area) - h,
    };
};
exports.throwBoundsIn = throwBoundsIn;
/** 由工作区列表构造抛掷空间（单块屏时等价于 throwBounds）。 */
const throwSpace = (o) => ({
    bounds: o.areas.map((a) => (0, exports.throwBoundsIn)(a, o.size, o.sideAllow)),
    areas: o.areas,
    panels: o.panels && o.panels.length === o.areas.length ? o.panels : o.areas, // 面板缺失或不同序：退化用工作区
    size: o.size,
    sideAllow: o.sideAllow,
});
exports.throwSpace = throwSpace;
/** 宠物当前该归属哪块屏：身体中心所在屏，落在空洞里时取最近的一块。 */
const screenOfBox = (space, x, y) => {
    const cx = x + space.size / 2;
    const cy = y + (space.size * 9) / 16 / 2;
    const hit = (0, displays_ts_1.indexAtPoint)(space.areas, cx, cy);
    return hit >= 0 ? hit : (0, displays_ts_1.nearestIndex)(space.areas, cx, cy);
};
exports.screenOfBox = screenOfBox;
/** 抛体单步积分与边界反弹。返回值带上两个标志：bounced = 本步是否碰边或落地，
 *  atRest = 所有接触面都已贴住且切向低速，调用方应停止循环；contacts = 本步接触到的边。
 *  physics 取成品配置的物理参数，缺失时用默认值兜底；gravity 覆盖重力方向与大小（缺省竖直向下）。 */
const throwStep = (s, dtRaw, b, physics = constants_ts_1.DEFAULT_PHYSICS, gravity) => {
    const dt = Math.min(Math.max(dtRaw, 0), constants_ts_1.MAX_STEP_DT);
    const g = gravity ?? { gx: 0, gy: physics.gravity };
    let { x, y, vx, vy } = s;
    vx += g.gx * dt;
    vy += g.gy * dt;
    x += vx * dt;
    y += vy * dt;
    let bounced = false;
    let hit = null;
    const contacts = [];
    /** 同一步撞到两条边（角落）时 hit 留更重的那个（手感只按主撞击算），contacts 全量保留。 */
    const record = (edge, speed) => {
        contacts.push(edge);
        if (hit === null || speed > hit.speed)
            hit = { edge, speed };
    };
    if (x < b.minX) {
        record('left', Math.abs(vx));
        x = b.minX;
        const out = (0, contact_ts_1.resolveContact)({ vx, vy }, 'left', physics, dt);
        vx = out.vx;
        vy = out.vy;
        bounced = true;
    }
    else if (x > b.maxX) {
        record('right', Math.abs(vx));
        x = b.maxX;
        const out = (0, contact_ts_1.resolveContact)({ vx, vy }, 'right', physics, dt);
        vx = out.vx;
        vy = out.vy;
        bounced = true;
    }
    if (y < b.minY) {
        // ceilingBounce=false：顶部无边界，不夹不弹——宠物飞出屏幕顶部，靠重力落回（y 保持越界状态）
        if (physics.ceilingBounce) {
            record('ceiling', Math.abs(vy));
            y = b.minY;
            const out = (0, contact_ts_1.resolveContact)({ vx, vy }, 'ceiling', physics, dt);
            vx = out.vx;
            vy = out.vy;
            bounced = true;
        }
    }
    else if (y >= b.maxY) {
        record('floor', Math.abs(vy));
        y = b.maxY;
        const out = (0, contact_ts_1.resolveContact)({ vx, vy }, 'floor', physics, dt);
        vx = out.vx;
        vy = out.vy;
        bounced = true;
    }
    return { x, y, vx, vy, bounced, atRest: (0, contact_ts_1.isRestingOnContacts)(contacts, { vx, vy }), hit, contacts };
};
exports.throwStep = throwStep;
/** 多屏抛掷步进：物理与 throwStep 同一套，区别是边界取自身体中心所在屏，越界后多问一句越界侧有没有屏。
 *  越界侧有别的屏就原样放行（不夹不弹，自然跨屏飞行或落到下一块屏），什么都没有才按该边反弹。
 *  探测用完整面板而不是工作区：任务栏位于上下屏接缝时 workArea 之间会空出一条带，按工作区探测
 *  会把接缝当墙，宠物永远穿不过去。探测点取当前面板的边外第一像素，面板底即物理屏底。
 *  放行时不改位置也不记录当前屏，下一帧由身体中心重新定位——相邻两屏的 AABB 在缝隙处留有
 *  2×sideAllow 宽的重叠盲区，改成「越界即切屏」会在盲区里逐帧对跳。
 *  lockScreen ≥ 0 表示锁定该屏（confineToScreen）：边界恒取该屏、跳过邻屏探测，屏缝与空洞一样当墙；
 *  索引越界（飞行途中拔掉显示器）即退回不锁定，免得拿一块不存在的屏当边界。 */
const throwStepRegion = (s, dtRaw, space, physics = constants_ts_1.DEFAULT_PHYSICS, lockScreen = -1, gravity) => {
    const dt = Math.min(Math.max(dtRaw, 0), constants_ts_1.MAX_STEP_DT);
    const g = gravity ?? { gx: 0, gy: physics.gravity };
    let { x, y, vx, vy } = s;
    vx += g.gx * dt;
    vy += g.gy * dt;
    x += vx * dt;
    y += vy * dt;
    if (space.areas.length === 0) {
        return { x, y, vx, vy, screen: -1, bounced: false, atRest: false, hit: null, contacts: [] };
    }
    const h = (space.size * 9) / 16;
    let bounced = false;
    let hit = null;
    const contacts = [];
    /** 同一步撞到两条边时 hit 留更重的那个，与 {@link throwStep} 同口径；contacts 全量保留。 */
    const record = (edge, speed) => {
        contacts.push(edge);
        if (hit === null || speed > hit.speed)
            hit = { edge, speed };
    };
    // 锁定屏（confineToScreen）：索引越界（飞行途中拔掉显示器导致屏数变少）即视为不锁定
    const locked = Number.isInteger(lockScreen) && lockScreen >= 0 && lockScreen < space.areas.length;
    /** 该用哪块屏的 AABB / 工作区 / 面板：锁定时恒为锁定屏，否则取身体中心所在屏 */
    const pick = (i) => (locked ? lockScreen : i);
    // 横向：边界来自身体中心所在屏，放行与否看缝外同高度处有没有像素
    let cur = (0, exports.screenOfBox)(space, x, y);
    let b = space.bounds[pick(cur)];
    let a = space.areas[pick(cur)];
    const pa = space.panels[pick(cur)] || a;
    const cy = y + h / 2;
    if (x < b.minX) {
        if (locked || (0, displays_ts_1.indexAtPoint)(space.panels, pa.x - 1, cy) < 0) {
            record('left', Math.abs(vx));
            x = b.minX;
            const out = (0, contact_ts_1.resolveContact)({ vx, vy }, 'left', physics, dt);
            vx = out.vx;
            vy = out.vy;
            bounced = true;
        }
    }
    else if (x > b.maxX) {
        if (locked || (0, displays_ts_1.indexAtPoint)(space.panels, (0, displays_ts_1.rectRight)(pa), cy) < 0) {
            record('right', Math.abs(vx));
            x = b.maxX;
            const out = (0, contact_ts_1.resolveContact)({ vx, vy }, 'right', physics, dt);
            vx = out.vx;
            vy = out.vy;
            bounced = true;
        }
    }
    // 纵向：横向若被夹回，身体中心可能已换屏，重新定位
    cur = (0, exports.screenOfBox)(space, x, y);
    b = space.bounds[pick(cur)];
    a = space.areas[pick(cur)];
    const pa2 = space.panels[pick(cur)] || a;
    const cx = x + space.size / 2;
    if (y < b.minY) {
        // ceilingBounce=false：顶部无边界，不夹不弹——宠物飞出屏幕顶部，靠重力落回
        if (physics.ceilingBounce && (locked || (0, displays_ts_1.indexAtPoint)(space.panels, cx, pa2.y - 1) < 0)) {
            record('ceiling', Math.abs(vy));
            y = b.minY;
            const out = (0, contact_ts_1.resolveContact)({ vx, vy }, 'ceiling', physics, dt);
            vx = out.vx;
            vy = out.vy;
            bounced = true;
        }
    }
    else if (y >= b.maxY) {
        // 下方还有一块屏（上下排布的桌面）⇒ 不当地面，继续往下掉
        if (locked || (0, displays_ts_1.indexAtPoint)(space.panels, cx, (0, displays_ts_1.rectBottom)(pa2)) < 0) {
            record('floor', Math.abs(vy));
            y = b.maxY;
            const out = (0, contact_ts_1.resolveContact)({ vx, vy }, 'floor', physics, dt);
            vx = out.vx;
            vy = out.vy;
            bounced = true;
        }
    }
    cur = pick((0, exports.screenOfBox)(space, x, y));
    return {
        x,
        y,
        vx,
        vy,
        screen: cur,
        bounced,
        atRest: (0, contact_ts_1.isRestingOnContacts)(contacts, { vx, vy }),
        hit,
        contacts,
    };
};
exports.throwStepRegion = throwStepRegion;
/** 一帧该积几步（整数 ≥ 1）。N = 1 是常态：普通甩抛一帧位移远小于 8px；
 *  只有弹弓拉得很远、初速几千 px/s 时才拆多步，否则一帧跨过上百 px 会跳过落地与反弹那几帧。
 *  dt 先按 MAX_STEP_DT 夹取（与 throwStep 内部同源），保证步数算的就是实际要积的时间。 */
const throwSubsteps = (vx, vy, dt) => {
    const travel = Math.hypot(vx, vy) * Math.min(Math.max(dt, 0), constants_ts_1.MAX_STEP_DT);
    if (!(travel > constants_ts_1.SUBSTEP_PX))
        return 1;
    return Math.min(constants_ts_1.SUBSTEP_MAX, Math.ceil(travel / constants_ts_1.SUBSTEP_PX));
};
exports.throwSubsteps = throwSubsteps;

},
"src/shared/pickers.ts": function(exports, require) {
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.pickCategoryAction = exports.rollKind = exports.pickWeightedCategory = exports.randomBetween = exports.nextWorkStatusAnim = exports.isEventAnim = exports.poolIncludes = exports.slotIncludes = exports.pickSlot = exports.pickSleepSet = exports.pick = void 0;
/** 从池里等概率抽一个；exclude 避开某个名字（减少连续重复）。 */
const pick = (pool, exclude) => {
    const entries = exclude ? pool.filter((n) => n !== exclude) : pool;
    // 排除后池空（单元素池 + 排除自己）：退回原池抽，宁可重复也不返回 undefined
    const src = entries.length ? entries : pool;
    return src[Math.floor(Math.random() * src.length)];
};
exports.pick = pick;
/**
 * 挑一套睡觉动作：整套随机，调用方拿到的三段必须来自同一套（否则会「蹲着入睡、趴着醒来」）。
 *
 * @param sets - 配置里的 sleep 套数组；段内多候选由调用方对选中的那套再 `pick` 一次。
 * @returns 选中的套；空数组返回 null，调用方据此隐藏「睡觉」入口。
 */
const pickSleepSet = (sets) => sets.length > 0 ? sets[Math.floor(Math.random() * sets.length)] : null;
exports.pickSleepSet = pickSleepSet;
/** 事件档位取值：字符串槽位原样返回（固定播放）；数组槽位 = 档内候选，随机抽 1 并尽量避开 exclude。
 *  排除后池空（单候选且排除自己）退回原数组——宁可重复，也不返回 undefined。 */
const pickSlot = (slot, exclude) => {
    if (typeof slot === 'string')
        return slot;
    const entries = exclude === undefined ? slot : slot.filter((n) => n !== exclude);
    const src = entries.length ? entries : slot;
    return src[Math.floor(Math.random() * src.length)];
};
exports.pickSlot = pickSlot;
/** 槽位是否包含某动画名：字符串按名比，数组查成员——直接 includes 会漏掉数组槽位。 */
const slotIncludes = (slot, anim) => typeof slot === 'string' ? slot === anim : slot.includes(anim);
exports.slotIncludes = slotIncludes;
/** 事件池（档位槽位数组）是否包含某动画名。 */
const poolIncludes = (pool, anim) => pool.some((slot) => (0, exports.slotIncludes)(slot, anim));
exports.poolIncludes = poolIncludes;
/** 整个 events 段是否包含某动画名。 */
const isEventAnim = (events, anim) => events ? Object.values(events).some((pool) => (0, exports.poolIncludes)(pool, anim)) : false;
exports.isEventAnim = isEventAnim;
/** 工作状态播完（ended）后的续播决策：找到包含 current 的档位，多候选档位则返回档内下一候选
 *  （排除 current，避免连抽），让长时间状态自动轮换；单候选档位或动画不属于该池则返回 null。
 *  两端共用同一份决策，轮换行为严格一致。 */
const nextWorkStatusAnim = (pool, current) => {
    const idx = pool.findIndex((slot) => (0, exports.slotIncludes)(slot, current));
    if (idx === -1)
        return null;
    const slot = pool[idx];
    if (!Array.isArray(slot) || slot.length <= 1)
        return null;
    return (0, exports.pickSlot)(slot, current);
};
exports.nextWorkStatusAnim = nextWorkStatusAnim;
/** 生成 [min, max) 区间内的随机整数。 */
const randomBetween = (min, max) => Math.floor(min + Math.random() * (max - min));
exports.randomBetween = randomBetween;
/** 按权重在分类池中选一个分类；镜像（朝右）时排除 noMirror 分类并归一化剩余权重，池空返回 null。 */
const pickWeightedCategory = (categories, facing) => {
    const cats = categories.filter((c) => c.actions.length > 0);
    if (!cats.length)
        return null;
    const filtered = cats.filter((c) => !(c.noMirror && facing === 'right'));
    const eligible = filtered.length ? filtered : cats;
    const totalW = eligible.reduce((s, c) => s + c.weight, 0) || 1;
    let t = Math.random() * totalW;
    for (const c of eligible) {
        t -= c.weight;
        if (t <= 0)
            return c;
    }
    return eligible[eligible.length - 1];
};
exports.pickWeightedCategory = pickWeightedCategory;
/** 按权重掷骰：roll ∈ [0,1) → 下一个动画类别。
 *  (idle + turn + move) / 100 是这三档的占比之和，剩余概率归入 action。
 *  opts.fixed 为真时 turn / move 权重按 0 算，只可能返回 idle 或 action。
 *  两端共用本函数，随机链行为严格一致。 */
const rollKind = (roll, w, opts) => {
    const turn = opts?.fixed ? 0 : w.turn;
    const move = opts?.fixed ? 0 : w.move;
    const topEnd = (w.idle + turn + move) / 100;
    if (roll < w.idle / 100)
        return 'idle';
    if (roll < (w.idle + turn) / 100)
        return 'turn';
    if (roll < topEnd)
        return 'move';
    return 'action';
};
exports.rollKind = rollKind;
/** 从分类池选一个动作；无可用分类时回退 idle 池。
 *  facing 用于 noMirror 过滤，current 用于避免连续重复。 */
const pickCategoryAction = (categories, idlePool, facing, current) => {
    const cat = (0, exports.pickWeightedCategory)(categories, facing);
    if (!cat)
        return { id: 'FALLBACK', name: (0, exports.pick)(idlePool, current) };
    return { id: cat.id, name: (0, exports.pick)(cat.actions, current) };
};
exports.pickCategoryAction = pickCategoryAction;

},
"src/shared/playback.ts": function(exports, require) {
"use strict";
/**
 * 播放状态词汇表：宿主受理（`accepted`）、渲染端可上报的四种状态，以及哪些是终态。
 * 两端共用同一份定义：宿主的状态机与浏览器侧的回执都从这取，避免各写一套字面量最后对不上。
 * 不是状态机：转移规则在宿主 `playback` 里，这里只有词汇。
 * @module dsh-pet/src/shared/playback
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.REPORTABLE_STATUSES = exports.TERMINAL_STATUSES = void 0;
/** 终态：到达后不可再变。 */
exports.TERMINAL_STATUSES = ['ended', 'failed', 'cancelled'];
/** 渲染端可上报的状态集合。 */
exports.REPORTABLE_STATUSES = ['playing', 'ended', 'failed', 'cancelled'];

},
"src/shared/score-popup.ts": function(exports, require) {
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SCORE_MIN_SPEED = exports.clickScore = exports.SCORE_POPUP_CSS = exports.SCORE_POPUP_DURATION_MS = void 0;
exports.spawnScoreBurst = spawnScoreBurst;
exports.mountScorePopup = mountScorePopup;
/**
 * 点击积分弹窗与粒子爆发：两端共用同一份渲染。
 * 纯逻辑（阈值与分数映射）在 score.ts，本文件只做展示——粒子在点击处爆开，
 * 弹窗显示 +N 分与速度/大小明细，点外或 Esc 立即关闭。
 * @module dsh-pet/src/shared/score-popup
 */
const score_ts_1 = require("src/shared/score.ts");
Object.defineProperty(exports, "clickScore", { enumerable: true, get: function () { return score_ts_1.clickScore; } });
Object.defineProperty(exports, "SCORE_MIN_SPEED", { enumerable: true, get: function () { return score_ts_1.SCORE_MIN_SPEED; } });
/** 弹窗展示时长（ms）：积分反馈比气泡（10s）短，够读即可。 */
exports.SCORE_POPUP_DURATION_MS = 2200;
/** 弹窗样式 —— 两端注入同一份。 */
exports.SCORE_POPUP_CSS = [
    '.dsh-pet-score{position:fixed;z-index:2147483002;min-width:120px;text-align:center;',
    'background:rgba(255,255,255,.97);border:1px solid rgba(255,179,0,.35);border-radius:12px;',
    'box-shadow:0 10px 32px rgba(0,0,0,.22);padding:8px 16px 9px;user-select:none;pointer-events:auto;',
    // 字体族走全局配置变量（两端注入在 documentElement）：弹窗挂在 body 下，继承不到宠物根容器。
    // 字号固定 px——配置的 font.size 只作用于气泡与悬浮提示。
    "font-family:var(--dsh-pet-font-family,'ShangshouSoftCandy','Yuanti SC','YouYuan','幼圆','Comic Sans MS','PingFang SC','Microsoft YaHei',sans-serif);}",
    '.dsh-pet-score.is-in{animation:dshPetScorePop .28s ease}',
    '.dsh-pet-score-val{font-size:22px;line-height:1.25;font-weight:700;color:#ff8f00;font-variant-numeric:tabular-nums}',
    '.dsh-pet-score-sub{font-size:11px;line-height:1.4;color:rgba(43,43,43,.6);margin-top:2px;white-space:nowrap}',
    // 粒子层：整屏固定、不挡交互；粒子为绝对定位小圆点，位移与透明度由 rAF 直接写
    '.dsh-pet-score-burst{position:fixed;inset:0;pointer-events:none;z-index:2147483002}',
    '.dsh-pet-score-particle{position:absolute;border-radius:50%;pointer-events:none}',
    '@keyframes dshPetScorePop{from{transform:scale(.6);opacity:0}to{transform:scale(1);opacity:1}}',
].join('');
/** 样式只注入一次（同 CHAT_CSS 的注入模式）。 */
let scoreCssInjected = false;
function injectScoreCss() {
    if (scoreCssInjected || typeof document === 'undefined')
        return;
    scoreCssInjected = true;
    const tag = document.createElement('style');
    tag.dataset.plugin = 'dsh-pet';
    tag.dataset.pluginCss = 'dsh-pet/score';
    tag.textContent = exports.SCORE_POPUP_CSS;
    document.head.appendChild(tag);
}
/** 粒子数量。 */
const BURST_COUNT = 20;
/** 初速范围（px/s）。 */
const BURST_SPEED_MIN = 120;
const BURST_SPEED_MAX = 460;
/** 重力（px/s²）：粒子向上喷出后回落。 */
const BURST_GRAVITY = 700;
/** 单粒子寿命范围（ms）。 */
const BURST_LIFE_MIN = 500;
const BURST_LIFE_MAX = 900;
/** 粒子半径范围（px）。 */
const BURST_RADIUS_MIN = 3;
const BURST_RADIUS_MAX = 7;
/** 暖色盘（积分与庆祝感）。 */
const BURST_COLORS = ['#ffb300', '#ff8f00', '#ff7043', '#f4511e', '#ffc400', '#ffd54f', '#ef5350'];
/** 在 (x, y) 爆开一圈暖色粒子（视口坐标）：随机方向初速 + 重力回落 + 淡出，寿命结束整体清理。
 *  prefers-reduced-motion 时跳过（与 Q 弹同语义）。 */
function spawnScoreBurst(x, y) {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches)
        return;
    injectScoreCss();
    const root = document.createElement('div');
    root.className = 'dsh-pet-score-burst';
    document.body.appendChild(root);
    const parts = [];
    for (let i = 0; i < BURST_COUNT; i++) {
        const angle = Math.random() * Math.PI * 2;
        const speed = BURST_SPEED_MIN + Math.random() * (BURST_SPEED_MAX - BURST_SPEED_MIN);
        const r = BURST_RADIUS_MIN + Math.random() * (BURST_RADIUS_MAX - BURST_RADIUS_MIN);
        const el = document.createElement('div');
        el.className = 'dsh-pet-score-particle';
        el.style.left = x + 'px';
        el.style.top = y + 'px';
        el.style.width = r * 2 + 'px';
        el.style.height = r * 2 + 'px';
        el.style.background = BURST_COLORS[Math.floor(Math.random() * BURST_COLORS.length)];
        root.appendChild(el);
        parts.push({
            el,
            vx: Math.cos(angle) * speed,
            vy: Math.sin(angle) * speed - 80,
            t0: performance.now(),
            life: BURST_LIFE_MIN + Math.random() * (BURST_LIFE_MAX - BURST_LIFE_MIN),
        });
    }
    const step = () => {
        const now = performance.now();
        let alive = false;
        for (const p of parts) {
            const tSec = (now - p.t0) / 1000;
            const lifeRatio = (now - p.t0) / p.life;
            if (lifeRatio >= 1)
                continue;
            alive = true;
            // 分析式轨迹：x = vx·t，y = vy·t + ½g·t²（不用逐帧累积，避免丢帧漂移）
            p.el.style.transform =
                'translate(' + p.vx * tSec + 'px,' + (p.vy * tSec + 0.5 * BURST_GRAVITY * tSec * tSec) + 'px)';
            p.el.style.opacity = String(Math.max(0, 1 - lifeRatio));
        }
        if (alive)
            requestAnimationFrame(step);
        else
            root.remove();
    };
    requestAnimationFrame(step);
}
/** 挂载点击积分弹窗：显示 +N 分与速度/大小明细，SCORE_POPUP_DURATION_MS 后自动消失，点外或 Esc 关闭。
 *  位置为视口坐标，超出视口自动夹回；分数由调用方用 clickScore 算好传入。 */
function mountScorePopup(opts) {
    injectScoreCss();
    // 弹窗显示在点击点上方（避开手指/光标），超出视口夹回
    const x = opts.x;
    const y = opts.y;
    const root = document.createElement('div');
    root.className = 'dsh-pet-score';
    const val = document.createElement('div');
    val.className = 'dsh-pet-score-val';
    val.textContent = '+' + opts.score;
    const sub = document.createElement('div');
    sub.className = 'dsh-pet-score-sub';
    sub.textContent = '速度 ' + Math.round(opts.speed) + ' · 大小 ' + Math.round(opts.size);
    root.appendChild(val);
    root.appendChild(sub);
    document.body.appendChild(root);
    // 定位（先量后定位；同 mountChatDialog）
    const rr = root.getBoundingClientRect();
    root.style.left = Math.max(4, Math.min(x - rr.width / 2, window.innerWidth - rr.width - 4)) + 'px';
    root.style.top = Math.max(4, y - rr.height - 14) + 'px';
    // 强制重排后再加动画类，保证入场动画可见
    void root.offsetWidth;
    root.classList.add('is-in');
    let closed = false;
    let timer = null;
    const close = () => {
        if (closed)
            return;
        closed = true;
        if (timer !== null)
            window.clearTimeout(timer);
        timer = null;
        document.removeEventListener('mousedown', onDocPointerDown, true);
        document.removeEventListener('keydown', onDocKeyDown, true);
        root.remove();
        if (opts.onClose)
            opts.onClose();
    };
    // 挂载宽限期：弹窗由 pointerdown 触发（按下即弹），同一事件之后浏览器还会派发兼容的 mousedown；
    // 没有宽限期，刚挂上的弹窗会被自己的「点外关闭」当场关掉，所以只吞掉挂载后的第一个 mousedown。
    const mountedAt = performance.now();
    let graceConsumed = false;
    const onDocPointerDown = (e) => {
        if (closed)
            return;
        if (!graceConsumed) {
            graceConsumed = true;
            if (e.timeStamp - mountedAt < 300)
                return; // 同一次按下的兼容 mousedown:忽略
        }
        if (root.contains(e.target))
            return;
        close();
    };
    const onDocKeyDown = (e) => {
        if (closed)
            return;
        if (e.key === 'Escape')
            close();
    };
    document.addEventListener('mousedown', onDocPointerDown, true);
    document.addEventListener('keydown', onDocKeyDown, true);
    timer = window.setTimeout(close, exports.SCORE_POPUP_DURATION_MS);
    return { el: root, close };
}

},
"src/shared/score.ts": function(exports, require) {
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.clickScore = exports.SCORE_MIN_SPEED = void 0;
/**
 * 点击积分：飞行中的宠物被点击时按速度与体型算分，速度越快、宠物越小分越高。
 * 不负责达标判定与展示——阈值由调用方判，弹窗与粒子在 score-popup。
 * 依赖 constants 的基准宠物宽度换算体型加成。
 * @module dsh-pet/src/shared/score
 */
const constants_ts_1 = require("src/shared/constants.ts");
/** 达标速度阈值（px/s）：飞行中被点击时低于它不给分（低速点击维持普通点击动画）。 */
exports.SCORE_MIN_SPEED = 400;
/** 每 100 px/s 记 1 分（基准尺寸 462px 下）。 */
const SCORE_SPEED_PER_POINT = 100;
/** 点击积分：score = round(speed/100 × 462/size)，至少 1 分。
 *  小宠物目标小、飞行中更难命中，反而分高；speed ≤ 0 或 size ≤ 0 返回 0。 */
const clickScore = (speed, size) => {
    if (speed <= 0 || size <= 0)
        return 0;
    return Math.max(1, Math.round((speed / SCORE_SPEED_PER_POINT) * (constants_ts_1.PET_REF_WIDTH / size)));
};
exports.clickScore = clickScore;

},
"src/shared/sleep-hotkey.ts": function(exports, require) {
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SLEEP_HOTKEY_HINT = void 0;
exports.isSleepHotkey = isSleepHotkey;
/**
 * 睡觉的悬停快捷键：鼠标停在宠物上时按 `Z` 切换睡 / 醒。
 *
 * 按键规则归 shared/hotkey，本模块只绑定「哪个键 + 菜单文案」。
 * 语义是切换而不是单向睡觉：醒着按 = 睡下，睡着按 = 叫醒——与右键那一项完全同一件事。
 * 用 `Z` 而不是 `S`：`S` 让给了截图，一个裸键不能挂两件事。
 * @module dsh-pet/src/shared/sleep-hotkey
 */
const hotkey_ts_1 = require("src/shared/hotkey.ts");
/** 快捷键的显示文案（菜单项右侧灰字）。与 {@link isSleepHotkey} 的按键保持同一份事实。 */
exports.SLEEP_HOTKEY_HINT = 'Z 键';
/**
 * 这次按键该不该切换睡觉状态。
 *
 * @param e - 键盘事件。
 * @returns 裸按 `Z`（含大写）时为 true，输入框里打字则为 false。
 */
function isSleepHotkey(e) {
    return (0, hotkey_ts_1.isBareKey)(e, 'z');
}

},
"src/shared/state.ts": function(exports, require) {
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.fetchState = fetchState;
exports.flattenCounters = flattenCounters;
exports.takeChanged = takeChanged;
exports.resolveLeafPath = resolveLeafPath;
exports.readBalance = readBalance;
exports.readSay = readSay;
exports.readWorkStatus = readWorkStatus;
exports.readAnim = readAnim;
exports.readLock = readLock;
exports.readSleep = readSleep;
exports.readPosition = readPosition;
exports.readThrow = readThrow;
exports.postAction = postAction;
/**
 * 轮询状态（/state）的客户端侧纯逻辑：拉取、叶子拍平、与基线比对。
 * 不负责写状态——动作端点只回执，数据只有一个出口；路径只按已知前后缀解析成落点
 * （见 resolveLeafPath），绝不按点号切分，因为宠物 id 允许含点号。
 * 两端共用同一份；首拉只记基线不渲染，否则刷新页面会把旧气泡重放一遍。
 * @module dsh-pet/src/shared/state
 */
const index_ts_1 = require("src/shared/balance/index.ts");
const work_status_ts_1 = require("src/shared/work-status.ts");
const constants_ts_1 = require("src/shared/constants.ts");
/** 叶子规范化：形状不对（非对象或 counter 非数字）→ null，不让脏数据进渲染层。 */
function normLeaf(value) {
    if (!value || typeof value !== 'object')
        return null;
    const leaf = value;
    if (typeof leaf.counter !== 'number' || !Number.isFinite(leaf.counter))
        return null;
    return { counter: leaf.counter, data: leaf.data ?? null };
}
/** 拉一次 /state；失败、HTTP 非 2xx 或形状不对都返回 null（轮询侧静默重试）。
 *  wait 传了就带 ?since=&timeout= 走长轮询：宿主在版本没变时挂起，直到任意叶子被写过或超时；
 *  不传则立刻返回全量。 */
async function fetchState(baseUrl = constants_ts_1.ROUTE_PATH + '/state', wait) {
    try {
        const url = wait ? `${baseUrl}?since=${wait.since}&timeout=${wait.timeoutMs}` : baseUrl;
        const res = await fetch(url, { cache: 'no-store' });
        if (!res.ok)
            return null;
        const raw = (await res.json().catch(() => null));
        // 业务失败也是 200：`ok:false` 的体不是快照，按失败处理（否则会被当成「空状态」成功一次）
        if (!raw || typeof raw !== 'object' || raw.ok === false)
            return null;
        const sections = {};
        const rawSections = raw.sections && typeof raw.sections === 'object' ? raw.sections : {};
        for (const [name, value] of Object.entries(rawSections)) {
            const leaf = normLeaf(value);
            if (leaf)
                sections[name] = leaf;
        }
        const pets = {};
        const rawPets = raw.pets && typeof raw.pets === 'object' ? raw.pets : {};
        for (const [petId, entry] of Object.entries(rawPets)) {
            if (!entry || typeof entry !== 'object')
                continue;
            const leaves = {};
            for (const [name, value] of Object.entries(entry)) {
                const leaf = normLeaf(value);
                if (leaf)
                    leaves[name] = leaf;
            }
            pets[petId] = leaves;
        }
        return {
            counter: typeof raw.counter === 'number' && Number.isFinite(raw.counter) ? raw.counter : undefined,
            sections,
            pets,
        };
    }
    catch {
        return null;
    }
}
/** 遍历 S 的所有叶子（sections 在前、pets 在后）。 */
function* walkLeaves(s) {
    for (const [name, leaf] of Object.entries(s.sections ?? {}))
        yield ['sections.' + name, leaf];
    for (const [petId, leaves] of Object.entries(s.pets ?? {})) {
        for (const [name, leaf] of Object.entries(leaves ?? {}))
            yield ['pets.' + petId + '.' + name, leaf];
    }
}
/** S → { 叶子路径: counter }，首拉基线用；新增的 section 或宠物自动纳入。 */
function flattenCounters(s) {
    const out = {};
    for (const [path, leaf] of walkLeaves(s))
        out[path] = leaf.counter;
    return out;
}
/** 与基线比对并就地推进基线，返回本次变化的叶子。
 *  首拉不要调它（用 flattenCounters 记基线），否则页面刷新会把旧数据重放一遍。 */
function takeChanged(s, baseline) {
    const out = [];
    for (const [path, leaf] of walkLeaves(s)) {
        if (baseline[path] === leaf.counter)
            continue;
        baseline[path] = leaf.counter;
        out.push({ path, leaf });
    }
    return out;
}
/** 分段叶子名的全集；新增 section 叶子时与 {@link SectionLeafName} 一起改。 */
const SECTION_LEAF_NAMES = ['config', 'balance', 'workStatus', 'notify', 'menu', 'focusSession'];
/** 宠物叶子名的全集；新增宠物叶子时与 {@link PetLeafName} 一起改。 */
const PET_LEAF_NAMES = ['say', 'anim', 'position', 'throw', 'lock', 'sleep'];
/** 把字符串收窄成分段叶子名。 */
function isSectionLeafName(name) {
    return SECTION_LEAF_NAMES.includes(name);
}
/** 把字符串收窄成宠物叶子名。 */
function isPetLeafName(name) {
    return PET_LEAF_NAMES.includes(name);
}
/**
 * 把叶子路径解析成落点；不认识的（含空宠物 id、空叶子名）→ null，消费端跳过这一拍。
 *
 * 宠物 id 允许含点号，所以只按**最后一个**点切叶子名，绝不 `split('.')`：`pets.a.b.say` 的宠物是
 * `a.b`。规则在这里而不是在分发处，是为了能脱离 React 断言——两端共用同一份口径。
 */
function resolveLeafPath(path) {
    if (path.startsWith('sections.')) {
        const name = path.slice('sections.'.length);
        return isSectionLeafName(name) ? { where: 'section', name } : null;
    }
    if (!path.startsWith('pets.'))
        return null;
    const rest = path.slice('pets.'.length);
    const dot = rest.lastIndexOf('.');
    // dot ≤ 0：没有叶子名（`pets.a`）或宠物 id 为空（`pets..say`）——都不是合法落点。
    if (dot <= 0)
        return null;
    const name = rest.slice(dot + 1);
    return isPetLeafName(name) ? { where: 'pet', name, petId: rest.slice(0, dot) } : null;
}
/** 类型收窄：余额叶子 → `{ state, manual }`。
 *  manual = 这次写入是手动触发的（/balance 命令、桌面「查看余额」菜单），由宿主在写入时标记，
 *  消费端据此决定余额不可用时要不要必弹文字说明。形状非法 → null，消费端跳过这一拍。 */
function readBalance(leaf) {
    const state = (0, index_ts_1.toBalanceState)(leaf.data);
    if (!state)
        return null;
    const manual = leaf.data.manual === true;
    return { state, manual };
}
/** 类型收窄：宠物说话叶子 → SayCue（形状非法或空文本 → null，消费端跳过这一拍）。
 *  碎碎念、命令气泡、对话回复共用这一个叶子——前端本来就是同一条展示链路。
 *  duration 与 anim 缺省即默认行为（10s + 联动），不写这两个字段的叶子照常能读。 */
function readSay(leaf) {
    if (!leaf.data || typeof leaf.data !== 'object')
        return null;
    const d = leaf.data;
    // 清空指令优先：它不带 text，所以必须排在文本校验前面
    if (d.clear === true)
        return { kind: 'clear' };
    if (typeof d.text !== 'string' || !d.text)
        return null;
    return {
        kind: 'say',
        text: d.text,
        image: typeof d.image === 'string' ? d.image : undefined,
        // 第三方给的配图地址（完整 URL，scheme 已由宿主卡在 http/https）。与 image 并列、互斥，
        // 消费端有 url 就用 url，否则拼表情包路径——判别位在字段名上，见 SayCue 的说明。
        url: typeof d.url === 'string' ? d.url : undefined,
        // 只认 ≥0 的有限数：非法值当没给（写端已校验，这里只是防御，不让脏数据毁掉整拍）
        duration: typeof d.duration === 'number' && Number.isFinite(d.duration) && d.duration >= 0 ? d.duration : undefined,
        anim: typeof d.anim === 'boolean' ? d.anim : undefined,
        // 只认两个合法字面量：写错的一端名等于「不指定」，消费端据此不念
        voiceTo: d.voiceTo === 'web' || d.voiceTo === 'desktop' ? d.voiceTo : undefined,
    };
}
/** 类型收窄：工作状态叶子 → 快照（形状非法 → null，消费端跳过这一拍）。
 *  与余额不同没有「手动」标记：工作状态永远由 DSH 事件驱动，没有用户主动要的那条路。 */
function readWorkStatus(leaf) {
    return (0, work_status_ts_1.toWorkStatus)(leaf.data);
}
/** 类型收窄：点播动画叶子 → 动画名或地址 + 播放回执（两者都空 → null，消费端跳过这一拍）。
 *  name：该宠物动画池内的名字，名字即文件名，消费端换源并走菜单动作处理（镜像修正、移动类走真实位移）；
 *  url：第三方给的完整地址，直接换源播一次、不走菜单语义——裸地址没有「是不是文字类/移动类」这些属性。
 *  「这个动画是否存在于该宠物」由宿主在写入前保证，播放端不兜底。
 *  playbackId 是宿主受理时生成的回执编号，渲染端在播放的四个时机上报真实状态；
 *  老宿主不写这个字段 → undefined，按「无回执」处理。
 *  facing 是调用方显式指定的朝向：undefined = 没指定，不动朝向，保持当前朝向——不是回落 left。 */
function readAnim(leaf) {
    if (!leaf.data || typeof leaf.data !== 'object')
        return null;
    const d = leaf.data;
    const name = typeof d.name === 'string' && d.name ? d.name : undefined;
    const url = typeof d.url === 'string' && d.url ? d.url : undefined;
    // 两个都缺席 = 形状非法（宿主写端保证恰好一个，这里不替它猜）
    if (name === undefined && url === undefined)
        return null;
    return {
        name,
        url,
        playbackId: typeof d.playbackId === 'string' && d.playbackId ? d.playbackId : undefined,
        // 朝向：只认两个字面量，其余（含缺省、老宿主、脏值）一律 undefined = 不动朝向
        facing: d.facing === 'left' || d.facing === 'right' ? d.facing : undefined,
    };
}
/** 类型收窄：占用锁叶子 → LockState（形状非法 → null，消费端跳过这一拍）。
 *
 *  这是状态不是指令：宿主写、渲染端读来决定要不要冻结自己——随机链不掷骰、暂停自播动画、
 *  忽略自动来源的余额与工作状态表现。宿主停不掉一段正在播的视频，「完全静止」最终由渲染端执行。
 *
 *  宿主不会到点推一次「锁没了」：expiresAt 是唯一真相，渲染端据此自己定时解除（宿主侧过期是懒判的）。
 *  读到已经过去的 expiresAt 就等于没有锁——刷新页面后拿到陈旧叶子时必须按这个判，不能只看 locked。
 *  不含 lockId：那是持锁者的凭证，不能放进人人可读的 /state。
 */
function readLock(leaf) {
    if (!leaf.data || typeof leaf.data !== 'object')
        return null;
    const d = leaf.data;
    if (d.locked === false)
        return { locked: false };
    if (d.locked !== true)
        return null;
    // locked:true 却缺 expiresAt（或非法）= 形状非法：宁可不冻结，也不猜一个到期时刻
    if (typeof d.expiresAt !== 'number' || !Number.isFinite(d.expiresAt))
        return null;
    return { locked: true, expiresAt: d.expiresAt };
}
/** 类型收窄：睡觉叶子 → SleepState（形状非法 → null，消费端跳过这一拍）。
 *
 *  这是状态不是指令：渲染端读它决定要不要睡，不往回写。三段名字由宿主挑定并一起写进叶子，
 *  渲染端照此播「开始（一次）→ 循环（无限）→ 起来（一次）」——自己重新挑会让两端播到不同的一套。
 *  `sleeping: true` 却缺任何一段名 = 形状非法：宁可不睡（保持现状），也不要播一段不存在的动画。
 */
function readSleep(leaf) {
    if (!leaf.data || typeof leaf.data !== 'object')
        return null;
    const d = leaf.data;
    if (d.sleeping === false)
        return { sleeping: false };
    if (d.sleeping !== true)
        return null;
    for (const name of [d.start, d.loop, d.end]) {
        if (typeof name !== 'string' || name === '')
            return null;
    }
    return { sleeping: true, start: d.start, loop: d.loop, end: d.end };
}
/** 类型收窄：位置指令叶子 → `{ x, y, mode, duration }`（形状非法 → null，消费端跳过这一拍）。
 *  这是指令不是状态上报：宿主写、前端读来挪宠物，前端不往回写。
 *  x/y 是宠物中心的归一化坐标（0~1，宿主写入前已夹取）；duration 只有 line 模式才有，其余恒为 0。 */
function readPosition(leaf) {
    if (!leaf.data || typeof leaf.data !== 'object')
        return null;
    const d = leaf.data;
    if (typeof d.x !== 'number' || !Number.isFinite(d.x))
        return null;
    if (typeof d.y !== 'number' || !Number.isFinite(d.y))
        return null;
    if (d.mode !== 'instant' && d.mode !== 'spring' && d.mode !== 'line')
        return null;
    if (d.mode === 'line') {
        // line 缺 duration（或非法）就是形状非法：宿主一定会写，写错宁可跳过这一拍，也不替它猜一个时间
        if (typeof d.duration !== 'number' || !Number.isFinite(d.duration) || d.duration < 0)
            return null;
        return { x: d.x, y: d.y, mode: 'line', duration: d.duration };
    }
    return { x: d.x, y: d.y, mode: d.mode, duration: 0 };
}
/** 类型收窄：抛掷指令叶子 → `{ angle, power }`（形状非法 → null，消费端跳过这一拍）。
 *  angle 单位为度（0 = 正右，逆时针为正）；power 是力度倍率（1.0 = 1200 px/s 软钳速前）。
 *  同样是指令，前端不往回写。 */
function readThrow(leaf) {
    if (!leaf.data || typeof leaf.data !== 'object')
        return null;
    const d = leaf.data;
    if (typeof d.angle !== 'number' || !Number.isFinite(d.angle))
        return null;
    if (typeof d.power !== 'number' || !Number.isFinite(d.power) || d.power <= 0)
        return null;
    return { angle: d.angle, power: d.power };
}
/** 动作端点：POST 一次，返回是否成功。
 *  动作不返回数据——数据只有 /state 一个出口。调用方收到 ok 后不需要再做别的：动作写叶子会让
 *  顶层 counter 变化，挂着的长轮询那一拍立刻返回。 */
async function postAction(baseUrl, body) {
    try {
        const res = await fetch(baseUrl, {
            method: 'POST',
            ...(body === undefined ? {} : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }),
        });
        if (!res.ok)
            return false;
        const data = (await res.json().catch(() => null));
        return data?.ok === true;
    }
    catch {
        return false;
    }
}

},
"src/shared/todo/api.ts": function(exports, require) {
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.TODOS_PATH = void 0;
exports.loadTodos = loadTodos;
exports.addTodo = addTodo;
exports.patchTodo = patchTodo;
exports.removeTodo = removeTodo;
/**
 * 待办接口的浏览器侧封装：取清单、新建、修改、删除。
 *
 * 只做 HTTP 与响应收窄，不碰 DOM；失败统一成 `{ ok: false, message }` 让面板原样展示。
 * 数据只有 `/todos` 一个出口：修改成功后由调用方重新拉一次清单，不靠本地拼装猜结果。
 * @module dsh-pet/src/shared/todo/api
 */
const constants_ts_1 = require("src/shared/constants.ts");
const types_ts_1 = require("src/shared/todo/types.ts");
/** 待办接口的基址（与宿主路由同一前缀）。 */
exports.TODOS_PATH = constants_ts_1.ROUTE_PATH + '/todos';
/** 发一次请求并收窄最外层：协议失败、业务失败、非 JSON 都归成失败。 */
async function send(url, method, body) {
    try {
        const response = await fetch(url, {
            method,
            cache: 'no-store',
            ...(body === undefined ? {} : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }),
        });
        const payload = (await response.json().catch(() => null));
        if (!response.ok)
            return { failed: true, message: `请求失败（HTTP ${response.status}）` };
        if (payload === null)
            return { failed: true, message: '响应不是 JSON' };
        if (payload.ok === false) {
            const reason = typeof payload.message === 'string' ? payload.message : payload.reason;
            return { failed: true, message: typeof reason === 'string' && reason !== '' ? reason : '请求被拒绝' };
        }
        return { failed: false, body: payload };
    }
    catch (error) {
        return { failed: true, message: '连不上桌宠服务：' + (error instanceof Error ? error.message : String(error)) };
    }
}
/** 单条响应 → 待办；形状不对时给出可展示的失败。 */
function readTodo(body) {
    const todo = (0, types_ts_1.parseTodoItem)(body.todo);
    return todo === null ? { ok: false, message: '响应里没有有效的待办' } : { ok: true, value: todo };
}
/** 读整张清单。 */
async function loadTodos(baseUrl = exports.TODOS_PATH) {
    const result = await send(baseUrl, 'GET');
    if (result.failed)
        return { ok: false, message: result.message };
    return { ok: true, value: (0, types_ts_1.parseTodoList)(result.body.todos) };
}
/** 新建一条；`dueAt` 为 null 表示没有期限。 */
async function addTodo(text, dueAt, baseUrl = exports.TODOS_PATH) {
    const result = await send(baseUrl, 'POST', { text, dueAt });
    if (result.failed)
        return { ok: false, message: result.message };
    return readTodo(result.body);
}
/** 修改一条：只传要改的字段。 */
async function patchTodo(id, patch, baseUrl = exports.TODOS_PATH) {
    const result = await send(baseUrl + '/' + encodeURIComponent(id), 'PATCH', patch);
    if (result.failed)
        return { ok: false, message: result.message };
    return readTodo(result.body);
}
/** 删除一条；返回删掉的条数（0 = 本来就没有）。 */
async function removeTodo(id, baseUrl = exports.TODOS_PATH) {
    const result = await send(baseUrl + '/' + encodeURIComponent(id), 'DELETE');
    if (result.failed)
        return { ok: false, message: result.message };
    return { ok: true, value: typeof result.body.removed === 'number' ? result.body.removed : 0 };
}

},
"src/shared/todo/calendar.ts": function(exports, require) {
"use strict";
/**
 * 日历格的纯计算：某年某月排成 7 列几行、哪些格子属于前后月。
 *
 * 不碰 DOM 与当前时间；周一起算的列偏移与补位规则由测试钉住。
 * @module dsh-pet/src/shared/todo/calendar
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.monthCells = monthCells;
/**
 * 某个月的日历格：从周一起算，补满最后一整周。
 *
 * @param year - 四位年份。
 * @param month - 0 起的月份。
 * @returns 行优先的格子，长度是 7 的倍数（通常是 5 行，跨 6 周的月份 6 行）。
 */
function monthCells(year, month) {
    const first = new Date(year, month, 1);
    // getDay 里周日是 0，这里换成「周一起算」的列偏移。
    const lead = (first.getDay() + 6) % 7;
    const days = new Date(year, month + 1, 0).getDate();
    const rows = Math.ceil((lead + days) / 7);
    const cells = [];
    for (let i = 0; i < rows * 7; i++) {
        const date = new Date(year, month, 1 - lead + i);
        cells.push({ date, out: date.getMonth() !== month });
    }
    return cells;
}

},
"src/shared/todo/due-picker.ts": function(exports, require) {
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createDuePicker = createDuePicker;
/**
 * 待办的到期时间选择器：一个显示当前值的按钮 + 内嵌日历。
 *
 * 日历区在「日期 / 小时 / 分钟」三种网格之间切换，高度按内容算，不用预留。
 * 内嵌而不是浮层：桌面宠物窗口只比宠物大一圈，浮层会被窗口边缘裁掉；面板向上长，两端一致。
 * 显隐由面板的折叠容器控制（这里不设 hidden，display:none 会让折叠过渡失效），本模块只报告
 * aria-expanded 与 onOpenChange；值写成 `YYYY-MM-DDTHH:mm`，提醒链路不感知这里。
 * @module dsh-pet/src/shared/todo/due-picker
 */
const calendar_ts_1 = require("src/shared/todo/calendar.ts");
const format_ts_1 = require("src/shared/todo/format.ts");
/** 周一为一周首日，与国内日历习惯一致。 */
const WEEK_HEAD = ['一', '二', '三', '四', '五', '六', '日'];
/** 分钟档位：与提醒的最短间隔一致，避免选出提醒策略分辨不出的时刻。 */
const MINUTE_STEP = 5;
/** 未选日期时的默认时分：早上九点，比零点更像个「该做事了」的时刻。 */
const DEFAULT_HOUR = 9;
/** 两位补零。 */
function pad2(value) {
    return String(value).padStart(2, '0');
}
/** 造一个带 class 的元素。 */
function make(tag, className) {
    const node = document.createElement(tag);
    node.className = className;
    return node;
}
/** 造一个按钮：全部是 `type="button"`，否则在表单里会触发提交。 */
function makeButton(className, text) {
    const button = make('button', className);
    button.type = 'button';
    if (text !== undefined)
        button.textContent = text;
    return button;
}
/** 建整个选择器的 DOM（尚未挂进文档）。 */
function buildPickerDom() {
    const el = makeButton('dsh-pet-todo-due', '无期限');
    el.setAttribute('aria-haspopup', 'dialog');
    el.setAttribute('aria-expanded', 'false');
    el.setAttribute('aria-label', '提醒时间（可选）');
    const calendar = make('div', 'dsh-pet-todo-cal');
    calendar.setAttribute('role', 'dialog');
    calendar.setAttribute('aria-label', '选择提醒时间');
    const head = make('div', 'dsh-pet-todo-cal-head');
    const prev = makeButton('dsh-pet-todo-cal-nav', '‹');
    prev.dataset.act = 'prev';
    prev.setAttribute('aria-label', '上个月');
    const title = make('span', 'dsh-pet-todo-cal-title');
    const next = makeButton('dsh-pet-todo-cal-nav', '›');
    next.dataset.act = 'next';
    next.setAttribute('aria-label', '下个月');
    head.append(prev, title, next);
    const week = make('div', 'dsh-pet-todo-cal-week');
    for (const name of WEEK_HEAD) {
        const cell = make('span', '');
        cell.textContent = name;
        week.appendChild(cell);
    }
    const grid = make('div', 'dsh-pet-todo-cal-grid');
    const foot = make('div', 'dsh-pet-todo-cal-foot');
    const today = makeButton('dsh-pet-todo-cal-act', '今天');
    today.dataset.act = 'today';
    const clear = makeButton('dsh-pet-todo-cal-act', '清除');
    clear.dataset.act = 'clear';
    const grow = make('span', 'dsh-pet-todo-cal-grow');
    const hourChip = makeButton('dsh-pet-todo-cal-chip', '09');
    hourChip.dataset.act = 'hour';
    hourChip.setAttribute('aria-label', '选择小时');
    const colon = make('span', 'dsh-pet-todo-cal-colon');
    colon.textContent = ':';
    const minuteChip = makeButton('dsh-pet-todo-cal-chip', '00');
    minuteChip.dataset.act = 'minute';
    minuteChip.setAttribute('aria-label', '选择分钟');
    const done = makeButton('dsh-pet-todo-cal-act', '完成');
    done.dataset.act = 'done';
    foot.append(today, clear, grow, hourChip, colon, minuteChip, done);
    calendar.append(head, week, grid, foot);
    return { el, calendar, prev, next, title, grid, hourChip, minuteChip };
}
/** 同一个自然日（忽略时分）。 */
function sameDay(a, b) {
    return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}
/** 选中日期 + 当前时分组成的时刻；未选日期为 null。 */
function dueMs(state) {
    if (state.picked === null)
        return null;
    const { picked } = state;
    return new Date(picked.getFullYear(), picked.getMonth(), picked.getDate(), state.hour, state.minute).getTime();
}
/** 造一个日历格：选中态同时写进 class 与 aria。 */
function cellButton(text, selected) {
    const button = makeButton('dsh-pet-todo-cal-cell', text);
    button.classList.toggle('is-sel', selected);
    button.setAttribute('aria-pressed', String(selected));
    return button;
}
/** 画日期网格。 */
function renderDays(dom, state) {
    const today = new Date();
    for (const cell of (0, calendar_ts_1.monthCells)(state.view.getFullYear(), state.view.getMonth())) {
        const { date } = cell;
        const button = cellButton(String(date.getDate()), state.picked !== null && sameDay(state.picked, date));
        button.classList.toggle('is-out', cell.out);
        button.classList.toggle('is-today', sameDay(today, date));
        button.dataset.ts = String(date.getTime());
        button.setAttribute('aria-label', `${date.getMonth() + 1}月${date.getDate()}日`);
        dom.grid.appendChild(button);
    }
}
/** 画小时或分钟的网格：一格一个数，当前值高亮。 */
function renderNumbers(dom, state) {
    const isHour = state.mode === 'hour';
    const count = isHour ? 24 : 60;
    const step = isHour ? 1 : MINUTE_STEP;
    for (let value = 0; value < count; value += step) {
        const button = cellButton(pad2(value), (isHour ? state.hour : state.minute) === value);
        button.dataset.num = String(value);
        button.setAttribute('aria-label', `${value} ${isHour ? '时' : '分'}`);
        dom.grid.appendChild(button);
    }
}
/** 同步按钮文案、时分标签与当前网格的标题。 */
function syncPicker(dom, state) {
    const ms = dueMs(state);
    dom.el.textContent = ms === null ? '无期限' : (0, format_ts_1.dueLabel)(ms, Date.now());
    dom.el.classList.toggle('is-set', ms !== null);
    dom.hourChip.textContent = pad2(state.hour);
    dom.minuteChip.textContent = pad2(state.minute);
    dom.hourChip.classList.toggle('is-on', state.mode === 'hour');
    dom.minuteChip.classList.toggle('is-on', state.mode === 'minute');
}
/** 整块重画：标题、翻月按钮、网格与文案一次到位。 */
function renderPicker(dom, state) {
    const day = state.mode === 'day';
    dom.title.textContent = day
        ? `${state.view.getFullYear()}年${state.view.getMonth() + 1}月`
        : state.mode === 'hour'
            ? '选择小时'
            : '选择分钟';
    dom.prev.hidden = !day;
    dom.next.hidden = !day;
    dom.grid.className = 'dsh-pet-todo-cal-grid is-' + state.mode;
    dom.grid.textContent = '';
    if (day)
        renderDays(dom, state);
    else
        renderNumbers(dom, state);
    syncPicker(dom, state);
}
/** 选中某一天：同步展示月份，并回到日期网格。 */
function pickDay(dom, state, date) {
    state.picked = date;
    state.view = new Date(date.getFullYear(), date.getMonth(), 1);
    state.mode = 'day';
    renderPicker(dom, state);
}
/** 点日历里的按钮：翻月、切网格、今天、清除、完成，或选中某一天 / 某个数。 */
function onCalendarClick(dom, state, button, close) {
    const { ts, num, act } = button.dataset;
    if (ts !== undefined) {
        pickDay(dom, state, new Date(Number(ts)));
        return;
    }
    if (num !== undefined) {
        if (state.mode === 'hour')
            state.hour = Number(num);
        else
            state.minute = Number(num);
        state.mode = 'day';
        renderPicker(dom, state);
        return;
    }
    if (act === 'prev' || act === 'next') {
        state.view = new Date(state.view.getFullYear(), state.view.getMonth() + (act === 'prev' ? -1 : 1), 1);
        renderPicker(dom, state);
        return;
    }
    if (act === 'hour' || act === 'minute') {
        // 再点一次当前网格的标签就退回日期，省一个返回按钮。
        state.mode = state.mode === act ? 'day' : act;
        renderPicker(dom, state);
        return;
    }
    if (act === 'today') {
        const now = new Date();
        pickDay(dom, state, new Date(now.getFullYear(), now.getMonth(), now.getDate()));
        return;
    }
    if (act === 'clear')
        state.picked = null;
    renderPicker(dom, state);
    // 收起必须走 close：它还要同步 aria 与面板的 is-picking（清单靠它重新露出来）。
    if (act === 'clear' || act === 'done')
        close();
}
/**
 * 造一个到期时间选择器。
 *
 * @param options - 展开与收起的回调。
 * @returns 触发按钮、日历容器与读写句柄。
 */
function createDuePicker(options = {}) {
    const now = new Date();
    const state = {
        picked: null,
        hour: DEFAULT_HOUR,
        minute: 0,
        view: new Date(now.getFullYear(), now.getMonth(), 1),
        mode: 'day',
        open: false,
    };
    const dom = buildPickerDom();
    const setOpen = (open) => {
        if (state.open === open)
            return;
        state.open = open;
        dom.el.setAttribute('aria-expanded', String(open));
        options.onOpenChange?.(open);
    };
    dom.el.addEventListener('click', () => {
        // 打开时落到「已选日期的月份」，没选过就落到当月，并总是从日期网格开始。
        if (!state.open) {
            const anchor = state.picked ?? new Date();
            state.view = new Date(anchor.getFullYear(), anchor.getMonth(), 1);
            state.mode = 'day';
            renderPicker(dom, state);
        }
        setOpen(!state.open);
    });
    dom.calendar.addEventListener('click', (event) => {
        const button = event.target.closest('button');
        if (button !== null)
            onCalendarClick(dom, state, button, () => setOpen(false));
    });
    // 点面板里别处就收起日历：面板自己也挂了同样的监听，两者互不干扰（各判各的容器）。
    const onDocMouseDown = (event) => {
        if (!state.open)
            return;
        const target = event.target;
        if (target !== null && (dom.el.contains(target) || dom.calendar.contains(target)))
            return;
        setOpen(false);
    };
    document.addEventListener('mousedown', onDocMouseDown, true);
    renderPicker(dom, state);
    return {
        el: dom.el,
        calendar: dom.calendar,
        value: () => {
            const ms = dueMs(state);
            return ms === null ? '' : (0, format_ts_1.formatDateTimeLocal)(ms);
        },
        close: () => setOpen(false),
        reset: () => {
            state.picked = null;
            state.hour = DEFAULT_HOUR;
            state.minute = 0;
            state.mode = 'day';
            renderPicker(dom, state);
            setOpen(false);
        },
        dispose: () => document.removeEventListener('mousedown', onDocMouseDown, true),
    };
}

},
"src/shared/todo/format.ts": function(exports, require) {
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.spanText = spanText;
exports.dueLabel = dueLabel;
exports.remainingLabel = remainingLabel;
exports.todoUrgency = todoUrgency;
exports.metaLabel = metaLabel;
exports.formatDateTimeLocal = formatDateTimeLocal;
exports.parseDateTimeLocal = parseDateTimeLocal;
const MINUTE_MS = 60 * 1000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;
/** 星期名，索引与 Date.getDay() 对齐。 */
const WEEKDAYS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
/** 两位补零。 */
function pad2(value) {
    return String(value).padStart(2, '0');
}
/** 当天零点的时间戳：跨日比较用它，避开夏令时造成的 23/25 小时日。 */
function startOfDay(date) {
    return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}
/** 两个时刻相差几个自然日（按本地日历，向前为负）。 */
function dayDiff(target, base) {
    return Math.round((startOfDay(target) - startOfDay(base)) / DAY_MS);
}
/**
 * 把毫秒差写成人话。
 *
 * @param ms - 时长（非负；负数先取绝对值），不足一分钟按一分钟算。
 * @returns 例如「25分钟」「3小时」「2天」。
 */
function spanText(ms) {
    const minutes = Math.max(1, Math.round(Math.abs(ms) / MINUTE_MS));
    if (minutes < 60)
        return `${minutes}分钟`;
    const hours = Math.max(1, Math.round(minutes / 60));
    if (hours < 24)
        return `${hours}小时`;
    return `${Math.max(1, Math.round(hours / 24))}天`;
}
/**
 * 到期时刻的绝对说法（不含「还剩多久」）。
 *
 * @param dueAt - 到期时刻；null 表示没有期限。
 * @param now - 当前时刻。
 * @returns 「今天 18:00」「明天 09:00」「周五 20:00」「11月3日 09:00」「无期限」。
 */
function dueLabel(dueAt, now) {
    if (dueAt === null)
        return '无期限';
    const due = new Date(dueAt);
    const clock = `${pad2(due.getHours())}:${pad2(due.getMinutes())}`;
    const days = dayDiff(due, new Date(now));
    if (days === 0)
        return `今天 ${clock}`;
    if (days === 1)
        return `明天 ${clock}`;
    if (days === 2)
        return `后天 ${clock}`;
    if (days > 2 && days < 7)
        return `${WEEKDAYS[due.getDay()]} ${clock}`;
    return `${due.getMonth() + 1}月${due.getDate()}日 ${clock}`;
}
/**
 * 相对说法：还剩多久 / 已逾期多久。
 *
 * @param dueAt - 到期时刻；null（无期限）时返回空串。
 * @param now - 当前时刻。
 * @returns 「还剩2小时」「已逾期3天」或 `''`。
 */
function remainingLabel(dueAt, now) {
    if (dueAt === null)
        return '';
    if (dueAt <= now)
        return `已逾期${spanText(now - dueAt)}`;
    return `还剩${spanText(dueAt - now)}`;
}
/**
 * 紧迫度：只有「未完成」的待办才有意义。
 *
 * @param dueAt - 到期时刻；null = 无期限。
 * @param now - 当前时刻。
 * @returns 6 小时内为 soon，24 小时内为 today，更远为 later。
 */
function todoUrgency(dueAt, now) {
    if (dueAt === null)
        return 'undated';
    const remaining = dueAt - now;
    if (remaining <= 0)
        return 'overdue';
    if (remaining <= 6 * HOUR_MS)
        return 'soon';
    if (remaining <= DAY_MS)
        return 'today';
    return 'later';
}
/**
 * 一条待办在列表里的副标题。
 *
 * @param todo - 待办本体。
 * @param now - 当前时刻。
 * @returns 已完成 → 「已完成」/「已完成 · 今天 18:00」；未完成 → 「今天 18:00 · 还剩2小时」。
 */
function metaLabel(todo, now) {
    if (todo.done) {
        return todo.dueAt === null ? '已完成' : `已完成 · ${dueLabel(todo.dueAt, now)}`;
    }
    if (todo.dueAt === null)
        return '无期限';
    const relative = remainingLabel(todo.dueAt, now);
    if (todo.dueAt <= now)
        return relative;
    return `${dueLabel(todo.dueAt, now)} · ${relative}`;
}
/**
 * 把时间戳写成 `datetime-local` 输入框认的本地字符串。
 *
 * @param ms - epoch 毫秒。
 * @returns `YYYY-MM-DDTHH:mm`（本地时区）。
 */
function formatDateTimeLocal(ms) {
    const date = new Date(ms);
    return (`${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}` +
        `T${pad2(date.getHours())}:${pad2(date.getMinutes())}`);
}
/**
 * 读 `datetime-local` 的值；空串表示「没有期限」。
 *
 * @param value - 输入框的值，形如 `YYYY-MM-DDTHH:mm`。
 * @returns epoch 毫秒；空串、格式非法或日期不存在（如 2 月 30 日）时返回 null。
 */
function parseDateTimeLocal(value) {
    const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(value.trim());
    if (!match)
        return null;
    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    const hour = Number(match[4]);
    const minute = Number(match[5]);
    if (month < 1 || month > 12 || day < 1 || day > 31 || hour > 23 || minute > 59)
        return null;
    const date = new Date(year, month - 1, day, hour, minute, 0, 0);
    // 组件回读校验：2 月 30 日会被 Date 滚到 3 月，这里把它判成非法而不是悄悄改期。
    if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day)
        return null;
    return date.getTime();
}

},
"src/shared/todo/hotkey.ts": function(exports, require) {
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.TODO_HOTKEY_HINT = void 0;
exports.isTodoHotkey = isTodoHotkey;
/**
 * 待办面板的悬停快捷键：鼠标停在宠物上时按 `D` 开关面板。
 * 按键规则归 shared/hotkey，本模块只绑定「哪个键 + 菜单文案」。
 * @module dsh-pet/src/shared/todo/hotkey
 */
const hotkey_ts_1 = require("src/shared/hotkey.ts");
/** 快捷键的显示文案（菜单项右侧灰字）。与 {@link isTodoHotkey} 的按键保持同一份事实。 */
exports.TODO_HOTKEY_HINT = 'D 键';
/**
 * 这次按键该不该开关待办面板。
 *
 * @param e - 键盘事件。
 * @returns 裸按 `D`（含大写）时为 true，输入框里打字则为 false。
 */
function isTodoHotkey(e) {
    return (0, hotkey_ts_1.isBareKey)(e, 'd');
}

},
"src/shared/todo/index.ts": function(exports, require) {
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.sortTodoItems = exports.parseTodoList = exports.parseTodoItem = exports.todoUrgency = exports.spanText = exports.remainingLabel = exports.parseDateTimeLocal = exports.metaLabel = exports.formatDateTimeLocal = exports.dueLabel = exports.isTodoHotkey = exports.TODO_HOTKEY_HINT = exports.todoPanelTopMarginPx = exports.createTodoPanel = exports.TODOS_PATH = exports.removeTodo = exports.patchTodo = exports.loadTodos = exports.addTodo = void 0;
/**
 * 待办事项的共享出口：面板构建、展示格式化与 wire 类型。
 *
 * 判据（排序、紧迫度、时间格式化）都是纯函数；面板只依赖 DOM 与 fetch，两端同一份。
 * 浏览器半侧从气泡外壳直接 import 本模块，桌面 shared-core 经 shared/index 打包同一份。
 * @module dsh-pet/src/shared/todo
 */
var api_ts_1 = require("src/shared/todo/api.ts");
Object.defineProperty(exports, "addTodo", { enumerable: true, get: function () { return api_ts_1.addTodo; } });
Object.defineProperty(exports, "loadTodos", { enumerable: true, get: function () { return api_ts_1.loadTodos; } });
Object.defineProperty(exports, "patchTodo", { enumerable: true, get: function () { return api_ts_1.patchTodo; } });
Object.defineProperty(exports, "removeTodo", { enumerable: true, get: function () { return api_ts_1.removeTodo; } });
Object.defineProperty(exports, "TODOS_PATH", { enumerable: true, get: function () { return api_ts_1.TODOS_PATH; } });
var panel_ts_1 = require("src/shared/todo/panel.ts");
Object.defineProperty(exports, "createTodoPanel", { enumerable: true, get: function () { return panel_ts_1.createTodoPanel; } });
var styles_ts_1 = require("src/shared/todo/styles.ts");
Object.defineProperty(exports, "todoPanelTopMarginPx", { enumerable: true, get: function () { return styles_ts_1.todoPanelTopMarginPx; } });
var hotkey_ts_1 = require("src/shared/todo/hotkey.ts");
Object.defineProperty(exports, "TODO_HOTKEY_HINT", { enumerable: true, get: function () { return hotkey_ts_1.TODO_HOTKEY_HINT; } });
Object.defineProperty(exports, "isTodoHotkey", { enumerable: true, get: function () { return hotkey_ts_1.isTodoHotkey; } });
var format_ts_1 = require("src/shared/todo/format.ts");
Object.defineProperty(exports, "dueLabel", { enumerable: true, get: function () { return format_ts_1.dueLabel; } });
Object.defineProperty(exports, "formatDateTimeLocal", { enumerable: true, get: function () { return format_ts_1.formatDateTimeLocal; } });
Object.defineProperty(exports, "metaLabel", { enumerable: true, get: function () { return format_ts_1.metaLabel; } });
Object.defineProperty(exports, "parseDateTimeLocal", { enumerable: true, get: function () { return format_ts_1.parseDateTimeLocal; } });
Object.defineProperty(exports, "remainingLabel", { enumerable: true, get: function () { return format_ts_1.remainingLabel; } });
Object.defineProperty(exports, "spanText", { enumerable: true, get: function () { return format_ts_1.spanText; } });
Object.defineProperty(exports, "todoUrgency", { enumerable: true, get: function () { return format_ts_1.todoUrgency; } });
var types_ts_1 = require("src/shared/todo/types.ts");
Object.defineProperty(exports, "parseTodoItem", { enumerable: true, get: function () { return types_ts_1.parseTodoItem; } });
Object.defineProperty(exports, "parseTodoList", { enumerable: true, get: function () { return types_ts_1.parseTodoList; } });
Object.defineProperty(exports, "sortTodoItems", { enumerable: true, get: function () { return types_ts_1.sortTodoItems; } });

},
"src/shared/todo/panel.ts": function(exports, require) {
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createTodoPanel = createTodoPanel;
/**
 * 待办面板的内容与生命周期：取数、提交、删除、忙碌态，以及「点面板外收起」的意图转发。
 * 不负责定位与显隐：面板是气泡槽的一个槽位，位置与谁显示都由槽位决定。
 * 依赖 ./api 的 HTTP、./render 的骨架与 ./styles 的样式；清理只摘自己的节点与监听，不碰容器。
 * @module dsh-pet/src/shared/todo/panel
 */
const api_ts_1 = require("src/shared/todo/api.ts");
const format_ts_1 = require("src/shared/todo/format.ts");
const render_ts_1 = require("src/shared/todo/render.ts");
const styles_ts_1 = require("src/shared/todo/styles.ts");
/**
 * 建一个待办面板并开始取数。
 *
 * @param options - 接口基址与关闭回调。
 * @returns 面板根元素与清理函数。
 */
function createTodoPanel(options = {}) {
    (0, styles_ts_1.injectTodoCss)();
    const parts = (0, render_ts_1.createTodoPanelParts)();
    const baseUrl = options.baseUrl ?? api_ts_1.TODOS_PATH;
    let disposed = false;
    let busy = false;
    let todos = [];
    // 三个函数互相引用（列表回调 → 修改 → 重拉 → 渲染）：mutate / reload 用函数声明提升，
    // 回调里引用它们不会在构造期求值，也就不存在初始化顺序问题。
    const handlers = {
        onToggle: (todo, done) => void mutate(() => (0, api_ts_1.patchTodo)(todo.id, { done }, baseUrl)),
        onDelete: (todo) => void mutate(() => (0, api_ts_1.removeTodo)(todo.id, baseUrl)),
    };
    /** 重新拉整张清单：修改一律以宿主返回为准，不在本地猜结果。 */
    async function reload() {
        const result = await (0, api_ts_1.loadTodos)(baseUrl);
        if (disposed)
            return;
        if (!result.ok) {
            (0, render_ts_1.setTodoError)(parts, result.message);
            // 加载失败时别让空态一直停在「加载中…」。
            parts.empty.textContent = '清单加载失败，关掉面板再开一次试试';
            parts.empty.hidden = false;
            return;
        }
        todos = result.value;
        (0, render_ts_1.setTodoError)(parts, null);
        (0, render_ts_1.renderTodoList)(parts, todos, handlers, Date.now());
    }
    /** 串行执行一次修改：请求在途时禁止再次提交，成功后统一重拉。 */
    async function mutate(task) {
        if (disposed || busy)
            return;
        busy = true;
        (0, render_ts_1.setTodoBusy)(parts, true);
        (0, render_ts_1.setTodoError)(parts, null);
        const result = await task();
        busy = false;
        if (disposed)
            return;
        (0, render_ts_1.setTodoBusy)(parts, false);
        if (!result.ok) {
            (0, render_ts_1.setTodoError)(parts, result.message);
            return;
        }
        await reload();
    }
    /** 提交新增：空正文直接回到输入框。 */
    const submitAdd = () => {
        const text = parts.input.value.trim();
        if (text === '') {
            parts.input.focus();
            return;
        }
        // 选择器只会给出 `YYYY-MM-DDTHH:mm` 或空串，解析不出来按无期限处理，不拦提交。
        const dueText = parts.duePicker.value();
        const dueAt = dueText === '' ? null : (0, format_ts_1.parseDateTimeLocal)(dueText);
        // 先收起日历：错误行在清单那一侧，日历开着时会被折叠区藏起来，报错就看不见了。
        parts.duePicker.close();
        // 过去的时刻建出来就是逾期，提醒一上线就会喊，等于让用户先错一次再改。
        if (dueAt !== null && dueAt < Date.now()) {
            (0, render_ts_1.setTodoError)(parts, '这个时间已经过去了，换一个吧');
            return;
        }
        void mutate(async () => {
            const result = await (0, api_ts_1.addTodo)(text, dueAt, baseUrl);
            if (result.ok) {
                parts.input.value = '';
                parts.duePicker.reset();
            }
            return result;
        });
    };
    parts.form.addEventListener('submit', (event) => {
        event.preventDefault();
        submitAdd();
    });
    // 点面板外面就收起：面板没有标题栏也没有关闭按钮，收起意图只能靠「点别处」表达。
    // 用 mousedown 而不是 click，并走捕获阶段：拖拽宠物时 pointerdown 会先截走事件，
    // 监听 click 会漏掉「按住拖走」的那一下；捕获阶段保证在页面任何处理之前先判一次。
    // 不写 instanceof Node：shared-core 会被桌面端 lint 当成无 DOM 全局的脚本检查。
    const onDocMouseDown = (event) => {
        if (disposed)
            return;
        const target = event.target;
        if (target !== null && parts.root.contains(target))
            return;
        // 点宠物本体不算「点别处」：拖它走是常见需求，而拖拽的起点就是这一下。
        if (options.keepOpenOn?.(event.target) === true)
            return;
        options.onClose?.();
    };
    document.addEventListener('mousedown', onDocMouseDown, true);
    parts.closeButton.addEventListener('click', () => options.onClose?.());
    parts.empty.textContent = '加载中…';
    parts.empty.hidden = false;
    // 不自动聚焦输入框：面板挂在宠物头顶，抢走 DSH 输入框的焦点比少一次点击更烦。
    void reload();
    return {
        el: parts.root,
        dispose: () => {
            if (disposed)
                return;
            disposed = true;
            // 监听必须摘：不摘的话面板关掉后它还会在每次点击时被判一次，等于永久挂着一个死回调。
            document.removeEventListener('mousedown', onDocMouseDown, true);
            parts.duePicker.dispose();
            parts.root.remove();
        },
    };
}

},
"src/shared/todo/render.ts": function(exports, require) {
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createTodoPanelParts = createTodoPanelParts;
exports.renderTodoList = renderTodoList;
exports.setTodoError = setTodoError;
exports.setTodoBusy = setTodoBusy;
/**
 * 待办面板的 DOM 骨架与清单渲染：只拼元素、绑事件，不取数、不定位、不关弹窗。
 *
 * 删除做成两步（先变成「确认」，2.5 秒后自动复原）：清单没有撤销，误点一次就没了太容易。
 * @module dsh-pet/src/shared/todo/render
 */
const due_picker_ts_1 = require("src/shared/todo/due-picker.ts");
const format_ts_1 = require("src/shared/todo/format.ts");
/** 删除按钮的二次确认窗口（ms）：超时自动复原，避免「确认」态一直挂着。 */
const DELETE_ARM_MS = 2500;
/** 空态文案：加载中会临时替换它，重渲染时再写回来。 */
const EMPTY_TEXT = '还没有待办。记一件要做的事，到点我会提醒你～';
/** 清单最多露出几行，其余靠滚动。 */
const LIST_ROWS = 2;
/** 造一个带 class 的元素，避免每处都写 createElement + className。 */
function element(tag, className, text) {
    const node = document.createElement(tag);
    node.className = className;
    if (text !== undefined)
        node.textContent = text;
    return node;
}
/** 造一个可折叠区：高度靠 grid-template-rows 在 0fr 与 1fr 之间过渡，内容高度是 auto 也能动画。 */
function fold(className, children) {
    const outer = element('div', 'dsh-pet-todo-fold ' + className);
    const clip = element('div', 'dsh-pet-todo-foldClip');
    clip.append(...children);
    outer.appendChild(clip);
    return outer;
}
/**
 * 造面板骨架（尚未挂进文档）。
 *
 * @returns 面板需要的全部元素引用。
 */
function createTodoPanelParts() {
    const root = element('div', 'dsh-pet-todo');
    root.setAttribute('role', 'dialog');
    root.setAttribute('aria-label', '待办事项');
    const head = element('div', 'dsh-pet-todo-head');
    const title = element('span', 'dsh-pet-todo-title', '待办事项');
    const count = element('span', 'dsh-pet-todo-count', '0 项未完成');
    count.setAttribute('aria-live', 'polite');
    const closeButton = element('button', 'dsh-pet-todo-close', '✕');
    closeButton.type = 'button';
    closeButton.setAttribute('aria-label', '关闭待办面板');
    head.append(title, count, closeButton);
    const form = element('form', 'dsh-pet-todo-form');
    const input = element('input', 'dsh-pet-todo-input');
    input.type = 'text';
    input.maxLength = 200;
    input.placeholder = '记一件要做的事…';
    input.autocomplete = 'off';
    input.setAttribute('aria-label', '待办内容');
    const row = element('div', 'dsh-pet-todo-row');
    const duePicker = (0, due_picker_ts_1.createDuePicker)({ onOpenChange: (open) => root.classList.toggle('is-picking', open) });
    const addButton = element('button', 'dsh-pet-todo-add', '添加');
    addButton.type = 'submit';
    row.append(duePicker.el, addButton);
    form.append(input, row);
    const error = element('div', 'dsh-pet-todo-err');
    error.hidden = true;
    const empty = element('div', 'dsh-pet-todo-empty', EMPTY_TEXT);
    empty.hidden = true;
    const list = element('ul', 'dsh-pet-todo-list');
    const hint = element('div', 'dsh-pet-todo-hint', '离到期越近，我会提醒得越勤快～');
    // 下半区两块内容轮流出现：清单态与日历态各是一个折叠区，展开收起走同一条过渡。
    // 面板高度因此跟着内容走（不留空白），切换时也是滑过去而不是硬跳。
    const lower = element('div', 'dsh-pet-todo-lower');
    lower.append(fold('is-cal', [duePicker.calendar]), fold('is-list', [error, empty, list, hint]));
    root.append(head, form, lower);
    return { root, form, input, duePicker, addButton, list, empty, count, closeButton, error };
}
/**
 * 把清单压到「两行」的高度，多出来的部分靠清单自己滚动。
 *
 * 行高随正文折行变化，写不成 CSS 常量，所以量一次首行再乘二；量不到（未挂载）就不设上限，
 * 免得把清单压成 0 高。
 *
 * @param list - 清单容器。
 */
function capListHeight(list) {
    const first = list.firstElementChild;
    if (first === null) {
        list.style.maxHeight = '';
        return;
    }
    const rowHeight = first.getBoundingClientRect().height;
    if (rowHeight <= 0)
        return;
    // 清单自带内边距，算进高度里才不会被截掉最后一行的一半。
    const pad = parseFloat(getComputedStyle(list).paddingTop) || 0;
    list.style.maxHeight = rowHeight * LIST_ROWS + pad * 2 + 'px';
}
/**
 * 渲染一整张清单。
 *
 * @param parts - 面板元素。
 * @param todos - 已排序的待办。
 * @param handlers - 勾选与删除的回调。
 * @param now - 当前时刻，用来生成「还剩多久」。
 */
function renderTodoList(parts, todos, handlers, now) {
    parts.list.textContent = '';
    const pending = todos.filter((todo) => !todo.done).length;
    parts.count.textContent = `${pending} 项未完成`;
    parts.empty.textContent = EMPTY_TEXT;
    parts.empty.hidden = todos.length > 0;
    for (const todo of todos)
        parts.list.appendChild(renderItem(todo, handlers, now));
    capListHeight(parts.list);
}
/** 渲染一条；未完成项带紧迫度，已完成项划线。 */
function renderItem(todo, handlers, now) {
    const item = element('li', 'dsh-pet-todo-item' + (todo.done ? ' is-done' : ''));
    if (!todo.done)
        item.dataset.urgency = (0, format_ts_1.todoUrgency)(todo.dueAt, now);
    const check = element('input', 'dsh-pet-todo-check');
    check.type = 'checkbox';
    check.checked = todo.done;
    check.setAttribute('aria-label', (todo.done ? '标记未完成：' : '标记完成：') + todo.text);
    check.addEventListener('change', () => handlers.onToggle(todo, check.checked));
    const main = element('div', 'dsh-pet-todo-main');
    const text = element('div', 'dsh-pet-todo-text', todo.text);
    const meta = element('div', 'dsh-pet-todo-meta', (0, format_ts_1.metaLabel)(todo, now));
    main.append(text, meta);
    const remove = element('button', 'dsh-pet-todo-del', '✕');
    remove.type = 'button';
    remove.setAttribute('aria-label', '删除：' + todo.text);
    remove.addEventListener('click', () => {
        // 第一次点击只进入确认态；再点一次才真的删。
        if (remove.dataset.armed !== '1') {
            remove.dataset.armed = '1';
            remove.classList.add('is-armed');
            remove.textContent = '确认';
            window.setTimeout(() => {
                // 面板已关闭 / 已重渲染时元素不再在文档里：静默复原即可。
                if (!remove.isConnected)
                    return;
                delete remove.dataset.armed;
                remove.classList.remove('is-armed');
                remove.textContent = '✕';
            }, DELETE_ARM_MS);
            return;
        }
        handlers.onDelete(todo);
    });
    item.append(check, main, remove);
    return item;
}
/**
 * 显示 / 清除错误行。
 *
 * @param parts - 面板元素。
 * @param message - 错误文案；null 表示清除。
 */
function setTodoError(parts, message) {
    parts.error.hidden = message === null;
    parts.error.textContent = message ?? '';
}
/**
 * 切换忙碌态：请求在途时禁掉输入与按钮，避免连点建出两条。
 *
 * @param parts - 面板元素。
 * @param busy - 是否请求在途。
 */
function setTodoBusy(parts, busy) {
    parts.input.disabled = busy;
    parts.duePicker.el.disabled = busy;
    parts.addButton.disabled = busy;
}

},
"src/shared/todo/styles.ts": function(exports, require) {
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.TODO_CSS = exports.TODO_PANEL_METRICS = exports.TODO_FONT_SCALE = void 0;
exports.injectTodoCss = injectTodoCss;
exports.todoPanelTopMarginPx = todoPanelTopMarginPx;
/**
 * 待办面板的样式：面板本体是气泡槽里的一个气泡，外框沿用气泡的白底圆角与尾巴。
 *
 * 只有静态字符串与注入状态，不建 DOM、不读配置；尺寸全部锚在气泡字号 --f 上，
 * 因此 config.font 的字号与 followPet、以及宠物尺寸改了，面板跟着等比缩放。
 * 高度预算 TODO_PANEL_METRICS 与这里的系数同源：改任何一条都必须同步，否则桌面窗口上边距会算少。
 * @module dsh-pet/src/shared/todo/styles
 */
const fonts_ts_1 = require("src/shared/fonts.ts");
/** 面板根字号相对气泡字号的比例：默认配置（气泡 21.02px）下取整为 13px。 */
exports.TODO_FONT_SCALE = 0.618;
/** 面板竖向预算（em，基准 = 面板根字号）：头部 + 表单 + 下半区，默认配置下约 329px。 */
exports.TODO_PANEL_METRICS = {
    /** 头部：上下内边距 + 标题行（行高 1.5 × 字号 1.077）。 */
    head: 0.769 + 0.615 + 1.077 * 1.5,
    /** 表单：正文框 + 间距 + 时间行 + 下内边距。 */
    form: 0.462 * 2 + 1.4 + 0.462 + (0.462 * 2 + 1.4) + 0.769,
    /** 清单态：上下内边距 + 两行条目（每行 = 内边距 + 正文 + 行距 + 时间标签）。 */
    list: 0.462 * 2 + 2 * (0.538 * 2 + 1.5 + 0.154 + 0.846 * 1.5),
    /** 底部提示。 */
    hint: 0.462 + 0.692 + 0.846 * 1.5,
    /** 日历态：内边距 + 标题行 + 星期行 + 六行日期 + 底部操作行 + 行间空隙。 */
    calendar: 1.077 + 1.077 * 1.5 + 0.846 * 1.5 + 6 * (1.4 + 0.231 * 2) + 5 * 0.154 + (0.923 * 1.5 + 0.462) + 0.308 * 3,
};
/** 面板样式：头部 + 添加行 + 可滚动的清单 + 底部提示。 */
exports.TODO_CSS = [
    // 气泡变体：两端气泡的基础类不同（网页 .dsh-pet-bubble / 桌面 .pet-bubble），所以并列两条提高特异性，
    // 不依赖注入顺序压过基础样式。宽度锚 --f（14.65 × 21.02 ≈ 308px），max() 给 220px 下限防止
    // 小字号下输入框与按钮挤成一列，max-width 再把整体夹回视口。
    '.dsh-pet-bubble.dsh-pet-todo-bubble,.pet-bubble.dsh-pet-todo-bubble{padding:0;',
    'width:max(220px,calc(var(--f)*14.65));max-width:calc(100vw - 16px);pointer-events:auto;cursor:default}',
    // 面板本体：只负责竖向排布，外框（底色/圆角/阴影/尾巴）全部交给气泡，圆角用 inherit 对齐。
    // 尺寸一律 em，基准是本行的 --t；自己改了 font-size 的元素内边距改用 calc(var(--t)*k)，
    // 否则 em 会按它自己的字号再缩一遍。
    '.dsh-pet-todo{--t:calc(var(--f)*' + exports.TODO_FONT_SCALE + ');display:flex;flex-direction:column;',
    'box-sizing:border-box;border-radius:inherit;overflow:hidden;color:#2b2b2b;font-size:var(--t);',
    'line-height:1.5;user-select:none;',
    "font-family:var(--dsh-pet-font-family,'ShangshouSoftCandy','Yuanti SC','YouYuan','幼圆','Comic Sans MS','PingFang SC','Microsoft YaHei',sans-serif);",
    '}',
    '.dsh-pet-todo *{box-sizing:border-box}',
    '.dsh-pet-todo-head{display:flex;align-items:center;gap:.615em;padding:.769em .923em .615em}',
    '.dsh-pet-todo-title{flex:1;font-size:1.077em;font-weight:600}',
    '.dsh-pet-todo-count{color:rgba(43,43,43,.55);font-size:.923em}',
    '.dsh-pet-todo-close{border:none;background:transparent;color:rgba(43,43,43,.5);font-family:inherit;',
    'font-size:1em;line-height:1;padding:.308em .385em;border-radius:.462em;cursor:pointer}',
    '.dsh-pet-todo-close:hover{background:rgba(0,0,0,.06);color:rgba(43,43,43,.9)}',
    '.dsh-pet-todo-form{display:flex;flex-direction:column;gap:.462em;padding:0 .923em .769em;',
    'border-bottom:1px solid rgba(0,0,0,.07)}',
    '.dsh-pet-todo-input{width:100%;border:1px solid rgba(0,0,0,.12);border-radius:.615em;',
    'background:rgba(255,255,255,.9);padding:.462em .615em;font-size:1em;line-height:1.4;color:#2b2b2b;',
    'font-family:inherit;outline:none}',
    '.dsh-pet-todo-input:focus{border-color:rgba(64,128,255,.55);box-shadow:0 0 0 .154em rgba(64,128,255,.14)}',
    '.dsh-pet-todo-input::placeholder{color:rgba(43,43,43,.42)}',
    '.dsh-pet-todo-row{display:flex;align-items:center;gap:.462em}',
    // 到期按钮：长得像输入框，点开是自绘日历；没选时文字偏淡，选了转深。
    '.dsh-pet-todo-due{flex:1;min-width:0;text-align:left;border:1px solid rgba(0,0,0,.12);border-radius:.615em;',
    'background:rgba(255,255,255,.9);padding:.462em .615em;font-size:1em;line-height:1.4;font-family:inherit;',
    'color:rgba(43,43,43,.55);cursor:pointer;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
    '.dsh-pet-todo-due:hover{border-color:rgba(64,128,255,.45)}',
    '.dsh-pet-todo-due.is-set{color:#2b2b2b}',
    '.dsh-pet-todo-due[aria-expanded="true"]{border-color:rgba(64,128,255,.55);',
    'box-shadow:0 0 0 .154em rgba(64,128,255,.14)}',
    '.dsh-pet-todo-add{border:none;border-radius:.615em;background:#4a7dff;color:#fff;font-size:1em;',
    'padding:.462em .923em;cursor:pointer;font-family:inherit;white-space:nowrap}',
    '.dsh-pet-todo-add:hover{background:#3a6ce8}',
    '.dsh-pet-todo-add:disabled,.dsh-pet-todo-input:disabled{opacity:.55;cursor:default}',
    // 内嵌日历：白底淡灰衬底，选中日实心主色，非本月日期变淡，今天描一圈。
    '.dsh-pet-todo-cal{display:flex;flex-direction:column;gap:.308em;',
    'padding:.462em .615em .615em;background:rgba(43,43,43,.025)}',
    '.dsh-pet-todo-cal-head{display:flex;align-items:center;gap:.308em}',
    '.dsh-pet-todo-cal-title{flex:1;text-align:center;font-size:1.077em;font-weight:600}',
    '.dsh-pet-todo-cal-nav{border:none;background:transparent;color:rgba(43,43,43,.55);font-family:inherit;',
    'font-size:1.154em;line-height:1;padding:.154em .385em;border-radius:.462em;cursor:pointer}',
    '.dsh-pet-todo-cal-nav:hover{background:rgba(0,0,0,.07);color:#2b2b2b}',
    '.dsh-pet-todo-cal-week,.dsh-pet-todo-cal-grid{display:grid;grid-template-columns:repeat(7,1fr);gap:.154em}',
    // 日期行高固定，日历高度因此是常量（与 TODO_PANEL_METRICS.calendar 同源），折叠时才能算得准。
    '.dsh-pet-todo-cal-grid{grid-auto-rows:1.862em}',
    // 小时 24 格、分钟 12 格都排 6 列，行数少，整体居中。
    '.dsh-pet-todo-cal-grid.is-hour,.dsh-pet-todo-cal-grid.is-minute{grid-template-columns:repeat(6,1fr);',
    'grid-auto-rows:1.6em;align-content:center}',
    '.dsh-pet-todo-cal-week{font-size:.846em;line-height:1.5;color:rgba(43,43,43,.45);text-align:center}',
    '.dsh-pet-todo-cal-cell{border:none;background:transparent;font-family:inherit;font-size:1em;line-height:1.4;',
    'color:#2b2b2b;padding:.231em 0;border-radius:.462em;cursor:pointer;font-variant-numeric:tabular-nums}',
    '.dsh-pet-todo-cal-cell:hover{background:rgba(0,0,0,.06)}',
    '.dsh-pet-todo-cal-cell.is-out{color:rgba(43,43,43,.26)}',
    '.dsh-pet-todo-cal-cell.is-today{box-shadow:inset 0 0 0 1px rgba(74,125,255,.55)}',
    '.dsh-pet-todo-cal-cell.is-sel{background:#4a7dff;color:#fff;font-weight:600}',
    '.dsh-pet-todo-cal-foot{display:flex;align-items:center;gap:.308em}',
    '.dsh-pet-todo-cal-act{border:none;background:transparent;color:#4a7dff;font-family:inherit;font-size:.923em;',
    'line-height:1.5;padding:.231em .385em;border-radius:.462em;cursor:pointer}',
    '.dsh-pet-todo-cal-act:hover{background:rgba(74,125,255,.1)}',
    '.dsh-pet-todo-cal-grow{flex:1}',
    // 时/分标签：点开就是对应的数字网格，再点一次退回日期。
    '.dsh-pet-todo-cal-chip{border:1px solid rgba(0,0,0,.12);border-radius:.462em;background:rgba(255,255,255,.95);',
    'color:#2b2b2b;font-family:inherit;font-size:.923em;line-height:1.4;padding:.154em .385em;cursor:pointer;',
    'font-variant-numeric:tabular-nums}',
    '.dsh-pet-todo-cal-chip.is-on{border-color:rgba(74,125,255,.55);color:#4a7dff;',
    'box-shadow:0 0 0 .154em rgba(74,125,255,.14)}',
    '.dsh-pet-todo-cal-colon{color:rgba(43,43,43,.45)}',
    // 下半区：两块内容各占一个折叠区，谁出现谁展开，面板高度跟着内容走，不留空白。
    // 折叠用 grid-template-rows 的 0fr→1fr：内容高度是 auto 也能过渡，不用猜 max-height。
    '.dsh-pet-todo-lower{display:flex;flex-direction:column}',
    '.dsh-pet-todo-fold{display:grid;grid-template-rows:0fr;visibility:hidden;',
    'transition:grid-template-rows .18s ease,visibility 0s .18s}',
    '.dsh-pet-todo-fold>.dsh-pet-todo-foldClip{overflow:hidden;min-height:0}',
    '.dsh-pet-todo-fold.is-list{grid-template-rows:1fr;visibility:visible;transition-delay:0s}',
    '.dsh-pet-todo.is-picking .dsh-pet-todo-fold.is-cal{grid-template-rows:1fr;visibility:visible;',
    'transition-delay:0s}',
    // 收起的那一侧等过渡走完再隐藏，否则内容会在半路上突然消失；visibility 同时挡掉键盘焦点。
    '.dsh-pet-todo.is-picking .dsh-pet-todo-fold.is-list{grid-template-rows:0fr;visibility:hidden;',
    'transition-delay:0s,.18s}',
    // 清单高度由 capListHeight 按两行写在行内；这里只保证超出就滚动、滚动不带动气泡外的东西。
    '.dsh-pet-todo-list{list-style:none;margin:0;padding:.462em;overflow-y:auto;overscroll-behavior:contain;',
    'flex:0 1 auto;min-height:0;scrollbar-width:thin}',
    '.dsh-pet-todo-item{display:flex;align-items:flex-start;gap:.615em;padding:.538em .462em;border-radius:.615em}',
    '.dsh-pet-todo-item:hover{background:rgba(0,0,0,.045)}',
    '.dsh-pet-todo-check{margin-top:.231em;width:1.154em;height:1.154em;flex:0 0 auto;cursor:pointer;',
    'accent-color:#4a7dff}',
    '.dsh-pet-todo-main{flex:1;min-width:0}',
    '.dsh-pet-todo-text{overflow-wrap:anywhere;white-space:pre-wrap}',
    '.dsh-pet-todo-meta{margin-top:calc(var(--t)*0.154);font-size:.846em;color:rgba(43,43,43,.5)}',
    '.dsh-pet-todo-item[data-urgency="overdue"] .dsh-pet-todo-meta{color:#d94f3d}',
    '.dsh-pet-todo-item[data-urgency="soon"] .dsh-pet-todo-meta{color:#c9761b}',
    '.dsh-pet-todo-item[data-urgency="today"] .dsh-pet-todo-meta{color:#3f6fd8}',
    '.dsh-pet-todo-item.is-done .dsh-pet-todo-text{text-decoration:line-through;color:#2e9e4f}',
    '.dsh-pet-todo-del{border:none;background:transparent;color:rgba(43,43,43,.34);font-size:.923em;line-height:1;',
    'padding:calc(var(--t)*0.308) calc(var(--t)*0.385);border-radius:.462em;cursor:pointer;flex:0 0 auto;',
    'min-width:calc(var(--t)*1.692)}',
    '.dsh-pet-todo-del:hover{background:rgba(0,0,0,.07);color:rgba(43,43,43,.8)}',
    '.dsh-pet-todo-del.is-armed{background:rgba(217,79,61,.12);color:#d94f3d}',
    '.dsh-pet-todo-empty{padding:calc(var(--t)*1.538) calc(var(--t)*0.923);text-align:center;',
    'color:rgba(43,43,43,.44);font-size:.923em}',
    '.dsh-pet-todo-empty[hidden]{display:none}',
    '.dsh-pet-todo-err{flex:0 0 auto;padding:0 calc(var(--t)*0.923) calc(var(--t)*0.615);color:#d94f3d;',
    'font-size:.923em;white-space:pre-wrap;overflow-wrap:anywhere}',
    '.dsh-pet-todo-err[hidden]{display:none}',
    // margin-top:auto 把提示钉在下半区底部：清单只有两行时，多出来的空当留在中间而不是堆在提示下面。
    '.dsh-pet-todo-hint{margin-top:auto;padding:calc(var(--t)*0.462) calc(var(--t)*0.923) calc(var(--t)*0.692);',
    'color:rgba(43,43,43,.4);font-size:.846em;text-align:center}',
].join('');
let todoCssInjected = false;
/** 把面板样式注入文档一次；重复挂载不会重复插入。 */
function injectTodoCss() {
    if (todoCssInjected || typeof document === 'undefined')
        return;
    todoCssInjected = true;
    const tag = document.createElement('style');
    tag.dataset.plugin = 'dsh-pet';
    tag.dataset.pluginCss = 'dsh-pet/todo';
    tag.textContent = exports.TODO_CSS;
    document.head.appendChild(tag);
}
/** 面板占用的窗口上边距（px）：桌面窗口余量必须容得下整块面板，否则面板顶端被窗口上沿切掉。
 *  算法与 {@link bubbleTopMarginPx} 同口径：面板底边同样落在宠物盒顶边下方 0.108 × 尺寸处。
 *  面板高度是常量（下半区固定），所以展开日历或出现错误行都不会改变窗口尺寸。
 *  @param font - 该宠物的 font 配置，缺失按默认口径。
 *  @param size - 该宠物的宽度 px。 */
function todoPanelTopMarginPx(font, size) {
    const m = exports.TODO_PANEL_METRICS;
    // 窗口余量按较高的那种状态算：面板高度会随状态变，但窗口尺寸不能跟着变。
    const panelPx = (m.head + m.form + Math.max(m.list + m.hint, m.calendar)) * (0, fonts_ts_1.resolveFontPx)(font, size).bubble * exports.TODO_FONT_SCALE;
    const overlap = (Number(size) || 0) * fonts_ts_1.BUBBLE_OVERLAP_RATIO;
    return Math.max(0, Math.ceil(panelPx - overlap));
}

},
"src/shared/todo/types.ts": function(exports, require) {
"use strict";
/**
 * 待办的 wire 形状与解析：面板只消费宿主 /todos 返回的数据。
 *
 * 不做取数与渲染；字段口径与 host/todo/types 同名（宿主不 import 共享层，两份各自维护）。
 * 宿主已校验并排序，这里再收窄一次类型：脏数据跳过而不是让整张清单渲染失败。
 * @module dsh-pet/src/shared/todo/types
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.parseTodoItem = parseTodoItem;
exports.parseTodoList = parseTodoList;
exports.sortTodoItems = sortTodoItems;
/** 读一个数字，非法回落。 */
function numberOr(raw, fallback) {
    return typeof raw === 'number' && Number.isFinite(raw) ? raw : fallback;
}
/**
 * 收窄一条待办。
 *
 * @param raw - 响应体里的单条。
 * @returns 合法时返回记录；id / 正文缺失或 dueAt 类型不对时返回 null。
 */
function parseTodoItem(raw) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw))
        return null;
    const record = raw;
    if (typeof record.id !== 'string' || record.id === '')
        return null;
    if (typeof record.text !== 'string')
        return null;
    const dueAt = record.dueAt === null || record.dueAt === undefined
        ? null
        : typeof record.dueAt === 'number' && Number.isFinite(record.dueAt)
            ? record.dueAt
            : undefined;
    if (dueAt === undefined)
        return null;
    return {
        id: record.id,
        text: record.text,
        dueAt,
        done: record.done === true,
        createdAt: numberOr(record.createdAt, 0),
        updatedAt: numberOr(record.updatedAt, 0),
        completedAt: typeof record.completedAt === 'number' ? record.completedAt : null,
    };
}
/**
 * 收窄整张清单：不是数组按空清单处理，坏条目逐条跳过。
 *
 * @param raw - 响应体里的 `todos` 字段。
 * @returns 已校验的清单（保持原顺序）。
 */
function parseTodoList(raw) {
    if (!Array.isArray(raw))
        return [];
    const out = [];
    for (const item of raw) {
        const todo = parseTodoItem(item);
        if (todo !== null)
            out.push(todo);
    }
    return out;
}
/**
 * 展示顺序：未完成在前（到期越近越靠前，无期限垫底），已完成在后（最近完成的在上）。
 *
 * 宿主也排过一次；这里再排一次是为了「单条 PATCH 的响应直接插进列表」时顺序不歪。
 *
 * @param list - 任意顺序的清单。
 * @returns 排好序的新数组。
 */
function sortTodoItems(list) {
    return [...list].sort((a, b) => {
        if (a.done !== b.done)
            return a.done ? 1 : -1;
        if (a.done)
            return (b.completedAt ?? 0) - (a.completedAt ?? 0);
        const aDue = a.dueAt ?? Number.POSITIVE_INFINITY;
        const bDue = b.dueAt ?? Number.POSITIVE_INFINITY;
        if (aDue !== bDue)
            return aDue - bDue;
        return a.createdAt - b.createdAt;
    });
}

},
"src/shared/tooltip.ts": function(exports, require) {
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.TOOLTIP_CSS = exports.TOOLTIP_GAP_RATIO = exports.TOOLTIP_CLASS = void 0;
exports.tooltipPlacement = tooltipPlacement;
/**
 * 宠物悬浮提示：替代原生 title（它的样式、字体、延迟全由浏览器或系统决定，改不动），按光标位置显示。
 * 本模块给 class、样式与摆位纯函数；节点构造与宽高实测留在两端各自的壳里。
 * 坐标一律是各端自己的视口坐标（fixed 定位），宠物走动或窗口位移不会带着提示漂。
 * 尺寸取宠物宽的 CSS 变量（两端变量名不同），用回退兼容，调用方无需传尺寸。
 * 不用 DSH 主题变量：它只存在于 DSH 页面，桌面 Electron 页里没有，会退化成透明底。
 * @module dsh-pet/src/shared/tooltip
 */
/** 提示框 class（两端共用）。 */
exports.TOOLTIP_CLASS = 'pet-tooltip';
/** 光标与提示框之间的间隙（占宠物宽度比例）：462px 的宠物下约 10px，与原生提示的偏移观感接近。 */
exports.TOOLTIP_GAP_RATIO = 0.022;
/** 光标位置 + 提示框实测尺寸 + 允许范围 → 提示框左上角坐标。
 *  摆法与原生提示一致：优先放光标右下，右边装不下翻到左侧，下边装不下翻到上方，翻完仍越界就夹回范围内。
 *  尺寸必须实测（offsetWidth/offsetHeight）：翻边判据依赖真实宽高，估算偏大会贴着边就翻、偏小会越界被裁。
 *  @param cursor - 光标位置。
 *  @param tip - 提示框实测尺寸（px）。
 *  @param bounds - 允许显示的范围：桌面端是窗口 ∩ 光标所在屏的工作区，浏览器端是整个视口。
 *  @param gap - 光标与提示框的间隙（px）。 */
function tooltipPlacement(cursor, tip, bounds, gap) {
    const clamp = (v, lo, hi) => (hi < lo ? lo : Math.min(Math.max(v, lo), hi));
    const rightMax = bounds.x + bounds.w;
    const bottomMax = bounds.y + bounds.h;
    let x = cursor.x + gap;
    if (x + tip.w > rightMax)
        x = cursor.x - gap - tip.w;
    x = clamp(x, bounds.x, rightMax - tip.w);
    let y = cursor.y + gap;
    if (y + tip.h > bottomMax)
        y = cursor.y - gap - tip.h;
    y = clamp(y, bounds.y, bottomMax - tip.h);
    return { x, y };
}
/** 提示框样式 —— 两端注入同一份（浏览器并入插件 CSS，桌面由 renderer.js 建 style 标签）。 */
exports.TOOLTIP_CSS = [
    '.pet-tooltip{',
    // fixed + 坐标由 JS 按光标写：left/top 只是未定位前的兜底，不会真的显示
    'position:fixed;left:0;top:0;',
    'max-width:calc(var(--dsh-pet-size,var(--pet-size,462px))*0.8);',
    'padding:calc(var(--dsh-pet-size,var(--pet-size,462px))*0.010) calc(var(--dsh-pet-size,var(--pet-size,462px))*0.021);',
    'border-radius:calc(var(--dsh-pet-size,var(--pet-size,462px))*0.016);',
    // 白底黑字：对齐原生提示的观感，深色胶囊落在浅色宠物身上太抢眼
    'background:rgba(255,255,255,.96);color:#1f1f1f;',
    // 细边框：白底压在浅色宠物或浅色页面上会糊成一片，靠它划出轮廓
    'border:1px solid rgba(0,0,0,.12);',
    // 字体与气泡同一套；字体族走全局配置变量（注入在 documentElement），继承不到宠物根容器
    'font-family:var(--dsh-pet-font-family,"ShangshouSoftCandy","Yuanti SC","YouYuan","幼圆","Comic Sans MS","PingFang SC","Microsoft YaHei",sans-serif);',
    // 字号对齐 Windows 原生提示（9pt ≈ 12px）：462px 的宠物下 0.026 → 约 12px。
    // --dsh-pet-font-tip 由两端按该宠物尺寸算好注入（shared/fonts.ts 的 resolveFontPx），未注入时回退原表达式。
    'font-size:var(--dsh-pet-font-tip,calc(var(--dsh-pet-size,var(--pet-size,462px))*0.026));line-height:1.4;',
    // nowrap + 截断：宽度锁成一行才好和光标一起摆（换行会让宽度随位置跳变）
    'white-space:nowrap;overflow:hidden;text-overflow:ellipsis;',
    // 不设 backdrop-filter：白底没必要，原生提示也没有毛玻璃
    'box-shadow:0 calc(var(--dsh-pet-size,var(--pet-size,462px))*0.004) calc(var(--dsh-pet-size,var(--pet-size,462px))*0.013) rgba(0,0,0,.18);',
    // 层级低于气泡：两者不抢同一块地方（提示跟光标、气泡在头顶），保留层序只是兜底
    'opacity:0;transition:opacity .12s ease;pointer-events:none;z-index:2}',
    '.pet-tooltip.is-on{opacity:1}',
].join('');

},
"src/shared/types.ts": function(exports, require) {
"use strict";
/**
 * 与 config.jsonc 同构的类型模型：animations / animationWeights / pets 只此一份定义。
 * 运行时（浏览器半侧、桌面 Helper、设置页）直接使用这套结构，不额外造转换后的类型。
 * 纯类型与常量，无 React / DOM 依赖。
 * @module dsh-pet/src/shared/types
 */
Object.defineProperty(exports, "__esModule", { value: true });

},
"src/shared/voice.ts": function(exports, require) {
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PLAYBACK_WAIT_MAX_MS = void 0;
exports.getVoiceState = getVoiceState;
exports.subscribeVoiceState = subscribeVoiceState;
exports.subscribeVoiceUtterance = subscribeVoiceUtterance;
exports.setVoiceBase = setVoiceBase;
exports.setSurface = setSurface;
exports.setVoiceConfig = setVoiceConfig;
exports.setVoiceNotifyEnabled = setVoiceNotifyEnabled;
exports.isVoiceNotifyEnabled = isVoiceNotifyEnabled;
exports.playSayVoice = playSayVoice;
exports.speakNotice = speakNotice;
exports.speakText = speakText;
/**
 * 端侧语音播报：按 `say` 叶子决定这一句要不要念，以及合成请求与播放。
 *
 * 两端各判各的：叶子里的 `voiceTo` 指向哪一端，就只有那一端出声；缺省 = 谁都不念。
 * 网页端另加一道「页面可见」——被切到后台的页面没人看，出声只是打扰。
 * 每句的开始与结束经 {@link subscribeVoiceUtterance} 广播出去：说话气泡靠它决定何时收起。
 * 不负责合成与缓存：那些在宿主侧（`/voice/speak`）。
 * @module dsh-pet/src/shared/voice
 */
const constants_ts_1 = require("src/shared/constants.ts");
/** 当前音色；空串 = 不指定，由宿主用默认音色。 */
let voiceName = '';
/** 播放音量系数（0–1，1 = 最大音量）；两端共用，只作用于播放，不影响已合成好的音频。 */
let voiceVolume = 1;
/** 工作状态播报开关；只有成品配置明确为 true 才念。 */
let notifyEnabled = false;
/** 本端是网页端还是桌面端；`null` = 还没声明，此时不按叶子播放。 */
let surface = null;
/** 接口基址：网页端是同源前缀，桌面端由 `setVoiceBase` 换成 bridge 地址。 */
let voiceBase = constants_ts_1.ROUTE_PATH;
/** 配置是否已就绪；网页端由 `setVoiceConfig` 置位，桌面端首次播放时懒加载。 */
let configLoaded = false;
/** 当前播报状态；气泡据此显示图标。 */
let voiceState = 'idle';
/** 状态订阅者：两端的说话气泡据此渲染图标。 */
const stateListeners = new Set();
/** 播报开始/结束的订阅者：说话气泡据此挂起与收尾。 */
const utteranceListeners = new Set();
/** 播报序号；每次决定要念一句就自增，用来让气泡丢掉迟到的「上一句播完了」。 */
let utteranceSeq = 0;
/**
 * 客户端等合成结果的上限（ms）。
 *
 * 比宿主侧的总超时（28s）再宽一点：让宿主先超时并回结构化失败，
 * 客户端这道只是兜底，避免上游挂住时气泡上的转圈永远停不下来。
 */
const SPEAK_TIMEOUT_MS = 30_000;
/**
 * 等一句播完的上限（ms）。
 *
 * 比气泡自身的挂起上限（50s）再宽一点：正常单句远小于它，到点还没收尾说明播放这条线
 * 已经断了，此时按收尾处理，气泡不至于跟着永久挂住。
 */
exports.PLAYBACK_WAIT_MAX_MS = 60_000;
/** 合成请求的超时信号；自动播报与手动点播共用同一份口径。 */
function speakSignal() {
    return AbortSignal.timeout(SPEAK_TIMEOUT_MS);
}
/** 切换状态并通知订阅者；同值不重复通知。 */
function setVoiceState(next) {
    if (voiceState === next)
        return;
    voiceState = next;
    for (const listener of stateListeners)
        listener(next);
}
/**
 * 读当前播报状态；桌面端在重绘气泡时直接取（它没有 react 的订阅机制）。
 * @returns `idle` / `loading` / `ready`。
 */
function getVoiceState() {
    return voiceState;
}
/**
 * 订阅播报状态；订阅时会立刻收到当前值。
 * @param listener - 状态变化回调。
 * @returns 取消订阅；组件卸载/气泡关闭时必须调用。
 */
function subscribeVoiceState(listener) {
    stateListeners.add(listener);
    listener(voiceState);
    return () => {
        stateListeners.delete(listener);
    };
}
/**
 * 订阅每句播报的开始与结束；不补发历史状态，只报后续事件。
 *
 * @param listener - 事件回调：`start` 表示已经决定要念这一句（合成开始），
 *   `end` 表示播完、合成失败或超时——三种结局都会报一次，气泡不必自己判超时。
 * @returns 取消订阅；卡片卸载或气泡关闭时必须调用。
 */
function subscribeVoiceUtterance(listener) {
    utteranceListeners.add(listener);
    return () => {
        utteranceListeners.delete(listener);
    };
}
/** 广播一次播报事件；单个订阅者抛错不能挡住其余订阅者。 */
function emitUtterance(event) {
    for (const listener of utteranceListeners)
        listener(event);
}
/**
 * 换掉接口基址；桌面端在模块加载时调一次（`file://` 页面不能用相对路径）。
 * @param base - 已含前缀的地址，如 `dsh-pet-bridge://dsh-pet/dsh-pet-7340`。
 */
function setVoiceBase(base) {
    if (typeof base === 'string' && base)
        voiceBase = base;
}
/**
 * 声明本端是网页端还是桌面端；两端各自在启动时调一次。
 * 没声明时不按 `say` 叶子播放——宁可没声音，也不替另一端出声。
 * @param next - `web` / `desktop`；其余值忽略。
 */
function setSurface(next) {
    if (next === 'web' || next === 'desktop')
        surface = next;
}
/**
 * 记录成品配置里的音色与音量；网页端在读到 `/config` 时调一次。
 * 调用即视为配置已就绪，后续播放不再自己去拉。
 *
 * @param name - 音色 id（非字符串按未指定处理）。
 * @param volume - 音量系数（0–1）；缺省或非数值按最大音量播放。
 */
function setVoiceConfig(name, volume) {
    voiceName = typeof name === 'string' ? name : '';
    voiceVolume = clampVolume(volume);
    configLoaded = true;
}
/**
 * 记录工作状态播报开关；网页端在读到 `/config` 时调一次。
 *
 * @param on - 成品配置的 `main.voiceNotifyEnabled`；只有严格 `true` 才算开启。
 */
function setVoiceNotifyEnabled(on) {
    notifyEnabled = on === true;
}
/** 工作状态播报是否开启。 */
function isVoiceNotifyEnabled() {
    return notifyEnabled;
}
/** 把音量收敛到 0–1；非数值按最大音量（1）处理——脏配置不该把声音悄悄变成 0。 */
function clampVolume(value) {
    const n = Number(value);
    return Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 1;
}
/** 懒加载成品配置；失败按「不播」处理，且只试一次（避免每句都发请求）。 */
async function loadConfigOnce() {
    if (configLoaded)
        return;
    try {
        const response = await fetch(voiceBase + '/config', { cache: 'no-store' });
        const body = (await response.json());
        const main = body?.main;
        voiceName = typeof main?.voiceName === 'string' ? main.voiceName : '';
        voiceVolume = clampVolume(main?.voiceVolume);
        setVoiceNotifyEnabled(main?.voiceNotifyEnabled);
        // 只有成功才置位：拉不到（bridge 还没就绪 / 瞬时故障）留给下一句重试——
        // 否则一次失败就把这一端永久静音了。
        configLoaded = true;
    }
    catch {
        /* 拉不到就保持关闭：宁可没声音，也不乱播 */
    }
}
/**
 * 按 `say` 叶子播放：叶子点名了本端就念。
 *
 * 两道门：叶子有没有点名本端 → 网页端页面是否可见。念不念由宿主在写叶子时决定。
 *
 * @param say - 要念的那一句：`text` 正文，`voiceTo` 该由哪一端念。
 */
function playSayVoice(say) {
    const isMine = say.voiceTo !== undefined && say.voiceTo === surface;
    if (!say.text || !isMine) {
        setVoiceState('idle');
        return;
    }
    if (surface === 'web' && typeof document !== 'undefined' && document.hidden) {
        setVoiceState('idle');
        return;
    }
    void speakWhenReady(say.text); // 不 await：播放是旁路，不能挡住气泡与动画
}
/**
 * 配置就绪后开播；桌面端首次调用会顺手拉一次 `/config`。
 *
 * @param text - 要念的整句。
 * @param canPlayHidden - 页面隐藏时是否继续播；缺省 `false`（藏起来就静音）。
 */
async function speakWhenReady(text, canPlayHidden = false) {
    await loadConfigOnce();
    const seq = ++utteranceSeq;
    // 先报开始再置 loading：气泡要靠这条事件挂起收起计时，晚一步它就可能已经收了。
    emitUtterance({ kind: 'start', seq, text });
    setVoiceState('loading');
    try {
        await speak(text, canPlayHidden);
    }
    finally {
        // 成功、失败、超时都走这里：气泡在等这个收尾，漏一次就永远挂着。
        emitUtterance({ kind: 'end', seq, text });
    }
}
/**
 * 念一句与气泡无关的系统提示（工作状态播报）。
 *
 * 念不念由调用方判定。与其它自动播报共用同一个单槽——后一句掐掉前一句。
 *
 * @param text - 要念的整句；空串直接跳过。
 */
function speakNotice(text) {
    if (text === '')
        return;
    // 允许后台播：用户正在别的应用里，正是需要它出声的时候。
    void speakWhenReady(text, true);
}
/**
 * 等到这一句真正播完。
 *
 * `play()` 的 Promise 在「开播」时就 resolve，而气泡要的是「播完」：两者的差就是气泡提前
 * 收起的全部原因。所以这里另等收尾信号，并用 {@link PLAYBACK_WAIT_MAX_MS} 兜底。
 *
 * @param audio - 正在播的元素。
 * @param objectUrl - 收尾时要释放的 blob 地址。
 */
function waitForPlaybackEnd(audio, objectUrl) {
    return new Promise((resolve) => {
        let settled = false;
        let timer = null;
        const finish = () => {
            if (settled)
                return; // ended 与 pause 会先后到达，只收一次尾
            settled = true;
            if (timer !== null)
                clearTimeout(timer);
            URL.revokeObjectURL(objectUrl);
            resolve();
        };
        timer = setTimeout(finish, exports.PLAYBACK_WAIT_MAX_MS);
        timer.unref?.(); // 与宿主侧定时器同一策略：别把这个等待钉进事件循环
        audio.onended = finish;
        audio.onerror = finish;
        audio.onpause = finish; // 被下一句顶掉或用户暂停：同样算收尾，气泡不该再等一个不会响的音频
    });
}
/** 自动播报当前正在响的那个音频：新的一句进来先掐掉旧的，熄屏醒来后攒下的一串才不会叠着响。 */
let autoAudio = null;
/** 自动播报世代号：合成期间可能被更新的一句顶掉，回来的旧结果直接丢弃。 */
let autoSeq = 0;
/** 当前这句是否允许页面隐藏时继续播；跟随 autoAudio 一起换，不做成全局开关。 */
let autoAudioCanPlayHidden = false;
/**
 * 掐掉当前自动播报。
 *
 * 用 pause 而不是直接丢掉引用：`waitForPlaybackEnd` 已经挂了 `onpause` 收尾，
 * 气泡能照常收起，不会等一个已经不会响的音频。
 */
function stopAutoAudio() {
    const audio = autoAudio;
    // 标记无条件清掉：没有音频时也要清，否则下一句会被上一句的许可值带偏。
    autoAudio = null;
    autoAudioCanPlayHidden = false;
    if (audio === null)
        return;
    try {
        audio.pause();
    }
    catch {
        /* 播放器已销毁：忽略 */
    }
}
// 页面被藏起来（切后台 / 息屏）就静音：回来时不补播。通知类播报自带后台许可，不受这条影响。
if (typeof document !== 'undefined' && typeof document.addEventListener === 'function') {
    document.addEventListener('visibilitychange', () => {
        if (document.hidden && !autoAudioCanPlayHidden)
            stopAutoAudio();
    });
}
/**
 * 请求合成并播放；任何一步失败都落到 `failed`（气泡上留一个静音喇叭，而不是干脆没图标）。
 *
 * @param text - 要念的整句。
 * @param canPlayHidden - 页面隐藏时是否继续播；缺省 `false`。
 */
async function speak(text, canPlayHidden = false) {
    const token = ++autoSeq;
    stopAutoAudio();
    try {
        const response = await fetch(voiceBase + '/voice/speak', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ text, ...(voiceName ? { voice: voiceName } : {}) }),
            signal: speakSignal(),
        });
        if (token !== autoSeq)
            return;
        if (!response.ok || !(response.headers.get('content-type') ?? '').includes('audio')) {
            setVoiceState('failed');
            return;
        }
        const objectUrl = URL.createObjectURL(await response.blob());
        if (token !== autoSeq) {
            URL.revokeObjectURL(objectUrl);
            return;
        }
        const audio = new Audio(objectUrl);
        audio.volume = voiceVolume;
        // 合成期间页面被藏起来：这一句不补播，直接丢掉——除非这句自带后台许可（通知类）。
        if (!canPlayHidden && typeof document !== 'undefined' && document.hidden) {
            URL.revokeObjectURL(objectUrl);
            setVoiceState('idle');
            return;
        }
        // 音频就绪即置 ready：喇叭表示「这句有语音」，不跟播放进度绑定
        setVoiceState('ready');
        autoAudioCanPlayHidden = canPlayHidden;
        autoAudio = audio;
        try {
            await audio.play(); // 只代表开播：开播就失败要落到 failed，也不必再等收尾
        }
        catch {
            URL.revokeObjectURL(objectUrl);
            if (autoAudio === audio) {
                autoAudio = null;
                autoAudioCanPlayHidden = false;
            }
            setVoiceState('failed');
            return;
        }
        // 气泡靠 end 事件收起，所以必须等播完：停在「已经开播」会让气泡提早 1.5 秒消失
        await waitForPlaybackEnd(audio, objectUrl);
        if (autoAudio === audio)
            autoAudio = null;
    }
    catch {
        /* 含超时：气泡已经显示，失败也不能反过来打断渲染，只把图标换成静音喇叭 */
        // 旧请求的失败晚到不能覆盖新句状态：世代号已变就说明这句已经被顶掉。
        if (token === autoSeq)
            setVoiceState('failed');
    }
}
/** 手动点播时正在响的那个音频；新的一句先掐掉旧的，避免两句话叠在一起。 */
let manualAudio = null;
/** 手动点播的世代号：新的点播会作废旧请求的阶段回调，避免旧回调清掉新状态。 */
let manualSeq = 0;
let manualRequest;
/**
 * 手动播报一句（对话面板的喇叭按钮用）。
 *
 * 用户明确点播，拿到正文就合成播放；音色与音量取配置值。
 *
 * @param text - 要念的正文。
 * @param onPhase - 阶段回调：请求合成时 `loading`、音频就绪开始播时 `playing`、播完 `idle`、失败或超时 `failed`。
 */
function speakText(text, onPhase, fetchVoice = fetch) {
    if (!text)
        return;
    void playManual(text, onPhase, fetchVoice);
}
/** 请求合成并播放手动点播；失败静默，不打断面板交互。 */
async function playManual(text, onPhase, fetchVoice) {
    const token = ++manualSeq;
    manualRequest?.abort();
    const controller = manualRequest = new AbortController();
    await loadConfigOnce();
    if (token !== manualSeq)
        return;
    if (manualAudio) {
        manualAudio.pause();
        manualAudio = null;
    }
    onPhase?.('loading');
    try {
        const response = await fetchVoice(voiceBase + '/voice/speak', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ text, ...(voiceName ? { voice: voiceName } : {}) }),
            signal: AbortSignal.any([speakSignal(), controller.signal]),
        });
        if (token !== manualSeq)
            return;
        if (!response.ok || !(response.headers.get('content-type') ?? '').includes('audio')) {
            onPhase?.('failed');
            return;
        }
        const blob = await response.blob();
        if (token !== manualSeq)
            return;
        const objectUrl = URL.createObjectURL(blob);
        const audio = new Audio(objectUrl);
        audio.volume = voiceVolume;
        audio.onended = () => {
            URL.revokeObjectURL(objectUrl);
            if (manualAudio === audio) {
                manualAudio = null;
                onPhase?.('idle');
            }
        };
        audio.onerror = () => URL.revokeObjectURL(objectUrl);
        manualAudio = audio;
        onPhase?.('playing');
        await audio.play();
    }
    catch {
        /* 含超时：面板里还有文字，不弹错误打断阅读，只把按钮换成失败态 */
        if (token === manualSeq)
            onPhase?.('failed');
    }
    finally {
        if (manualRequest === controller)
            manualRequest = undefined;
    }
}

exports.stopManualSpeech = () => { manualSeq++; manualRequest?.abort(); manualRequest = undefined; if (manualAudio) { manualAudio.pause(); URL.revokeObjectURL(manualAudio.src); manualAudio = null; } };
},
"src/shared/weights.ts": function(exports, require) {
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DEFAULT_WEIGHTS = exports.WEIGHTS_TOTAL = exports.WEIGHT_KEYS = void 0;
exports.actionPercent = actionPercent;
exports.withWeight = withWeight;
exports.parseWeights = parseWeights;
/** 三个可编辑的权重字段；随机动作是余量，不单独存配置。 */
exports.WEIGHT_KEYS = ['idle', 'turn', 'move'];
/** 权重合计上限（百分比）：三项之和不能超过它，否则随机动作会是负数。 */
exports.WEIGHTS_TOTAL = 100;
/** 内置默认值：与 assets/config.jsonc 的 animationWeights 一致；配置缺失或未就绪时的占位。 */
exports.DEFAULT_WEIGHTS = { idle: 10, turn: 5, move: 5 };
/**
 * 取整并夹取；非有限数按下限处理，输入框里出现脏值时不写坏状态。
 *
 * @param value - 待归一的数值。
 * @param min - 下限。
 * @param max - 上限。
 * @returns 夹取后的整数。
 */
const clampInt = (value, min, max) => {
    const rounded = Math.round(value);
    if (!Number.isFinite(rounded))
        return min;
    // 手写坏配置可能让上限低于下限（三项合计已超过 100）：夹到下限，绝不产出负数。
    const upper = Math.max(min, max);
    return Math.min(Math.max(rounded, min), upper);
};
/**
 * 随机动作占比：总上限减去三项之和，最低 0。
 *
 * @param weights - 当前三项权重。
 * @returns 0–100 的整数；手写过大的值时按 0 处理。
 */
function actionPercent(weights) {
    return Math.max(0, exports.WEIGHTS_TOTAL - weights.idle - weights.turn - weights.move);
}
/**
 * 改一个权重：其余两项不动，夹到「给随机动作留 0」的上限。
 *
 * @param weights - 当前三项权重。
 * @param key - 要改的字段。
 * @param value - 目标值；小数取整，越界夹取。
 * @returns 新的权重对象（不修改入参）。
 */
function withWeight(weights, key, value) {
    const others = weights.idle + weights.turn + weights.move - weights[key];
    return { ...weights, [key]: clampInt(value, 0, exports.WEIGHTS_TOTAL - others) };
}
/**
 * 从不可信输入解析权重：三项都是非负有限数才采用。
 *
 * @param raw - 成品配置里的 `animationWeights`。
 * @returns 解析出的权重；缺字段、非数字或负数返回 `undefined`，调用方保留表单现值。
 */
function parseWeights(raw) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw))
        return undefined;
    const record = raw;
    const idle = Number(record.idle);
    const turn = Number(record.turn);
    const move = Number(record.move);
    if ([idle, turn, move].some((value) => !Number.isFinite(value) || value < 0))
        return undefined;
    return { idle, turn, move };
}

},
"src/shared/whisper.ts": function(exports, require) {
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.MEME_BUBBLE_CSS = exports.MEME_BUBBLE_CLASS = exports.MEME_IMG_CLASS = void 0;
exports.whisperBubbleView = whisperBubbleView;
exports.memeImageUrl = memeImageUrl;
exports.injectMemeBubbleCss = injectMemeBubbleCss;
exports.createMemeImage = createMemeImage;
exports.createMemeImageFromUrl = createMemeImageFromUrl;
const constants_ts_1 = require("src/shared/constants.ts");
/** 碎碎念文本 → 气泡行（两端共用同一份行数据）。 */
function whisperBubbleView(state) {
    if (state.ok)
        return [{ role: 'label', text: state.text }];
    const msg = state.reason === 'provider-missing'
        ? '当前对话未配置模型，碎碎念不可用'
        : '碎碎念生成失败' + (state.message ? '：' + state.message : '');
    return [{ role: 'label', text: msg }];
}
/** 表情包图片 URL，与视频同一套拼法：`<base>/pic/memes/<素材根>/<名称>.png`（素材根与名称都需编码）。
 *  带素材根是为了表达这张图属于哪只宠物：`pet/<素材根>-memes/` 存在时该种类只认自己的目录，
 *  否则走用户目录与包内 assets/memes；assetRoot 为空则退回两段形式，未打标的宠物与老宿主仍能取到图。
 *  base 已含 /dsh-pet-7340 前缀（与视频的 assetBase 一致），函数内不得再拼一次，否则桌面端图裂。
 *  桌面页面是 file:// 加载的，相对路径会解析成 file:/// 而必然失败，所以桌面传绝对基址。 */
function memeImageUrl(name, base = constants_ts_1.ROUTE_PATH, assetRoot = '') {
    const root = String(assetRoot ?? '').trim();
    const prefix = root ? '/pic/memes/' + encodeURIComponent(root) : '/pic/memes';
    return base + prefix + '/' + encodeURIComponent(name) + '.png';
}
/** 气泡配图 class（两端共用，样式见 MEME_BUBBLE_CSS）。 */
exports.MEME_IMG_CLASS = 'pet-bub-img';
/** 带图气泡 class：取消 min-width，让气泡贴合图片宽度（否则图旁留大片空白）。 */
exports.MEME_BUBBLE_CLASS = 'has-img';
/** 气泡配图样式 —— 两端注入同一份。
 *  尺寸锚在字号上：--m = 气泡正文最终字号 --f（各壳按 shared/fonts.ts 的 resolveFontPx 注入），
 *  字号调大图同步变大；--f 未注入时回退到宠物宽 × 0.0455。
 *  系数 = 0.34 ÷ 0.0455 ≈ 7.4725，默认 462px 宠物 / 21px 字号下与固定 0.34 × 宠物宽等价。
 *  max-width:100% 是兜底：关掉 followPet 把字号调小后，固定宽度的图会戳出气泡。 */
exports.MEME_BUBBLE_CSS = [
    '.pet-bub-img{--m:var(--f,calc(var(--dsh-pet-size,var(--pet-size,462px))*0.0455));display:block;' +
        'width:calc(var(--m)*7.4725);max-width:100%;height:auto;border-radius:calc(var(--m)*0.5714);' +
        'margin:0 auto calc(var(--m)*0.3736);object-fit:cover;pointer-events:none;user-select:none}',
    '.pet-bubble.has-img,.dsh-pet-bubble.has-img{min-width:0}',
    // 语音状态角标：两端共用；绝对定位在气泡右下角，不参与文字排版、不撑高气泡。
    '.dsh-pet-voice-badge{position:absolute;right:calc(var(--f,21px)*0.25);bottom:calc(var(--f,21px)*0.15);' +
        'width:calc(var(--f,21px)*0.66);height:calc(var(--f,21px)*0.66);display:flex;align-items:center;' +
        'justify-content:center;font-size:calc(var(--f,21px)*0.5);line-height:1;opacity:.65;pointer-events:none}',
    // 加载态：只有上半圈有颜色的细环，靠旋转表达「在转」。
    '.dsh-pet-voice-badge.is-loading::before{content:"";width:calc(var(--f,21px)*0.5);height:calc(var(--f,21px)*0.5);' +
        'border:1.5px solid rgba(43,43,43,.22);border-top-color:rgba(43,43,43,.7);border-radius:50%;' +
        'animation:dsh-pet-voice-spin .8s linear infinite}',
    '@keyframes dsh-pet-voice-spin{to{transform:rotate(360deg)}}',
    // 失败态：静音喇叭，压一点透明度——读得出「这句没念出来」，但不抢文字。
    '.dsh-pet-voice-badge.is-failed{opacity:.5}',
].join('');
/** 只注入一次（页面已有同一标记则跳过）。 */
let memeCssInjected = false;
function injectMemeBubbleCss() {
    if (memeCssInjected || typeof document === 'undefined')
        return;
    memeCssInjected = true;
    if (document.querySelector('style[data-plugin-css="dsh-pet/meme-bubble"]') !== null)
        return;
    const tag = document.createElement('style');
    tag.dataset.plugin = 'dsh-pet';
    tag.dataset.pluginCss = 'dsh-pet/meme-bubble';
    tag.textContent = exports.MEME_BUBBLE_CSS;
    document.head.appendChild(tag);
}
/** 生成气泡配图节点（两端共用同一份渲染）；返回 null 表示本次不配图，调用方走纯文本路径。
 *  @param name - 配图名称（配置 memes 的键），缺省或空白 → null。
 *  @param base - 已含 /dsh-pet-7340 的宿主基址（与视频同规则）：浏览器缺省，桌面传 BASE。
 *  @param assetRoot - 素材根（= 该宠物的条目 key），决定图片去哪个表情包目录链取。 */
function createMemeImage(name, base = constants_ts_1.ROUTE_PATH, assetRoot = '') {
    const key = String(name ?? '').trim();
    if (!key)
        return null;
    injectMemeBubbleCss();
    const img = document.createElement('img');
    img.className = exports.MEME_IMG_CLASS;
    img.src = memeImageUrl(key, base, assetRoot);
    img.alt = key;
    return img;
}
/** 生成外部地址配图节点（素材由第三方托管，只给地址）。
 *  与 createMemeImage 共用 class 与样式，区别只在 src：直接用给定地址，不拼表情包路径，也不需要 base。
 *  两种形态二选一由宿主保证，消费端按字段名区分，不做 startsWith('http') 嗅探；地址为空 → null。 */
function createMemeImageFromUrl(url) {
    const href = String(url ?? '').trim();
    if (!href)
        return null;
    injectMemeBubbleCss();
    const img = document.createElement('img');
    img.className = exports.MEME_IMG_CLASS;
    img.src = href;
    img.alt = '';
    return img;
}

},
"src/shared/work-status.ts": function(exports, require) {
"use strict";
/**
 * 工作状态联动：档位常量与快照解析。
 * 宿主半侧有自包含的实现（DSH 单文件加载约束，宿主不 import 本目录），负责监听 DSH 会话事件
 * 聚合成快照并写进 /state 的 sections.workStatus；本模块只有档位常量与叶子解析。
 * 气泡文案不在代码里：浏览器半侧直接读配置的 events.workStatusTexts。纯函数无副作用，不依赖 React / DOM。
 * @module dsh-pet/src/shared/work-status
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.WORK_STATUS_INDEX = exports.WORK_STATUS_STATES = void 0;
exports.toWorkStatus = toWorkStatus;
/** 工作状态档位（对应 animations.events.workStatus 数组索引，顺序即档位，勿在中间插入新档）。 */
exports.WORK_STATUS_STATES = ['thinking', 'working', 'result', 'waiting', 'success', 'error'];
/** 档位 → workStatus 数组索引（与 events.workStatus 的顺序严格一致）。 */
exports.WORK_STATUS_INDEX = {
    thinking: 0, // turn/start → 思考
    working: 1, // tool/call → 工作
    result: 2, // tool/result → 整理
    waiting: 3, // approval/asked → 等待
    success: 4, // turn/end completed → 完成
    error: 5, // turn/end error/max-tokens → 出错
};
/** 快照解析：档位不认识 → 归一成 null（空闲）；形状非法 → null，消费端跳过这一拍。 */
function toWorkStatus(raw) {
    if (!raw || typeof raw !== 'object')
        return null;
    const r = raw;
    const state = r.state === null || (typeof r.state === 'string' && exports.WORK_STATUS_STATES.includes(r.state))
        ? r.state
        : null;
    const sessionId = typeof r.sessionId === 'string' && r.sessionId !== '' && r.sessionId !== 'unknown' ? r.sessionId : null;
    return { state, task: typeof r.task === 'string' ? r.task : null, sessionId };
}

}}; const cache = {};
function require(id) { if (cache[id]) return cache[id]; const out = cache[id] = {}; modules[id](out, require); return out; }
window.PetShared = { ...require('src/shared/index.ts'), ...require('src/shared/chat/encode.ts'), ...require('src/shared/chat/hear-control.ts') }; })();
