# Rename By FITS Header

[English](#english) | [中文](#中文)

---

## English

A PixInsight PJSR script for batch renaming FITS/XISF astronomy images based on FITS header keywords with customizable filename templates.

### Features

- **Flexible Template System**: Create custom filename patterns using FITS header keywords
- **Batch Processing**: Rename multiple files at once
- **Safe Operations**: 
  - Dry-run mode for preview before actual renaming
  - Copy mode (keep originals) or Move mode (rename in place)
  - Automatic duplicate handling with sequential numbering
- **Wide Format Support**: Works with FITS (.fits, .fit, .fts) and XISF (.xisf) files
- **Rich Keyword Support**: Object name, filter, exposure time, temperature, timestamps, and more
- **User-Friendly GUI**: Easy-to-use dialog with real-time preview

###  Requirements

- PixInsight 1.8.9-2 or later
- FITS or XISF image files with standard headers

### 🚀 Installation

1. Download `RenameByHeaderOnDisk.js` from this repository
2. In PixInsight, go to `Script` → `Feature Scripts...`
3. Click `Add` and select the downloaded script file
4. The script will appear in your Scripts menu

### 📖 Usage

1. Launch the script from `Script` → `Rename By FITS Header`
2. Click `Add Files` to select your FITS/XISF images
3. Customize the filename template using available keywords
4. Preview the result in real-time
5. Choose operation mode:
   - **Dry-run**: Preview only, no files modified
   - **Copy mode** (default): Create renamed copies, keep originals
   - **Move mode**: Rename files in place, delete originals
6. Click `Execute` to process files

### 🏷️ Supported Keywords

| Keyword | Description | Example Output |
|---------|-------------|----------------|
| `{OBJECT}` | Target object name | M31, NGC7000 |
| `{FILTER}` | Filter name (uppercase) | HA, OIII, L, R |
| `{IMAGETYP}` | Image type | LIGHT, DARK, FLAT |
| `{EXPOSURE}` | Exposure time in seconds | 300, 120 |
| `{EXPTIME}` | Same as EXPOSURE | 300 |
| `{GAIN}` | Camera gain setting | 100, 139 |
| `{OFFSET}` | Camera offset setting | 10, 50 |
| `{CCD-TEMP}` | CCD temperature | 10C, 20C |
| `{XBINNING}` | X-axis binning | 1, 2 |
| `{YBINNING}` | Y-axis binning | 1, 2 |
| `{INSTRUME}` | Camera/instrument name | ASI2600MM |
| `{TELESCOP}` | Telescope name | FSQ106 |
| `{timestamp}` | Full UTC timestamp | 20250106203045 |
| `{date}` | Date only | 20250106 |
| `{time}` | Time only | 203045 |
| `{DATE-OBS}` | Observation date/time | 20250106203045 |
| `{DATE-LOC}` | Local date/time | 20250106203045 |

### 📝 Template Examples

**Default Template:**
```
{OBJECT}_{FILTER}_{timestamp}
```
Output: `M31_HA_20250106203045.fits`

**Simple Template:**
```
{OBJECT}_{FILTER}_{EXPOSURE}s
```
Output: `NGC7000_OIII_300s.fits`

**Detailed Template:**
```
{date}_{OBJECT}_{FILTER}_{EXPOSURE}s_{GAIN}g_{CCD-TEMP}
```
Output: `20250106_M31_HA_300s_100g_10C.fits`

**Calibration Files:**
```
{IMAGETYP}_{FILTER}_{CCD-TEMP}_{EXPOSURE}s
```
Output: `DARK_L_10C_300s.fits`

### ⚙️ Options

- **Template**: Custom filename pattern using keywords
- **Force Extension**: Override file extension (e.g., `xisf` or `fits`)
- **Dry-run**: Preview renaming without modifying files
- **Move Mode**: When enabled, deletes original files after renaming (use with caution!)

### ⚠️ Important Notes

1. **Always test with dry-run first** to verify the naming pattern
2. **Move mode is destructive** - original files will be deleted
3. **Duplicate names** are automatically handled with `_01`, `_02` suffixes
4. **Invalid characters** in filenames are replaced with underscores
5. **Backup your data** before using move mode

### 🐛 Troubleshooting

**Preview shows "Error"**
- Check if files have valid FITS headers
- Verify template syntax is correct

**Files not renamed**
- Ensure dry-run mode is disabled
- Check file permissions in the directory

**Missing keyword values**
- Script will use "NA", "0", or "UNTITLED" as fallbacks
- Verify your FITS headers contain the required keywords

### 📄 License

Copyright © 2025 Fluorine Zhu (正七价的氟离子)

MIT License - see LICENSE file for details

### 🤝 Contributing

Issues and pull requests are welcome! Feel free to:
- Report bugs
- Suggest new features
- Improve documentation
- Add support for more FITS keywords

### 📧 Contact

Author: Fluorine Zhu (正七价的氟离子)

---

## 中文

一个用于批量重命名 FITS/XISF 天文图像的 PixInsight PJSR 脚本，支持基于 FITS 头关键字的自定义文件名模板。

### ✨ 功能特性

- **灵活的模板系统**：使用 FITS 头关键字创建自定义文件名格式
- **批量处理**：一次性重命名多个文件
- **安全操作**：
  - 预览模式（dry-run），执行前查看结果
  - 复制模式（保留原文件）或移动模式（就地重命名）
  - 自动处理重复文件名，添加序号
- **广泛的格式支持**：支持 FITS (.fits, .fit, .fts) 和 XISF (.xisf) 文件
- **丰富的关键字支持**：目标名称、滤镜、曝光时间、温度、时间戳等
- **友好的图形界面**：易用的对话框，实时预览重命名结果

### 📋 系统要求

- PixInsight 1.8.9-2 或更高版本
- 带有标准头信息的 FITS 或 XISF 图像文件

### 🚀 安装方法

1. 从本仓库下载 `RenameByHeaderOnDisk.js` 文件
2. 在 PixInsight 中，进入 `Script` → `Feature Scripts...`
3. 点击 `Add` 并选择下载的脚本文件
4. 脚本将出现在 Scripts 菜单中

### 📖 使用说明

1. 从 `Script` → `Rename By FITS Header` 启动脚本
2. 点击 `Add Files` 选择你的 FITS/XISF 图像
3. 使用可用关键字自定义文件名模板
4. 实时预览重命名结果
5. 选择操作模式：
   - **Dry-run（预览模式）**：仅预览，不修改文件
   - **Copy mode（复制模式，默认）**：创建重命名副本，保留原文件
   - **Move mode（移动模式）**：就地重命名，删除原文件
6. 点击 `Execute` 执行处理

### 🏷️ 支持的关键字

| 关键字 | 说明 | 输出示例 |
|--------|------|----------|
| `{OBJECT}` | 目标天体名称 | M31, NGC7000 |
| `{FILTER}` | 滤镜名称（大写） | HA, OIII, L, R |
| `{IMAGETYP}` | 图像类型 | LIGHT, DARK, FLAT |
| `{EXPOSURE}` | 曝光时间（秒） | 300, 120 |
| `{EXPTIME}` | 同 EXPOSURE | 300 |
| `{GAIN}` | 相机增益 | 100, 139 |
| `{OFFSET}` | 相机偏置 | 10, 50 |
| `{CCD-TEMP}` | CCD 温度 | 10C, 20C |
| `{XBINNING}` | X 轴合并 | 1, 2 |
| `{YBINNING}` | Y 轴合并 | 1, 2 |
| `{INSTRUME}` | 相机/设备名称 | ASI2600MM |
| `{TELESCOP}` | 望远镜名称 | FSQ106 |
| `{timestamp}` | 完整 UTC 时间戳 | 20250106203045 |
| `{date}` | 仅日期 | 20250106 |
| `{time}` | 仅时间 | 203045 |
| `{DATE-OBS}` | 观测日期时间 | 20250106203045 |
| `{DATE-LOC}` | 本地日期时间 | 20250106203045 |

### 📝 模板示例

**默认模板：**
```
{OBJECT}_{FILTER}_{timestamp}
```
输出：`M31_HA_20250106203045.fits`

**简单模板：**
```
{OBJECT}_{FILTER}_{EXPOSURE}s
```
输出：`NGC7000_OIII_300s.fits`

**详细模板：**
```
{date}_{OBJECT}_{FILTER}_{EXPOSURE}s_{GAIN}g_{CCD-TEMP}
```
输出：`20250106_M31_HA_300s_100g_10C.fits`

**校准文件：**
```
{IMAGETYP}_{FILTER}_{CCD-TEMP}_{EXPOSURE}s
```
输出：`DARK_L_10C_300s.fits`

### ⚙️ 选项说明

- **Template（模板）**：使用关键字的自定义文件名格式
- **Force Extension（强制扩展名）**：覆盖文件扩展名（如 `xisf` 或 `fits`）
- **Dry-run（预览模式）**：预览重命名而不修改文件
- **Move Mode（移动模式）**：启用后将删除原文件（谨慎使用！）

### ⚠️ 重要提示

1. **始终先使用预览模式测试**以验证命名格式
2. **移动模式会删除原文件** - 操作不可逆
3. **重复文件名**会自动添加 `_01`、`_02` 等后缀
4. **文件名中的非法字符**会被替换为下划线
5. **使用移动模式前请备份数据**

### 🐛 故障排除

**预览显示"Error"**
- 检查文件是否有有效的 FITS 头
- 验证模板语法是否正确

**文件未被重命名**
- 确保已禁用预览模式
- 检查目录的文件权限

**关键字值缺失**
- 脚本会使用 "NA"、"0" 或 "UNTITLED" 作为后备值
- 验证 FITS 头是否包含所需关键字

### 📄 许可证

Copyright © 2025 Fluorine Zhu (正七价的氟离子)

MIT License - 详见 LICENSE 文件

### 🤝 贡献

欢迎提交 Issues 和 Pull Requests！你可以：
- 报告 Bug
- 建议新功能
- 改进文档
- 添加更多 FITS 关键字支持

### 📧 联系方式

作者：正七价的氟离子（Fluorine Zhu）
