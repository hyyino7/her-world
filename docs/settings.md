# Her World 设置

在 **DSH 设置 → Her World** 管理当前绑定的伙伴。**工作区 → 资料与会话 → 实际存储位置**显示 Core、Memory 和本机 Python 的位置。文档已就绪时，可搬迁存储仍可能待准备，页面会显示外部引导库或设备运行时的状态。

| 页面 | 操作 |
| --- | --- |
| **概览** | 查看绑定和组件状态，显示或隐藏正常桌宠，或打开独立的 Room 窗口。 |
| **角色** | 编辑 SOUL、USER、**基础说明**与**我是谁**，查看日记和相册。关闭 Life 或 Memory 后仍可访问这些 Core 资料。 |
| **情绪** | 编辑持续心情、原因和结构化感受，查看表达、设置近期保留范围。 |
| **记忆与档案** | 查看原生会话数，搜索有资格召回的 Bank 记录、打开来源，调整召回和批量整理。 |
| **桌宠** | 管理原版外观、物理和动作，设置回复表现、近期动作、安静模式与互动间隔。 |
| **生活** | 暂停或恢复 Life、设置日程和回顾、主动照料、打开 Room。钱包、背包、账本、商城和阅读导入由 Economy 提供。 |
| **连接** | 管理本机 QQ／微信／本地桥接及各获准群的公开资料。 |
| **工作区** | 绑定并初始化 Repo、查看执行限制、组件和维护信息。 |

角色预览读 Core 保存的人设与用户资料，预估只覆盖这两段；会话实际用量由 DSH 记录。World 视图使用当前装载的组件。独立上游 dsh-world 的「世界控制台」在自己的 DSH 设置项管理。[桌宠、World 与 Room](#pet-world-and-room)各用对应的服务。

档案页读取原生工作区会话统计，手动搜索按需启动本机 provider。搜索和打开详细内容都会按当前 Bank、作用域和来源资格校验。主人更正后，页面显示当前内容和证据。撤回后该条不可见。原始会话日志归 DSH，档案搜索覆盖当前 Bank 已准入的材料。

概览的长期记忆开关对已有会话的下一轮也生效。provider 不可用时，聊天照常并移除上轮召回块。**工作区 → 运行状态**只查询进程状态；真正需要时才启动 provider。

首次使用先绑定并初始化伙伴 Repo，人设和资料可以留空。在 **桌宠** 里添加形象后再打开桌宠。各入口读取同一份 Core 身份。清醒时轻触默认身体会记录主人的真实摸头行为，当前活动继续；睡眠时轻触请求叫醒。Cmd/Ctrl 加点击、右键菜单或悬停后按 L 都能打开紧凑聊天窗。拖动可移动桌宠，**收起**折叠窗口，**新会话**会先归档上一段。

<a id="desktop-interactions"></a>

## 桌宠交互

在 **桌宠** 使用同页的原版 Pet 编辑器调整外观、大小、位置、活动范围、移动和动作。形象由主人显式添加。正常身体与紧凑聊天使用独立的呈现载体，紧凑窗不会带额外身体或托盘。助手进程真正运行后，**启动中**才结束。可取消、重试，查询状态时保留未保存的表单。

**对话表现**设置最终回复气泡、气泡时长和贴图概率。**动作记录**设置已观察动作的保留条数和时长。**互动间隔**以秒保存碎碎念、梦话和余额查询的间隔；开关在上方原版编辑器。分段保存后可查看实际值。现行编辑器和计时均使用 `main-config.jsonc`。

安静模式暂停主动联络，主人发起的对话照常。开启自动碎碎念或梦话后，原版 Pet 生成器可发额外的短文本请求。新配置默认不开。短文本不生成原生会话、完整聊天日志或 Memory 记录。期限取已保存的后台时长上限和生成器的 30 秒上限中较短者。关闭、暂停或换绑会取消在途请求，提供者已收到的请求可能继续计费。Life 与桌宠协调主动时机。余额读取当前提供者的实际账户能力，不支持时显示不可用。

桌宠菜单可打开聊天和 **进入房间**，也提供当前可用的原版动作、声音、睡醒、待办、碎碎念和余额。桌宠隐藏或卸载后，Room 仍能从设置打开独立窗口。悬停快捷键为 L（聊天）、S（截图）、D（待办）和 Z（睡眠）。主人请求睡醒走共用 Body 服务，自主生活暂停时也可用。

Room 2D 和默认桌宠用同一份媒体映射，采样同一活动的阶段与进度。关闭 Room 后活动继续，拖动桌宠只改窗口位置。阅读文本、到达、睡醒和消耗均由实际执行决定。视频循环或素材结束不结算效果；提前播完的单次素材停在末帧，等共用阶段变化。

身体到达床并进入睡眠后才算睡着。等待结束、暂停或取消都不会叫醒她。睡眠期间投喂基础食物、背包餐食或水会提示先叫醒，身体和库存都不会变化。重复提交按原号返回拒绝结果；醒后发新请求。相对时长暂停保留活动进度，绝对截止时间仍按时钟计算。被拒的移动或菜园请求不打断当前计划。

素材按实际阶段复用或拼接。食物按物品元数据选素材。单一适配的 feeling 可以选择休息或触摸表现；无匹配素材或没有适配分类时保留中性表现。快乐与赶路冲突时沿用已有专用变体，明确转向或特殊步态可用共用映射。路径和速度由执行者决定。缺少专用动作时显示代理或静态表现，向右转向使用相同的镜像配置。自定义包继续用可用的本地素材和真实活动文字。

普通桌宠点击须先经过输入、拖动和锁定守卫，再走 Body 照料。忙碌时原活动主素材继续播放。已确认的主人互动可用气泡或登记贴图反馈；重复观察不重播，迟到反馈按实际有效期处理，隐藏后等待新快照。反馈不新开会话，也不独立写 Memory。基础投喂可从 Room 或生活照料发起，睡眠和动作准入沿用当前守卫。

紧凑聊天的麦克风用已配置的识别器，发送前可检查和编辑转写。每条伙伴回复可手动播放。隐藏或换会话会撤销录音、转写和播放请求，晚到结果不会覆盖新草稿。Room 也会通过 Voice 取消尚未开始的合成。已经提交给提供者的文本仍可能完成处理或计费。

原版待办支持新增、完成、重开、删除、截止时间与提醒，存于 `.chatpet/data/desktop/todos.json`。它独立于原生 Agent 的待办和已接受的 Life 计划。现存文件无效时，保留并显示错误。

图片可选择、粘贴、拖入，也可由主人显式截图。发送前可看预览。截图要有系统录屏权限。图片经 DSH 原生附件服务进入同一个会话；便携上传副本在 `.chatpet/data/desktop/images/`。换设备后由新设备的附件服务重新准入。要让伙伴理解图片，当前模型须支持视觉输入。

正常桌宠优先用已配置或缓存的 Electron。主人请求启动身体、设备又没有 Electron 时，原版下载路径使用可选依赖 `@electron/get` 和 `@electron-internal/extract-zip`。紧凑窗、Room 和独立桌宠使用本机已有 Electron；包内不附二进制。外观和解码表现以安装后实机结果为准。

## Expression, recent experience and lasting memory

| Control | Fresh configuration | Effect |
| --- | ---: | --- |
| Sticker probability | Unconfigured | Applied once per eligible reply when the fish selects an available sticker. 0 suppresses stickers and 100 accepts every selected sticker. Body expression is independent. |
| Recent action count / age | Unconfigured | Both limits apply to observed distinctive actions and related feedback. |
| Recent mood changes / age | Unconfigured | Both limits apply to retained mood changes; the continuing current emotion is separate. |
| Batch-summary turns | Unconfigured | Summarize after this many completed turns, or after the idle threshold. |
| Batch-summary idle time | Unconfigured | Summarize pending dialogue after inactivity. |
| Minimum summary interval | Unconfigured | Limits repeat maintenance; failed work also uses the reference retry backoff. |
| Recall count | Unconfigured | Bounds provider-selected recall items. |
| Recall block size | Unconfigured | Clips text at presentation only; `pet_memory_read` retrieves eligible full detail and original dialogue. |

The owner saves these values to the bound workspace's `.chatpet/core.json`.
Omitted and explicit null values remain unconfigured in the editor; native
consumers resolve only the mechanics they require without persisting them as owner choices. Other workspaces retain their own
settings. A stale settings draft cannot replace a newer value or a different
workspace's configuration. A zero count or retention period removes that class
of recent experience on its next read. Durable preferences remain with Mnemosyne.
Recent interaction data lives in `.chatpet/data/memory/recent-interactions.sqlite`.

Automatic batch triggers remain inactive until their cadence is configured
or an explicitly enabled Life review requests maintenance. Blank identity and
foundation files never substitute a bundled persona. Current emotion
persists across expiry of the recent-change list. Its canonical file is
`.chatpet/data/emotion/state.json`, separate from the recent-change ledger.
**情绪** edits its text, reason and structured feelings with revision/hash checks.
Existing text-only states do not receive invented numeric values; existing Room
0–100 values are retained when present. Current Emotion is an independent state:
correcting or forgetting a Bank record does not automatically rewrite or hide its
text/reason. The owner can edit the current state explicitly. A damaged file is reported and retained.
An update whose final encoded document exceeds the reader's existing size limit
is refused before replacement; the previous feeling stays readable and editable.
Emotion does not write a second Room mood file.

## Entry And Ownership

Open **DSH Settings → Her World**. The client uses native settings section/icon
slots, theme, React and Connection transport. It owns only form drafts. The owning
services validate and save durable state. Closing the page retains acknowledged writes.

| Entry | Responsibility |
| --- | --- |
| `src/console/client.js` | Loaded `./client` browser factory, real reads, per-section drafts/save/status, conflicts and refresh |
| `dist/src/console/plugin.js` | Package-root carrier and finite exact native owner-only API routes |
| `dist/src/console/settings.js` | Finite settings operation map, strict input shapes, workspace lookup and safe Chinese failures |
| `dist/src/core/preferences.js` | Owner-authorized, revisioned, idempotent preferences and quiet-policy writes in the existing Core store |

DSH loads the browser factory from the package's `./client` export.
The **大肥鱼** section and its icon both use the stable ID `dsh-Chatpet` in the native `settings.section`
and `settings.section.icon` slots. The bundle mounts the `chatpet-settings`
carrier and separately declares `00-Core`, `10-Memory`, `20-Emotion`,
`25-Behavior`, `30-Desktop`, Pet presentation, Life, Room and channel capabilities. The current Memory switch applies to the next turn in both new and existing
conversations. Turning it off removes the prior recall block and stops new
observations; it does not erase the Bank or native originals, or backfill turns
made while Memory was off.

The settings page calls owner-authenticated native Connection routes under
`/api/chatpetSettings/`. It reads `snapshot` and the workspace-scoped
`worldView`, `archiveFind` and `archiveRead` routes, saves `identity`, `profile`,
`quiet`, `preferences` and `companion`, initializes the selected Repo with
`initialize`, and requests `desktopOpen` or `desktopClose` for the bound
workspace. It also reads/saves the Core foundation and Emotion state, opens Room
through `roomOpen`, and calls the owning presentation timing
operation. The handler checks the request shape, binding and revision as
appropriate. The native connection identifies the owner. The page receives a
readable error when its backing service is unavailable.

## Supported Settings

| Area | Current behavior and effective scope |
| --- | --- |
| Role name and character | Read/write existing Core identity with its expected revision; saved values are used by subsequent native turns and survive restart |
| Quiet mode | Revisioned policy update; suppresses proactive contact while owner replies remain admitted. Does not start autonomy |
| Background limits | Save Memory context characters, steps, tools and duration; subsequent autonomous/background turns read the saved limits; ordinary owner turns use native DSH execution |
| Workspace target | Native Workspace Registry list, live directory check, save/clear selected ID and canonical host metadata; persisted across restart |
| Modules | Read actual Core-reported capability states; module-owned settings are not fabricated |
| Recovery | Use the existing offline backup command and complete-workspace procedure; Core has no online snapshot or generic artifact service |

Memory and desktop values share one revisioned workspace file. **保存记忆设置** applies the memory fields. The desktop save applies its own fields and preserves pending memory edits. Forms keep drafts until a successful save or an explicit refresh. A stale
revision or binding rejects the save and preserves the draft. Refresh asks
before discarding pending edits. The browser does not store configuration.

Role and USER-profile saves also carry the editor binding captured by the
snapshot, including an explicit unbound local state. A workspace switch and
return does not make an old draft current again. Conflicts preserve the draft;
refresh its binding before saving. Older clients that omit this scope must
refresh instead of writing against whichever workspace is now selected.
QQ, WeChat and local-bridge saves confirm their submitted section while
preserving other unsaved sections and edits made during a pending save.

Core identity/policy retain their existing revision streams. Preferences use an
additive `preferences/current` record in Core's existing SQLite schema. Missing
preferences inherit the host's validated conversation defaults; saved preferences
override that seed after restart. Owner checks, revisions and request replay
protect configuration writes. Retired Core quiescence/activity records do not
gate current configuration or native conversations. Model routing belongs to DSH.
Old history-window/cold-recall values are tolerated when reading an older workspace,
but do not appear as current choices or return in new saves.

## Foundation and self-description

**角色 → 基础说明** edits `.chatpet/COMPANION.md`. Initialization declares this
file in the managed inventory and creates it empty. Empty content is valid; no
bundled persona/default silently fills it. The next eligible native request
receives the saved content, combined with SOUL/USER and only the capabilities
actually available to that conversation. Native DSH permissions remain authoritative.

自述保存在 `.chatpet/self.md`，历史与日记分别保存在 `.chatpet/self.history/` 和
`.chatpet/diary/`。
Core's scoped reader/writer integration permits ordinary
conversation updates without autonomous Life. It remains distinct from the
owner-authored persona, the user's profile and Memory facts. Life's daily review
is another opportunity to inspect it, not a prerequisite. Self-description and diaries remain scoped owner documents; their availability
does not depend on a running Memory provider. Forgetting a Bank record does not
erase these documents or the original transcripts. Diary and album data/tools stay with their owning
capabilities; when that optional provider is unavailable the foundation must not
claim the capability exists.

## Workspace and recovery

Binding saves the selected native workspace and initializes `.chatpet/`.
Default first setup may still use the one external bootstrap Core. Its Repo
documents can be ready while portable storage remains incomplete. The existing
stopped setup/migration copies that same database and atomically declares it in
the Repo manifest; it never creates another companion or a placeholder database.
The role and user profile become available on eligible native requests in that
workspace. DSH owns the native session, logs and permission settings. Optional
Core supplies binding, persona, settings and native Memory hooks. DSH owns
conversation execution; there is no separate Core workbench or activity runner.
Old scheduler records remain inert data and do not block rebinding.

Complete native logs can travel with the bound Repo. To transfer to a second
device, follow the offline copy, rebind and conflict checks in the
[portability guide](portability.md). Workspace file authority is described in
the initialized Repo manifest and the module-owned directories; installing program
files does not move companion identity or history to the plugin directory.

## Source and verification records

Upstream license and attribution are retained in [THIRD_PARTY_NOTICES](../THIRD_PARTY_NOTICES.md).
Detailed development checks and installed acceptance records belong to the source
repository's runtime/handover records. They are not required for the installed
program to run.

## Daily Life

The current-life plan card shows the goal, reason,
current activity, actual progress, remaining intentions, pause reason and next
consideration time. Eligible owner conversations use `life_plan_read`,
`life_plan_update` and `life_activity_control` to manage the same persistent plan;
changing or archiving a conversation does not erase it. Starting Life remains
an explicit setting. Optional morning/review times can be left empty; the plan
supplies its next consideration time and body-condition thresholds. Pausing
Life retains its plan and accepted operation state. The virtual economy retains its owning wallet/inventory/ledger and actual
execution receipts.

Plan steps distinguish travel from sustained activity. `move` goes to an
existing room/spot and completes on actual arrival, including when already at
that position. `room` stays at a selected position; `hold` continues at the
current position. Both sustained kinds accept a duration or end time. Without
either, they wait for explicit control and must be the final step in a new
plan. `nextConsiderAt` wakes planning; it never completes an activity. Execution
receipts expose the completion contract and explain indefinite stays. Existing
saved queues keep their original meaning and remain available for explicit
revision or cancellation; no automatic conversion or replay occurs.

`life_plan_keep` records a
considered continuation without replacing current work. It starts one initial
planning opportunity when enabled Life has no plan and offers one consideration
after the final finite activity if no next time was chosen. A saved empty plan
or indefinite activity may remain quiet. The page adds an optional
automatic correction count for autonomous replies that omit saving a decision:
blank uses one attempt, zero disables correction. It is portable Life policy,
not a fixed activity cadence. Exhausted correction is visible as a Life fault
and preserves actual activity progress.

Open **Settings → 大肥鱼 → 生活**. Life is a separate `40-Life`
component in the existing package. A new Repo starts paused. Opening this
page, reading status, feeding, watering and local interactions do not request
a model. Enabling Life starts a dedicated native DSH home session using the
configured `agentPreset` (default `standard`) and the current native model.
It can make model requests while the owner is not chatting.

The page shows the original template's virtual activity and descriptive body
state, recent events, World alarm, home availability and tool activity. It
does not represent physical health. Behavior reuses the original movement, dwell, needs, sleep and event-cooldown
rules, with the bounded host pause policy described below. The template uses the machine's
local time; the World schedule uses that same timezone, shown on the page.
New companions have blank optional wake/review times; enabling Life does not
require filling them.
Pet starts with an empty body list rather than creating a default body. `plan_next`
lets the companion choose its next alarm (upstream minimum: one minute).
The home appears in the bound workspace's ordinary DSH session list.

On first actual home creation, World's arrival greeting is recorded for Life's
existing scheduler, including when foreground Room/chat created the home first.
Initialization/settings do not invoke a model. Existing home sessions are reused;
restarting is not another first arrival. A newly created visual body is idle with
empty interaction history. A new garden has empty plots, no starter resources or
opening story, and automatic care off. Existing saves remain unchanged; resources
must actually exist before the original purchase/planting operations can succeed.

The switch and state live in `.chatpet/data/life/` in the bound Repo:
`control.json`, `home.json`, `life.json`, `life/wakes.jsonl` and `activity/`. Complete home-session
events use Core's existing portable native transcript copies and Mnemosyne
enrollment. Life has no separate Memory extractor or Bank. It reuses the
existing turn/idle Memory batching. Pause retains alarm and event records. It stops autonomous model wakeups,
new spontaneous body goals and automatic garden tasks. Directed feeding, touch,
sleep/wake, movement and requested garden work still use `25-Behavior`, even if
Life is unloaded. Accepted manual route/dwell work can finish; stopped automatic
work cannot manufacture a completion effect. Paused passive needs/crop time is
not caught up on resume. Enabling Life retains the body and explicit requests;
reloading the components restores the saved native home and current eligibility. Invalid JSON is reported and preserved rather than silently reset.

Quiet mode suppresses `reach_out` desktop bubbles, with an explicit failed
outlet receipt; Life can keep progressing and recording. A stopped desktop
also reports delivery failure. Home replies are not automatically repeated as
ordinary reply bubbles; proactive delivery uses World's `reach_out` once.
Life pauses automatic Desktop whispers while running and aborts an in-flight
whisper when starting. Manual whispers and normal conversations remain
available. Disabling/unloading Life cancels its current autonomous home turn and removes
its schedules and background admission. It does not unload Behavior or erase the
foreground native-home identity, retained self-description or conversations. The saved background limits still apply through native Life admission; ordinary owner chat uses DSH limits
to each turn; no aggregate daily spending cap has been added.


## Pet, World and Room

**设置 → 大肥鱼 → 生活** configures the shared ongoing life; the interactive Room itself opens in a separate window. The clock controls use the displayed Life time zone. The budget is a reminder based on usage reported by the home session. The activity view shows the estimate. The evening-review switch puts a completed review on the existing Memory batch queue.

Daily review uses native `read` and `write` for its own self-description and
diary, including read-only listings of its diary and self-history directories.
Shell or programming-tool refusal does not revoke these scoped file tools.
Previously delivered review dates with a missing diary are recovered from the
existing Life wake records on startup. Unfinished dates and their failure reasons persist in Life's existing state;
a completed model reply is not a diary write receipt. A missing or empty diary
retains its task, with at most the configured planning repair count of automatic
corrections per date, then waits for a later daily review. Native cancellation
waits for that later opportunity. Disabling evening review retains pending tasks
without dispatching them. Restarts reconcile the original native session before
retrying, and a successful write or an already existing nonempty diary prevents
replaying that date. Existing-file reconciliation preserves the record; it does
not claim a new verified write. Other dates in the backlog remain separate jobs.

The native diary guard also accepts a direct owner-chat `write` to a missing
historical diary when that exact date is already in the persisted review backlog.
The successful native receipt clears that date without an additional autonomous
turn. This exception does not permit editing an existing historical file or
open file tools to an ordinary autonomous turn.

A backfill turn receives the original date's scope. It can create that missing
diary and records the actual backfill date in its text. Existing past diaries
cannot be overwritten, including when a file appears between preparation and
dispatch; corrections belong in today's diary. A day still in progress can be
appended through the native write workflow. No long-term self change is required
for a successful diary review. Owner input, rebinding or home disposal ends the
live permission continuation; pending tasks do not grant file access to ordinary
autonomous turns.

Quiet waiting, lying in bed and the next consideration alarm do not put the body
to sleep. Choosing sleep requires an explicit `body` step with `action: sleep`;
arrival and actual body receipts establish sleep. The prompt reports whether the
body is awake, awaiting sleep or asleep. Failure receipts retain their real reason
for plan repair; labels and reply prose never execute sleep. A completed hold and
gentle touch do not wake an already sleeping body.

- **概览 → 打开房间**, **生活 → 房间与菜园 → 打开房间**, or the pet menu's **进入房间** opens the same independent window. Repeating the command focuses it. Wake, rest, feeding, touch, movement and requested garden actions share Behavior's saved body with Desktop and remain usable while Life is paused. Closing Room releases its renderer/request lifetime; it does not reset the body or start another Agent. The TV asks the operating system to select a shared source and uses the existing native Room conversation for frame commentary. Actual physical source sharing remains a separate owner trial.
- A visible native garden with a moist, immature crop also reads its current
  natural projection at a low frequency when no body/care event occurs. Static
  native gardens remain event-driven. Hidden, minimized, locked and disposed
  views stop those reads; reopening refreshes the snapshot. These reads do not
  call a model, choose work, grow a second world or harvest automatically.
- **角色 → 日记与相册** browses the Core-owned diary/photo archive and eligible original dialogue, independent of autonomous Life. The original photo tools also work in ordinary native chat. New records use `.chatpet/self.md`, `.chatpet/self.history/`, `.chatpet/diary/` and `.chatpet/data/core/photos/`. Changing workspaces closes the previous view.
- **连接 → 外部联络 → 管理渠道** configures the current companion’s device-local accounts. For QQ, select a loopback OneBot WebSocket, specify the account, and allow individual private conversations and groups. The token field names a device environment variable. For WeChat, provide the account and allowed chats, then connect a compatible adapter using its private discovery file. Status and receipts report connectivity, queue state and provider-reported usage. A verified owner private chat resolves the retained companion home even while autonomous Life is paused or unloaded. Group/private guest chats have independent native histories. Each allowed QQ group has its own public character card, relationship material, phrase review and stickers.
- Open an allowed QQ group to choose its public role card and how it participates. V1 replies to directed messages. V2 can observe a conversation, wake on the configured triggers and choose whether to send. Its name trigger uses the current Core companion name; later messages follow a rename without reconnecting. The group panel shows unread activity and its observation reports. A verified owner can ask to publish a saved public QQ Space draft in private chat. Enabling the schedule also publishes queued drafts at the selected Beijing times.
- **本地程序和推送** enables the original World token-authenticated home bridge. The private discovery file contains the current home address and token. Each configured HTTP destination chooses which of `reach`, `reply` and `busy` it accepts. Turning the bridge off, switching the bound Repo or stopping Channels withdraws the old bridge. Pausing or unloading autonomous Life does not disable an explicitly enabled owner bridge; it continues to use the retained native home.
- **桌宠** controls tray visibility, work-state animation, dream interval, whisper illustrations, confinement, and the original physics, animation and text settings. The original Pet editor on the same page manages deliberately added bodies and their artwork, phone motion, notification behavior and browser placement. Each body follows the bound companion. Installed packs use the companion’s `.chatpet/data/pet-platform/pet/` directory.
- **桌宠 → 独立桌宠** can issue a private connection file for the current binding or copy a limited animation-control credential for another trusted program. Run `dafeiyu-standalone` to open the fish without DSH chat. Run `dafeiyu-standalone --connection "/absolute/path/to/standalone.json"` for the current native conversation. In a source checkout, run `node src/desktop/standalone.mjs` from the repository directory. The helper uses the device’s DSH Electron or the executable selected via `DSH_CHATBOT_ELECTRON_PATH`.
- **语音** uses DSH’s enabled recognizer for input. For playback the Pet service uses its configured synthesizer and cache. The bundled default is the original Edge network synthesizer, so manually choosing to read a reply can send that reply to the speech service. Offline voice tests use a local fixture.
