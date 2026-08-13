# Fluorine7 PixInsight Batch Scripts

[English](#english) | [中文](#中文)

> This repository supersedes the former **Rename-By-Fitsheader** repository.

## English

Three batch-processing scripts for **PixInsight 1.9.4 or later** and its V8 JavaScript runtime. All three appear under `Script > Batch Processing`.

| Script | Version | Purpose | License |
|---|---:|---|---|
| Rename By FITS Header | 1.2 | Copy or rename FITS/XISF files with customizable header keyword templates | MIT |
| Expand Integration | 1.3 | Perform sliding-window ImageIntegration for time-series data | MIT |
| Batch Image Keyword Editor | 4.0 | Add, edit, or remove FITS-compatible keywords in FITS/XISF files | GPL-3.0-only |

### Update repository installation

1. Open `Resources > Updates > Manage Repositories` in PixInsight.
2. Add this repository URL:

   ```text
   https://raw.githubusercontent.com/Fluorine7/Fluorine7-PixInsight-Scripts/main/
   ```

3. Open `Resources > Updates > Check for Updates` and install **Fluorine7 PixInsight Batch Scripts**.
4. Restart PixInsight if requested.

Until the repository has a valid Certified PixInsight Developer signature, PixInsight may warn that its authenticity cannot be verified. Review the source and package before accepting an unsigned update.

### Manual installation

Download the current package archive from this repository, extract it, then use `Script > Feature Scripts... > Add` and select its `src/scripts/Fluorine7` directory.

### Rename By FITS Header

- Templates such as `{OBJECT}_{FILTER}_{timestamp}`
- FITS, FIT, FTS, and XISF input
- First-file preview and non-destructive preview of all files
- Copy mode by default; optional move/delete-original mode with confirmation
- Collision-safe sequential names
- Optional millisecond timestamps and output directory

Changing the forced suffix only changes the filename. It does **not** convert the image format.

### Expand Integration

- Sliding window size and step
- Configurable ImageIntegration combination, normalization, rejection, and range clipping
- Optional LocalNormalization files
- Multiple ImageIntegration weighting modes
- Observation-time metadata written to generated integrations

### Batch Image Keyword Editor

Based on `BatchFITSKeywordEdit` by Mike Cranfield and substantially reworked by Fluorine Zhu. It remains GPL-3.0-only and preserves original attribution.

- FITS/XISF metadata validation
- Add, edit, and remove keyword operations
- Reference keyword copying and manual fallback
- Output conflict planning and transactional replacement

### Licensing

This is a multi-license repository:

- `Rename By FITS Header` and `Expand Integration`: [MIT](LICENSES/MIT.txt)
- `Batch Image Keyword Editor`: [GPL-3.0-only](LICENSES/GPL-3.0-only.txt)

See each source file's copyright and SPDX notice. The GPL script is not relicensed under MIT.

### Source and issue tracker

- Repository: <https://github.com/Fluorine7/Fluorine7-PixInsight-Scripts>
- Issues: <https://github.com/Fluorine7/Fluorine7-PixInsight-Scripts/issues>

---

## 中文

这是面向 **PixInsight 1.9.4 或更高版本**、使用 V8 JavaScript 运行时的批处理脚本合集。三个脚本均位于 `Script > Batch Processing`。

| 脚本 | 版本 | 用途 | 许可证 |
|---|---:|---|---|
| Rename By FITS Header | 1.2 | 根据 FITS/XISF 头关键字模板复制或重命名文件 | MIT |
| Expand Integration | 1.3 | 对时间序列图像执行滑动窗口叠加 | MIT |
| Batch Image Keyword Editor | 4.0 | 批量添加、编辑或删除 FITS 兼容关键字 | GPL-3.0-only |

### 通过更新仓库安装

1. 在 PixInsight 中打开 `Resources > Updates > Manage Repositories`。
2. 添加：

   ```text
   https://raw.githubusercontent.com/Fluorine7/Fluorine7-PixInsight-Scripts/main/
   ```

3. 打开 `Resources > Updates > Check for Updates`，安装 **Fluorine7 PixInsight Batch Scripts**。
4. 如有提示，重启 PixInsight。

在仓库取得有效的 Certified PixInsight Developer 签名前，PixInsight 可能提示无法验证仓库真实性。接受未签名更新前，请先检查源码和安装包。

### 手动安装

下载并解压当前安装包，然后打开 `Script > Feature Scripts... > Add`，选择其中的 `src/scripts/Fluorine7` 目录。

### 许可证

本仓库采用多许可证方式：

- `Rename By FITS Header`、`Expand Integration`：[MIT](LICENSES/MIT.txt)
- `Batch Image Keyword Editor`：[GPL-3.0-only](LICENSES/GPL-3.0-only.txt)

Batch Image Keyword Editor 基于 Mike Cranfield 的 GPLv3 项目修改，已保留原作者署名和 GPLv3 条款，不能按 MIT 重新授权。

### 源码与问题反馈

- 仓库：<https://github.com/Fluorine7/Fluorine7-PixInsight-Scripts>
- Issues：<https://github.com/Fluorine7/Fluorine7-PixInsight-Scripts/issues>
