# 阶段 3 · 第三层原地治理（P4）

大改方案，Codex 起草、Codex 独立挑刺后修订、Claude 定稿，基于 `main` 的 `b78474e`。主人 2026-11-22 拍板：16 项全部按推荐。主人已决定进入阶段 3，范围沿用 `docs/product.md:415,421–441`。每批另按确认的执行方案开工。

## 主人会看到什么

- 仍从原入口使用桌宠、Room、QQ／微信、语音和设置。验收时逐个关闭或重开，普通聊天、记忆和已有生活流程照常运行。语音不可用时按各入口原有方式结束或回到文字。阶段目标见 `docs/product.md:423,427,431`。
- Room 和桌宠根据同一活动、时间和情绪选择各自素材。确认后的混合情绪规则会改变部分空闲画面。桌宠已在吃饭时重复点击，只投喂一次。开始前可以取消，已经生效的请求凭原号核对。旧差异见 `docs/product.md:230,234`。
- 设置页继续用原入口。钱包操作遇到断线，关页面或重启后仍能用原号看结果，再决定是否重试。老浏览器里的待办随 Console 数据版迁入钱包。现有待办在浏览器本地，恢复提示见 `src/console/client.js:440–502,526–546`、`docs/product.md:229,429`。

## 五个版本各验什么

| 版本 | 主人验收 |
| --- | --- |
| Voice | 桌宠、Room、QQ 使用同一份语音能力。试说、听、取消、关掉语音和重新打开，确认旧录音结束，普通对话继续。 |
| Room | 实际安装包里开关 Room、上传图片、拍照、看双端活动进度。换到另一个伙伴再换回，确认旧窗口请求丢弃。查看「新增口渴百分比」实测的文件清单。 |
| Channels | 试账号开关、重启、换绑和断线回执。查看「QQ 每账号每日主动消息额度」从设置保存走到发送和重启的实测，核对改动是否只在 Channels。 |
| Desktop | 从桌宠打开 Room。试睡眠、忙碌、连续点吃饭、取消和恢复。检查聊天与旧会话复用，关掉任一外围入口后生活仍继续。 |
| Console | 从 DSH Connection 打开设置，验证保存后重启、断线后的原号查证和显式重试。数据版另做合成与授权隔离副本的离线续做、清源、回退和升级。 |

## 请主人拍板

| 事项 | 推荐与代价 |
| --- | --- |
| 1. 安全网后继续／缩小／止步 | 先看六个入口的旧行为、已知缺陷和词表检查新增项，再逐条批准新增项和共用代码允许谁用。代价是首批另有一次确认。 |
| 2. 设置和错误恢复 | 做运维登记、稳定路由、结构化错误，并用一项设置实测保存到重启生效，批准 Core 存储只复用错误码类型。代价是先验证旧外观配置和兼容响应，试验没有减少改动文件就收住。 |
| 3. 5b 新聊天来源 | 建议延期到阶段 4 收尾评估。代价是阶段 3 少一组来源接入的实测证据，第 7 题照验。 |
| 4. Channels 台账与桌宠会话 | 五类回执和 `desktop-session` 都留在 Core，批准对应原位例外。`records.kind` 公共类型化和通用存储句柄延期。代价是保留部分 Core 依赖。 |
| 5. 槽位、素材、表情与贴纸 | 做退出生活层所需的最小拆分，保留原动作槽编号、可用条件和素材，目录合并留待评估。代价是各载体仍维护自己的素材。 |
| 6. 桌宠命令和通知 | 保留草案，只收本轮语音、Room 打开和吃饭接点。代价是各载体继续维护自己的协议子集。 |
| 7. 工作进度 | 保留草案，回归六种状态与收尾。代价是暂保留桌宠与上游各自的状态投影。 |
| 8. 桌面设置键 | 收拢便携字段的默认值和校验，设备键重排留草案。代价是旧映射继续维护，纯校验无法等价时逐条请批例外。 |
| 9. 渠道状态和额度试点 | 只合并连接返回类型，先让设置页读取 Channels 的字段说明，再独立测额度。代价是前置会重生成 Desktop 客户端，试验一旦再跨模块就记未达。 |
| 10. 混合情绪 | 推荐 `anger`、`boredom` 优先，其余按现有声明顺序，同组反序结果一样。代价是难过夹开心或未知情绪也会改变空闲画面，先看[逐例对照](#emotion-examples)再选。 |
| 11. Room 旧快照和包路径 | Room、桌宠、拍照、Console 回包保留旧播放形状。建议外部直接读 `petBehavior/petLife` 时改用呈现入口，先核对仓外消费。若需要兼容适配或扩 npm 包路径，另行先批。代价是可能先停搬迁。 |
| 12. 吃饭和分批换信号 | 批准按动作判定吃饭、多次点击只生效一次，以及过渡期同时发送新旧通知。代价是过渡期保留两路通知，最后统一退役。无法保行为的生成链逐条请批例外。 |
| 13. 钱包有多笔待办 | 逐笔可查和显式重试，待办未清时拦住新 Console 钱包操作。人工放弃只对无在途、无部分提交且能确认未执行或主人认可无证据的单笔开放，保留编号。代价是先处理旧单才能从设置页办新单。 |
| 14. 导出保留多久 | 含正文的私有导出只保存到清源或回退验收完成、主人关闭回退窗口为止，历史只留核对摘要。代价是封窗后不能用原导出回插。 |
| 15. Console 数据改动和回退 | 批准钱包、离线工具和 Core 绑定的最小变更，备份器有缺口时另批。真实演练用主人提供的隔离副本。代价是原副本持续停业务写，启动验收用一次性克隆，回退窗口在放行业务前。 |
| 16. 合入与发版 | 按表中顺序，先验 RC，再发同业务源码正式包，再用更新按钮在隔离环境确认正式包激活。Console 加做数据演练。代价是每版两次隔离包验收。 |

## 何时停

- 第一批结束就评审。旧行为跑不通、已知红项未定位、扫描新增无法逐条解释或未获批时先停。同一行为两轮修不好就停，同一条必须守住的行为第二次出问题就先复盘。见 `docs/product.md:185–193,206–217,436,441`。
- 模块无法保持已确认的行为、包内路径跑不通，或需要未经批准的高风险改动时停该批，交付逐条例外或缩小证据。新增范围先写明对应场景、替换或延期的目标、当前验收和原完成标准去向。见 `AGENTS.md:48,60–69`、`docs/product.md:441`。
- 隔离、停写、绑定、备份或原号核对失败时立即停止数据操作。真实迁移两轮失败停止阶段收尾。正式包隔离激活失败就停在日常升级之前。第 2、3 题未达标给出实测路径再由主人决定是否缩小。阶段关闭需行为清单、门禁、G8 和主人验收。见 `docs/product.md:415,432,439–441`、`docs/development.md:125–134`。

## 各批要点

下面规模按单提交估计。每批先锁定文件范围。纯搬家和改逻辑分提交，暂存后用 `git diff --cached --numstat --find-renames` 实算，超 15 文件／600 行先拆或预先报批。跟踪的 `dist/src/**` 和工具生成基线照常提交并单列，`src/` 内生成产物计入阈值，只改生成源（`AGENTS.md:65–69`）。各批先构建再快测，变更边界跑 `pnpm run check:arch`。发版前核对实际档案和 `pnpm run metrics`，合并前一次 `pnpm run verify`（`AGENTS.md:54–57`、`package.json:92,115,125–128`）。

### 第一批 · 可运行的安全网

- **改什么**　新增 `tests/behavior-list/presentation-r7.test.mjs`，本批将通过的旧行为用例直接加入 `index.json`，真实 Cordis 挂卸六个入口 `30-Desktop`、`35-PetPlatform`、`50-Room`、`60-Channels`、`70-Voice`、`chatpet-settings`（Console），分别采用源码入口夹具（`tests/behavior-list/entries.ts:8,12–17`）。现有三入口卸载测的是生活三区（`cordis.patch.yml:12–33`、`tests/behavior-list/entries-lifecycle.test.mjs:967–1008`）。先跑外围全关、逐关、换装载顺序和重载。观察聊天、记忆、计划、身体、钱包与资源撤销。Life 卸载、显式暂停、Body 卸载三者继续独立验证（`docs/architecture.md:149–156,541–551`）。既有失败单列可运行复现，标出阻断的版本和修复批。
- **必须有两条入口测试**　Room 从真实 owner 入口写入后截断回包，凭同一原号映射核对拥有者的持久回执与一次效果，写入前取消则零效果。当前 Room 自有回执仅在内存、上限 256 条（`src/room/plugin.ts:85–98`、`src/living/body/room.ts:1027–1038,1067–1073`）。Console 真打 Connection 路由，卸载后实际无路由、重载只登记一次。目前总 RPC 表丢弃撤销返回值（`src/console/plugin.ts:29–43`）。首批以可运行复现报告该缺陷，Console 批转为索引中的通过断言。其他失败格同样由所属批转绿。
- **R8 和共用小包**　在 `scripts/arch/lib/{ast,vocabulary}.mjs` 识别由 `as const` 或 `satisfies` 声明且键用于类型或查表的静态词表，最少两键，值可混用对象和布尔。子表沿用父表声明。只解析本地或相对具名导入中可唯一定位的静态展开。用真实 `FACT_DOMAINS` 的两键顶层、展开子表与 `BODY_ACTIONS`、`PLAN_KINDS`、`PLAN_ECONOMY_OPERATIONS`、`READING_STATES` 及跨文件手写副本做正例。普通配置、空表、动态键、不可解展开、派生别名和数组做反例。保持同文件定义对跳过（`src/contracts/interaction.ts:1–23`、`src/contracts/behavior.ts:10–33,57–101`、`scripts/arch/lib/vocabulary.mjs:9–17,54–62`）。报告新增规范键、重数、两端位置和命中原因。常规 `--write-baseline` 拒绝新增（`scripts/arch/lib/ratchet.mjs:5–19,22–38`）。推荐细案预先附一次性核准录入脚本的命令及清单格式。脚本只在差量键和重数与批准清单完全一致、无规则增量或键漂移时生成 `vocabulary.json`，夹具证明漏批或超批拒写，生成结果单独提交，最后普通棘轮通过。另在扫描夹具中只放行获批的 Desktop、Room、Console 到第三层共用叶子的实际入边，禁止叶子反向依赖或持久写（`scripts/arch/lib/scan.mjs:12–23`、`docs/architecture.md:229–239`）。
- **不做**　业务切换、未核准的基线写入、发包。**高风险**　无。基线录入按拍板 1 先批。**规模**　R7、R8、共用小包规则各 3–8 文件／90–360 行，核准基线单提交。
- **验收**　`pnpm run build` 后 `node --test tests/behavior-list/entries-lifecycle.test.mjs tests/behavior-list/presentation-r7.test.mjs tests/arch/known-violations.test.mjs tests/arch/ratchet.test.mjs tests/arch/scan-scope.test.mjs`，再跑 `pnpm run test:behavior-list`、`pnpm run check:arch -- --report`、`pnpm run metrics`。另用 `node --test tests/behavior-list/presentation-r7-known-defects.mjs` 跑拟新增的缺陷复现，按实际结果单列红项。缺陷脚本不进自动清单。索引运行器要求通过且不接受跳过（`scripts/checks/run-behavior-list.mjs:16–31,39–44`）。

### 第二批 · Voice

- **改什么**　生成源 `scripts/build/build-desktop-animation.mjs` 和 `src/voice/plugin.ts` 先核实上游语音闭包只加载一份 registry，再搬路径或留明确例外。用 `RegistrationTable` 的租约和撤销托管查可用性、说、听、取消，接 Desktop、Room 和 Channels。分别验证提供方与调用方撤销、旧录音晚到、单向能力和无语音降级。保留 `petVoice` 兼容入口（`scripts/build/build-desktop-animation.mjs:35–44`、`src/voice/plugin.ts:9,18–59`、`src/core/tables/registry.ts:20–41,66–77`）。
- **不做**　重写上游 provider 或改变旧 RPC。**高风险**　无。**规模**　闭包搬迁 4–8 文件／90–250 行，登记及消费者分提交，每次 4–10 文件／130–420 行。
- **验收**　构建后 `node --test dist/tests/life/voice-and-life-library.test.js dist/tests/room/room-voice.test.js tests/regressions/audit-r2-desktop-voice.test.mjs tests/regressions/audit-r3-body-voice.test.mjs tests/regressions/audit-r4-voice-rate.test.mjs`。`pnpm run test:room-voice` 是夹具 IPC 和 preload（`package.json:110`、`tests/room/room-voice-window.cjs:17–36`）。另外用实际安装包开生产 Room 窗口，验桌宠及 QQ 缺能力、取消、卸载，录音家族按 `docs/product.md:215` 复核。

### 第三批 · Room

- **改什么 · 换信号**　首次改订阅 `world.changed` 就复用 `homeScope()` 的绑定代次，把代次纳入 LivingWorld 排队及合并键，Room 窗口、请求及 Body／Plan 的异步生产者在起步捕获代次及租约，通知沿用该代次。出队、快照读取前后和回包均复核，旧任务不能按同三元组补领当前代次。Room 另保留 IPC `bootId/revision`。当前比工作区、路径及存储 ID，A→B→A 可碰回原值（`src/living/index.ts:40–48,165–193,220–226,278–285,324–345`、`src/core/workspace.ts:144–159`、`src/room/window.ts:27–34,75–91`、`src/room/window-preload.cjs:13–33`、`src/living/body/plugin.ts:273–280`、`src/living/plan/plugin.ts:214–215`）。测试让旧 A 的 I/O 在回到 A 后才返回，检查旧结果不刷新、不误写，B 无串入，当前 A 正常。身体、话术及动作各读拥有者窄口。动作仍保准入与原号。
- **改什么 · 图片和传输**　图片先拆 I/O 再抽共用准入和原子流程，同批在 `arch/storage.json` 分登记两个目录、各自拥有者及实际写入者，守住 `.chatpet/data/desktop/images`、`.chatpet/data/room/images` 和绑定校验。桌宠默认编码上限 1 MiB，Room 截图原量 2.5 MiB 并按原换算限制编码长度（`arch/storage.json:47–48`、`src/desktop/images.ts:13–46`、`src/room/chat.ts:18,30–34,53–62`）。从一份手写声明派生九个 Room 端点，保留真实 owner、主 frame、超时和取消，开窗另登记窄口。`src/console/plugin.ts:29` 是**含**九项的总 RPC 表，`lifeDates` 仍走日记适配（`src/room/window.ts:9,81–91`、`src/console/settings.ts:192–214`）。从声明派生各载体端点子集。Room 浏览器聊天、电视、语音用 310 秒，其他 20 秒。Console 仅聊天、电视 300 秒，其他 15 秒（`vendor/feiyu-room-template/public/room/native-room.js:2–39`、`src/room/assets.ts:98–102`、`src/console/client.js:1221`）。
- **包内路径先定**　TS 主机用 `dist/src`，主进程及 sandbox preload 把声明生成或内联到现有 `src/room/window*.cjs`，浏览器沿现有 Room 静态路由加载生成内容，拍照子进程用包内 `dist/src/room/assets.js` 和同一浏览器资源，无开发目录兜底。先验实际 npm 包闭包和 iframe、preload、照片入口（`package.json:41–55`、`src/room/window-main.cjs:11,53–54`、`src/room/assets.ts:98–102,173`、`src/room/shot-browser.cjs:17–26,33–43`、`scripts/build/build-pet-platform.mjs:12–21`）。
- **改什么 · 播放拆批**　先在原位分离 Body 语义和兼容投影，再按测试与构建链分组提前改依赖，最后单独纯搬资源和采样，分类规则另交。旧播放路径命中 17 个测试文件（`rg -l -F living/body/playback tests`），另有一处仅引用旧素材索引（`tests/regressions/mapped-playback-carriers.test.mjs:64`）。素材输入 3,921 行，TS 生成索引 2,365 行，另有源码和构建链引用（`src/living/body/animation-allocation.json:3921`、`src/living/body/animation-map.ts:2365`、`scripts/build/build-animation-map.mjs:9,54–55`）。每个纯搬提交用 `--numstat --find-renames` 核实，超限先拆前置或请批生成链例外。第一笔搬迁前锁定拍板 11 的 `home.playback` 边界。Room、桌宠、拍照、Console `lifeView` 同批接回旧响应。若仓外直读有依赖，先定外部适配或停搬，对照 `src/living/body/plugin.ts:315–325,346–364`、`src/living/plan/plugin.ts:453–465,676`、`src/console/settings.ts:221–234`。第二层最终零 `roomClip/desktopClip/ActivityClip/ActivityPlayback`，按[概念表](#concepts)验两端帧和旧输入。
- **不做**　改 vendor、重排素材目录、把任意动作塞进通用快照。**高风险**　建议路径无需。若必须改 `package.json.files`，Room 单列提交先拍板。若须改 Core 绑定实现同样另批（`AGENTS.md:60–67`）。**规模**　换信号 4–8 文件／150–400 行，图片和传输每次 5–10／150–480，语义前置及纯搬各 4–12／0–480，分类和适配每次 5–10／200–500。旧路径替换按依赖分组实算。
- **验收**　构建后 `node --test tests/behavior-list/presentation-r7.test.mjs tests/behavior/activity-playback-room.test.mjs tests/behavior/presentation-lifecycle.test.mjs dist/tests/regressions/mapped-playback.test.js tests/regressions/room-refresh.test.mjs tests/regressions/mapped-room-layer-lifetime.test.mjs tests/regressions/audit-r4-room-wiring.test.mjs tests/regressions/audit-r4-room-photo.test.mjs`。 `pnpm run test:desktop-images` 只走 `DesktopImages`（`package.json:101`、`scripts/checks/check-desktop-images.mjs:20–26`）。实际包另验 Room 图片准入、恢复、空图、越权、两目录大小边界和拍照。典型修改 2 从 Room 完成点独立实做可读口渴百分比，验刷新和空快照，至多旧 3 个物理文件、只动 Room 或共用资源（`docs/product.md:98,103`、`docs/development.md:137–145`）。

### 第四批 · Channels

- **改什么**　Channels 改读同绑定 `world.changed`，由 Plan 补 home 写入、运行、暂停和卸载通知。复用 Life home 的运行判断、发送恢复和现有压缩登记能提供的窄读口，钱包变动不能额外触发主动消息（`src/channels/plugin.ts:72–89,120–143`、`src/living/plan/plugin.ts:193–215,361,386–395,641–643,740–744`、`src/core/native/conversation.ts:134–138`）。收连接返回类型，保留外层缺绑定返回 `off` 和内层委托。另交薄字段前置，让 Console 通用表单读 Channels 的可编辑描述，Channels 继续校验并持久化，同时生成 Desktop 客户端（`src/channels/plugin.ts:72–76,94–112`、`src/channels/messaging.ts:181–186`、`src/console/client.js:328–362`、`scripts/build/build-pet-platform.mjs:433–434`）。
- **不做**　迁五类 Core 回执或改发送恢复串行语义。原位例外同步更新 `arch/storage.json` 中现有「搬出」处置及架构拥有者表（`arch/storage.json:14–17,20`、`scripts/lib/offline-backup.mjs:309–310,338–366`）。**高风险**　无，现有恢复器只用于测试。**规模**　信号／类型 5–10 文件／140–380 行，薄字段前置 4–8／120–350，生成联动另计并实算。
- **验收**　构建后 `node --test tests/behavior-list/channels.test.mjs tests/regressions/audit-qq-recovery.test.mjs tests/regressions/mapped-channel-path-binding.test.mjs tests/infrastructure/offline-backup.test.mjs`，前置另验生成后桌宠设置表单。从前置合入后的模块完成点开独立典型修改 3，实做设置保存、按 UTC 日计数、默认 10、0 禁发、并发预留、未知发送、换账号、跨日和重启。含测试和产物最多旧 11 文件，Console 或 Desktop 有新联动就未达标（`docs/product.md:98,104,111–113`、`docs/development.md:137–145`）。

### 第五批 · Desktop（含 PetPlatform）

- **改什么**　两个开 Room 的入口都走登记，并窄化能证实的宿主读点。用 Body 串行入口按目标动作判断可开始、已呈现或拒绝，同一边界检查准入、代次、取消和原编号。读失败不放行，已提交按原号核对。Desktop 切 `world.changed` 保留刷新收敛。在所有外部消费者切完且确认后，用三区租约直调退掉 `pet/behavior.changed`、`pet/economy.fact`、`pet/life.changed` 的生产、订阅与声明。现有开窗、读点和行为依据 `src/desktop/platform/plugin.ts:222–242,340–374,596–607,665–707`、`src/living/body/plugin.ts:329–369`、`src/contracts/living.ts:15–41`。
- **三区通知时序**　Body 有效变更后向当前 Plan 排入异步通知，Body 不等 Plan，Plan 缺席跳过。Plan 在原控制状态落盘／启停通知点安排 Body 串行同步，常规通知不等待，显式暂停才等待当前 Body 暂停计划并关闭自治，Body 缺席仍完成 Plan 持久化和停排程。Economy 提交新事实后提示 Plan 排队，钱包不等 Plan 推进，缺席或通知失败保留已提交事实供恢复。Plan 在原自通知触发点直接排程，保留合并。前后核对同绑定和租约。观察性读取不能凭空多排一次 Life，实际推进转场仍通知，并验证读取与刷新能收敛。分别回归异步不阻塞、暂停等待、提交后通知失败，以及缺席与换绑（`src/living/body/plugin.ts:100–115,241–280,315–325,458`、`src/living/plan/plugin.ts:89–107,361–395,555,563,604,614,643,718`、`src/living/economy/plugin.ts:226–230,275,305`、`src/living/index.ts:174–196,278–285,324–345,365–379`）。
- **不做**　全量统一 WorkStage、设备键或迁 `desktop-session`。原位决定同步更新存储处置（`arch/storage.json:18`、`src/desktop/conversation.ts:138–167`）。**高风险**　按推荐无。改会话存放需另立离线方案。**规模**　接线 5–9 文件／160–360 行，准入 5–10／210–520，旧信号退役每次 5–12／180–490。
- **验收**　构建后 `node --test tests/desktop/pet-platform.test.mjs tests/behavior-list/concepts-desktop.test.mjs tests/regressions/mapped-refresh-convergence.test.mjs tests/living/living-lifecycle.test.mjs dist/tests/desktop/desktop-features.test.js dist/tests/desktop/desktop-work.test.js`，隔离 `pnpm run test:pet-platform-window` 和 `node scripts/checks/check-standalone-window.mjs`（`package.json:106`、`docs/development.md:170`）。覆盖并发吃饭、已吃饭、睡眠、忙碌、Body 缺席、读失败、提交前后取消和旧会话复用。

### 第六批 · Console

- **改什么**　运维及两个旧钱包写 RPC 由各拥有者登记，共用 owner、绑定、取消、原号校验，撤销责任归 Console 入口。把旧路由下线／重载测试转绿。错误码由 `ContractError` 统一，Console 保留旧响应字段并传 `effect/retry`，测试旧配置、有无 Desktop 和迟到响应（`src/console/plugin.ts:12–43`、`src/console/settings.ts:19,73–105,294–312,413–424`、`src/contracts/common.ts:21`、`src/core/storage.ts:11`）。
- **试点**　第 7 题从薄声明完成点开独立度量分支，试加数字控件「最近心情保留分钟数」，经设置页保存、owner RPC 和 Core 配置落盘，重启后实际让 Emotion 读写两条分处阈值两边的合成记录，验一留一删，并测旧档缺省与越界。定位 `src/console/client.js:1027–1032,1055–1058`、`src/console/settings.ts:359–364`、`src/core/workspace.ts:92–100,530–536`、`src/emotion/recent.ts:68–79`。试验仅度量，普通字段基线至少 3 个手写文件，按减半上限 1 文件、1 层判，含新操作时对照至少 5 个手写文件、上限 2。测试和产物另列，业务接线也计数。未达收住字段扩展。5b 提请延期，记录到阶段 4 的聊天平台接入复测，判法仍只要求不改第一层（`docs/product.md:106–108,115,120–128,428`）。
- **数据细批**　钱包登记和原号只读核查、`0004` 及两份备份核验、浏览器导出／清源／回插工具、旧页切换和演练分开，按[经济附录](#economy-migration)验。**不做**　整页字段 DSL、通用存储句柄、真数据日常工作区写入。**高风险**　`src/core/storage.ts`、`src/core/workspace.ts`、`scripts/migrate/`，条件性 `scripts/lib/offline-backup.mjs`，细批先批。**规模**　路由／字段每次 5–12 文件／180–480 行，数据每次 5–13／200–570。
- **验收**　构建后 `node --test tests/behavior-list/concepts-economy-settings.test.mjs tests/behavior-list/domains.test.mjs dist/tests/core/settings.test.js tests/migrate/normal.test.mjs tests/migrate/crash.test.mjs tests/migrate/rollback.test.mjs tests/migrate/refusals.test.mjs`。新增三工具及原号查证的快测文件名在细批定下后写入命令。现有 `tests/manual/companion-settings-window.cjs` 用夹具宿主调用处理器（`tests/manual/companion-settings-window.cjs:95–110`、`docs/development.md:169`），另用实际包和隔离 DSH Connection 验生产设置窗。

### 合入与发版依赖

| 合入点 | 后续依赖或发版条件 |
| --- | --- |
| 安全网 | 先验旧行为与核准差量，无单独版本。共享层声明、索引、基线在最新主线上串行重算。 |
| Voice → Room | Voice 先稳登记和最小消费者接线。Room 首切绑定代次并提供开窗登记，然后从 Room 完成点跑第 2 题。 |
| Room → Channels → Desktop | 先合 Channels 薄字段前置和 Desktop 生成联动，验两端保存。从完成点只改 Channels 测第 3 题。Channels 换信号后 Desktop 才退三路旧事件。 |
| Desktop → Console | Console 接入已稳定的拥有者登记。离线合成演练可在独立分支先行，路由、客户端和 Core 合同依最新合入点串行。 |
| 每个版本 | 快测、行为清单及合并门禁 → RC 用隔离更新按钮安装演练 → 核对并发布与通过 RC 同业务源码的正式包 → 通过隔离更新激活 → 主人再升日常。业务源码有变化就重新验 RC。比对标签、`release.json` 和业务 diff。Console RC 和正式包各在独立隔离副本走数据门槛。见 `docs/product.md:415`、`docs/github-updates.md:7–20,28–52`、`.github/workflows/release.yml:44–65`。 |

阶段收尾跑 `pnpm run build && pnpm run test:behavior-list`、`pnpm run verify` 和 G8。附录每条基线须有实际清除证据或主人核准的例外，核对 kind/action 趋势及变化原因。R7 各版本补齐换绑、写后取消和原号复核，回环或 `/bin/ps` 受限换到允许的隔离环境验（`AGENTS.md:54–59`）。G9 从安装包真实设置入口操作钱包、断回包、重启查到一次生效。再从 Room 和桌宠确认同一活动进度，关闭一入口后验证普通聊天和工作区记忆。用合成数据、本机夹具，真实迁移另按附录检查。

### 待核实

- 安全网批核实 R8 实际新增键及误报、R7 旧行为与缺陷复现、六入口的隔离结果。当前独立审查只跑过架构报告与度量。
- Voice 核实已安装 provider 的旧路径和单 registry。Room 搬迁前核实仓外 `petBehavior/petLife` 消费及生产 iframe、预载与拍照包闭包。Desktop 核实原生桥和独立窗口静态接线、旧外观配置等价性和跨设备会话复用。
- Console 核实宿主 Connection 是否有等价的可用 Peer 类型，经济细批核实授权浏览器来源、停写和排空能力、停写下真实安装指纹的切包路径、私有导出位置与双备份接线、钱包采用状态。按隔离门槛复核续做、清源、回插和正式包。
- 第 2、3、7 题只有实施后的实测能判达标。5b 待拍板是否延期。混合情绪的两端实际帧与资源缺失表现待隔离看样。

## 执行结果

## 审查结论

<a id="concepts"></a>
## 附录 · 第二批概念表与扩展检查

份数按独立手写定义计，生成镜像、素材映射、子集另注。开工前交主人确认，第一批复查份数，后续按拍板执行（`docs/product.md:186,285–292,434–436`）。

| 概念与拥有者 | 现状和转换点 | 本阶段验收 |
| --- | --- | --- |
| 槽位与素材。Body 管语义和许可，第三层管素材及播放 | 一份分配输入含 127 槽、122 素材、27 贴纸、42 Room 别名，一份生成索引。现在计划入参、Body 许可和采样都读相关定义（`src/living/body/animation-allocation.json:32,1853`、`scripts/build/build-animation-map.mjs:9,54–55`、`src/living/plan/plan.ts:129`、`src/living/body/room.ts:488,573,634,829–833`、`src/living/body/playback.ts:34–35`）。 | 原槽 ID 与许可有效，第三层适配各端资源。缺素材按旧静止或占位。全量重新映射留草案。 |
| 表情与贴纸。Emotion 管回复意图，Body 管互动反馈，载体管展示素材 | 回复 footer 的 `action` 是表情意图，`sticker` 是回复配图 ID。Emotion 解析和挑选后发工作区、会话、轮次事件，Body 转 `CompanionExpression`。Desktop 按关联窗口／会话展现，Room 将显式表情投影成文字，Body 的互动反馈另从触摸槽取贴纸。QQ 自有媒体收藏和发送，ID 含义独立（`src/emotion/index.ts:32–46,54–62,67–95`、`src/emotion/plugin.ts:148–156,317–324`、`src/contracts/behavior.ts:167–170`、`src/living/body/plugin.ts:77–86,321–325`、`src/desktop/platform/plugin.ts:23–28,323–335,759`、`src/desktop/helper/chat.js:115–120`、`src/room/assets.ts:16–35`、`src/living/body/playback.ts:202–207`、`src/channels/group-material.ts:243–264`）。 | 验显式表情、回复配图、触摸反馈和 QQ 表情走各自语义及权限。目录合并留待评估（`docs/architecture.md:255–266`）。 |
| Desktop 命令与通知。Desktop 管 | 聊天四个在线命令手写 4 处，standalone 另有离线拒绝子集 `open/new/send/stop/open-session`。host 通知词表 1 处，helper 按窗转发，renderer 消费（`src/desktop/conversation.ts:43`、`src/desktop/index.ts:62–68,207–230,284–289`、`src/desktop/helper/main.cjs:74–110,154–190`、`src/desktop/platform/plugin.ts:586–710`、`src/desktop/helper/preload.cjs:2–15`、`src/desktop/helper/shell.js:135–181`、`src/desktop/helper/chat.js:132`、`src/desktop/standalone.mjs:66`）。 | 保留草案。窗口、浏览器、原生通道各自按现有权限验，本轮只收语音、Room 和吃饭入口。 |
| WorkStage。Desktop 管 | 本地六态映射 1 份，`Work.stage` 是字符串。上游共享端定义、宿主状态归约各 1 份，透传与消费另计（`src/desktop/index.ts:16,96–110`、`vendor/dsh-pet/src/shared/work-status.ts:9–21,32–41`、`vendor/dsh-pet/platform/runtime.mjs:2179,2215`、`src/desktop/platform/plugin.ts:170–172`、`src/desktop/helper/shell.js:172–179`）。 | 保留草案，回归六态及收尾。 |
| 桌面设置键。Core 管便携含义，Desktop 管载体映射 | Core 字段声明 1 份，旧 12 键迁移映射和运行时 5 键子集各 1 份，另有 Desktop 6 键入口和 compact 菜单投影。完整外观引用现有素材校验（`src/core/companion-settings.ts:2–20,44–48,56–83`、`src/desktop/platform/migration.ts:150–155`、`src/desktop/platform/plugin.ts:267–276`、`src/desktop/index.ts:142–155`、`src/desktop/helper/shell.js:18–30,54–72,135–151`、`src/desktop/appearance.ts:5–12,70–85`）。 | 便携校验经 Core 可直接使用的声明派生，保默认和旧输入。设备键余项保留草案。五键确有重复且等价时另批小步。 |
| Channels 状态。各入口管各自状态机 | 上游连接和 `connected`，模块 `off/online/unavailable` 的返回类型写了 2 份，能力栏另有 `ready/disabled/unavailable` 1 份。外层缺有效绑定返回 `off`，其余委托内层。Qzone、QQ、微信、本地送达各有业务状态（`vendor/dsh-world/lib/adapters/qq-sdk.js:26,667`、`src/channels/qq.ts:41,206,233`、`src/channels/messaging.ts:159–186,208–214`、`src/channels/plugin.ts:72–76,136–143`、`src/channels/group-qzone.ts:10`、`src/channels/qq-inbox.ts:10–17,55–95`、`src/channels/bridge.ts:80–89`）。 | 收为一份连接返回类型，其他命名留草案，发送恢复证据和序列化值照旧。 |
| 九种 feeling。Emotion 管 | 全集 2 份，中文标签 1 份，实现分别见 `src/contracts/emotion.ts:2`、`src/living/body/playback.ts:27`、`src/living/body/presentation.ts:5–8`。 | 一份全集，类型、标签覆盖和优先级引用它，测九值、已知夹未知、纯未知，保留自由文字、标签和次序。 |
| Room 七维。Emotion 管 | 机器集合写成联合和运行表 2 份，提示词镜像 1 处。缺 `dims` 得空对象，缺个别维保留部分字段，额外维度忽略，已知分数非法则拒绝（`src/contracts/emotion.ts:6–9`、`src/emotion/index.ts:13–30`、`src/emotion/plugin.ts:199`）。 | 一份集合派生类型、按原顺序取值及提示词。逐测无维度、缺维度、多维度及非法分数的旧缺省。 |
| 呈现分类。Body 管语义，第三层管映射 | 现在有 2 套，语义判断与播放选材不同（`src/living/body/presentation.ts:10–23`、`src/living/body/playback.ts:90–126`）。 | 一套意图进两端。测睡、走、吃、阅读等待／准备／播放、园艺、反馈、显式表情、无身体和下表情绪。按同一快照核对语义、素材和时间。 |
| `ActivityClip / ActivityPlayback`。第三层管播放投影 | 各一份类型，生成资源类型亦有 clip 名，Body 回执目前包含播放（`src/living/body/playback.ts:4–22`、`src/living/body/animation-map.ts:3`、`src/living/body/plugin.ts:237–239,321–325,346–364,376–385`）。 | Body 只输语义、时间与身份。呈现边界组装旧形状，按 Room 批验证旧回包、实际采样和无素材退化。 |

<a id="emotion-examples"></a>
主人在 Room 和桌宠的空闲／休息画面对照以下例子。按现有语义优先级推荐，用各端已有素材，实际画面随隔离包看样。当前中性断言见 `tests/regressions/mapped-playback.test.ts:138–146`，现有选材及反馈见 `src/living/body/presentation.ts:10–23`、`src/living/body/playback.ts:95–126,175–205`、`src/living/body/animation-allocation.json:1230,1262,1394,1459`。

| 输入 | 当前播放 | 推荐播放 |
| --- | --- | --- |
| 生气＋平静 `anger+calm` | 呼吸待机 `rest.calm` | 短暂傲娇后待机 `rest.anger` |
| 难过＋开心 `sad+happy` | 呼吸待机 `rest.calm` | 开心哼歌后待机 `rest.happy` |
| 难过＋未知 `sad+curious` | 呼吸待机 `rest.calm` | 短暂叹气后待机 `rest.sad` |
| 纯未知 | 呼吸待机，保留自由文字 | 呼吸待机，保留自由文字 |

输入反序和重复得相同选择。已知加未知按已知情绪选休息素材。触摸仍按原先单一已知情绪和真实触摸条件，显式表情／贴纸仍走原意图及会话守卫。动作、阅读、互动事实优先，拍板后只更新相应旧中性断言（`tests/regressions/mapped-playback.test.ts:138–169`）。

扩展检查采用既有的取消、注册、拥有区和存储登记。在 Core 留语音、开窗、运维登记槽，实际操作由拥有者提供。共用叶子只放传输声明、资源和纯投影，持久写入由拥有者执行（`docs/architecture.md:87–95,219–239,255–266`）。目标是原语音、开窗、呈现和运维场景的兼容治理。按变动登记层、存储和行为，典型修改用独立分支只做度量。整个阶段以原产品场景为限（`AGENTS.md:37–48`、`docs/product.md:10–18,186,421–439`）。

<a id="economy-migration"></a>
## 附录 · 钱包待确认的迁移、查证和回退

**现状**　每个浏览器 profile/origin 用 `chatpet:economy:pending:<workspaceId>` 保存 `{endpoint,input,requestId}` 后才发送。单个面板实例的 `locked` 管当次并发，「已核对」直接清本机键。原输入可能含阅读正文。旧 `economyAction/economySettings` 直接调用钱包。备份不含浏览器，盘点只报 `browser-check-required`，Life 启动会排程（`src/console/client.js:440–502,526–546,565–583`、`src/console/settings.ts:73–105`、`scripts/lib/offline-backup.mjs:110–131`、`scripts/migrate/inventory.mjs:78`、`src/living/plan/plugin.ts:89–107`）。

| 顺序 | 细批要交付的约定 |
| --- | --- |
| 1. 停写、排空 | 主人提供隔离原副本及授权 profile/origin。先隔断旧标签、旧页面两个 RPC 和其他写入口，停止接新请求，关掉或隔离全部旧页面，等待已交给 Economy／Body 的操作落到可核对状态，排空在途并确认无写入者。关页、取消或仅看进程退出不足以证明已排空，已持久化的部分提交可以留下查证（`src/living/economy/plugin.ts:296–298,349–355`、`src/living/index.ts:406–414`）。库与原浏览器从导出到清源完成或回退验收一直停**业务**写，只准离线工具按步骤写。无法验证停写或排空就不导出。必须启 DSH 换包或实装看页面时，用一次性克隆及独立 profile，核实克隆无法访问原库或原浏览器存储。开细批前须证实原隔离安装在停写下能切换程序包并取得本机新／旧包安装指纹，克隆回执不能代用。现有备份按安装及当前包指纹核验，找不到可用路径就停（`docs/development.md:113–126`、`scripts/lib/offline-backup.mjs:268–277,391–394`）。 |
| 2. 私有原样导出、旧包备份 | 导出工具记录每个来源的 profile/origin/键定位、绑定与轮次、原值及摘要、原号和规范指纹。绑定用可核验的旧安装与仓库身份关联，仅有同名 workspaceId 不足以配对来源。分别证明已盘点为空、不可读、来源未提供。两个来源同绑定同号同规范内容只导一笔，保留每个来源的定位和原值摘要。异载荷、未知来源或坏数据停。沿用同目录私有暂存（目录 0700，文件 0600）、写完 fsync、原子 rename 和目录 fsync，拒绝链接（`scripts/migrate/io.mjs:10–31`）。旧包 `companion-backup create/verify` 回退校验清单锚定旧备份 manifest 摘要、安装指纹、绑定和导出摘要。导出及附件丢失、替换或截断即停（旧备份流程 `docs/development.md:113–131`）。 |
| 3. 新包离线导入、同包续做 | 用新包对应源码复用 `plan/run/status/--resume`。给新包续做备份与 journal 单独锚定新备份、指纹和同一导出摘要。每次 `--resume` 重新验证整条锚定和原副本停写，目标已提交但日志缺失按目标续做，绝不派发动作。现 `--resume` 只验运行时备份及绑定，要补导出验证（`scripts/migrate/runner.mjs:19–33,59–87,95–145`、`docs/development.md:86–111`）。 |
| 4. 持久证明 | `0004` 将 living 进一版，在已采用的钱包内，待确认行与不含正文的导入证明同事务落盘，证明包含绑定、来源覆盖、来源与原号摘要、条数。零条有耐久证明。尚未采用钱包且零条时，明确在独立迁移目标标记中证明，保留无钱包状态。全新安装另标无旧来源。缺导出不能当零条，已采用却缺库、坏库或链接、未采用却有待办均停。历史校验读耐久证明，全部待办结清仍可复核。合成测试用上一正式包准备已结清 `0003`、manifest `core:3/living:3` 的明确 v3 副本，验证升级、同轮续做和待办结清后的历史证明。保持 `0003` 的原 `complete` 判法（`src/core/storage-migration.ts:24–30`、`scripts/migrate/steps/0003-economy-marker.mjs:81–99`）。 |
| 5. 克隆验收、逐源清除、放行 | 在原副本核对持久目标、`segment=settled`、每个来源、余额／库存／Body 与导入前一致。从一次性克隆运行生产窗口。主人确认后由清源工具在原 origin 严格按原值比较和删除。先耐久记逐源操作意图，完成后记状态。断在两者之间，凭同轮意图、冻结下的单写约束和现场重查继续。无同轮证据的缺键、异值、少来源或身份变化均停。再次确认原副本和浏览器来源未被克隆触及。全部浏览器来源清除完才放行，旧页须失效或刷新，两条旧写 RPC 在新包也经同一登记。 |
| 6. 回退或封窗 | 放行前可在停写下换回旧包、核源并从旧备份恢复，回插工具逐源记录意图：缺键填原值，同值已完成，异值保留并停。回插中断可续做。核原编号、余额、库存、Body 效果和旧入口，全部通过才解除停写。放行后如需回退，先保全新效果并由主人决定逐笔核对方案。旧恢复器的保全范围见 `docs/architecture.md:577–584`、`scripts/lib/offline-backup.mjs:409–420`。原导出及其私有副本保留期限按拍板 14，历史只留证明摘要。 |

**按原号查证**　Economy 提供独立 owner 只读口，校验当前绑定、租约、原号与规范指纹。从已打开且已验证的钱包精准查询持久 `requests`，投喂依原派生 `operationId` 查持久 Body 效果和库存使用回执。资料缺席为不可用。有效查询分为已提交、部分提交、无证据、同号异内容。只返必要摘要，无准备建库、`tick()`、通知、调度或待办修改。现有流水只读最近 80 条，钱包 `bound()` 可能准备／建库，`requests` 查重在事务，Body 快照和 `inspectPlanned` 会推进（`src/living/economy/plugin.ts:68–96,120–125,202–205,263–271,278–293`、`src/living/economy/store.ts:183–188,424`、`src/living/body/plugin.ts:315–325`、`src/living/body/room.ts:444–459,482–490,740–742,923–950`）。

**按原号重试**　新旧页面的提交都由钱包登记后派发。待办保留原号、绑定、指纹和重试所需输入，结清后只留终态所需凭证。对已登记待办，只有主人显式重试才走原拥有者，以同一绑定、原号和指纹在事务中争用一次。同号异内容拒绝，已提交返回原结果，部分投喂沿原凭据只续未完结算。确认终态、人工放弃与重试以请求级条件更新互斥。保留编号终态凭证供晚到请求判断。取消、换绑和 Console 关停保留未确认项，读入口不泄露原正文。新操作与放弃按拍板 13，Life 的原有运行不受 Console 待办阻塞。

**演练**　合成副本覆盖明确 v3、确实零条／缺导出、两来源同单、多单、异载荷、缺库／采用状态、换绑和含合成正文。注入旧标签在冻结前在途／冻结后竞写、导入前后中断、清源一半中断、回插一半中断（含浏览器已写而状态未记），并测跨浏览器重试与人工核对竞写、结清后历史核验。两条必过：配置已保存但回包丢失查得已提交，Body 已施效库存未结算查得部分提交。固定合成时钟，反复查证前后余额、可用／预留／总库存、持久 Body 状态一致，显式重试才续完且效果一次。

合成通过后才用主人提供并授权的独立隔离副本。Agent 只取获准的路径、文件大小、表／字段、行数、通过与否和固定原因码。授权程序本机处理原值、键、编号和正文。RC 走续做、清源、回插及回退，正式包从同起点另副本重验实际升级与激活（`AGENTS.md:59`、`docs/development.md:132–134`）。

## 附录 · 第三层基线去向表

独立审查起点：全仓 R1–R4 为 37，R8 为 637，kind/action 为 270／102；行为索引 124 项（L1 53、L2 68、L3 3），常规运行 121 项（`arch/baseline/rules.json:3`、`arch/baseline/vocabulary.json:3`、`scripts/arch/metrics.mjs:76–95,104–114`、`tests/behavior-list/index.json:3–1483`、`scripts/checks/run-behavior-list.mjs:39–44`）。首批另报扫描增量，纯搬用核准的搬家改键，不计作清除（`AGENTS.md:68`、`docs/decisions.md:218–222`）。

### R1–R4 逐条去向

全仓 37 条。第三层源文件 31 条，加 Desktop 自有生成源 1 条（`arch/layers.json:76`）及 Core 引用 Desktop 1 条，共 **33 条**（R1 18、R2 14、R3 1、R4 0）。未列 4 条是 Core 初始化两条和 Memory 上游加载两条，已有长期例外（`docs/product.md:339–342`）。基线位置为条目起始行。

| 基线位置 | 规则 | 记录调用点 | 目标或表达式 | 去向建议 |
| --- | --- | --- | --- | --- |
| `arch/baseline/rules.json:4` | R1 | `scripts/build/build-desktop-animation.mjs:8`（列 1） | `scripts/build/build-life-media.mjs` | Desktop 批尝试清。识别自有构建目录的真实归属并验证产物，无法保持行为则记构建链例外。 |
| `arch/baseline/rules.json:14` | R2 | `src/channels/messaging.ts:94`（列 21） | `petVoice` | Voice 批清，经登记口调用合成。 |
| `arch/baseline/rules.json:26` | R1 | `src/console/plugin.ts:3`（列 1） | `src/desktop/plugin.js` | Console 批清，Desktop 运维登记。 |
| `arch/baseline/rules.json:38` | R1 | `src/console/plugin.ts:4`（列 1） | `src/room/plugin.js` | Console 批清，Room 运维登记。 |
| `arch/baseline/rules.json:50` | R1 | `src/console/plugin.ts:5`（列 1） | `src/channels/plugin.js` | Console 批清，Channels 运维登记。 |
| `arch/baseline/rules.json:62` | R1 | `src/console/plugin.ts:7`（列 1） | `src/desktop/platform/plugin.js` | Console 批清，Desktop 平台运维登记。 |
| `arch/baseline/rules.json:74` | R2 | `src/console/plugin.ts:22`（列 76） | `petDesktop` | Console 批清，Desktop 运维登记。 |
| `arch/baseline/rules.json:86` | R2 | `src/console/plugin.ts:24`（列 11） | `petRoom` | Console 批清，Room 运维登记。 |
| `arch/baseline/rules.json:98` | R2 | `src/console/plugin.ts:25`（列 11） | `petChannels` | Console 批清，Channels 运维登记。 |
| `arch/baseline/rules.json:110` | R2 | `src/console/plugin.ts:26`（列 11） | `petPlatform` | Console 批清，Desktop 平台运维登记。 |
| `arch/baseline/rules.json:122` | R1 | `src/console/settings.ts:9`（列 1） | `src/desktop/appearance.js` | 设置窄切片清。外观声明与纯校验放现有边界内，素材仍归 Desktop，不能等价迁移时保留明确例外。 |
| `arch/baseline/rules.json:134` | R1 | `src/console/settings.ts:70`（列 28） | `src/channels/plugin.js` | Console 批清，Channels 运维操作由登记端声明。 |
| `arch/baseline/rules.json:146` | R1 | `src/console/settings.ts:71`（列 28） | `src/desktop/platform/plugin.js` | Console 批清，Desktop 平台运维操作由登记端声明。 |
| `arch/baseline/rules.json:158` | R1 | `src/console/settings.ts:71`（列 150） | `src/desktop/platform/plugin.js` | Console 批清，Desktop 平台运维操作由登记端声明。 |
| `arch/baseline/rules.json:170` | R1 | `src/core/companion-settings.ts:2`（列 1） | `src/desktop/appearance.js` | 设置窄切片清，与 Desktop 外观默认值和校验共用纯契约，不能等价迁移时保留明确例外。 |
| `arch/baseline/rules.json:204` | R1 | `src/desktop/features.ts:16`（列 50） | `import ( "./upstream/host/" + file + ".js" )` | Desktop 批清。显式列出有限的实际导入项，验证模块解析和产物位置。 |
| `arch/baseline/rules.json:214` | R2 | `src/desktop/features.ts:67`（列 43） | `this . ctx . get ( name as never )` | Desktop 批清，以实际宿主服务注入替代动态查找，保留可选服务语义。 |
| `arch/baseline/rules.json:224` | R2 | `src/desktop/features.ts:142`（列 23） | `petVoice` | Voice 批清，经登记口调用。 |
| `arch/baseline/rules.json:236` | R2 | `src/desktop/index.ts:265`（列 21） | `context . get ( key )` | Desktop 批清，显式读取可选的宿主服务。 |
| `arch/baseline/rules.json:246` | R1 | `src/desktop/platform/migration.ts:28`（列 16） | `require ( join ( root , "vendor/dsh-pet/platform/runtime.mjs" ) )` | 建议长期例外，保留发行包根定位及上游迁移运行时加载。 |
| `arch/baseline/rules.json:256` | R1 | `src/desktop/platform/plugin.ts:38`（列 18） | `load ( join ( vendor , "runtime.mjs" ) )` | 建议长期例外，保留发行包根定位及上游运行时挂载。 |
| `arch/baseline/rules.json:266` | R2 | `src/desktop/platform/plugin.ts:143`（列 102） | `host . get ( n , false )` | Desktop 批先核对有限宿主服务面。等价性无法证实时保留长期例外，保留上游开放的可选服务查找。 |
| `arch/baseline/rules.json:276` | R3 | `src/desktop/platform/plugin.ts:146`（列 68） | `host . on ( event , ( item : any , data : any ) => { const session = item ?. session ?? item ; if ( ! scope . signal . abo…` | Desktop 批先核对有限事件面。等价性无法证实时保留长期例外，桥仍须给上游回调施加工作区和取消隔离。 |
| `arch/baseline/rules.json:286` | R2 | `src/desktop/platform/plugin.ts:598`（列 18） | `petRoom` | Desktop 批清，复用 Room 已登记的窄开窗端口。 |
| `arch/baseline/rules.json:298` | R2 | `src/desktop/platform/plugin.ts:605`（列 20） | `petRoom` | Desktop 批清，复用同一 Room 开窗端口。 |
| `arch/baseline/rules.json:310` | R2 | `src/desktop/platform/plugin.ts:648`（列 19） | `petVoice` | Voice 批清，经登记口调用。 |
| `arch/baseline/rules.json:322` | R1 | `src/desktop/standalone.mjs:8`（列 1） | `dist/src/core/companion-settings.js` | 建议长期例外。npm bin 指向源码（`package.json:32`），从包内已编译树取默认值，保留安装后和源码入口。 |
| `arch/baseline/rules.json:352` | R1 | `src/room/chat.ts:8`（列 1） | `src/desktop/images.js` | Room 批清，提取共用图片能力，Desktop 与 Room 同用。 |
| `arch/baseline/rules.json:364` | R2 | `src/room/plugin.ts:72`（列 19） | `petVoice` | Voice 批清，Room 从登记口取语音能力（现取服务）。 |
| `arch/baseline/rules.json:376` | R2 | `src/room/plugin.ts:79`（列 11） | `petVoice` | Voice 批清，保留调用后对服务及绑定的复核。 |
| `arch/baseline/rules.json:388` | R1 | `src/room/shot-browser.cjs:18`（列 29） | `dist/src/room/assets.js` | 建议长期例外，隔离拍照子进程加载安装包内的编译入口（`src/room/shot-browser.cjs:18,24–26`）。 |
| `arch/baseline/rules.json:398` | R1 | `src/voice/plugin.ts:9`（列 50） | `import ( "../desktop/upstream/host/" + part + ".js" )` | Voice 批尝试清，复用上游构建接点并验实装只加载一份 registry；已安装 provider 依赖旧路径且不能等价搬迁时，保留明确例外。 |
| `arch/baseline/rules.json:408` | R1 | `src/voice/plugin.ts:21`（列 22） | `src/desktop/upstream/host/voice/speech-registry.js` | Voice 批尝试清，与识别路由共用一份上游 provider registry；包内闭包或原生旧路径不能等价搬迁时，保留明确例外。 |

### R5 存储报告

全仓保存 324 条，当前实时报告共 319 条。第三层和 Desktop 自有生成源相关 **109 条**。明确报告违规 **29 条（13 写，16 读）**，未判定 **80 条（32 写，48 读）**。按调用身份和出现次数核对，第三层当前报告与快照一致，部分源码行号有变化，以下列当前行号。棘轮命令只处理 R1–R4、R8（`scripts/arch/check.mjs:41–44`）。

| 基线位置 | 当前调用点 | 访问及目标 | 去向建议 |
| --- | --- | --- | --- |
| `arch/baseline/writers.json:469` | `src/channels/bridge.ts:82`（列 26） | 读 `life-outlet-delivery` | 长期例外。按 P4 草案留在 Core，Channels 批复验原回执恢复。 |
| `arch/baseline/writers.json:486` | `src/channels/bridge.ts:85`（列 9） | 写 `life-outlet-delivery` | 长期例外。按 P4 草案留在 Core，Channels 批复验原回执恢复。 |
| `arch/baseline/writers.json:503` | `src/channels/bridge.ts:88`（列 16） | 写 `life-outlet-delivery` | 长期例外。按 P4 草案留在 Core，Channels 批复验原回执恢复。 |
| `arch/baseline/writers.json:728` | `src/channels/messaging.ts:159`（列 49） | 读 `channel-received` | 长期例外。按 P4 草案留在 Core，Channels 批复验原回执恢复。 |
| `arch/baseline/writers.json:745` | `src/channels/messaging.ts:162`（列 11） | 写 `channel-received` | 长期例外。按 P4 草案留在 Core，Channels 批复验原回执恢复。 |
| `arch/baseline/writers.json:762` | `src/channels/messaging.ts:165`（列 13） | 写 `channel-received` | 长期例外。按 P4 草案留在 Core，Channels 批复验原回执恢复。 |
| `arch/baseline/writers.json:779` | `src/channels/messaging.ts:168`（列 84） | 写 `channel-received` | 长期例外。按 P4 草案留在 Core，Channels 批复验原回执恢复。 |
| `arch/baseline/writers.json:796` | `src/channels/messaging.ts:208`（列 23） | 读 `channel-reach` | 长期例外。按 P4 草案留在 Core，Channels 批复验原回执恢复。 |
| `arch/baseline/writers.json:813` | `src/channels/messaging.ts:212`（列 11） | 写 `channel-reach` | 长期例外。按 P4 草案留在 Core，Channels 批复验原回执恢复。 |
| `arch/baseline/writers.json:830` | `src/channels/messaging.ts:214`（列 11） | 写 `channel-reach` | 长期例外。按 P4 草案留在 Core，Channels 批复验原回执恢复。 |
| `arch/baseline/writers.json:847` | `src/channels/plugin.ts:81`（列 10） | 读 `memory-batch` | Channels 批改走拥有者提供的只读查询，先核对可复用的端口和失败语义。 |
| `arch/baseline/writers.json:864` | `src/channels/qq-inbox.ts:34`（列 51） | 写 `channel-received` | 长期例外。按 P4 草案留在 Core，Channels 批复验原回执恢复。 |
| `arch/baseline/writers.json:881` | `src/channels/qq-inbox.ts:35`（列 42） | 读 `channel-received` | 长期例外。按 P4 草案留在 Core，Channels 批复验原回执恢复。 |
| `arch/baseline/writers.json:898` | `src/channels/qq-inbox.ts:40`（列 19） | 读 `channel-received` | 长期例外。按 P4 草案留在 Core，Channels 批复验原回执恢复。 |
| `arch/baseline/writers.json:915` | `src/channels/qq-inbox.ts:41`（列 9） | 写 `channel-received` | 长期例外。按 P4 草案留在 Core，Channels 批复验原回执恢复。 |
| `arch/baseline/writers.json:932` | `src/channels/qq-inbox.ts:43`（列 7） | 写 `channel-received` | 长期例外。按 P4 草案留在 Core，Channels 批复验原回执恢复。 |
| `arch/baseline/writers.json:949` | `src/channels/qq-inbox.ts:52`（列 50） | 读 `channel-received` | 长期例外。按 P4 草案留在 Core，Channels 批复验原回执恢复。 |
| `arch/baseline/writers.json:966` | `src/channels/qq-inbox.ts:59`（列 21） | 读 `channel-received` | 长期例外。按 P4 草案留在 Core，Channels 批复验原回执恢复。 |
| `arch/baseline/writers.json:983` | `src/channels/qq-inbox.ts:67`（列 23） | 读 `channel-received` | 长期例外。按 P4 草案留在 Core，Channels 批复验原回执恢复。 |
| `arch/baseline/writers.json:1000` | `src/channels/qq-inbox.ts:68`（列 24） | 读 `channel-received` | 长期例外。按 P4 草案留在 Core，Channels 批复验原回执恢复。 |
| `arch/baseline/writers.json:1017` | `src/channels/qq-inbox.ts:72`（列 28） | 读 `channel-received` | 长期例外。按 P4 草案留在 Core，Channels 批复验原回执恢复。 |
| `arch/baseline/writers.json:1034` | `src/channels/qq-inbox.ts:99`（列 51） | 读 `channel-received` | 长期例外。按 P4 草案留在 Core，Channels 批复验原回执恢复。 |
| `arch/baseline/writers.json:1051` | `src/channels/qq-inbox.ts:102`（列 18） | 读 `channel-received` | 长期例外。按 P4 草案留在 Core，Channels 批复验原回执恢复。 |
| `arch/baseline/writers.json:1164` | `src/channels/usage.ts:12`（列 49） | 读 `channel-usage` | 长期例外。按 P4 草案留在 Core，Channels 批复验原回执恢复。 |
| `arch/baseline/writers.json:1181` | `src/channels/usage.ts:28`（列 10） | 读 `channel-usage-event` | 长期例外。按 P4 草案留在 Core，Channels 批复验原回执恢复。 |
| `arch/baseline/writers.json:1198` | `src/channels/usage.ts:29`（列 7） | 写 `channel-usage-event` | 长期例外。按 P4 草案留在 Core，Channels 批复验原回执恢复。 |
| `arch/baseline/writers.json:1215` | `src/channels/usage.ts:34`（列 7） | 写 `channel-usage` | 长期例外。按 P4 草案留在 Core，Channels 批复验原回执恢复。 |
| `arch/baseline/writers.json:3677` | `src/desktop/index.ts:44`（列 70） | 读 `desktop-session` | 建议长期例外。Desktop 批验证随 Core 回退与恢复，是否搬出由主人拍板。 |
| `arch/baseline/writers.json:3694` | `src/desktop/index.ts:45`（列 20） | 写 `desktop-session` | 建议长期例外。Desktop 批验证随 Core 回退与恢复，是否搬出由主人拍板。 |

R5 未判定项逐条列在下面，数字为 `arch/baseline/writers.json` 条目起始行。按模块用合成目录核对访问，确认属于伙伴持久存储时按拥有者表复核。

| 记录文件 | 基线条目起始行 → 当前调用行:列（读写） | 去向依据 |
| --- | --- | --- |
| `scripts/build/build-desktop-animation.mjs` | `68→10:27(读)`、`84→14:18(读)`、`100→18:5(写)`、`116→18:51(写)`、`132→29:1(写)`、`148→38:18(读)`、`164→41:3(写)`、`180→43:3(写)`、`196→46:17(读)`、`212→50:79(读)` | Desktop 批复核，当前判定未知，保留报告。 |
| `scripts/build/build-pet-platform.mjs` | `228→10:22(读)`、`244→27:35(读)`、`260→89:1(写)`、`276→116:1(写)`、`292→117:1(写)`、`308→209:1(写)`、`324→228:1(写)`、`340→434:1(写)` | Desktop 批复核，当前判定未知，保留报告。 |
| `src/channels/bridge.ts` | `421→32:3(写)`、`437→50:60(读)`、`453→70:36(读)` | Channels 批复核，当前判定未知，保留报告。 |
| `src/channels/group-material.ts` | `520→44:21(读)`、`536→76:22(读)`、`552→76:62(读)`、`568→76:99(读)`、`584→77:16(读)`、`600→77:59(读)`、`616→77:100(读)`、`632→77:135(读)` | Channels 批复核，当前判定未知，保留报告。 |
| `src/channels/group-qzone.ts` | `648→33:30(读)` | Channels 批复核，当前判定未知，保留报告。 |
| `src/channels/group-social.ts` | `664→46:23(读)` | Channels 批复核，当前判定未知，保留报告。 |
| `src/channels/messaging-storage.ts` | `680→16:26(读)` | Channels 批复核，当前判定未知，保留报告。 |
| `src/channels/messaging.ts` | `696→51:42(读)`、`712→98:16(读)` | Channels 批复核，当前判定未知，保留报告。 |
| `src/channels/sessions.ts` | `1068→224:53(写)` | Channels 批复核，当前判定未知，保留报告。 |
| `src/channels/storage.ts` | `1084→9:24(读)`、`1100→16:22(读)`、`1116→20:60(读)`、`1132→30:26(读)`、`1148→48:31(写)` | Channels 批复核，当前判定未知，保留报告。 |
| `src/desktop/appearance.ts` | `3485→10:39(读)`、`3501→11:72(读)` | Desktop 批复核，当前判定未知，保留报告。 |
| `src/desktop/features.ts` | `3517→97:29(写)`、`3533→109:30(读)`、`3549→146:46(读)`、`3565→203:32(读)` | Desktop 批复核，当前判定未知，保留报告。 |
| `src/desktop/images.ts` | `3581→20:49(写)`、`3597→36:142(读)`、`3613→37:51(写)`、`3629→37:116(写)`、`3645→42:17(读)`、`3661→46:30(读)` | Desktop 批复核，当前判定未知，保留报告。 |
| `src/desktop/platform/migration.ts` | `3711→40:3(写)`、`3727→53:14(读)`、`3743→58:7(写)`、`3759→59:7(写)`、`3775→59:58(写)`、`3791→156:39(读)`、`3807→157:28(读)`、`3823→203:65(写)` | Desktop 批复核，当前判定未知，保留报告。 |
| `src/desktop/platform/plugin.ts` | `3839→23:28(读)`、`3855→53:33(写)`、`3871→66:27(写)`、`3887→67:42(读)`、`3903→133:7(写)`、`3919→286:56(读)`、`3935→290:7(写)`、`3951→291:10(读)`、`3967→292:7(写)`、`3983→490:7(写)`、`3999→491:7(写)` | Desktop 批复核，当前判定未知，保留报告。 |
| `src/desktop/standalone.mjs` | `4015→18:40(读)` | Desktop 批复核，当前判定未知，保留报告。 |
| `src/room/assets.ts` | `5231→155:60(读)`、`5247→157:44(读)`、`5263→161:50(读)`、`5279→173:79(读)`、`5295→175:26(读)` | Room 批复核，当前判定未知，保留报告。 |
| `src/room/chat.ts` | `5311→141:13(写)` | Room 批复核，当前判定未知，保留报告。 |
| `src/room/plugin.ts` | `5327→83:29(读)` | Room 批复核，当前判定未知，保留报告。 |
| `src/voice/plugin.ts` | `5343→45:9(写)` | Voice 批复核，当前判定未知，保留报告。 |

### R8 词表逐条去向

全仓 637 条。按任一端点在第三层选中 **413 条**，其中 **404 条双向关系组成 202 对**，加 **9 个裸字段**。源端属于第三层 364 条，反向低层 49 条。每对给出 `arch/baseline/vocabulary.json` 两个条目起始行。以下按当前棘轮快照列出，首批扩展扫描后的新增候选由主人另行确认。

**Channels 批候选。若批准收口 QQ 状态枚举，内部一处定义并保持端上输出。** 共 2 条。

- `2046 ↔ 2067` · `src/channels/messaging.ts:181` ↔ `src/channels/plugin.ts:72`

**Console 批候选。运维登记表提供操作集合，兼容层保留旧端点名。** 共 18 条。

- `2088 ↔ 2114` · `src/channels/plugin.ts:98` ↔ `src/console/plugin.ts:29`
- `3097 ↔ 3117` · `src/console/client.js:455` ↔ `src/console/plugin.ts:29`
- `4293 ↔ 4313` · `src/console/client.js:1221` ↔ `src/console/plugin.ts:29`
- `4575 ↔ 4596` · `src/console/client.js:1229` ↔ `src/console/plugin.ts:29`
- `4670 ↔ 4744` · `src/console/plugin.ts:29` ↔ `src/console/settings.ts:83`
- `4765 ↔ 4839` · `src/console/plugin.ts:29` ↔ `src/console/settings.ts:165`
- `4860 ↔ 4934` · `src/console/plugin.ts:29` ↔ `src/console/settings.ts:192`
- `4961 ↔ 5035` · `src/console/plugin.ts:29` ↔ `src/console/settings.ts:203`
- `5060 ↔ 5134` · `src/console/plugin.ts:29` ↔ `src/console/settings.ts:415`

**设置窄切片候选。统一错误码定义，保留调用者适用子集，逐项核对实扫差异。** 共 10 条。

- `3611 ↔ 3632` · `src/console/client.js:495` ↔ `src/console/settings.ts:24`
- `3668 ↔ 3689` · `src/console/client.js:495` ↔ `src/contracts/common.ts:19`
- `3719 ↔ 3740` · `src/console/client.js:495` ↔ `src/core/storage.ts:11`
- `5553 ↔ 5589` · `src/console/settings.ts:24` ↔ `src/living/body/room.ts:506`
- `5612 ↔ 5648` · `src/console/settings.ts:24` ↔ `src/living/economy/plugin.ts:167`

**Room 批候选。收 Room 传输重复，Console 总表与子集关系随登记表改造，按实时扫描确认消失项。** 共 34 条。

- `4434 ↔ 4454` · `src/console/client.js:1221` ↔ `src/room/window-main.cjs:11`
- `4481 ↔ 4501` · `src/console/client.js:1221` ↔ `src/room/window-preload.cjs:3`
- `4528 ↔ 4548` · `src/console/client.js:1221` ↔ `src/room/window.ts:9`
- `5155 ↔ 5229` · `src/console/plugin.ts:29` ↔ `src/room/plugin.ts:86`
- `5250 ↔ 5324` · `src/console/plugin.ts:29` ↔ `src/room/window-main.cjs:11`
- `5351 ↔ 5425` · `src/console/plugin.ts:29` ↔ `src/room/window-preload.cjs:3`
- `5452 ↔ 5526` · `src/console/plugin.ts:29` ↔ `src/room/window.ts:9`
- `5912 ↔ 5939` · `src/console/settings.ts:192` ↔ `src/room/plugin.ts:86`
- `5960 ↔ 5987` · `src/console/settings.ts:192` ↔ `src/room/window-main.cjs:11`
- `6014 ↔ 6041` · `src/console/settings.ts:192` ↔ `src/room/window-preload.cjs:3`
- `6068 ↔ 6095` · `src/console/settings.ts:192` ↔ `src/room/window.ts:9`
- `13315 ↔ 13336` · `src/room/plugin.ts:86` ↔ `src/room/window-main.cjs:11`
- `13363 ↔ 13384` · `src/room/plugin.ts:86` ↔ `src/room/window-preload.cjs:3`
- `13411 ↔ 13432` · `src/room/plugin.ts:86` ↔ `src/room/window.ts:9`
- `13621 ↔ 13648` · `src/room/window-main.cjs:11` ↔ `src/room/window-preload.cjs:3`
- `13675 ↔ 13702` · `src/room/window-main.cjs:11` ↔ `src/room/window.ts:9`
- `13729 ↔ 13756` · `src/room/window-preload.cjs:3` ↔ `src/room/window.ts:9`

**Voice 批清。语音端点由公共调用契约派生。** 共 2 条。

- `8680 ↔ 8701` · `src/desktop/features.ts:141` ↔ `src/voice/plugin.ts:40`

**Room 批候选。Room 传输到语音操作的短名适配由传输契约派生。** 共 2 条。

- `13273 ↔ 13294` · `src/room/plugin.ts:75` ↔ `src/room/voice-client.js:23`

**Channels 字段薄切片和 Console 设置批核对可派生项，独立的设备凭据或界面边界建议长期例外。** 共 8 条。

- `4 ↔ 25` · `src/channels/bridge.ts:21` ↔ `src/console/client.js:378`
- `1898 ↔ 1920` · `src/channels/messaging-storage.ts:6` ↔ `src/console/client.js:344`
- `1956 ↔ 1976` · `src/channels/messaging-storage.ts:27` ↔ `src/console/client.js:22`
- `2001 ↔ 2021` · `src/channels/messaging-storage.ts:28` ↔ `src/console/client.js:22`

**建议长期例外。独立连接与请求入口各自校验权限，保留各自方法及主机范围。** 共 40 条。

- `46 ↔ 66` · `src/channels/bridge.ts:23` ↔ `src/desktop/platform/plugin.ts:480`
- `86 ↔ 106` · `src/channels/bridge.ts:23` ↔ `src/desktop/standalone.mjs:21`
- `126 ↔ 146` · `src/channels/bridge.ts:23` ↔ `src/room/window-main.cjs:10`
- `166 ↔ 186` · `src/channels/bridge.ts:23` ↔ `src/room/window.ts:44`
- `1772 ↔ 1793` · `src/channels/messaging-settings.ts:32` ↔ `src/desktop/standalone.mjs:20`
- `1814 ↔ 1835` · `src/channels/messaging-settings.ts:32` ↔ `src/room/window-main.cjs:10`
- `1856 ↔ 1877` · `src/channels/messaging-settings.ts:32` ↔ `src/room/window.ts:44`
- `8950 ↔ 8970` · `src/desktop/helper/main.cjs:223` ↔ `src/desktop/platform/plugin.ts:738`
- `9424 ↔ 9444` · `src/desktop/platform/plugin.ts:480` ↔ `src/desktop/standalone.mjs:21`
- `9464 ↔ 9484` · `src/desktop/platform/plugin.ts:480` ↔ `src/room/window-main.cjs:10`
- `9504 ↔ 9524` · `src/desktop/platform/plugin.ts:480` ↔ `src/room/window.ts:44`
- `9672 ↔ 9692` · `src/desktop/platform/plugin.ts:700` ↔ `src/room/assets.ts:132`
- `9712 ↔ 9732` · `src/desktop/platform/plugin.ts:710` ↔ `src/room/assets.ts:132`
- `9752 ↔ 9772` · `src/desktop/platform/plugin.ts:728` ↔ `src/room/assets.ts:132`
- `9884 ↔ 9905` · `src/desktop/standalone.mjs:20` ↔ `src/room/window-main.cjs:10`
- `9926 ↔ 9947` · `src/desktop/standalone.mjs:20` ↔ `src/room/window.ts:44`
- `9968 ↔ 9988` · `src/desktop/standalone.mjs:21` ↔ `src/room/window-main.cjs:10`
- `10008 ↔ 10028` · `src/desktop/standalone.mjs:21` ↔ `src/room/window.ts:44`
- `13539 ↔ 13559` · `src/room/window-main.cjs:10` ↔ `src/room/window.ts:44`
- `13579 ↔ 13600` · `src/room/window-main.cjs:10` ↔ `src/room/window.ts:44`

**建议长期例外。群素材、群研究类型、QQ 收件与 QQ 适配的标签集合属于各自的输入与持久化边界。保留各入口的有效子集，按原链路回归。** 共 102 条。

- `206 ↔ 226` · `src/channels/group-material.ts:18` ↔ `src/channels/group-upstream.d.ts:16`
- `246 ↔ 266` · `src/channels/group-material.ts:18` ↔ `src/channels/group-upstream.d.ts:17`
- `286 ↔ 306` · `src/channels/group-material.ts:18` ↔ `src/channels/qq-inbox.ts:12`
- `326 ↔ 346` · `src/channels/group-material.ts:18` ↔ `src/channels/qq-inbox.ts:17`
- `366 ↔ 386` · `src/channels/group-material.ts:18` ↔ `src/channels/qq-inbox.ts:57`
- `406 ↔ 426` · `src/channels/group-material.ts:18` ↔ `src/channels/qq.ts:26`
- `446 ↔ 466` · `src/channels/group-material.ts:18` ↔ `src/channels/qq.ts:28`
- `486 ↔ 506` · `src/channels/group-material.ts:18` ↔ `src/channels/qq.ts:30`
- `526 ↔ 546` · `src/channels/group-material.ts:18` ↔ `src/channels/qq.ts:33`
- `566 ↔ 586` · `src/channels/group-material.ts:18` ↔ `src/channels/qq.ts:170`
- `606 ↔ 626` · `src/channels/group-material.ts:49` ↔ `src/channels/group-upstream.d.ts:16`
- `646 ↔ 666` · `src/channels/group-material.ts:49` ↔ `src/channels/group-upstream.d.ts:17`
- `686 ↔ 706` · `src/channels/group-material.ts:49` ↔ `src/channels/qq-inbox.ts:12`
- `726 ↔ 746` · `src/channels/group-material.ts:49` ↔ `src/channels/qq-inbox.ts:17`
- `766 ↔ 786` · `src/channels/group-material.ts:49` ↔ `src/channels/qq-inbox.ts:57`
- `806 ↔ 826` · `src/channels/group-material.ts:49` ↔ `src/channels/qq.ts:26`
- `846 ↔ 866` · `src/channels/group-material.ts:49` ↔ `src/channels/qq.ts:28`
- `886 ↔ 906` · `src/channels/group-material.ts:49` ↔ `src/channels/qq.ts:30`
- `926 ↔ 946` · `src/channels/group-material.ts:49` ↔ `src/channels/qq.ts:33`
- `966 ↔ 986` · `src/channels/group-material.ts:49` ↔ `src/channels/qq.ts:170`
- `1132 ↔ 1152` · `src/channels/group-upstream.d.ts:16` ↔ `src/channels/qq-inbox.ts:12`
- `1172 ↔ 1192` · `src/channels/group-upstream.d.ts:16` ↔ `src/channels/qq-inbox.ts:17`
- `1212 ↔ 1232` · `src/channels/group-upstream.d.ts:16` ↔ `src/channels/qq-inbox.ts:57`
- `1252 ↔ 1272` · `src/channels/group-upstream.d.ts:16` ↔ `src/channels/qq.ts:26`
- `1292 ↔ 1312` · `src/channels/group-upstream.d.ts:16` ↔ `src/channels/qq.ts:28`
- `1332 ↔ 1352` · `src/channels/group-upstream.d.ts:16` ↔ `src/channels/qq.ts:30`
- `1372 ↔ 1392` · `src/channels/group-upstream.d.ts:16` ↔ `src/channels/qq.ts:33`
- `1412 ↔ 1432` · `src/channels/group-upstream.d.ts:16` ↔ `src/channels/qq.ts:170`
- `1452 ↔ 1472` · `src/channels/group-upstream.d.ts:17` ↔ `src/channels/qq-inbox.ts:12`
- `1492 ↔ 1512` · `src/channels/group-upstream.d.ts:17` ↔ `src/channels/qq-inbox.ts:17`
- `1532 ↔ 1552` · `src/channels/group-upstream.d.ts:17` ↔ `src/channels/qq-inbox.ts:57`
- `1572 ↔ 1592` · `src/channels/group-upstream.d.ts:17` ↔ `src/channels/qq.ts:26`
- `1612 ↔ 1632` · `src/channels/group-upstream.d.ts:17` ↔ `src/channels/qq.ts:28`
- `1652 ↔ 1672` · `src/channels/group-upstream.d.ts:17` ↔ `src/channels/qq.ts:30`
- `1692 ↔ 1712` · `src/channels/group-upstream.d.ts:17` ↔ `src/channels/qq.ts:33`
- `1732 ↔ 1752` · `src/channels/group-upstream.d.ts:17` ↔ `src/channels/qq.ts:170`
- `2235 ↔ 2255` · `src/channels/qq-inbox.ts:12` ↔ `src/channels/qq.ts:26`
- `2275 ↔ 2295` · `src/channels/qq-inbox.ts:12` ↔ `src/channels/qq.ts:28`
- `2315 ↔ 2335` · `src/channels/qq-inbox.ts:12` ↔ `src/channels/qq.ts:30`
- `2355 ↔ 2375` · `src/channels/qq-inbox.ts:12` ↔ `src/channels/qq.ts:33`
- `2395 ↔ 2415` · `src/channels/qq-inbox.ts:12` ↔ `src/channels/qq.ts:170`
- `2435 ↔ 2455` · `src/channels/qq-inbox.ts:17` ↔ `src/channels/qq.ts:26`
- `2475 ↔ 2495` · `src/channels/qq-inbox.ts:17` ↔ `src/channels/qq.ts:28`
- `2515 ↔ 2535` · `src/channels/qq-inbox.ts:17` ↔ `src/channels/qq.ts:30`
- `2555 ↔ 2575` · `src/channels/qq-inbox.ts:17` ↔ `src/channels/qq.ts:33`
- `2595 ↔ 2615` · `src/channels/qq-inbox.ts:17` ↔ `src/channels/qq.ts:170`
- `2635 ↔ 2655` · `src/channels/qq-inbox.ts:57` ↔ `src/channels/qq.ts:26`
- `2675 ↔ 2695` · `src/channels/qq-inbox.ts:57` ↔ `src/channels/qq.ts:28`
- `2715 ↔ 2735` · `src/channels/qq-inbox.ts:57` ↔ `src/channels/qq.ts:30`
- `2755 ↔ 2775` · `src/channels/qq-inbox.ts:57` ↔ `src/channels/qq.ts:33`
- `2795 ↔ 2815` · `src/channels/qq-inbox.ts:57` ↔ `src/channels/qq.ts:170`

**建议长期例外。群素材状态与上游类型声明镜像，合并前须核对上游约定。** 共 4 条。

- `1006 ↔ 1027` · `src/channels/group-material.ts:178` ↔ `src/channels/group-upstream.d.ts:8`
- `1048 ↔ 1069` · `src/channels/group-material.ts:180` ↔ `src/channels/group-upstream.d.ts:8`

**建议长期例外。界面标签、路由动作子集或底层执行状态属于各自边界，保留值域按既有契约分别回归。** 共 52 条。

- `1090 ↔ 1111` · `src/channels/group-social.ts:28` ↔ `src/console/client.js:263`
- `2880 ↔ 2906` · `src/console/client.js:29` ↔ `src/contracts/common.ts:37`
- `2932 ↔ 2953` · `src/console/client.js:31` ↔ `src/memory/client.ts:36`
- `3191 ↔ 3211` · `src/console/client.js:455` ↔ `src/console/settings.ts:83`
- `3232 ↔ 3252` · `src/console/client.js:455` ↔ `src/console/settings.ts:415`
- `3273 ↔ 3294` · `src/console/client.js:480` ↔ `src/contracts/behavior.ts:131`
- `3318 ↔ 3339` · `src/console/client.js:480` ↔ `src/core/native/result.ts:6`
- `3361 ↔ 3382` · `src/console/client.js:480` ↔ `src/living/body/room.ts:76`
- `3403 ↔ 3424` · `src/console/client.js:480` ↔ `src/living/body/room.ts:397`
- `3444 ↔ 3465` · `src/console/client.js:480` ↔ `src/living/body/room.ts:416`
- `3486 ↔ 3507` · `src/console/client.js:480` ↔ `src/living/body/room.ts:983`
- `3528 ↔ 3549` · `src/console/client.js:480` ↔ `src/living/economy/store.ts:20`
- `3570 ↔ 3591` · `src/console/client.js:480` ↔ `src/living/plan/plan.ts:316`
- `3769 ↔ 3792` · `src/console/client.js:643` ↔ `src/living/plan/plan.ts:10`
- `3815 ↔ 3838` · `src/console/client.js:643` ↔ `src/living/plan/plan.ts:176`
- `3861 ↔ 3884` · `src/console/client.js:643` ↔ `src/living/plan/plan.ts:213`
- `3904 ↔ 3927` · `src/console/client.js:643` ↔ `src/living/plan/plan.ts:289`
- `3947 ↔ 3970` · `src/console/client.js:643` ↔ `src/living/plan/plan.ts:300`
- `3990 ↔ 4013` · `src/console/client.js:643` ↔ `src/living/plan/plan.ts:316`
- `4033 ↔ 4056` · `src/console/client.js:643` ↔ `src/living/plan/plan.ts:347`
- `4076 ↔ 4099` · `src/console/client.js:643` ↔ `src/living/plan/plan.ts:359`
- `4119 ↔ 4142` · `src/console/client.js:643` ↔ `src/living/plan/plugin.ts:375`
- `4162 ↔ 4185` · `src/console/client.js:643` ↔ `src/living/plan/plugin.ts:570`
- `4205 ↔ 4228` · `src/console/client.js:645` ↔ `src/contracts/behavior.ts:130`
- `4251 ↔ 4272` · `src/console/client.js:786` ↔ `src/contracts/emotion.ts:22`
- `4387 ↔ 4407` · `src/console/client.js:1221` ↔ `src/console/settings.ts:192`。从共享 Room 协议派生 Console 聊天／电视子集，保留载体各自时限；Room 语音也在 Room 长期限子集（`src/room/assets.ts:98–102`、`vendor/feiyu-room-template/public/room/native-room.js:16,29`）。

**建议长期例外。各入口独立声明插件依赖或原生回调过滤。** 共 10 条。

- `2188 ↔ 2214` · `src/channels/plugin.ts:119` ↔ `src/desktop/plugin.ts:8`
- `8595 ↔ 8617` · `src/desktop/conversation.ts:102` ↔ `src/desktop/features.ts:62`
- `8637 ↔ 8657` · `src/desktop/features.ts:62` ↔ `src/desktop/index.ts:96`
- `9792 ↔ 9813` · `src/desktop/plugin.ts:8` ↔ `src/living/plan/plugin.ts:714`
- `9837 ↔ 9858` · `src/desktop/plugin.ts:8` ↔ `src/room/plugin.ts:158`

**建议长期例外。工作区状态／修改范围与 Console 标签或请求校验分别维护，保留绑定边界。** 共 6 条。

- `2835 ↔ 2857` · `src/console/client.js:28` ↔ `src/core/workspace.ts:49`
- `6122 ↔ 6144` · `src/console/settings.ts:383` ↔ `src/core/workspace.ts:46`
- `6164 ↔ 6186` · `src/console/settings.ts:383` ↔ `src/core/workspace.ts:302`

**建议长期例外。审阅文本、原生日志与聊天线协议的角色边界不同。** 共 12 条。

- `2974 ↔ 2995` · `src/console/client.js:208` ↔ `src/core/review-dialogue.ts:11`
- `3015 ↔ 3036` · `src/console/client.js:208` ↔ `src/desktop/conversation.ts:44`
- `3056 ↔ 3077` · `src/console/client.js:208` ↔ `src/room/chat.ts:37`
- `8149 ↔ 8169` · `src/core/review-dialogue.ts:11` ↔ `src/desktop/conversation.ts:44`
- `8189 ↔ 8209` · `src/core/review-dialogue.ts:11` ↔ `src/room/chat.ts:37`
- `8555 ↔ 8575` · `src/desktop/conversation.ts:44` ↔ `src/room/chat.ts:37`

**建议长期例外。随 Desktop 平台迁移入口回归，保留各语言边界的既有迁移协议。** 共 16 条。

- `5672 ↔ 5692` · `src/console/settings.ts:158` ↔ `src/desktop/platform/migration.ts:26`
- `5712 ↔ 5732` · `src/console/settings.ts:158` ↔ `src/desktop/platform/migration.ts:218`
- `5752 ↔ 5772` · `src/console/settings.ts:158` ↔ `src/desktop/platform/plugin.ts:299`
- `5792 ↔ 5812` · `src/console/settings.ts:159` ↔ `src/desktop/platform/migration.ts:26`
- `5832 ↔ 5852` · `src/console/settings.ts:159` ↔ `src/desktop/platform/migration.ts:218`
- `5872 ↔ 5892` · `src/console/settings.ts:159` ↔ `src/desktop/platform/plugin.ts:299`
- `9260 ↔ 9280` · `src/desktop/platform/migration.ts:26` ↔ `src/desktop/platform/plugin.ts:299`
- `9384 ↔ 9404` · `src/desktop/platform/migration.ts:218` ↔ `src/desktop/platform/plugin.ts:299`

**建议长期例外。动画、照料动作或接口校验保留各入口的值域。** 共 6 条。

- `6823 ↔ 6845` · `src/contracts/common.ts:16` ↔ `src/desktop/platform/plugin.ts:579`
- `9544 ↔ 9564` · `src/desktop/platform/plugin.ts:620` ↔ `src/emotion/index.ts:51`
- `9586 ↔ 9607` · `src/desktop/platform/plugin.ts:631` ↔ `src/living/body/room.ts:567`

**建议长期例外。设置键映射涉及独立 CLI、桌宠和平台分流，按概念表草案取舍。** 共 10 条。

- `7434 ↔ 7461` · `src/core/companion-settings.ts:44` ↔ `src/desktop/index.ts:144`
- `7485 ↔ 7512` · `src/core/companion-settings.ts:44` ↔ `src/desktop/platform/plugin.ts:270`
- `7533 ↔ 7560` · `src/core/companion-settings.ts:44` ↔ `src/desktop/standalone.mjs:62`
- `8991 ↔ 9015` · `src/desktop/index.ts:144` ↔ `src/desktop/platform/plugin.ts:270`
- `9036 ↔ 9060` · `src/desktop/index.ts:144` ↔ `src/desktop/standalone.mjs:62`

**建议长期例外。Desktop 命令和通知含不同进程及 CLI 兼容子集，按概念表草案取舍。** 共 30 条。

- `8334 ↔ 8356` · `src/desktop/conversation.ts:43` ↔ `src/desktop/helper/main.cjs:162`
- `8378 ↔ 8400` · `src/desktop/conversation.ts:43` ↔ `src/desktop/index.ts:228`
- `8422 ↔ 8444` · `src/desktop/conversation.ts:43` ↔ `src/desktop/index.ts:229`
- `8466 ↔ 8488` · `src/desktop/conversation.ts:43` ↔ `src/desktop/platform/plugin.ts:642`
- `8510 ↔ 8532` · `src/desktop/conversation.ts:43` ↔ `src/desktop/standalone.mjs:66`
- `8722 ↔ 8745` · `src/desktop/helper/main.cjs:108` ↔ `src/desktop/index.ts:63`
- `8773 ↔ 8795` · `src/desktop/helper/main.cjs:162` ↔ `src/desktop/index.ts:228`
- `8817 ↔ 8839` · `src/desktop/helper/main.cjs:162` ↔ `src/desktop/index.ts:229`
- `8861 ↔ 8883` · `src/desktop/helper/main.cjs:162` ↔ `src/desktop/platform/plugin.ts:642`
- `8905 ↔ 8927` · `src/desktop/helper/main.cjs:162` ↔ `src/desktop/standalone.mjs:66`
- `9082 ↔ 9104` · `src/desktop/index.ts:228` ↔ `src/desktop/platform/plugin.ts:642`
- `9126 ↔ 9148` · `src/desktop/index.ts:228` ↔ `src/desktop/standalone.mjs:66`
- `9171 ↔ 9193` · `src/desktop/index.ts:229` ↔ `src/desktop/platform/plugin.ts:642`
- `9215 ↔ 9237` · `src/desktop/index.ts:229` ↔ `src/desktop/standalone.mjs:66`
- `9627 ↔ 9649` · `src/desktop/platform/plugin.ts:642` ↔ `src/desktop/standalone.mjs:66`

**建议长期例外。两个独立输入边界分别过滤危险键。** 共 4 条。

- `9300 ↔ 9321` · `src/desktop/platform/migration.ts:36` ↔ `src/living/body/room.ts:627`
- `9342 ↔ 9363` · `src/desktop/platform/migration.ts:36` ↔ `src/living/body/room.ts:663`

**建议长期例外。Room 输入端按传输协议校验计划／菜园／概览权限，生活内部保留其状态和命令语义。** 共 16 条。

- `11461 ↔ 11482` · `src/living/body/room.ts:1103` ↔ `src/room/plugin.ts:95`
- `11544 ↔ 11565` · `src/living/body/room.ts:1130` ↔ `src/room/plugin.ts:131`
- `11682 ↔ 11702` · `src/living/economy/plugin.ts:310` ↔ `src/room/tool-context.ts:5`
- `11883 ↔ 11903` · `src/living/plan/plan-tools.ts:132` ↔ `src/room/tool-context.ts:5`
- `12129 ↔ 12150` · `src/living/plan/plan-tools.ts:154` ↔ `src/room/plugin.ts:95`
- `12667 ↔ 12688` · `src/living/plan/plan.ts:312` ↔ `src/room/plugin.ts:95`
- `12869 ↔ 12890` · `src/living/plan/plugin.ts:607` ↔ `src/room/plugin.ts:95`
- `12911 ↔ 12932` · `src/living/plan/plugin.ts:608` ↔ `src/room/plugin.ts:95`

**建议长期例外。拍照子进程和 Room 请求分别校验各自输入，随拍照回归。** 共 20 条。

- `12953 ↔ 12973` · `src/room/photo.ts:6` ↔ `src/room/plugin.ts:141`
- `12993 ↔ 13013` · `src/room/photo.ts:6` ↔ `src/room/shot-browser.cjs:17`
- `13033 ↔ 13053` · `src/room/photo.ts:7` ↔ `src/room/plugin.ts:141`
- `13073 ↔ 13093` · `src/room/photo.ts:7` ↔ `src/room/shot-browser.cjs:17`
- `13113 ↔ 13133` · `src/room/photo.ts:10` ↔ `src/room/plugin.ts:141`
- `13153 ↔ 13173` · `src/room/photo.ts:10` ↔ `src/room/shot-browser.cjs:17`
- `13193 ↔ 13213` · `src/room/photo.ts:10` ↔ `src/room/plugin.ts:141`
- `13233 ↔ 13253` · `src/room/photo.ts:10` ↔ `src/room/shot-browser.cjs:17`
- `13459 ↔ 13479` · `src/room/plugin.ts:141` ↔ `src/room/shot-browser.cjs:17`
- `13499 ↔ 13519` · `src/room/plugin.ts:141` ↔ `src/room/shot-browser.cjs:17`

| 基线位置 | 调用位置 | 字段 | 去向建议 |
| --- | --- | --- | --- |
| `arch/baseline/vocabulary.json:13783` | `src/channels/group-social.ts:50` | `type` | 建议长期例外。字段继续接受现有传输或展示值，收窄前须核对历史兼容。 |
| `arch/baseline/vocabulary.json:13793` | `src/channels/qq-inbox.ts:8` | `type` | 建议长期例外。字段继续接受现有传输或展示值，收窄前须核对历史兼容。 |
| `arch/baseline/vocabulary.json:13803` | `src/channels/qq-inbox.ts:112` | `type` | 建议长期例外。字段继续接受现有传输或展示值，收窄前须核对历史兼容。 |
| `arch/baseline/vocabulary.json:13813` | `src/console/settings.ts:20` | `kind` | Console 批先核对能否复用宿主 Connection Peer 身份类型。此项是 `peer.principal.kind`，沿用 owner 校验（`src/console/settings.ts:18–20,73–76`）；找不到等价可用类型时记原位例外。 |
| `arch/baseline/vocabulary.json:13903` | `src/desktop/conversation.ts:10` | `type` | 建议长期例外。字段继续接受现有传输或展示值，收窄前须核对历史兼容。 |
| `arch/baseline/vocabulary.json:13913` | `src/desktop/conversation.ts:11` | `kind` | 建议长期例外。字段继续接受现有传输或展示值，收窄前须核对历史兼容。 |
| `arch/baseline/vocabulary.json:13923` | `src/desktop/conversation.ts:65` | `type` | 建议长期例外。字段继续接受现有传输或展示值，收窄前须核对历史兼容。 |
| `arch/baseline/vocabulary.json:13933` | `src/desktop/index.ts:132` | `action` | 建议长期例外。字段继续接受现有传输或展示值，收窄前须核对历史兼容。 |
| `arch/baseline/vocabulary.json:13943` | `src/desktop/index.ts:207` | `action` | 建议长期例外。字段继续接受现有传输或展示值，收窄前须核对历史兼容。 |
