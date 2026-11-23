# Install and update

Her World is published as npm package `her-world`. Source, version tags and the
same checked runtime archives remain at <https://github.com/hyyino7/her-world>.
No custom plugin index, compiler or install hooks are required.

## DSH installation and updates

- New installation: **Plugins → Add plugin**, enter `her-world`, install
  and enable.
- Existing npm installation: open **Her World → Versions**, check versions,
  click **Update** for the desired version. Normal stable updates do not need
  the prerelease filter.
- Existing GitHub installation: switch once through DSH's native manager.
  Disable and remove the GitHub-installed Her World program package, then add
  `her-world`. Preserve the bound workspace and private Core overrides;
  do not delete companion data. Subsequent updates use the version list above.

DSH owns installed-source records, package replacement, activation and rollback.
Restart only when DSH requests it. The owner performs installation and updates.
Do not enable the old `dsh-Chatpet` and Her World bundles together.

pnpm may delay new npm packages for 24 hours. An owner-approved
`minimumReleaseAgeExclude: [her-world]` entry in the native profile's existing
`pnpm-workspace.yaml` permits immediate updates of this package only; keep any
other existing exclusions.

## Publication

在 GitHub **Actions → Publish Her World → Run workflow** 选择 `main`，填入新的完整版本号。发布入口见 `.github/workflows/release.yml:1–11`，发布门禁见[开发说明](development.md#全量验证与发布)。

For clean, committed source, dispatch the workflow directly. If the working
tree contains unrelated changes, isolate only the intended patch against the
current remote `main` before committing it. Do not publish the whole dirty tree,
reset it or discard somebody else's work to prepare a release.

工作流写入版本和来源元数据，经门禁后冻结提交与标签，把检过的归档发布到 npm。在推进 `main` 或创建 GitHub Release 前，核对 npm 元数据里的 SHA-512 与普通安装地址下载的归档都匹配。缓存中的 404、限流和短时网络故障最多重试 20 分钟，完整性或版本冲突立即失败（`.github/workflows/release.yml:35–109`、`scripts/lib/npm-publication.mjs:10–58`）。

npm uses GitHub trusted publishing bound to `hyyino7/her-world` and `release.yml`.
No npm token is stored in the repository or Actions secrets. Prereleases use
`next`; stable releases use `latest`. Existing tags and package versions are not
overwritten. **Re-run failed jobs** resumes the same frozen source/version after
a processing or download timeout; choose a new version for different source.
The frozen tag retains recovery history without another release branch per
version. Publication never installs the local plugin or edits companion data.
