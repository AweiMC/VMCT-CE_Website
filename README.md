# VMCT Community Archive

静态资料站 + 数据同步工具。把上游 Wiki 仓库的内容规范化为一份静态数据集，用 Marathon / Graphic Realism 视觉语言呈现为可离线运行的网页。

## 目录

| 路径 | 说明 |
| --- | --- |
| `site/` | 静态网页。直接部署为静态站点，或本地起任意 HTTP 服务访问 `index.html`。 |
| `scripts/normalize_data.py` | 数据规范化脚本：读取上游仓库 → 产出 `site/data/catalog.*` 并复制所需图片。 |
| `tools/VMCT-Sync/` | Java 17 Swing 同步比对工具（零第三方依赖），独立运行，不嵌入网页。 |

## 网页

线上地址：<https://aweimc.github.io/vmct-ce-site/>

纯静态，无后端。数据写在 `site/data/catalog.js`（`window.VMCT_DATA`），因此可直接以静态文件托管，不暴露服务器本地文件。

特性：

- 暗底 + 单一酸绿强调色、全直角、编辑级排印、程序化 FUI 几何
- 一次性启动序列、马赛克视图转场、点阵背景（均在 `prefers-reduced-motion` 下自动减档）
- 总览 / 整合包 / 地图 / 资料库 / 致谢 / 其他 六个视图
- 按 MC 版本、Modloader（Fabric / Forge / NeoForge / 原版，使用各自 ICON）、状态筛选
- 关键词检索（`/` 聚焦）、列表 / 网格切换、详情页含正文与下载链接

本地预览：

```bash
cd site
python -m http.server 8080
# 浏览器打开 http://localhost:8080
```

### 部署

推送到 `main` 分支即触发 `.github/workflows/deploy.yml`，把 `site/` 作为 GitHub Pages 制品发布（Source 为 GitHub Actions）。首次部署前需在仓库 Settings → Pages 中把 Source 设为 **GitHub Actions**，否则 `configure-pages` 会报 404 导致失败。

## 重新同步数据

需要 Python 3.10+ 与 `pyyaml`、`markdown`、`pillow`：

```bash
pip install pyyaml markdown pillow
```

把上游仓库克隆到本地某目录后：

```bash
python scripts/normalize_data.py --repo <上游仓库目录> --site site
```

脚本会顺带把封面图/正文图转成 WebP 并缩放到界面实际显示尺寸（12 MB 封面 → 约 1.5 MB），
`--no-optimize` 可跳过该步骤。若未安装 pillow，脚本会提示并保留原图。

脚本只读取上游仓库中 `src/pages` 的内容与 `database/download-seeds.json`，输出的 JSON 仅包含仓库相对路径，不含任何本机绝对路径。

### 数据分片（按需加载）

`site/data/catalog.js` 只包含列表所需的数据：条目元信息与 `excerpt`（摘要），约 100 KB（gzip 约 22 KB）。`slug` / `path` / 状态与加载器的显示名 / 日期原始值 / 封面槽位这些都能从 `id`、`kind`、`status`、`loader`、`icon` 推导，不再随数据下发。

- `site/data/bodies/<id>.js`：每篇正文一个文件，只有打开对应详情页时才加载（约 1–2 KB gzip），之后缓存在内存里。
- **检索只匹配元数据**：标题、原名、简介/摘要、作者、加载器/状态/版本，全部已在 `catalog.js` 中，因此不再下发任何全文索引（`data/search/` 仅保留 4 个兼容空桩，供缓存了旧 `app.js` 的客户端避免 404）。
- 顶部搜索框打开的是**检索弹窗**（背景模糊的 Marathon 风格面板）：输入即时排序结果（标题 > 原名 > 简介 > 作者），`↑ ↓` 选择、`↵` 打开、`ESC` 关闭；`/` 或 `Ctrl/Cmd+K` 随时唤起。
- 列表默认每页 24 张卡片，可通过底部分页条切换每页 12 / 24 / 48 / 96 条，选择记在 `localStorage`。
- 封面图统一下载后缩放到 512px 并转成 **AVIF**（动画封面保留为动画 WebP），正文配图转 AVIF（≤1600px）。
- GitHub Pages 只提供 gzip 压缩（不支持 Brotli）。开发者工具的「大小 / Size」列显示的是解压后体积，「传输 / Transferred」列才是真实字节；若显示「已缓存」，说明这次是缓存命中、没有网络传输——勾选面板里的「禁用缓存 / Disable Cache」再刷新即可看到真实压缩体积。

### 图片占位与后续同步

正文图在 HTML 里已经是固定比例的 `figure.img-slot` 占位盒，属性直接记录：

| 属性 | 含义 |
| --- | --- |
| `data-img-slot` | 槽位 ID（`body-01`…） |
| `data-img-state` | `ready`（本地文件）、`remote`（由原站按需提供）、`pending`（无图占位） |
| `data-img-target` | 本地路径（`ready`） |
| `data-img-source` | 原始图片 URL |

封面不再单独下发槽位结构：渲染层由 `icon` 推导（有本地文件即 `ready`，外链即 `remote`，无图为 `pending`）。

渲染层据此预留固定比例的占位盒：本地图与外链图都直接显示，无图时显示带槽位编号的斜纹骨架。盒子尺寸由样式锁定，图片是否加载都不影响布局。

正文远程图**不下载到本地**：只记录尺寸比例与原始 URL（`state: remote`），图片字节由原站按需提供，避免构建时下载整图占用带宽与磁盘。仓库自带的 `/imgs/` 资源属源仓库内容，仍复制到 `site/assets/imgs/`（并转成 AVIF）；封面缓存于 `site/assets/icons/`。

如需跳过封面图标缓存：加 `--no-icons`；跳过图片压缩/转码：加 `--no-optimize`。

## 同步比对工具

位于 `tools/VMCT-Sync/`，Java 17，无 Maven / Gradle 依赖。

编译运行：

```bash
cd tools/VMCT-Sync
javac -encoding UTF-8 -d out src/vmct/sync/*.java
java -Dfile.encoding=UTF-8 -cp out vmct.sync.Main
```

使用：

1. 选择源仓库根目录（含 `src/pages` 的检出目录）
2. 快照文件默认 `snapshot.tsv`，首次同步后生成
3. 可选「同步前 git pull」与 HTTP 代理
4. 点击 `SYNC`：扫描全部 Markdown，按内容指纹与快照比对
5. 面板显示新增 / 更新 / 移除三类差异，可导出 Markdown 报告
6. 「写入快照」把当前结果设为新基线

## 许可证

- 本站自身代码（HTML / CSS / JavaScript、构建与同步脚本）采用 [MIT License](LICENSE)。
- 档案内容（整合包与地图介绍、汉化文本、封面与配图等）版权归各原作者与上游仓库所有；本站仅作静态镜像，不随代码一同再授权。

## 说明

本站为社区非官方资料整理，数据来自公开仓库；内容版权归各自原作者所有。
