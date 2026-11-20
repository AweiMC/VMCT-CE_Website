# VMCT Community Archive

静态资料站 + 数据同步工具。把上游 Wiki 仓库的内容规范化为一份静态数据集，用 Marathon / Graphic Realism 视觉语言呈现为可离线运行的网页。

## 目录

| 路径 | 说明 |
| --- | --- |
| `site/` | 静态网页。直接部署为静态站点，或本地起任意 HTTP 服务访问 `index.html`。 |
| `scripts/normalize_data.py` | 数据规范化脚本：读取上游仓库 → 产出 `site/data/catalog.*` 并复制所需图片。 |
| `tools/VMCT-Sync/` | Java 17 Swing 同步比对工具（零第三方依赖），独立运行，不嵌入网页。 |

## 网页

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

## 重新同步数据

需要 Python 3.10+ 与 `pyyaml`、`markdown`：

```bash
pip install pyyaml markdown
```

把上游仓库克隆到本地某目录后：

```bash
python scripts/normalize_data.py --repo <上游仓库目录> --site site
```

脚本只读取上游仓库中 `src/pages` 的内容与 `database/download-seeds.json`，输出的 JSON 仅包含仓库相对路径，不含任何本机绝对路径。

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
