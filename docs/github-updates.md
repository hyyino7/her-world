# 安装、更新和发布

Her World 的 npm 包名为 `her-world`。源码、版本标签和通过检查的运行时归档由 [GitHub 仓库](https://github.com/hyyino7/her-world) 提供。插件由 DSH 装载，发行包已含构建产物。

<a id="dsh-installation-and-updates"></a>

## 在 DSH 安装和更新

- **首次安装**：打开 **插件 → 添加插件**，输入 `her-world` 并安装。npm 包不带 Core 配置，这时启用会在 `00-Core` 报 `Invalid companionId`。完全退出 DSH，用 DSH 自带的 Electron 以 Node 模式运行已装包里的 setup，由它把 Core 身份写进 profile：

  ```sh
  ELECTRON_RUN_AS_NODE=1 "/Applications/DeepSeek Harness.app/Contents/MacOS/DeepSeek Harness" \
    ~/.dsh/profiles/desktop/node_modules/her-world/scripts/install-dsh.mjs --apply
  ```

  先不加 `--apply` 可以只预览。重新打开 DSH 后，在设置里绑定伙伴 Repo。参数见[伙伴数据搬家和恢复](portability.md)。
- **更新已有 npm 安装**：打开 **Her World → 版本**，检查版本，选择所需正式版并点 **更新**。DSH 提示重启时再重启。
- **隔离验收与换包**：先用隔离环境激活正式包，走实际功能入口，并从同一版本页换回基线版，核对数据仍可读。支持基线是已迁移的 0.5.0，操作完成后再升级日常机器。历史迁移步骤见 [v0.5.0](https://github.com/hyyino7/her-world/tree/v0.5.0)。
- **搬家和离线修复**：setup 及恢复步骤见[伙伴数据搬家和恢复](portability.md)。

如果 DSH profile 配置了 pnpm 发布年龄限制，主人可在已有的 `pnpm-workspace.yaml` 的 `minimumReleaseAgeExclude` 列表加入 `her-world`，同时保留已有项。

<a id="publication"></a>

## 发布

在 GitHub **Actions → Publish Her World → Run workflow** 选择 `main`，填入完整的新版本号。发布只使用已提交的候选源码。工作区有无关改动时，在独立 worktree 基于远端 `main` 整理待发改动。门禁见[开发说明](development.md#全量验证与发布)。

工作流写入版本和来源元数据，过门禁后冻结提交与标签，再把核对过的归档发布到 npm。推进 `main` 和创建 GitHub Release 前，会比较 npm 元数据的 SHA-512 以及普通安装地址下载的归档。短时的 404、限流和网络失败最多重试 20 分钟，完整性或版本冲突立即失败（`.github/workflows/release.yml`、`scripts/lib/npm-publication.mjs`）。

npm 的可信发布绑定 `hyyino7/her-world` 的 `release.yml`。工作流按版本号把预发布放到 `next`、正式版放到 `latest`。0.6.0 使用一个正式版。发布或下载超时时，在原工作流选择 **Re-run failed jobs**，沿用冻结的源码和版本号。换源码需使用新版本。冻结标签是对应归档的源码记录；安装与伙伴数据由 DSH 和绑定 Repo 管理。
