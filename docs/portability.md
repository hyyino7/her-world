# 伙伴 Repo 的可搬迁性

修复版把 SOUL/USER、可搬迁的设置、Core 数据、Memory、持续的情绪、Desktop 待办和图片上传，以及完整的原生会话副本，都随绑定的存储 Repo 保存。DSH 仍是会话运行时。恢复日志不会重放用户消息，也不会运行模型轮次。

## 存储边界

| 位置 | 负责什么 |
| --- | --- |
| 已安装的插件 | 可执行代码、内置媒体、打包的 World/Memory 适配器；更新会替换程序文件。 |
| 绑定的 Repo | 这个伙伴的身份、SOUL/USER/foundation/self、日记和历史、Bank、情绪、身体和菜园、相册、当前的 Life 计划、钱包/背包/经济账本/阅读内容和书签、可搬迁的偏好，以及完整的原始会话副本。渠道策略、公开群资料、发布/发件日志和隔离的 guest 历史也归 Repo。 |
| 本机 DSH profile | 账号凭据、适配器 URL 和发现、连接开关、Python 和运行时准备、安装回执、权限和临时缓存。 |

正常运行不需要开发检出。setup 命令及其辅助脚本随插件包发布；源码构建只用于开发。本地 Python 环境准备在 DSH profile 的 `chatpet-runtime/` 下，与检出无关。程序资源路径从已安装的包解析。记录下来的历史源码路径只是来源记录，不是生效的运行时绑定。

渠道策略和日志跟随当前绑定的 Repo 目录。在另一个路径选择复制过来的 Repo 时，使用那个目录里的记录，同时保留伙伴身份。凭据和连接开关留在本机。

托管的 setup 会把核实过的打包 Memory 入口重新绑定到当前 Bundle。如果继承来的 `memory.serviceEntry` 认不出是打包代码，setup 会在探测 Python 之前停下，要求明确选择：用 `--memory-service-entry bundled` 选打包的 provider，或者传一个已有的自定义入口绝对路径，有意保留这项本机覆盖。自定义入口是程序选择，不是 Bank 数据；换一台设备要重新明确绑定。标准的 `--resume-repo` 路径使用打包的 provider。

经济来源扩展把完整的 SQLite 聚合和存储标记放在 `.chatpet/data/economy/`。一次性采用之后，保留下来的旧菜园 JSON 只是来源记录。复制或恢复时，要在停止状态下把 Economy、Body 的食物回执、Life 计划、Core 和数据库附属文件一起处理；只恢复钱包可能和已经生效的效果冲突。离线备份除了 Core/Memory 写入者，也检查 `economy.lock`。已初始化的经济数据缺失时，状态是不可用，绝不当作可以新建空白钱包。源码检出里现在的经济拥有者实现在 `src/living/economy/`；已安装环境的恢复步骤见下文。

## 搬到另一台设备

1. 在源设备上确认工作区页面显示存储已完成。Core 必须真的从 `.chatpet/data/core/` 运行；Repo 里只是有文档或另一个数据库文件，不能证明这一点。
2. 完全退出 DSH，然后复制完整的伙伴 Repo，包括隐藏的 `.chatpet/` 和数据库附属文件。只用 Git 克隆带不走被忽略的个人数据。不要把无关的 dsh-chatbot 伙伴合并进来。
3. 在新设备上安装并打开一次 DSH，配置账号和模型，完全退出后运行 `her-world` 包提供的 setup 命令。若复制来的 Repo 有 Memory Bank，还要提供一个兼容且已装好依赖的 Python 环境。

   ```sh
   dafeiyu-setup \
     --resume-repo "/absolute/path/to/copied-companion-repo" \
     --memory-python "/absolute/path/to/device/venv/bin/python" \
     --apply
   ```

   setup 交给 DSH 安装 npm 上的稳定版 `her-world`。用 `--version <版本>` 指定版本。缓存中已有该包和依赖时，可以加 `--offline`。包内入口为 `scripts/install-dsh.mjs`，也可以用 DSH 自带的 Electron 以 Node 模式运行。设备运行时准备会离线复制提供的本地 Python 环境。伙伴从未配置长期 Memory 时，省略 `--memory-python`。已声明或拥有的 Bank 缺失或无效时，setup 会报错。`--no-backup` 可关闭默认备份，每次应用仍会保留此前的 profile 补丁和回执快照（若存在）。
4. setup 将 Core 身份、范围和本机路径写入当前 profile 的 `cordis.patch.yml`。验证安装后生成 `chatpet-installation/installation.json`。重新打开 DSH，通过原生工作区选择器绑定复制来的 Repo 并初始化文档。新建的原生工作区 ID 可以不同，恢复的日志和存储身份沿用复制来的 Repo。本机渠道连接和权限要另行配置。

现用 npm profile 可在退出 DSH 后运行 `dafeiyu-setup repair-core-config` 离线核对。加 `--apply` 可以为现有 Core 覆盖补写安装回执，或凭经核实的已完成回执恢复丢失的覆盖。修复保留已核实的自定义 Memory 入口。插件启用或停用时均可离线修复，遇到冲突会返回原因码。

setup 或配置修复中断后，如果重试一直返回 `profile-busy`，先确认没有 setup 或修复进程在运行，并且 DSH 已完全退出。然后手动删除目标 profile 目录下的 `.her-world-setup.lock` 目录，再重试原命令。

初始化会区分「文档已就绪」和「可搬迁存储已完整」。设置页显示 Core/Memory 的实际位置，不会把外部引导数据库说成已完成的安装。setup 可以离线完成已经识别的绑定；缺失或被删的 `.chatpet/` 绝不会在应用启动时被悄悄重建。

对真正的新绑定，文档初始化可以基于唯一的外部引导 Core 完成。之后在停止状态下运行 setup，会复制这同一个数据库，并原子地加进 Repo 清单；声明失败可以重试。已有的 Core 声明始终是必需的；已初始化的身份清单会阻止「缺 Core 时启动」造出空白替代，包括声明完成前被中断的迁移。

原生对话导出会记录来源工作区和存储 ID。切换到另一个 Repo 不能把这份导出重定向或悄悄丢掉。单次失败会保留待处理项，并允许其他会话保存；三次有限的自动重试会记录失败，之后可以用显式 flush、或重启和恢复，从原生原始日志补回。最后一次服务 flush 会关掉计时器。进程被突然终止时，复制仍可能没来得及做；这台设备上完整的原生原始日志始终是恢复依据。

QQ 输入回执会保留原平台 ID、路由身份和冻结的批次，直到原生准入得到确认。恢复时重新核对当前范围、账号、白名单和发言人权限。它探测的是原来的原生会话，不为检查而新建会话。收件箱或日志结果不确定时，保持待处理并可见，不重跑这条输入。准入确认后，回执里的临时消息正文会被删掉；会话归原生日志所有。不确定是否发出的回复不会被自动重新生成或重发。

以上都是已实现的源码和 setup 路径；这次交付没有做过真实的第二台设备验收，测试留给主人。

## 保留与冲突

每份完整日志副本都在 `.chatpet/data/core/native-sessions/` 下。原生事件、消息 ID、工具记录和压缩事件都保留；摘要不替代这些原始内容。只有恢复后的会话头里的工作目录会重新绑定。DSH 可能追加它自己的续用生命周期标记。

已有的原生会话在复用前会先检查。会话头或日志冲突时拒绝，两边都不覆盖。完全一致的已有前缀可以通过原生单写入者 API 继续追加。原生不支持的格式由原生校验器拒绝。在新设备上确认续用正常之前，保留原 Repo 和安装器备份。

原生服务重构后，当前的 Memory 开关从下一轮起生效，包括已有的会话。关掉它会去掉注入的召回块，不会删除 Bank 或完整的会话副本。provider 不可用时，普通聊天照常进行，只是没有召回块。这取代了早先「每个会话冻结模式」的策略。在重构打包并安装之前，已安装的行为仍以带日期的交付记录为准。

Memory provider 会为所选 Bank 里已准入的 Body/Economy 互动来源修复召回元数据。它复用这些来源已有的 episode ID，保留原始观察、内容和旧版本，并尊重来源撤回。投递信封仍只是证据，不算第二次经历；旧的信封候选会保留，但不加进互动召回。这项修复不导入未观察过的原生日志，也不重建缺失的 Bank。

受控的双 profile 测试是 `pnpm run test:native-portability`。它检查身份、设置、Bank、情绪的连续性，完整原始事件的保留，同一会话的续用，恢复期间不做推理，以及冲突拒绝。它模拟两台各有独立本地 profile 的设备；真实硬件和主人的体验仍是单独的验收步骤。

Desktop 待办和图片上传随 `.chatpet/data/desktop/` 一起搬走。图片上传在使用前会经新设备的原生附件 provider 重新准入；原生的规范化或引用格式变了时会明确拒绝，并保留上传副本。操作系统的截屏权限和 provider 凭据归设备所有。睡眠是临时运行状态，不是可搬迁的人格。

<a id="offline-file-backup-and-same-machine-recovery"></a>

## 离线文件备份和同机恢复

`scripts/companion-backup.mjs` 为停止状态的伙伴提供文件级备份。一份备份是一个私有目录，包含清单、SHA-256 文件哈希和逐字节的数据副本。把它放在存储 Repo 和正在使用的 DSH 数据之外。它可能包含私人对话和本地渠道凭据；不要提交或公开。

使用已完成的回执（`status: installed`、`packageInstalled: true`），已安装但被停用的插件也算。只做准备的 setup 会把计划回执存在该次尝试准备好的 Bundle 旁边，并打印 `attemptReceipt`；它不动当前默认的 `installation.json`。在真正的包 CLI 改动任何东西之前，setup 会把之前的回执原样保留在尝试目录里，并发布一个 `applying` 标记。只有核实完成后，才原子地发布新的已安装回执。如果在这个边界之后应用失败，先核对实际安装的绑定，再重试备份或恢复；准备中、应用中或不完整的回执会被拒绝。旧回执只是保留下来的证据，不能证明被中断的换包让旧绑定仍然有效。

命令会用当前 Core 身份、已就绪的工作区和存储 ID 核对已完成的回执，然后复用运行时的 Bank 选择及其配置目录的拥有者。过期的外部 Bank 不会被当作这个伙伴的数据复制或恢复。每道离线关卡都会重新核对这个选择，并拒绝受影响的当前或保留 Bank 目录里还活着的 Memory 拥有者。备份包括 `.chatpet/`（人格、USER、foundation、自我描述、Bank、情绪、身体和菜园、相册和日记、自定义包、可搬迁的原生副本）、绑定 Repo 的 `AGENTS.md`、仍是实际配置权威时的外部 Core 目录，以及这个伙伴范围内的渠道和语音文件。原生 JSONL 日志和投影缓存文件从绑定的工作区、以及这个伙伴渠道目录下的 guest 工作区里选取。工作区登记的备份只包含这些条目及其归档、置顶的会话 ID。

全局 profile 设置作为参考副本保留。DSH 凭据、账号和模型设置、可执行包都不恢复。共享附件对象为了连续性会被备份，但恢复只补缺失的对象，绝不删除新对象，也不覆盖有冲突的当前字节。

恢复**不会**撤销外部投递、已消耗的额度或实际的模型花费。它保留这些当前日志，而不是回滚：

- 在本伙伴的渠道目录里，`qzone-<QQ account>/published.json` 保留整个当前的草稿、发布和额度日志，包括已发送和不确定的状态。里面嵌的设置随日志保持当前值。
- `wechat-<account key>/wechat-outbox.sqlite` 和它现有的 `-wal`、`-shm`、`-journal` 附属文件作为当前的 SQLite 文件组一起保留。当前文件组里没有的旧快照附属文件不会放回去。
- `group-material/<group hash>/social.json` 保留当前的已读确认和已消耗的群唤醒额度，不恢复旧的未读工作。
- 在 Core 的 `records` 里，只有 `channel-received`、`channel-reach`、`life-outlet-delivery`、`channel-usage` 和 `channel-usage-event` 保留当前值。普通的身份、事项和会话仍从备份恢复。
- 在 `.chatpet/data/life/life.json` 里，只保留当前的 `spend` 字段。home 会话 ID、闹钟和其他 Life 状态仍从备份恢复。

这些例外复用已有的日志，会列在恢复报告的 `preservedJournals` 里。它们防止旧的待发草稿或发件被发送第二次，也防止恢复回来的输入又被当作新的平台消息接收。如果备份里有日志、基础数据库或已处理消息记录，而当前对应的那份缺失，恢复会停下并给出具体的核对要求；它不猜外部操作有没有发生，也不悄悄重新激活只存在于备份里的队列。备份里有花费而当前的 Life `spend` 字段缺失时，同样要求核对。

创建或恢复备份之前，完全退出 DSH 和所有命令行会话写入者。命令会检查桌面进程、Core/Memory 拥有者记录和打开着的原生会话锁文件。缺少所需进程和锁检查工具的操作系统会被拒绝，而不是默认当作已离线。`plan` 和 `verify` 读取 Core 的绑定信息时用的是数据库的私有副本，所以 Core 写入者还活着时它们也会拒绝；只做准备的 setup（不带 `--apply`）同理。恢复还会和本检出的迁移命令按仓库路径互斥，迁移进行中不能恢复，反之亦然（细节见源码检出里的 `docs/development.md`，它不随包发布）。

在源码检出里，用项目的 Node 版本，在仓库目录下运行：

```sh
node scripts/companion-backup.mjs plan --installation /absolute/path/installation.json
node scripts/companion-backup.mjs create --installation /absolute/path/installation.json \
  --output /absolute/path/backups/fish-before-change
node scripts/companion-backup.mjs verify --installation /absolute/path/installation.json \
  --backup /absolute/path/backups/fish-before-change
node scripts/companion-backup.mjs restore --installation /absolute/path/installation.json \
  --backup /absolute/path/backups/fish-before-change \
  --before /absolute/path/backups/fish-current-safety-copy
```

已安装的包以 `dafeiyu-backup` 提供同一条命令（Node 24）：

```sh
dafeiyu-backup create --installation /absolute/path/installation.json \
  --output /absolute/path/backups/fish-before-change
dafeiyu-backup restore --installation /absolute/path/installation.json \
  --backup /absolute/path/backups/fish-before-change \
  --before /absolute/path/backups/fish-current-safety-copy
```

每个输出目录和 `--before` 目录都必须是新的。恢复先核对备份、同一个伙伴/范围/路径和已安装代码的指纹，然后先备份当前数据，再暂存替换内容。要恢复另一个代码版本的数据，先重装对应的插件包。只换包不会回滚另一个版本写入的数据。

只回滚所选原生工作区的记录和日志；无关的工作区、它们更新的会话、归档和置顶状态、全局 profile 设置和账号设置都保持当前值。如果某个原生路径或会话 ID 现在属于无关的工作区，恢复会拒绝，而不是合并。数据路径的覆盖改过时，用 `--bindings` 传一个 JSON 对象，写明实际的 `sessions`、`registry`、`projectionCache`、`attachments`、`channels` 或 `voice` 绝对路径。默认的目录约定对应当前集成的原生 JSONL/JSON provider；换了 provider 就要给它实际支持的绑定，不能猜文件位置。

同机恢复有意连同所选的原生日志快照和 Bank 一起替换，不会留下更新的日志再被悄悄导入旧数据。搬到另一台设备或另一个路径，用 `--resume-repo` 和上文 DSH 的原生导入与冲突处理。隔离的离线夹具覆盖了恢复、无关工作区的保留、损坏/版本/活跃写入者的拒绝、不可变附件冲突、源数据并发变化、Qzone 已发送和不确定状态不重放、微信 WAL 文件组的保留，以及当前投递和花费的保留；它们不能证明主人的恢复验收或真实设备迁移。
