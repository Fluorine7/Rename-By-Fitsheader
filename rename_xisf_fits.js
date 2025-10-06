#script-id RenameByHeaderOnDisk

#include <pjsr/DataType.jsh>
#include <pjsr/FrameStyle.jsh>
#include <pjsr/Sizer.jsh>
#include <pjsr/StdButton.jsh>
#include <pjsr/StdIcon.jsh>
#include <pjsr/TextAlign.jsh>

// Rename_xisf_fits.js (PixInsight PJSR)
// v1.0 - Fixed: File.copyFile error handling
// 作者：正七价的氟离子（Fluorine Zhu）
// 批量按 FITS 头关键字重命名文件

#define VERSION "1.0"
#define TITLE   "Rename By FITS Header"
#define DEFAULT_TEMPLATE "{OBJECT}_{FILTER}_{timestamp}"

// ---------- 工具函数 ----------
function stripQuotes(s){ 
   if(s==null) return ""; 
   s=(""+s).trim(); 
   if(s.length>=2&&s[0]==s[s.length-1]&&(s[0]=="'"||s[0]=='"')) 
      return s.substring(1,s.length-1).trim(); 
   return s; 
}

function sanitizeToken(s, toUpper){
   s = stripQuotes(s).replace(/\s+/g,"_").replace(/[^0-9A-Za-z_\-]+/g,"");
   return toUpper ? s.toUpperCase() : s;
}

function formatUTC(dtStr){
   var s=stripQuotes(dtStr).replace("Z","");
   var m=s.match(/^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2}):(\d{2})/);
   return m ? (m[1]+m[2]+m[3]+m[4]+m[5]+m[6]) : "000000000000";
}

function formatDate(dtStr){
   var s=stripQuotes(dtStr).replace("Z","");
   var m=s.match(/^(\d{4})-(\d{2})-(\d{2})/);
   return m ? (m[1]+m[2]+m[3]) : "00000000";
}

function formatTime(dtStr){
   var s=stripQuotes(dtStr).replace("Z","");
   var m=s.match(/(\d{2}):(\d{2}):(\d{2})/);
   return m ? (m[1]+m[2]+m[3]) : "000000";
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

function ensureUniquePath(path){
   if (File.exists(path)){
      var ext = File.extractExtension(path);
      var nameWithoutExt = File.extractName(path);
      var dir = File.extractDrive(path) + File.extractDirectory(path);
      
      if (!dir.endsWith('/')) {
         dir += '/';
      }
      
      var i=1, cand;
      do{ 
         cand = dir + nameWithoutExt + '_' + ("0"+i).slice(-2) + ext; 
         ++i; 
      } while(File.exists(cand));
      return cand;
   }
   return path;
}

function pick(obj, names){ 
   for (var i=0;i<names.length;++i){ 
      var v=obj[names[i]]; 
      if(v!=null && (""+v).length) return v; 
   } 
   return null; 
}

// 安全的文件复制函数
function safeCopyFile(src, dst){
   // 确保目标文件不存在
   if (File.exists(dst)) {
      throw new Error("Target file already exists: " + dst);
   }
   
   // 使用读写方式复制
   var srcFile = new File;
   srcFile.openForReading(src);
   var fileData = srcFile.read(DataType_ByteArray, srcFile.size);
   srcFile.close();
   
   var dstFile = new File;
   dstFile.createForWriting(dst);
   dstFile.write(fileData);
   dstFile.close();
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
   if (imgDesc.length < 1) {
      throw new Error("Cannot open file: " + filePath);
   }

   var keywords = {};
   var fitsKeywords = fi.keywords;
   for (var i = 0; i < fitsKeywords.length; ++i) {
      var k = fitsKeywords[i];
      keywords[k.name] = stripQuotes(k.strippedValue);
   }

   fi.close();
   return keywords;
}

// 解析模板生成文件名
function parseTemplate(template, kw){
   if(!template || template.length === 0) {
      template = DEFAULT_TEMPLATE;
   }
   
   var result = template;
   
   // 替换所有关键字
   var replacements = {
      '{OBJECT}': function(){ return sanitizeToken(kw.OBJECT || kw.OBJNAME || kw.TARGET || "UNTITLED", false); },
      '{FILTER}': function(){ return sanitizeToken(pick(kw, ["FILTER","FILTER1","FILTER2","FILTNAM","FILTNAM1"]) || "NA", true); },
      '{IMAGETYP}': function(){ return sanitizeToken(kw.IMAGETYP || kw.IMAGETYPE || "NA", true); },
      '{EXPOSURE}': function(){ return kw.EXPOSURE || kw.EXPTIME || "0"; },
      '{EXPTIME}': function(){ return kw.EXPTIME || kw.EXPOSURE || "0"; },
      '{GAIN}': function(){ return kw.GAIN || "0"; },
      '{OFFSET}': function(){ return kw.OFFSET || "0"; },
      '{XBINNING}': function(){ return kw.XBINNING || "1"; },
      '{YBINNING}': function(){ return kw.YBINNING || "1"; },
      '{CCD-TEMP}': function(){ return formatCCDTemp(kw["CCD-TEMP"]); },
      '{INSTRUME}': function(){ return sanitizeToken(kw.INSTRUME || "NA", false); },
      '{TELESCOP}': function(){ return sanitizeToken(kw.TELESCOP || "NA", false); },
      '{timestamp}': function(){ 
         var t = pick(kw, ["DATE-OBS","DATE-AVG","DATE_AVG","DATE-LOC","DATE_LOC"]);
         return t ? formatUTC(t) : "000000000000";
      },
      '{date}': function(){ 
         var t = pick(kw, ["DATE-OBS","DATE-AVG","DATE_AVG","DATE-LOC","DATE_LOC"]);
         return t ? formatDate(t) : "00000000";
      },
      '{time}': function(){ 
         var t = pick(kw, ["DATE-OBS","DATE-AVG","DATE_AVG","DATE-LOC","DATE_LOC"]);
         return t ? formatTime(t) : "000000";
      },
      '{DATE-OBS}': function(){ return kw["DATE-OBS"] ? formatUTC(kw["DATE-OBS"]) : "000000000000"; },
      '{DATE-LOC}': function(){ return kw["DATE-LOC"] ? formatUTC(kw["DATE-LOC"]) : "000000000000"; }
   };
   
   for (var placeholder in replacements) {
      if (result.indexOf(placeholder) >= 0) {
         result = result.replace(new RegExp(placeholder.replace(/[{}]/g, '\\$&'), 'g'), replacements[placeholder]());
      }
   }
   
   // 清理非法字符
   result = result.replace(/[\/\\:*?"<>|]/g, '_');
   
   return result;
}

function buildNewName(filePath, template){
   var kw = readHeaderFromFile(filePath);
   var newName = parseTemplate(template, kw);
   
   var ext = File.extractExtension(filePath);
   var dir = File.extractDrive(filePath) + File.extractDirectory(filePath);
   
   if (!dir.endsWith('/')) {
      dir += '/';
   }
   
   return { 
      kw: kw, 
      srcPath: filePath, 
      newPath: dir + newName + ext 
   };
}

// ---------- 重命名引擎 ----------
function RenameEngine(){
   this.run = function(files, params){
      console.show();
      console.abortEnabled = true;
      console.noteln("================================================================");
      console.noteln(format("Files to process: %d   Dry-run: %s   Mode: %s",
         files.length, params.dryRun.toString(), params.moveMode ? "Move (delete original)" : "Copy (keep original)"));
      console.noteln("Template: " + (params.template || DEFAULT_TEMPLATE));
      if(params.forceExt) console.noteln("Force Extension: " + params.forceExt);

      var ok=0, err=0, skipped=0;
      
      for (var i=0; i < files.length; ++i){
         if (console.abortRequested) {
            console.warningln("**** Aborted by user.");
            break;
         }
         
         var src = files[i];
         console.writeln(format("[%d/%d] %s", i + 1, files.length, File.extractNameAndSuffix(src)));
         
         try{
            var r = buildNewName(src, params.template);
            
            if (params.forceExt && params.forceExt.length){
               var ext = params.forceExt;
               if (ext.charAt(0) != ".") ext = "." + ext;
               var base = File.extractName(r.newPath);
               var dir = File.extractDrive(r.newPath) + File.extractDirectory(r.newPath);
               
               if (!dir.endsWith('/')) {
                  dir += '/';
               }
               
               r.newPath = dir + base + ext.toLowerCase();
            }
            
            console.writeln("   -> ", File.extractNameAndSuffix(r.newPath));
            
            if (!params.dryRun){
               if (params.moveMode) {
                  // 移动模式：删除原文件
                  if (src === r.newPath) {
                     console.noteln("   ⊙ Skipped (same name)");
                     ++skipped;
                  } else {
                     File.move(src, r.newPath);
                     console.noteln("   ✓ Renamed (original deleted)");
                     ++ok;
                  }
               } else {
                  // 复制模式：保留原文件
                  var target = ensureUniquePath(r.newPath);
                  
                  if (src === target) {
                     console.noteln("   ⊙ Skipped (same name)");
                     ++skipped;
                  } else {
                     if (target !== r.newPath) {
                        console.noteln("   ! File exists, saving as: ", File.extractNameAndSuffix(target));
                     }
                     
                     // 使用安全的复制函数
                     safeCopyFile(src, target);
                     console.noteln("   ✓ Copied (original kept)");
                     ++ok;
                  }
               }
            } else {
               ++ok;
            }
            
         }catch(e){
            console.warningln("   ✗ FAILED: ", e.toString());
            ++err;
         } finally {
            gc(true);
            processEvents();
         }
      }
      
      console.noteln("----------------------------------------------------------------");
      console.noteln(format("Done: %d ok, %d errors, %d skipped%s", 
         ok, err, skipped, params.dryRun ? "  (dry-run)" : ""));
      console.noteln("================================================================");
   };
}

// ---------- 对话框 ----------
function MainDialog(){
   this.__base__ = Dialog;
   this.__base__();
   var self = this;

   this.fileList = [];

   this.windowTitle = TITLE + " v" + VERSION;
   this.minWidth = 600;

   this.helpLabel = new Label(this);
   this.helpLabel.frameStyle = FrameStyle_Box;
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
   this.filesTreeBox.setScaledMinSize(500, 150);
   this.filesTreeBox.numberOfColumns = 1;
   this.filesTreeBox.headerVisible = false;

   this.addFilesButton = new PushButton(this);
   this.addFilesButton.text = "Add Files";
   this.addFilesButton.icon = this.scaledResource(":/icons/add.png");
   this.addFilesButton.onClick = function() {
      var ofd = new OpenFileDialog;
      ofd.multipleSelections = true;
      ofd.caption = "Select FITS/XISF Images";
      ofd.filters = [ ["Image Files", ".xisf", ".fits", ".fit", ".fts"], ["All Files", "*"] ];
      if (ofd.execute()) {
         self.filesTreeBox.canUpdate = false;
         for (var i = 0; i < ofd.fileNames.length; ++i) {
            if (self.fileList.indexOf(ofd.fileNames[i]) < 0) {
               var node = new TreeBoxNode(self.filesTreeBox);
               node.setText(0, ofd.fileNames[i]);
               self.fileList.push(ofd.fileNames[i]);
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

   // 模板输入区域
   var labelWidth = this.font.width("Template: ") + 4;
   
   this.templateLabel = new Label(this);
   this.templateLabel.text = "Template:";
   this.templateLabel.minWidth = labelWidth;
   this.templateLabel.textAlignment = TextAlign_Right|TextAlign_VertCenter;
   
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
         self.templateEdit.text += keyword;
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
   this.previewLabel.textAlignment = TextAlign_Right|TextAlign_VertCenter;
   
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
   this.extLabel.text = "Force Ext:";
   this.extLabel.minWidth = labelWidth;
   this.extLabel.textAlignment = TextAlign_Right|TextAlign_VertCenter;
   this.extEdit = new Edit(this);
   this.extEdit.toolTip = "e.g., xisf or fits; leave empty to keep original extension";
   this.extSizer = new HorizontalSizer;
   this.extSizer.spacing = 4;
   this.extSizer.add(this.extLabel);
   this.extSizer.add(this.extEdit, 50);
   this.extSizer.addStretch();

   this.dryRunCheck = new CheckBox(this);
   this.dryRunCheck.text = "Dry-run (preview only)";
   this.dryRunCheck.checked = true;
   this.dryRunCheck.toolTip = "Preview renaming without actually modifying files";
   
   this.moveModeCheck = new CheckBox(this);
   this.moveModeCheck.text = "Move files (delete original)";
   this.moveModeCheck.checked = false;
   this.moveModeCheck.toolTip = "If checked: rename files in place (delete original)\nIf unchecked: copy to new name (keep original)";
   
   this.optsSizer = new HorizontalSizer;
   this.optsSizer.spacing = 12;
   this.optsSizer.addUnscaledSpacing(labelWidth + 4);
   this.optsSizer.add(this.dryRunCheck);
   this.optsSizer.addSpacing(12);
   this.optsSizer.add(this.moveModeCheck);
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

   // 更新预览函数
   this.updatePreview = function() {
      if (self.fileList.length === 0) {
         self.previewEdit.text = "(Add files to see preview)";
         return;
      }
      
      try {
         var result = buildNewName(self.fileList[0], self.templateEdit.text);
         var newName = File.extractNameAndSuffix(result.newPath);
         
         if (self.extEdit.text.trim().length > 0) {
            var ext = self.extEdit.text.trim();
            if (ext.charAt(0) != ".") ext = "." + ext;
            newName = File.extractName(result.newPath) + ext;
         }
         
         self.previewEdit.text = newName;
      } catch(e) {
         self.previewEdit.text = "Error: " + e.message;
      }
   };

   // 版权标签
   this.copyrightLabel = new Label(this);
   this.copyrightLabel.useRichText = true;
   this.copyrightLabel.textAlignment = TextAlign_Left|TextAlign_VertCenter;
   this.copyrightLabel.text = "<p>Copyright &copy; 2025 Fluorine Zhu</p>";

   this.okBtn = new PushButton(this);
   this.okBtn.text = "Execute";
   this.okBtn.icon = this.scaledResource(":/icons/ok.png");
   this.okBtn.onClick = function() {
      if (self.fileList.length === 0) {
         (new MessageBox("No input files have been specified.", TITLE, StdIcon_Error, StdButton_Ok)).execute();
         return;
      }

      var params = {};
      params.template = self.templateEdit.text.trim();
      params.dryRun = self.dryRunCheck.checked;
      params.moveMode = self.moveModeCheck.checked;
      var fx = self.extEdit.text.trim();
      params.forceExt = fx.length ? (fx.charAt(0)=='.'?fx:("."+fx)) : "";

      if (!params.dryRun && params.moveMode) {
         var msg = "<p>You have enabled <b>Move mode</b>, which will delete original files.</p>" +
                   "<p>This may lead to irreversible data loss.<br>" +
                   "<b>Are you sure you want to continue?</b></p>";
         if ((new MessageBox(msg, TITLE, StdIcon_Warning, StdButton_Yes, StdButton_No)).execute() != StdButton_Yes) {
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
   this.sizer.add(this.paramsGroupBox);
   this.sizer.add(this.btnSizer);
}
MainDialog.prototype = new Dialog;

// ---------- 入口 ----------
function main(){
   console.hide();
   var dlg = new MainDialog();
   dlg.execute();
}

main();