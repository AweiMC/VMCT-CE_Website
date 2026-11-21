# VMCT Community Archive

静态资料站 + 数据同步工具。把上游 Wiki 仓库的内容规范化为一份静态数据集，用 Marathon / Graphic Realism 视觉语言呈现为可离线运行的网页。

## 目录

| 路径 | 说明 |
| --- | --- |
| `site/` | 静态网页。直接部署为静态站点，或本地起任意 HTTP 服务访问 `index.html`。 |
| `scripts/normalize_data.py` | 数据规范化脚本：读取上游仓库 → 产出 `site/data/catalog.*` 并复制所需图片。 |
| `tools/VMCT-Sync/` | Java 17 Swing 同步比对工具（零第三方依赖），独立运行，不嵌入网页。 |

## 网页

线上地址：<https://aweimc.github.io/VMCT-CE_Website/>

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

### 图片占位与后续同步

每条档案在数据里带 `media` 数组，每个槽位记录：

| 字段 | 含义 |
| --- | --- |
| `slot` | 槽位 ID（`cover` / `body-01`…） |
| `role` | `cover`（封面）或 `body`（正文图） |
| `target` | 本地路径（`ready`）或原始图片 URL（`remote`） |
| `source` | 原始图片 URL |
| `state` | `ready`（本地文件）、`remote`（由原站按需提供）、`pending`（无图占位） |
| `w` / `h` | 占位尺寸比例，锁定布局 |

渲染层据此预留固定比例的占位盒：本地图与外链图都直接显示，无图时显示带槽位编号的斜纹骨架。盒子尺寸由 `w/h` 锁定，图片是否加载都不影响布局。

正文远程图**不下载到本地**：只记录尺寸比例与原始 URL（`state: remote`），图片字节由原站按需提供，避免构建时下载整图占用带宽与磁盘。仓库自带的 `/imgs/` 资源属源仓库内容，仍复制到 `site/assets/imgs/`；封面缩略图缓存于 `site/assets/icons/`。

如需跳过封面图标缓存：加 `--no-icons`。

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

## 说明

本站为社区非官方资料整理，数据来自公开仓库；内容版权归各自原作者所有。
