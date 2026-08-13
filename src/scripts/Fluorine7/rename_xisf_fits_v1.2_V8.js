/*
 * Rename By FITS Header v1.2
 *
 * Copyright (c) 2025-2026 Fluorine Zhu
 * SPDX-License-Identifier: MIT
 *
 * Ported to PixInsight 1.9.4 V8 with improved file safety.
 * See LICENSES/MIT.txt in the source repository for license terms.
 */

#engine v8

#script-id Fluorine7RenameByFITSHeader
#feature-id Fluorine7RenameByFITSHeader : Batch Processing > Rename By FITS Header
#feature-info Batch copy or rename FITS/XISF images using customizable header keyword templates.<br/>\
Requires PixInsight 1.9.4 or later.<br/>\
Copyright &copy; 2025-2026, Fluorine Zhu.

#define VERSION "1.2"
#define TITLE   "Rename By FITS Header"
#define DEFAULT_TEMPLATE "{OBJECT}_{FILTER}_{timestamp}"

CoreApplication.ensureMinimumVersion( 1, 9, 4 );

// ---------- 工具函数 ----------
function stripQuotes(s){
   if(s==null) return "";
   s=(""+s).trim();
   if(s.length>=2&&s[0]==s[s.length-1]&&(s[0]=="'"||s[0]=='"'))
      return s.substring(1,s.length-1).trim();
   return s;
}

function sanitizeToken(s, toUpper){
   // Preserve Unicode names while removing characters forbidden in file names.
   s = stripQuotes(s).replace(/\s+/g, "_")
                     .replace(/[\\\/:*?"<>|\x00-\x1F]/g, "")
                     .replace(/[. ]+$/g, "");
   return toUpper ? s.toUpperCase() : s;
}

function nonemptyToken(value, fallback, toUpper){
   var token = sanitizeToken(value, toUpper);
   return token.length > 0 ? token : fallback;
}

function parseHeaderDateTime(dtStr){
   var s = stripQuotes(dtStr);
   return s.match(/^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2}):(\d{2})(?:\.(\d+))?/);
}

function millisecondsText(fraction){
   var ms = fraction || "";
   while (ms.length < 3) ms += "0";
   return ms.substring(0, 3);
}

function formatUTC(dtStr, useMilliseconds){
   var m = parseHeaderDateTime(dtStr);
   if (!m) return useMilliseconds ? "00000000000000000" : "00000000000000";
   var result = m[1]+m[2]+m[3]+m[4]+m[5]+m[6];
   return useMilliseconds ? result + millisecondsText(m[7]) : result;
}

function formatDate(dtStr){
   var s = stripQuotes(dtStr);
   var m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
   return m ? (m[1]+m[2]+m[3]) : "00000000";
}

function formatTime(dtStr, useMilliseconds){
   var m = parseHeaderDateTime(dtStr);
   if (!m) return useMilliseconds ? "000000000" : "000000";
   var result = m[4]+m[5]+m[6];
   return useMilliseconds ? result + millisecondsText(m[7]) : result;
}

// CCD温度格式化：去掉负号，四舍五入，添加C
function formatCCDTemp(tempStr){
   if(!tempStr) return "NA";
   var temp = parseFloat(stripQuotes(tempStr));
   if(isNaN(temp)) return "NA";
   var absTemp = Math.abs(temp);
   var rounded = Math.round(absTemp);
   return rounded + "C";
}

function ensureUniquePath(path, reservedPaths){
   if (!File.exists(path) && !reservedPaths[path]) return path;

   var ext = File.extractExtension(path);
   var nameWithoutExt = File.extractName(path);
   var dir = File.extractDrive(path) + File.extractDirectory(path);
   if (!dir.endsWith('/')) dir += '/';

   var i = 1;
   var candidate;
   do {
      candidate = dir + nameWithoutExt + '_' + ("000" + i).slice(-3) + ext;
      ++i;
   } while (File.exists(candidate) || reservedPaths[candidate]);
   return candidate;
}

function pick(obj, names){
   for (var i=0;i<names.length;++i){
      var v=obj[names[i]];
      if(v!=null && (""+v).length) return v;
   }
   return null;
}

// Use the native buffered copy implementation. This avoids loading an entire
// astronomical image into the V8 heap and provides proper I/O error handling.
function safeCopyFile(src, dst){
   if (File.exists(dst))
      throw new Error("Target file already exists: " + dst);
   File.copyFile(dst, src);
}

function readHeaderFromFile(filePath) {
   var ext = File.extractExtension(filePath);

   if (ext.length === 0) {
      throw new Error("File has no extension: " + filePath);
   }

   var ff = new FileFormat(ext, true/*toRead*/, false/*toWrite*/);
   if (ff.isNull) {
      throw new Error("Unsupported format or no reader available for '" + ext + "' files.");
   }

   var fi = new FileFormatInstance(ff);
   if (fi.isNull) {
      throw new Error("Unable to instantiate file format for: " + ff.name);
   }

   var imgDesc = fi.open(filePath);
   if (imgDesc === null)
      throw new Error("I/O error while opening file: " + filePath);
   if (imgDesc.length < 1) {
      fi.close();
      throw new Error("File contains no readable images: " + filePath);
   }

   try {
      var keywords = {};
      var fitsKeywords = fi.keywords;
      for (var i = 0; i < fitsKeywords.length; ++i) {
         var k = fitsKeywords[i];
         // FITS keyword names are case-insensitive.
         keywords[String(k.name).toUpperCase()] = stripQuotes(k.strippedValue);
      }
      return keywords;
   } finally {
      fi.close();
   }
}

// 解析模板生成文件名
function parseTemplate(template, kw, useMilliseconds){
   if(!template || template.length === 0) {
      template = DEFAULT_TEMPLATE;
   }

   var result = template;

   // 替换所有关键字
   var replacements = {
      '{OBJECT}': function(){ return nonemptyToken(kw.OBJECT || kw.OBJNAME || kw.TARGET || "UNTITLED", "UNTITLED", false); },
      '{FILTER}': function(){ return nonemptyToken(pick(kw, ["FILTER","FILTER1","FILTER2","FILTNAM","FILTNAM1"]) || "NA", "NA", true); },
      '{IMAGETYP}': function(){ return nonemptyToken(kw.IMAGETYP || kw.IMAGETYPE || "NA", "NA", true); },
      '{EXPOSURE}': function(){ return kw.EXPOSURE || kw.EXPTIME || "0"; },
      '{EXPTIME}': function(){ return kw.EXPTIME || kw.EXPOSURE || "0"; },
      '{GAIN}': function(){ return kw.GAIN || "0"; },
      '{OFFSET}': function(){ return kw.OFFSET || "0"; },
      '{XBINNING}': function(){ return kw.XBINNING || "1"; },
      '{YBINNING}': function(){ return kw.YBINNING || "1"; },
      '{CCD-TEMP}': function(){ return formatCCDTemp(kw["CCD-TEMP"]); },
      '{INSTRUME}': function(){ return nonemptyToken(kw.INSTRUME || "NA", "NA", false); },
      '{TELESCOP}': function(){ return nonemptyToken(kw.TELESCOP || "NA", "NA", false); },
      '{timestamp}': function(){
         var t = pick(kw, ["DATE-OBS","DATE-AVG","DATE_AVG","DATE-LOC","DATE_LOC"]);
         return t ? formatUTC(t, useMilliseconds) : (useMilliseconds ? "00000000000000000" : "00000000000000");
      },
      '{date}': function(){
         var t = pick(kw, ["DATE-OBS","DATE-AVG","DATE_AVG","DATE-LOC","DATE_LOC"]);
         return t ? formatDate(t) : "00000000";
      },
      '{time}': function(){
         var t = pick(kw, ["DATE-OBS","DATE-AVG","DATE_AVG","DATE-LOC","DATE_LOC"]);
         return t ? formatTime(t, useMilliseconds) : (useMilliseconds ? "000000000" : "000000");
      },
      '{DATE-OBS}': function(){ return kw["DATE-OBS"] ? formatUTC(kw["DATE-OBS"], useMilliseconds) : (useMilliseconds ? "00000000000000000" : "00000000000000"); },
      '{DATE-LOC}': function(){ return kw["DATE-LOC"] ? formatUTC(kw["DATE-LOC"], useMilliseconds) : (useMilliseconds ? "00000000000000000" : "00000000000000"); }
   };

   for (var placeholder in replacements) {
      if (result.indexOf(placeholder) >= 0) {
         result = result.replace(new RegExp(placeholder.replace(/[{}]/g, '\\$&'), 'g'), replacements[placeholder]());
      }
   }

   // Clean invalid/control characters and Windows-incompatible trailing dots.
   result = result.replace(/[\/\\:*?"<>|\x00-\x1F]/g, '_')
                  .replace(/[. ]+$/g, "");
   return result.length > 0 ? result : "UNTITLED";
}

function buildNewName(filePath, template, useMilliseconds, outputDirectory){
   var kw = readHeaderFromFile(filePath);
   var newName = parseTemplate(template, kw, useMilliseconds);

   var ext = File.extractExtension(filePath);
   var dir = outputDirectory ? outputDirectory.trim() : "";
   if (dir.length === 0)
      dir = File.extractDrive(filePath) + File.extractDirectory(filePath);
   if (!dir.endsWith('/')) dir += '/';

   return {
      kw: kw,
      srcPath: filePath,
      newPath: dir + newName + ext
   };
}

function normalizeForcedSuffix(text){
   var suffix = text.trim();
   if (suffix.length === 0) return "";
   if (suffix.charAt(0) !== '.') suffix = "." + suffix;
   if (!/^\.[0-9A-Za-z]+$/.test(suffix))
      throw new Error("The forced suffix is invalid. Use letters and digits only.");
   return suffix.toLowerCase();
}

function applyForcedSuffix(path, suffix){
   if (suffix.length === 0) return path;
   var dir = File.extractDrive(path) + File.extractDirectory(path);
   if (!dir.endsWith('/')) dir += '/';
   return dir + File.extractName(path) + suffix;
}

// ---------- 重命名引擎 ----------
var RenameEngine = class
{
run(files, params)
{
   console.show();
   console.abortEnabled = true;
   console.noteln("================================================================");
   console.noteln(format("Files to process: %d   Dry-run: %s   Mode: %s",
      files.length, params.dryRun.toString(), params.moveMode ? "Move (delete original)" : "Copy (keep original)"));
   console.noteln("Template: " + (params.template || DEFAULT_TEMPLATE));
   console.noteln("Millisecond precision: " + (params.useMilliseconds ? "Yes" : "No"));
   console.noteln("Output directory: " + (params.outputDirectory.length > 0 ? params.outputDirectory : "Original file directories"));
   if (params.forceExt) {
      console.noteln("Forced suffix: " + params.forceExt);
      console.warningln("** The forced suffix does not convert the image file format.");
   }

   if (params.dryRun && params.moveMode)
      throw new Error("Dry-run and Delete Original File cannot be enabled together.");
   // A dry-run must not modify the filesystem, including directory creation.
   if (!params.dryRun && params.outputDirectory.length > 0 &&
       !File.directoryExists(params.outputDirectory))
      File.createDirectory(params.outputDirectory, true);

   var ok = 0, err = 0, skipped = 0;
   var reservedPaths = Object.create(null);

   for (var i = 0; i < files.length; ++i) {
      if (console.abortRequested) {
         console.warningln("**** Aborted by user.");
         break;
      }

      var src = files[i];
      console.writeln(format("[%d/%d] %s", i + 1, files.length, File.extractNameAndSuffix(src)));

      try {
         if (!File.exists(src))
            throw new Error("Source file no longer exists: " + src);

         var r = buildNewName(src, params.template, params.useMilliseconds,
                              params.outputDirectory);
         r.newPath = applyForcedSuffix(r.newPath, params.forceExt);

         // If the generated path is the source itself, do not add a numeric
         // suffix and accidentally turn a no-op into a duplicate file.
         if (src === r.newPath) {
            console.writeln("   -> ", File.extractNameAndSuffix(r.newPath));
            console.noteln("   ⊙ Skipped (same name)");
            ++skipped;
            continue;
         }

         var target = ensureUniquePath(r.newPath, reservedPaths);
         reservedPaths[target] = true;
         console.writeln("   -> ", File.extractNameAndSuffix(target));
         if (target !== r.newPath)
            console.noteln("   ! Name collision; using: ", File.extractNameAndSuffix(target));

         if (params.dryRun) {
            console.noteln("   ○ Planned only");
         } else if (params.moveMode) {
            // moveFile() also supports a selected output directory located on
            // a different physical device. Parameter order is target, source.
            File.moveFile(target, src);
            console.noteln("   ✓ Moved/renamed (original deleted)");
         } else {
            safeCopyFile(src, target);
            console.noteln("   ✓ Copied (original kept)");
         }
         ++ok;
      } catch (e) {
         console.warningln("   ✗ FAILED: ", e.toString());
         ++err;
      } finally {
         // V8 garbage collection cannot be forced. Yield to PixInsight so the
         // Abort button and user interface remain responsive.
         processEvents();
      }
   }

   console.abortEnabled = false;
   console.noteln("----------------------------------------------------------------");
   console.noteln(format("Done: %d ok, %d errors, %d skipped%s",
      ok, err, skipped, params.dryRun ? "  (dry-run)" : ""));
   console.noteln("================================================================");
}
};

// ---------- 对话框 ----------
var MainDialog = class extends Dialog
{
constructor()
{
   super();
   var self = this;

   this.fileList = [];

   this.windowTitle = TITLE + " v" + VERSION;

   this.helpLabel = new Label(this);
   this.helpLabel.frameStyle = FrameStyle.Box;
   this.helpLabel.margin = 4;
   this.helpLabel.wordWrapping = true;
   this.helpLabel.useRichText = true;
   this.helpLabel.text = "<b>" + TITLE + "</b>"
           + "<p>Customize filename using template with keywords like {OBJECT}, {FILTER}, {timestamp}, etc.</p>"
           + "<p><i>Default: {OBJECT}_{FILTER}_{timestamp}</i></p>";

   this.filesTreeBox = new TreeBox(this);
   this.filesTreeBox.multipleSelection = true;
   this.filesTreeBox.rootDecoration = false;
   this.filesTreeBox.alternateRowColor = true;
   this.filesTreeBox.setScaledMinSize(900, 300);
   this.filesTreeBox.numberOfColumns = 2;
   this.filesTreeBox.headerVisible = true;
   this.filesTreeBox.setHeaderText(0, "Source File");
   this.filesTreeBox.setHeaderText(1, "Preview: New File Name");
   this.filesTreeBox.setColumnWidth(0, this.filesTreeBox.logicalPixelsToPhysical(440));
   this.filesTreeBox.setColumnWidth(1, this.filesTreeBox.logicalPixelsToPhysical(440));
   this.filesTreeBox.onResize = function(width){
      // Keep source and preview columns at an equal 50/50 split. Reserve a
      // small area for the frame and vertical scrollbar to avoid horizontal
      // scrolling caused solely by the column widths.
      var available = Math.max(2, width - this.logicalPixelsToPhysical(24));
      var half = Math.floor(available/2);
      this.setColumnWidth(0, half);
      this.setColumnWidth(1, available - half);
   };

   this.addFilesButton = new PushButton(this);
   this.addFilesButton.text = "Add Files";
   this.addFilesButton.icon = this.scaledResource(":/icons/add.png");
   this.addFilesButton.onClick = function() {
      var ofd = new OpenFileDialog;
      ofd.multipleSelections = true;
      ofd.caption = "Select FITS/XISF Images";
      ofd.filters = [ ["Image Files", "*.xisf", "*.fits", "*.fit", "*.fts"], ["All Files", "*"] ];
      if (ofd.execute()) {
         self.filesTreeBox.canUpdate = false;
         for (var i = 0; i < ofd.filePaths.length; ++i) {
            if (self.fileList.indexOf(ofd.filePaths[i]) < 0) {
               var node = new TreeBoxNode(self.filesTreeBox);
               node.setText(0, ofd.filePaths[i]);
               node.setText(1, "");
               self.fileList.push(ofd.filePaths[i]);
            }
         }
         self.filesTreeBox.canUpdate = true;
         self.updatePreview();
      }
   };

   this.removeFilesButton = new PushButton(this);
   this.removeFilesButton.text = "Remove Selected";
   this.removeFilesButton.icon = this.scaledResource(":/icons/delete.png");
   this.removeFilesButton.onClick = function() {
      var newFiles = [];
      for (var i = 0; i < self.filesTreeBox.numberOfChildren; ++i) {
         if (!self.filesTreeBox.child(i).selected) newFiles.push(self.filesTreeBox.child(i).text(0));
      }
      self.fileList = newFiles;
      for (var i = self.filesTreeBox.numberOfChildren; --i >= 0;) {
         if (self.filesTreeBox.child(i).selected) self.filesTreeBox.remove(i);
      }
      self.updatePreview();
   };

   this.clearFilesButton = new PushButton(this);
   this.clearFilesButton.text = "Clear";
   this.clearFilesButton.icon = this.scaledResource(":/icons/clear.png");
   this.clearFilesButton.onClick = function() {
      self.filesTreeBox.clear();
      self.fileList = [];
      self.updatePreview();
   };

   this.filesButtonSizer = new HorizontalSizer;
   this.filesButtonSizer.spacing = 4;
   this.filesButtonSizer.add(this.addFilesButton);
   this.filesButtonSizer.addStretch();
   this.filesButtonSizer.add(this.removeFilesButton);
   this.filesButtonSizer.add(this.clearFilesButton);

   this.filesGroupBox = new GroupBox(this);
   this.filesGroupBox.title = "Input Files";
   this.filesGroupBox.sizer = new VerticalSizer;
   this.filesGroupBox.sizer.margin = 6;
   this.filesGroupBox.sizer.spacing = 4;
   this.filesGroupBox.sizer.add(this.filesTreeBox, 100);
   this.filesGroupBox.sizer.add(this.filesButtonSizer);

   var labelWidth = this.font.width("Output Directory: ") + 4;

   // 输出目录；留空时每个文件输出到其原目录。
   this.outputDirLabel = new Label(this);
   this.outputDirLabel.text = "Output Directory:";
   this.outputDirLabel.minWidth = labelWidth;
   this.outputDirLabel.textAlignment = TextAlignment.Right|TextAlignment.VertCenter;

   this.outputDirEdit = new Edit(this);
   this.outputDirEdit.toolTip = "Optional. Leave empty to use each source file's original directory.";
   this.outputDirEdit.onEditCompleted = function(){ self.updatePreview(); };

   this.outputDirButton = new ToolButton(this);
   this.outputDirButton.icon = this.scaledResource(":/browser/select-file.png");
   this.outputDirButton.toolTip = "Select output directory";
   this.outputDirButton.onClick = function(){
      var gdd = new GetDirectoryDialog;
      gdd.caption = "Select Output Directory";
      if (gdd.execute()) {
         self.outputDirEdit.text = gdd.directoryPath;
         self.updatePreview();
      }
   };

   this.outputDirSizer = new HorizontalSizer;
   this.outputDirSizer.spacing = 4;
   this.outputDirSizer.add(this.outputDirLabel);
   this.outputDirSizer.add(this.outputDirEdit, 100);
   this.outputDirSizer.add(this.outputDirButton);

   // 模板输入区域
   this.templateLabel = new Label(this);
   this.templateLabel.text = "Template:";
   this.templateLabel.minWidth = labelWidth;
   this.templateLabel.textAlignment = TextAlignment.Right|TextAlignment.VertCenter;

   this.templateEdit = new Edit(this);
   this.templateEdit.text = DEFAULT_TEMPLATE;
   this.templateEdit.toolTip = "Filename template. Use Insert button to add keywords.";
   this.templateEdit.onEditCompleted = function() {
      self.updatePreview();
   };

   // 关键字选择下拉框
   this.keywordCombo = new ComboBox(this);
   this.keywordCombo.addItem("-- Insert Keyword --");
   this.keywordCombo.addItem("{OBJECT}");
   this.keywordCombo.addItem("{FILTER}");
   this.keywordCombo.addItem("{IMAGETYP}");
   this.keywordCombo.addItem("{EXPOSURE}");
   this.keywordCombo.addItem("{EXPTIME}");
   this.keywordCombo.addItem("{GAIN}");
   this.keywordCombo.addItem("{OFFSET}");
   this.keywordCombo.addItem("{CCD-TEMP}");
   this.keywordCombo.addItem("{XBINNING}");
   this.keywordCombo.addItem("{YBINNING}");
   this.keywordCombo.addItem("{INSTRUME}");
   this.keywordCombo.addItem("{TELESCOP}");
   this.keywordCombo.addItem("{timestamp}");
   this.keywordCombo.addItem("{date}");
   this.keywordCombo.addItem("{time}");
   this.keywordCombo.addItem("{DATE-OBS}");
   this.keywordCombo.addItem("{DATE-LOC}");
   this.keywordCombo.currentItem = 0;
   this.keywordCombo.toolTip = "Select a keyword to insert into template";
   this.keywordCombo.onItemSelected = function(index) {
      if (index > 0) {
         var keyword = this.itemText(index);
         var text = self.templateEdit.text;
         var start = self.templateEdit.selectionStart;
         var end = self.templateEdit.selectionEnd;
         if (start < 0 || start > text.length) start = text.length;
         if (end < start || end > text.length) end = start;

         // Insert at the caret, replacing the current selection if present.
         self.templateEdit.text = text.substring(0, start) + keyword + text.substring(end);
         var caret = start + keyword.length;
         self.templateEdit.selectionStart = caret;
         self.templateEdit.selectionEnd = caret;
         self.templateEdit.setFocus();
         self.updatePreview();
         this.currentItem = 0;
      }
   };

   this.templateSizer = new HorizontalSizer;
   this.templateSizer.spacing = 4;
   this.templateSizer.add(this.templateLabel);
   this.templateSizer.add(this.templateEdit, 100);
   this.templateSizer.add(this.keywordCombo);

   // 预览区域
   this.previewLabel = new Label(this);
   this.previewLabel.text = "Preview:";
   this.previewLabel.minWidth = labelWidth;
   this.previewLabel.textAlignment = TextAlignment.Right|TextAlignment.VertCenter;

   this.previewEdit = new Edit(this);
   this.previewEdit.readOnly = true;
   this.previewEdit.text = "(Add files to see preview)";
   this.previewEdit.toolTip = "Preview of first file's new name";

   this.previewSizer = new HorizontalSizer;
   this.previewSizer.spacing = 4;
   this.previewSizer.add(this.previewLabel);
   this.previewSizer.add(this.previewEdit, 100);

   // 其他选项
   this.extLabel = new Label(this);
   this.extLabel.text = "Force Suffix:";
   this.extLabel.minWidth = labelWidth;
   this.extLabel.textAlignment = TextAlignment.Right|TextAlignment.VertCenter;
   this.extEdit = new Edit(this);
   this.extEdit.toolTip = "Changes the filename suffix only; it does not convert the image format. " +
                          "For example: xisf or fits. Leave empty to keep the original suffix.";
   this.extEdit.onEditCompleted = function(){ self.updatePreview(); };
   this.extSizer = new HorizontalSizer;
   this.extSizer.spacing = 4;
   this.extSizer.add(this.extLabel);
   this.extSizer.add(this.extEdit, 50);
   this.extSizer.addStretch();

   this.dryRunButton = new PushButton(this);
   this.dryRunButton.text = "Dry Run / Preview All";
   this.dryRunButton.toolTip = "Read all selected files and populate the new filename column. " +
                               "No files or directories will be modified.";
   this.dryRunButton.onClick = function(){
      self.updatePreview();
      self.updateAllPreviews();
   };

   this.moveModeCheck = new CheckBox(this);
   this.moveModeCheck.text = "Delete Original File";
   this.moveModeCheck.checked = false;
   this.moveModeCheck.toolTip = "Move/rename files and delete the originals. " +
                                "When unchecked, files are copied and originals are kept.";

   this.millisecondCheck = new CheckBox(this);
   this.millisecondCheck.text = "Millisecond precision";
   this.millisecondCheck.checked = false;
   this.millisecondCheck.toolTip = "Enable millisecond precision for {timestamp}, {time}, {DATE-OBS}, {DATE-LOC}\nFormat: YYYYMMDDHHMMSSmmm";
   this.millisecondCheck.onCheck = function(checked) {
      self.updatePreview();
   };

   this.optsSizer = new HorizontalSizer;
   this.optsSizer.spacing = 12;
   this.optsSizer.addUnscaledSpacing(labelWidth + 4);
   this.optsSizer.add(this.dryRunButton);
   this.optsSizer.addSpacing(12);
   this.optsSizer.add(this.moveModeCheck);
   this.optsSizer.addSpacing(12);
   this.optsSizer.add(this.millisecondCheck);
   this.optsSizer.addStretch();

   this.paramsGroupBox = new GroupBox(this);
   this.paramsGroupBox.title = "Naming Template";
   this.paramsGroupBox.sizer = new VerticalSizer;
   this.paramsGroupBox.sizer.margin = 6;
   this.paramsGroupBox.sizer.spacing = 4;
   this.paramsGroupBox.sizer.add(this.templateSizer);
   this.paramsGroupBox.sizer.add(this.previewSizer);
   this.paramsGroupBox.sizer.add(this.extSizer);
   this.paramsGroupBox.sizer.add(this.optsSizer);

   this.clearAllPreviews = function(){
      for (var i = 0; i < self.filesTreeBox.numberOfChildren; ++i) {
         var node = self.filesTreeBox.child(i);
         node.setText(1, "");
         node.setToolTip(1, "");
      }
   };

   // Keep the original first-file preview behavior. Any parameter change also
   // clears the all-file column, since those values are then stale.
   this.updatePreview = function() {
      self.clearAllPreviews();
      if (self.fileList.length === 0) {
         self.previewEdit.text = "(Add files to see preview)";
         return;
      }

      try {
         var outputDirectory = self.outputDirEdit.text.trim();
         if (outputDirectory.length > 0)
            outputDirectory = File.fullPath(outputDirectory);
         var suffix = normalizeForcedSuffix(self.extEdit.text);
         var result = buildNewName(self.fileList[0], self.templateEdit.text,
                                   self.millisecondCheck.checked,
                                   outputDirectory);
         result.newPath = applyForcedSuffix(result.newPath, suffix);
         self.previewEdit.text = File.extractNameAndSuffix(result.newPath);
      } catch(e) {
         self.previewEdit.text = "Error: " + e.message;
      }
   };

   // Dry-run all files and populate the second list column. This function only
   // reads headers and checks paths; it never creates, copies, moves, or removes
   // files and directories.
   this.updateAllPreviews = function(){
      if (self.fileList.length === 0) {
         (new MessageBox("No input files have been specified.", TITLE,
                         StdIcon.Information, StdButton.Ok)).execute();
         return;
      }

      var outputDirectory = self.outputDirEdit.text.trim();
      var suffix;
      try {
         if (outputDirectory.length > 0)
            outputDirectory = File.fullPath(outputDirectory);
         suffix = normalizeForcedSuffix(self.extEdit.text);
      } catch (e) {
         (new MessageBox(e.message, TITLE, StdIcon.Error, StdButton.Ok)).execute();
         return;
      }

      var reservedPaths = Object.create(null);
      var errors = 0;
      self.filesTreeBox.canUpdate = false;
      try {
         for (var i = 0; i < self.fileList.length; ++i) {
            var node = self.filesTreeBox.child(i);
            var src = self.fileList[i];
            try {
               if (!File.exists(src))
                  throw new Error("Source file no longer exists");
               var result = buildNewName(src, self.templateEdit.text,
                                         self.millisecondCheck.checked,
                                         outputDirectory);
               result.newPath = applyForcedSuffix(result.newPath, suffix);
               var target = src === result.newPath ? result.newPath :
                            ensureUniquePath(result.newPath, reservedPaths);
               reservedPaths[target] = true;
               node.setText(1, File.extractNameAndSuffix(target));
               node.setToolTip(1, target);
            } catch (e) {
               node.setText(1, "ERROR: " + e.message);
               node.setToolTip(1, e.toString());
               ++errors;
            }
            processEvents();
         }
      } finally {
         self.filesTreeBox.canUpdate = true;
      }

      // Column widths remain at the 50/50 split maintained by onResize.
      if (errors > 0)
         (new MessageBox(format("Preview completed with %d error(s).", errors),
                         TITLE, StdIcon.Warning, StdButton.Ok)).execute();
   };

   // 版权标签
   this.copyrightLabel = new Label(this);
   this.copyrightLabel.useRichText = true;
   this.copyrightLabel.textAlignment = TextAlignment.Left|TextAlignment.VertCenter;
   this.copyrightLabel.text = "<p>Copyright &copy; 2025-2026 Fluorine Zhu</p>";

   this.okBtn = new PushButton(this);
   this.okBtn.text = "Execute";
   this.okBtn.icon = this.scaledResource(":/icons/ok.png");
   this.okBtn.onClick = function() {
      if (self.fileList.length === 0) {
         (new MessageBox("No input files have been specified.", TITLE, StdIcon.Error, StdButton.Ok)).execute();
         return;
      }

      var params = {};
      params.template = self.templateEdit.text.trim();
      params.dryRun = false; // Dry Run is now a separate, non-destructive preview action.
      params.moveMode = self.moveModeCheck.checked;
      params.useMilliseconds = self.millisecondCheck.checked;
      params.outputDirectory = self.outputDirEdit.text.trim();
      if (params.outputDirectory.length > 0)
         params.outputDirectory = File.fullPath(params.outputDirectory);
      try {
         params.forceExt = normalizeForcedSuffix(self.extEdit.text);
      } catch (e) {
         (new MessageBox(e.message, TITLE, StdIcon.Error, StdButton.Ok)).execute();
         return;
      }

      if (params.moveMode) {
         var msg = "<p>You have enabled <b>Delete Original File</b>.</p>" +
                   "<p>This may lead to irreversible data loss. A forced suffix only renames " +
                   "the file; it does not convert its image format.<br>" +
                   "<b>Are you sure you want to continue?</b></p>";
         if ((new MessageBox(msg, TITLE, StdIcon.Warning, StdButton.Yes, StdButton.No)).execute() != StdButton.Yes) {
            return;
         }
      }

      self.hide();
      processEvents();

      try {
         var engine = new RenameEngine();
         engine.run(self.fileList, params);
      } catch(e) {
         console.criticalln("Fatal error: " + e.toString());
      }

      self.done(1);
   };

   this.cancelBtn = new PushButton(this);
   this.cancelBtn.text = "Cancel";
   this.cancelBtn.icon = this.scaledResource(":/icons/cancel.png");
   this.cancelBtn.onClick = function() { self.cancel(); };

   this.btnSizer = new HorizontalSizer;
   this.btnSizer.spacing = 6;
   this.btnSizer.add(this.copyrightLabel);
   this.btnSizer.addStretch();
   this.btnSizer.add(this.okBtn);
   this.btnSizer.add(this.cancelBtn);

   this.sizer = new VerticalSizer;
   this.sizer.margin = 6;
   this.sizer.spacing = 6;
   this.sizer.add(this.helpLabel);
   this.sizer.add(this.filesGroupBox, 100);
   this.sizer.add(this.outputDirSizer);
   this.sizer.add(this.paramsGroupBox);
   this.sizer.add(this.btnSizer);

   // Use a larger initial/minimum interface while retaining DPI scaling.
   this.setScaledMinSize(1000, 700);
   this.adjustToContents();
}
};

// ---------- 入口 ----------
function main(){
   console.hide();
   var dlg = new MainDialog();
   dlg.execute();
}

main();
