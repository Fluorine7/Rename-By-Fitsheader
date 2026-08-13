/*
 * Expand Integration V1.3
 *
 * Copyright (c) 2026 Fluorine Zhu
 * SPDX-License-Identifier: MIT
 *
 * Ported to the PixInsight 1.9.4 V8 JavaScript runtime.
 * See LICENSES/MIT.txt in the source repository for license terms.
 */

#engine v8

#script-id   Fluorine7ExpandIntegration
#feature-id  Fluorine7ExpandIntegration : Batch Processing > Expand Integration
#feature-info  Sliding-window image integration with configurable ImageIntegration parameters.<br/>\
Requires PixInsight 1.9.4 or later.<br/>\
Copyright &copy; 2026, Fluorine Zhu.

CoreApplication.ensureMinimumVersion( 1, 9, 4 );

// ================== Globals ==================
var g_targetFrames = [];
var g_outputDir = "";
// This is the complete literal prefix, including any desired separator.
var g_outputPrefix = "expand_";
var g_windowSize = 5;
var g_stepSize = 1;
var g_pattern = /\.(xisf|fits|fit|fts)$/i;
var g_sortPreferHeader = true;

// Integration parameters (visible in main UI)
var g_combination = ImageIntegration.Average;
var g_minWeight = 0.05;
var g_rejection = ImageIntegration.WinsorizedSigmaClip; // Default rejection

// Keep UI indices independent from PixInsight's ImageIntegration enum values.
var g_rejectionOptions = [
   ["No rejection", ImageIntegration.NoRejection],
   ["Min/Max", ImageIntegration.MinMax],
   ["Percentile Clip", ImageIntegration.PercentileClip],
   ["Sigma Clip", ImageIntegration.SigmaClip],
   ["Winsorized Sigma Clip", ImageIntegration.WinsorizedSigmaClip],
   ["Averaged Sigma Clip", ImageIntegration.AveragedSigmaClip],
   ["Linear Fit", ImageIntegration.LinearFit],
   ["CCD Clip", ImageIntegration.CCDClip],
   ["ESD", ImageIntegration.Rejection_ESD],
   ["RCR", ImageIntegration.Rejection_RCR]
];

function rejectionOptionIndex(value){
   for (var i = 0; i < g_rejectionOptions.length; ++i)
      if (g_rejectionOptions[i][1] === value) return i;
   return 0;
}

function rejectionName(value){
   return g_rejectionOptions[rejectionOptionIndex(value)][0];
}

// Normalization
var g_normalization = ImageIntegration.AdditiveWithScaling;
var g_rejectionNormalization = ImageIntegration.Scale;

// Rejection parameters
var g_percentileLow = 0.2;
var g_percentileHigh = 0.1;
var g_sigmaLow = 4.0;
var g_sigmaHigh = 3.0;
var g_linearFitLow = 5.0;
var g_linearFitHigh = 3.5;
var g_ESD_Outliers = 0.3;
var g_ESD_Significance = 0.05;
var g_RCR_Limit = 0.1;

// Range rejection
var g_rangeClipLow = true;
var g_rangeLow = 0.0;
var g_rangeClipHigh = false;
var g_rangeHigh = 0.98;

// Large scale rejection
var g_largeScaleClipLow = false;
var g_largeScaleClipLowProtectedLayers = 2;
var g_largeScaleClipLowGrowth = 2;
var g_largeScaleClipHigh = false;
var g_largeScaleClipHighProtectedLayers = 2;
var g_largeScaleClipHighGrowth = 2;

// Other options
var g_generateRejectionMaps = true;
var g_clipLow = true;
var g_clipHigh = false; // 默认不选
var g_evaluateSNR = true;

// Subframe Weighting
var g_subframeWeightingEnabled = true;
// 0=PSFSignal, 1=PSFSNR, 2=PSFScaleSNR, 3=SNREstimate,
// 4=precomputed WBPPWGHT values supplied through a temporary CSV file.
var g_weightMode = 0;
var g_weightKeyword = "WBPPWGHT";

// Weighting formula parameters
var g_fwhmWeight = 15.0;
var g_eccentricityWeight = 5.0;
var g_snrWeight = 20.0;
var g_starsWeight = 0.0;
var g_psfSignalWeight = 60.0;
var g_psfSNRWeight = 0.0;

// ================== Helpers ==================
function pad3(n){ return ("000"+n).slice(-3); }

function sourceDirectory(filePath){
   return File.extractDrive(filePath) + File.extractDirectory(filePath);
}

function defaultOutputDirectory(frames){
   if (!frames || frames.length === 0) return "";
   var first = frames[0];
   for (var i = 1; i < frames.length; ++i)
      if (isFinite(frames[i].time) &&
          (!isFinite(first.time) || frames[i].time < first.time))
         first = frames[i];
   return sourceDirectory(first.path);
}

function readHeaderKeywords(filePath){
   var ext = File.extractExtension(filePath);
   if (ext.length === 0) throw new Error("No extension: " + filePath);
   var ff = new FileFormat(ext, true, false);
   if (ff.isNull) throw new Error("Unsupported format: " + ext);
   var fi = new FileFormatInstance(ff);
   if (fi.isNull) throw new Error("Cannot instantiate FileFormat");
   var desc = fi.open(filePath);
   if (desc.length < 1) throw new Error("Cannot open: " + filePath);
   var map = {};
   var kw = fi.keywords;
   for (var i=0;i<kw.length;++i)
      map[ kw[i].name ] = (""+kw[i].strippedValue).trim();
   fi.close();
   return map;
}

function headerTimeToNumber(kw){
   function tryParseDate(s){
      s = String(s).trim();
      // FITS timestamps without an explicit offset are UTC by definition.
      if (/^\d{4}-\d{2}-\d{2}[ T]/.test(s) &&
          !/(Z|[+\-]\d{2}:?\d{2})$/i.test(s))
         s = s.replace(" ", "T") + "Z";
      var t = Date.parse(s);
      return isNaN(t) ? NaN : t;
   }
   var dateKeys = ["DATE-OBS", "DATE-BEG", "DATE"];
   for (var i = 0; i < dateKeys.length; ++i)
      if (kw[dateKeys[i]]) {
         var t = tryParseDate(kw[dateKeys[i]]);
         if (!isNaN(t)) return t;
      }

   var jdText = kw["JD-OBS"] !== undefined ? kw["JD-OBS"] : kw["JD"];
   if (jdText !== undefined) {
      var jd = parseFloat(jdText);
      if (!isNaN(jd)) return (jd - 2440587.5)*86400000;
   }

   var mjdText = kw["MJD-OBS"] !== undefined ? kw["MJD-OBS"] : kw["MJD"];
   if (mjdText !== undefined) {
      var mjd = parseFloat(mjdText);
      if (!isNaN(mjd)) return (mjd - 40587)*86400000;
   }
   return NaN;
}

function formatTime(timeStr){
   if (!timeStr) return "";
   var match = timeStr.match(/(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})/);
   if (match) return match[1];
   return timeStr;
}

function sortFrames(frames){
   if (g_sortPreferHeader){
      frames.sort(function(a,b){
         if (a.time == b.time) return a.name < b.name ? -1 : 1;
         return a.time - b.time;
      });
   } else {
      frames.sort(function(a,b){ return a.name < b.name ? -1 : 1; });
   }
}

function createFrameObject(filePath){
   var name = File.extractName(filePath);
   var timeNum = NaN;
   var timeStr = "";
   var exposureSeconds = 0;

   try {
      var kw = readHeaderKeywords(filePath);
      timeNum = headerTimeToNumber(kw);
      if (kw["DATE-OBS"]) timeStr = kw["DATE-OBS"];
      else if (kw["DATE-BEG"]) timeStr = kw["DATE-BEG"];
      else if (kw["DATE"]) timeStr = kw["DATE"];
      var exposureText = kw["EXPTIME"] !== undefined ? kw["EXPTIME"] : kw["EXPOSURE"];
      if (exposureText !== undefined) {
         exposureSeconds = parseFloat(exposureText);
         if (!isFinite(exposureSeconds) || exposureSeconds < 0) exposureSeconds = 0;
      }
   } catch(e) {}

   if (!timeStr && !isNaN(timeNum))
      timeStr = new Date(timeNum).toISOString();

   return {
      path: filePath,
      name: name,
      time: isNaN(timeNum) ? Infinity : timeNum,
      timeStr: formatTime(timeStr),
      exposureSeconds: exposureSeconds,
      lnPath: ""
   };
}

function hasLocalNormalization(frames){
   frames = frames || g_targetFrames;
   for (var i=0; i<frames.length; i++){
      if (frames[i].lnPath !== "") return true;
   }
   return false;
}

function hasCompleteLocalNormalization(frames){
   if (!frames || frames.length === 0) return false;
   for (var i=0; i<frames.length; ++i)
      if (frames[i].lnPath === "") return false;
   return true;
}

// ================== Core ==================
function makeTargets(frames){
   // PixInsight 1.9.4/V8 requires four columns for ImageIntegration.images:
   // [enabled, imagePath, drizzlePath, localNormalizationPath].
   var targets = new Array(frames.length);
   for (var i = 0; i < frames.length; ++i)
      targets[i] = [true, frames[i].path, "", frames[i].lnPath || ""];
   return targets;
}

function csvField(value){
   return '"' + String(value).replace(/"/g, '""') + '"';
}

function prepareCSVWeights(frames, index){
   var rows = [];
   for (var i = 0; i < frames.length; ++i) {
      var keywords = readHeaderKeywords(frames[i].path);
      if (keywords[g_weightKeyword] === undefined)
         throw new Error("Weight keyword '" + g_weightKeyword +
                         "' not found in: " + frames[i].path);
      var weight = parseFloat(keywords[g_weightKeyword]);
      if (!isFinite(weight) || weight < 0)
         throw new Error("Invalid weight keyword '" + g_weightKeyword +
                         "' in: " + frames[i].path);
      rows.push(csvField(frames[i].path) + ", " + weight);
   }

   var path = g_outputDir + "/.expand_weights_" + pad3(index) + ".csv";
   if (File.exists(path)) File.remove(path);
   File.writeTextFile(path, rows.join("\n") + "\n");
   return path;
}

function windowByProcessId(id){
   if (!id || id.length === 0) return null;
   var window = ImageWindow.windowById(id);
   return window === null || window.isNull ? null : window;
}

function closeProcessWindow(id){
   var window = windowByProcessId(id);
   if (window !== null) {
      try {
         window.forceClose();
      } catch (e) {
         console.warningln("Could not close generated window: ", id);
      }
   }
}

function fitsDateTime(milliseconds){
   // FITS DATE-* timestamps are UTC; omit the trailing ISO "Z" by convention.
   return new Date(milliseconds).toISOString().replace(/Z$/, "");
}

function writeObservationKeywords(window, frames){
   var begin = Infinity;
   var end = -Infinity;
   var midSum = 0;
   var validCount = 0;

   for (var i = 0; i < frames.length; ++i) {
      if (!isFinite(frames[i].time)) continue;
      var exposureMilliseconds = Math.max(0, frames[i].exposureSeconds || 0)*1000;
      begin = Math.min(begin, frames[i].time);
      end = Math.max(end, frames[i].time + exposureMilliseconds);
      midSum += frames[i].time + exposureMilliseconds/2;
      ++validCount;
   }

   if (validCount === 0) {
      console.warningln("** No valid observation timestamps found; output time keywords were not changed.");
      return;
   }

   var average = midSum/validCount;
   var replaceNames = ["DATE-OBS", "DATE-BEG", "DATE-AVG", "DATE-END",
                       "MJD-OBS", "MJD-BEG", "MJD-AVG", "MJD-END", "NCOMBINE"];
   var keywords = window.keywords.filter(function(keyword){
      return replaceNames.indexOf(keyword.name.toUpperCase()) < 0;
   });

   keywords.push(new FITSKeyword("DATE-OBS", "'" + fitsDateTime(begin) + "'",
                                "Start of integrated observation (UTC)"));
   keywords.push(new FITSKeyword("DATE-BEG", "'" + fitsDateTime(begin) + "'",
                                "Start of integrated observation (UTC)"));
   keywords.push(new FITSKeyword("DATE-AVG", "'" + fitsDateTime(average) + "'",
                                "Mean mid-exposure time (UTC)"));
   keywords.push(new FITSKeyword("DATE-END", "'" + fitsDateTime(end) + "'",
                                "End of integrated observation (UTC)"));
   keywords.push(new FITSKeyword("MJD-AVG", ((average/86400000) + 40587).toFixed(8),
                                "Mean mid-exposure time (MJD)"));
   keywords.push(new FITSKeyword("NCOMBINE", String(frames.length),
                                "Number of integrated input frames"));
   window.keywords = keywords;

   console.noteln("Observation interval: ", fitsDateTime(begin), " to ", fitsDateTime(end));
   console.noteln("Representative DATE-AVG: ", fitsDateTime(average));
}

function integrateWindow(frames, index){
   var II = new ImageIntegration;
   var hasLN = hasCompleteLocalNormalization(frames);
   var csvWeightsPath = "";

   II.images = makeTargets(frames);
   II.generateIntegratedImage = true;
   II.combination = g_combination;
   II.rejection = g_rejection;
   II.normalization = g_normalization;
   II.rejectionNormalization = g_rejectionNormalization;
   II.minWeight = g_minWeight;
   II.weightScale = ImageIntegration.WeightScale_BWMV;

   if (g_subframeWeightingEnabled) {
      var weightModes = [
         ImageIntegration.PSFSignalWeight,
         ImageIntegration.PSFSNR,
         ImageIntegration.PSFScaleSNR,
         ImageIntegration.SNREstimate,
         ImageIntegration.CSVWeightsFile
      ];
      II.weightMode = weightModes[g_weightMode];

      if (g_weightMode === 2 && !hasLN)
         throw new Error("PSF Scale SNR weighting requires LocalNormalization files for all frames.");

      if (g_weightMode === 4) {
         csvWeightsPath = prepareCSVWeights(frames, index);
         II.csvWeightsFilePath = csvWeightsPath;
         console.noteln("** Using ", g_weightKeyword, " values through CSV weights");
      } else if (index === 1) {
         var modeNames = ["PSF Signal Weight", "PSF SNR", "PSF Scale SNR", "SNR Estimate"];
         console.noteln("** Using ", modeNames[g_weightMode], " weighting");
      }
   } else {
      II.weightMode = ImageIntegration.DontCare;
   }

   switch(g_rejection){
      case ImageIntegration.PercentileClip:
         II.pcClipLow = g_percentileLow;
         II.pcClipHigh = g_percentileHigh;
         break;
      case ImageIntegration.SigmaClip:
      case ImageIntegration.WinsorizedSigmaClip:
      case ImageIntegration.AveragedSigmaClip:
         II.sigmaLow = g_sigmaLow;
         II.sigmaHigh = g_sigmaHigh;
         break;
      case ImageIntegration.LinearFit:
         II.linearFitLow = g_linearFitLow;
         II.linearFitHigh = g_linearFitHigh;
         break;
      case ImageIntegration.Rejection_ESD:
         II.esdOutliersFraction = g_ESD_Outliers;
         II.esdAlpha = g_ESD_Significance;
         break;
      case ImageIntegration.Rejection_RCR:
         II.rcrLimit = g_RCR_Limit;
         break;
   }

   II.rangeClipLow = g_rangeClipLow;
   II.rangeLow = g_rangeLow;
   II.rangeClipHigh = g_rangeClipHigh;
   II.rangeHigh = g_rangeHigh;

   II.largeScaleClipLow = g_largeScaleClipLow;
   II.largeScaleClipLowProtectedLayers = g_largeScaleClipLowProtectedLayers;
   II.largeScaleClipLowGrowth = g_largeScaleClipLowGrowth;
   II.largeScaleClipHigh = g_largeScaleClipHigh;
   II.largeScaleClipHighProtectedLayers = g_largeScaleClipHighProtectedLayers;
   II.largeScaleClipHighGrowth = g_largeScaleClipHighGrowth;

   II.generateRejectionMaps = g_generateRejectionMaps;
   II.clipLow = g_clipLow;
   II.clipHigh = g_clipHigh;
   II.evaluateSNR = g_evaluateSNR;
   II.showImages = false;

   if (hasLN) {
      II.normalization = ImageIntegration.LocalNormalization;
      II.rejectionNormalization = ImageIntegration.LocalRejectionNormalization;
      II.subtractPedestals = false;
   }

   console.noteln("Running ImageIntegration for block ", index, "...");
   var ok = false;
   try {
      ok = II.executeGlobal();
   } finally {
      II.showImages = true;
      if (csvWeightsPath.length > 0 && File.exists(csvWeightsPath))
         File.remove(csvWeightsPath);
   }
   if (!ok) {
      closeProcessWindow(II.integrationImageId);
      closeProcessWindow(II.lowRejectionMapImageId);
      closeProcessWindow(II.highRejectionMapImageId);
      throw new Error("ImageIntegration failed at block " + index);
   }

   // ImageIntegration exposes exact output identifiers in the V8 API. This is
   // safer than searching window names or using the active window.
   var integrationWnd = windowByProcessId(II.integrationImageId);
   if (integrationWnd === null) {
      closeProcessWindow(II.lowRejectionMapImageId);
      closeProcessWindow(II.highRejectionMapImageId);
      throw new Error("No integration window generated for block " + index + ".");
   }

   writeObservationKeywords(integrationWnd, frames);

   var prefix = g_outputPrefix.trim();
   var outName = prefix + "stack_" + pad3(index) + ".xisf";
   var outPath = g_outputDir + "/" + outName;
   console.noteln("Saving integration to: ", outPath);
   try {
      if (!integrationWnd.saveAs(outPath, false, false, false, false))
         throw new Error("Could not save integration: " + outPath);
      console.noteln("Successfully saved ", outPath);
   } finally {
      closeProcessWindow(II.integrationImageId);
      closeProcessWindow(II.lowRejectionMapImageId);
      closeProcessWindow(II.highRejectionMapImageId);
   }
   console.noteln("Generated windows closed for block ", index);
}

function runExpand(selectedFrames){
   if (!selectedFrames || selectedFrames.length === 0)
      throw new Error("No input files selected.");
   if (/[<>:"/\\|?*\x00-\x1F]/.test(g_outputPrefix))
      throw new Error("The output prefix contains characters that are invalid in a file name.");

   var frames = selectedFrames.slice();
   sortFrames(frames);

   if (g_outputDir.trim().length === 0) {
      g_outputDir = defaultOutputDirectory(frames);
      if (g_outputDir.length === 0)
         throw new Error("Could not determine a default output directory.");
      console.noteln("** No output directory selected; using the directory of the earliest frame:");
      console.noteln("<raw>", g_outputDir, "</raw>");
   }
   if (!File.directoryExists(g_outputDir))
      File.createDirectory(g_outputDir, true);

   if (frames.length < g_windowSize)
      throw new Error("Not enough frames (" + frames.length + ") for window size " + g_windowSize + ".");
   if (hasLocalNormalization(frames) && !hasCompleteLocalNormalization(frames))
      throw new Error("LocalNormalization files must be assigned to all selected frames or to none of them.");
   if (g_normalization === ImageIntegration.LocalNormalization &&
       !hasCompleteLocalNormalization(frames))
      throw new Error("Local normalization was selected, but no complete set of XNML files is available.");
   if (g_subframeWeightingEnabled && g_weightMode === 4 &&
       g_weightKeyword.trim().length === 0)
      throw new Error("The weight keyword cannot be empty.");

   console.show();
   console.noteln("=".repeat(60));
   console.noteln("<b>Expand Integration Starting...</b>");
   console.noteln("Total frames: ", frames.length);
   console.noteln("Window size: ", g_windowSize);
   console.noteln("Step size: ", g_stepSize);
   console.noteln("Output prefix (literal): ", g_outputPrefix.trim().length > 0 ? g_outputPrefix.trim() : "(none)");
   console.noteln("Combination: ", ["Average","Median","Minimum","Maximum"][g_combination]);
   console.noteln("Rejection: ", rejectionName(g_rejection));
   console.noteln("Subframe Weighting: ", g_subframeWeightingEnabled ? "Yes" : "No");
   console.noteln("Local Normalization: ", hasCompleteLocalNormalization(frames) ? "Yes" : "No");
   console.noteln("=".repeat(60));

   var blockIndex = 1;
   for (var start = 0; start <= frames.length - g_windowSize; start += g_stepSize){
      console.noteln("");
      console.noteln("Block ", blockIndex, " - Frames ", start+1, " to ", start+g_windowSize);
      var subset = frames.slice(start, start + g_windowSize);
      integrateWindow(subset, blockIndex);
      blockIndex++;
   }

   console.noteln("");
   console.noteln("=".repeat(60));
   console.noteln("<b>Expand Integration Completed Successfully</b>");
   console.noteln("Total blocks created: ", blockIndex - 1);
   console.noteln("Output directory: ", g_outputDir);
   console.noteln("=".repeat(60));
}

// ================== Integration Parameters Dialog ==================
var IntegrationParametersDialog = class extends Dialog
{
constructor()
{
   super();

   var self = this;
   var labelWidth = this.font.width("Rejection normalization:M");

   this.windowTitle = "Integration Parameters";

   // Rejection algorithm
   var rejSizer = new HorizontalSizer;
   rejSizer.spacing = 6;
   var rejLabel = new Label(this);
   rejLabel.text = "Rejection algorithm:";
   rejLabel.textAlignment = TextAlignment.Right | TextAlignment.VertCenter;
   rejLabel.setScaledMinWidth(labelWidth);
   this.rejCombo = new ComboBox(this);
   for (var ri = 0; ri < g_rejectionOptions.length; ++ri)
      this.rejCombo.addItem(g_rejectionOptions[ri][0]);
   this.rejCombo.currentItem = rejectionOptionIndex(g_rejection);
   this.rejCombo.onItemSelected = function(idx){
      g_rejection = g_rejectionOptions[idx][1];
      self.updateControlsForRejection();
   };
   rejSizer.add(rejLabel);
   rejSizer.add(this.rejCombo);
   rejSizer.addStretch();

   // Normalization
   var normSizer = new HorizontalSizer;
   normSizer.spacing = 6;
   var normLabel = new Label(this);
   normLabel.text = "Normalization:";
   normLabel.textAlignment = TextAlignment.Right | TextAlignment.VertCenter;
   normLabel.setScaledMinWidth(labelWidth);
   this.normCombo = new ComboBox(this);
   this.normCombo.addItem("No normalization");
   this.normCombo.addItem("Additive");
   this.normCombo.addItem("Multiplicative");
   this.normCombo.addItem("Additive with scaling");
   this.normCombo.addItem("Multiplicative with scaling");
   this.normCombo.addItem("Local normalization");
   this.normCombo.currentItem = g_normalization;
   this.normCombo.onItemSelected = function(idx){ g_normalization = idx; };
   normSizer.add(normLabel);
   normSizer.add(this.normCombo);
   normSizer.addStretch();

   // Rejection Normalization
   var rejNormSizer = new HorizontalSizer;
   rejNormSizer.spacing = 6;
   var rejNormLabel = new Label(this);
   rejNormLabel.text = "Rejection normalization:";
   rejNormLabel.textAlignment = TextAlignment.Right | TextAlignment.VertCenter;
   rejNormLabel.setScaledMinWidth(labelWidth);
   this.rejNormCombo = new ComboBox(this);
   this.rejNormCombo.addItem("No normalization");
   this.rejNormCombo.addItem("Scale");
   this.rejNormCombo.addItem("Equalize fluxes");
   this.rejNormCombo.currentItem = g_rejectionNormalization;
   this.rejNormCombo.onItemSelected = function(idx){ g_rejectionNormalization = idx; };
   rejNormSizer.add(rejNormLabel);
   rejNormSizer.add(this.rejNormCombo);
   rejNormSizer.addStretch();

   // Percentile
   this.percLowCtrl = new NumericControl(this);
   this.percLowCtrl.label.text = "Percentile low:";
   this.percLowCtrl.label.setScaledMinWidth(labelWidth);
   this.percLowCtrl.setRange(0, 1);
   this.percLowCtrl.slider.setRange(0, 1000);
   this.percLowCtrl.setPrecision(2);
   this.percLowCtrl.setValue(g_percentileLow);
   this.percLowCtrl.onValueUpdated = function(v){ g_percentileLow = v; };

   this.percHighCtrl = new NumericControl(this);
   this.percHighCtrl.label.text = "Percentile high:";
   this.percHighCtrl.label.setScaledMinWidth(labelWidth);
   this.percHighCtrl.setRange(0, 1);
   this.percHighCtrl.slider.setRange(0, 1000);
   this.percHighCtrl.setPrecision(2);
   this.percHighCtrl.setValue(g_percentileHigh);
   this.percHighCtrl.onValueUpdated = function(v){ g_percentileHigh = v; };

   // Sigma
   this.sigLowCtrl = new NumericControl(this);
   this.sigLowCtrl.label.text = "Sigma low:";
   this.sigLowCtrl.label.setScaledMinWidth(labelWidth);
   this.sigLowCtrl.setRange(0, 10);
   this.sigLowCtrl.slider.setRange(0, 1000);
   this.sigLowCtrl.setPrecision(2);
   this.sigLowCtrl.setValue(g_sigmaLow);
   this.sigLowCtrl.onValueUpdated = function(v){ g_sigmaLow = v; };

   this.sigHighCtrl = new NumericControl(this);
   this.sigHighCtrl.label.text = "Sigma high:";
   this.sigHighCtrl.label.setScaledMinWidth(labelWidth);
   this.sigHighCtrl.setRange(0, 10);
   this.sigHighCtrl.slider.setRange(0, 1000);
   this.sigHighCtrl.setPrecision(2);
   this.sigHighCtrl.setValue(g_sigmaHigh);
   this.sigHighCtrl.onValueUpdated = function(v){ g_sigmaHigh = v; };

   // Linear fit
   this.linLowCtrl = new NumericControl(this);
   this.linLowCtrl.label.text = "Linear fit low:";
   this.linLowCtrl.label.setScaledMinWidth(labelWidth);
   this.linLowCtrl.setRange(0, 10);
   this.linLowCtrl.slider.setRange(0, 1000);
   this.linLowCtrl.setPrecision(2);
   this.linLowCtrl.setValue(g_linearFitLow);
   this.linLowCtrl.onValueUpdated = function(v){ g_linearFitLow = v; };

   this.linHighCtrl = new NumericControl(this);
   this.linHighCtrl.label.text = "Linear fit high:";
   this.linHighCtrl.label.setScaledMinWidth(labelWidth);
   this.linHighCtrl.setRange(0, 10);
   this.linHighCtrl.slider.setRange(0, 1000);
   this.linHighCtrl.setPrecision(2);
   this.linHighCtrl.setValue(g_linearFitHigh);
   this.linHighCtrl.onValueUpdated = function(v){ g_linearFitHigh = v; };

   // ESD
   this.esdOutliersCtrl = new NumericControl(this);
   this.esdOutliersCtrl.label.text = "ESD outliers:";
   this.esdOutliersCtrl.label.setScaledMinWidth(labelWidth);
   this.esdOutliersCtrl.setRange(0, 1);
   this.esdOutliersCtrl.slider.setRange(0, 1000);
   this.esdOutliersCtrl.setPrecision(2);
   this.esdOutliersCtrl.setValue(g_ESD_Outliers);
   this.esdOutliersCtrl.onValueUpdated = function(v){ g_ESD_Outliers = v; };

   this.esdSigCtrl = new NumericControl(this);
   this.esdSigCtrl.label.text = "ESD significance:";
   this.esdSigCtrl.label.setScaledMinWidth(labelWidth);
   this.esdSigCtrl.setRange(0, 1);
   this.esdSigCtrl.slider.setRange(0, 1000);
   this.esdSigCtrl.setPrecision(2);
   this.esdSigCtrl.setValue(g_ESD_Significance);
   this.esdSigCtrl.onValueUpdated = function(v){ g_ESD_Significance = v; };

   // RCR
   this.rcrLimitCtrl = new NumericControl(this);
   this.rcrLimitCtrl.label.text = "RCR Limit:";
   this.rcrLimitCtrl.label.setScaledMinWidth(labelWidth);
   this.rcrLimitCtrl.setRange(0, 1);
   this.rcrLimitCtrl.slider.setRange(0, 100);
   this.rcrLimitCtrl.setPrecision(2);
   this.rcrLimitCtrl.setValue(g_RCR_Limit);
   this.rcrLimitCtrl.onValueUpdated = function(v){ g_RCR_Limit = v; };

   // Range rejection
   this.rangeClipLowCheck = new CheckBox(this);
   this.rangeClipLowCheck.text = "Clip low range (below):";
   this.rangeClipLowCheck.checked = g_rangeClipLow;
   this.rangeClipLowCheck.onCheck = function(val){ g_rangeClipLow = val; };

   this.rangeLowCtrl = new NumericControl(this);
   this.rangeLowCtrl.label.text = "Range low:";
   this.rangeLowCtrl.label.setScaledMinWidth(labelWidth);
   this.rangeLowCtrl.setRange(0, 1);
   this.rangeLowCtrl.slider.setRange(0, 1000);
   this.rangeLowCtrl.setPrecision(4);
   this.rangeLowCtrl.setValue(g_rangeLow);
   this.rangeLowCtrl.onValueUpdated = function(v){ g_rangeLow = v; };

   this.rangeClipHighCheck = new CheckBox(this);
   this.rangeClipHighCheck.text = "Clip high range (above):";
   this.rangeClipHighCheck.checked = g_rangeClipHigh;
   this.rangeClipHighCheck.onCheck = function(val){ g_rangeClipHigh = val; };

   this.rangeHighCtrl = new NumericControl(this);
   this.rangeHighCtrl.label.text = "Range high:";
   this.rangeHighCtrl.label.setScaledMinWidth(labelWidth);
   this.rangeHighCtrl.setRange(0, 1);
   this.rangeHighCtrl.slider.setRange(0, 1000);
   this.rangeHighCtrl.setPrecision(4);
   this.rangeHighCtrl.setValue(g_rangeHigh);
   this.rangeHighCtrl.onValueUpdated = function(v){ g_rangeHigh = v; };

   // Large scale rejection
   this.largeScaleLowCheck = new CheckBox(this);
   this.largeScaleLowCheck.text = "Large scale clip low";
   this.largeScaleLowCheck.checked = g_largeScaleClipLow;
   this.largeScaleLowCheck.onCheck = function(val){ g_largeScaleClipLow = val; };

   this.lsLowLayersCtrl = new NumericControl(this);
   this.lsLowLayersCtrl.label.text = "LS low protected layers:";
   this.lsLowLayersCtrl.label.setScaledMinWidth(labelWidth);
   this.lsLowLayersCtrl.setRange(1, 8);
   this.lsLowLayersCtrl.slider.setRange(1, 8);
   this.lsLowLayersCtrl.setPrecision(0);
   this.lsLowLayersCtrl.setValue(g_largeScaleClipLowProtectedLayers);
   this.lsLowLayersCtrl.onValueUpdated = function(v){ g_largeScaleClipLowProtectedLayers = Math.round(v); };

   this.lsLowGrowthCtrl = new NumericControl(this);
   this.lsLowGrowthCtrl.label.text = "LS low growth:";
   this.lsLowGrowthCtrl.label.setScaledMinWidth(labelWidth);
   this.lsLowGrowthCtrl.setRange(1, 8);
   this.lsLowGrowthCtrl.slider.setRange(1, 8);
   this.lsLowGrowthCtrl.setPrecision(0);
   this.lsLowGrowthCtrl.setValue(g_largeScaleClipLowGrowth);
   this.lsLowGrowthCtrl.onValueUpdated = function(v){ g_largeScaleClipLowGrowth = Math.round(v); };

   this.largeScaleHighCheck = new CheckBox(this);
   this.largeScaleHighCheck.text = "Large scale clip high";
   this.largeScaleHighCheck.checked = g_largeScaleClipHigh;
   this.largeScaleHighCheck.onCheck = function(val){ g_largeScaleClipHigh = val; };

   this.lsHighLayersCtrl = new NumericControl(this);
   this.lsHighLayersCtrl.label.text = "LS high protected layers:";
   this.lsHighLayersCtrl.label.setScaledMinWidth(labelWidth);
   this.lsHighLayersCtrl.setRange(1, 8);
   this.lsHighLayersCtrl.slider.setRange(1, 8);
   this.lsHighLayersCtrl.setPrecision(0);
   this.lsHighLayersCtrl.setValue(g_largeScaleClipHighProtectedLayers);
   this.lsHighLayersCtrl.onValueUpdated = function(v){ g_largeScaleClipHighProtectedLayers = Math.round(v); };

   this.lsHighGrowthCtrl = new NumericControl(this);
   this.lsHighGrowthCtrl.label.text = "LS high growth:";
   this.lsHighGrowthCtrl.label.setScaledMinWidth(labelWidth);
   this.lsHighGrowthCtrl.setRange(1, 8);
   this.lsHighGrowthCtrl.slider.setRange(1, 8);
   this.lsHighGrowthCtrl.setPrecision(0);
   this.lsHighGrowthCtrl.setValue(g_largeScaleClipHighGrowth);
   this.lsHighGrowthCtrl.onValueUpdated = function(v){ g_largeScaleClipHighGrowth = Math.round(v); };

   // Other options
   this.genRejMapsCheck = new CheckBox(this);
   this.genRejMapsCheck.text = "Generate rejection maps";
   this.genRejMapsCheck.checked = g_generateRejectionMaps;
   this.genRejMapsCheck.onCheck = function(val){ g_generateRejectionMaps = val; };

   this.clipLowCheck = new CheckBox(this);
   this.clipLowCheck.text = "Clip low pixels";
   this.clipLowCheck.checked = g_clipLow;
   this.clipLowCheck.onCheck = function(val){ g_clipLow = val; };

   this.clipHighCheck = new CheckBox(this);
   this.clipHighCheck.text = "Clip high pixels";
   this.clipHighCheck.checked = g_clipHigh;
   this.clipHighCheck.onCheck = function(val){ g_clipHigh = val; };

   this.evalNoiseCheck = new CheckBox(this);
   this.evalNoiseCheck.text = "Evaluate SNR";
   this.evalNoiseCheck.checked = g_evaluateSNR;
   this.evalNoiseCheck.onCheck = function(val){ g_evaluateSNR = val; };

   // 根据当前rejection算法更新控件启用状态
   this.updateControlsForRejection = function(){
      var rej = g_rejection;

      var enablePercentile = (rej === ImageIntegration.PercentileClip);
      this.percLowCtrl.enabled = enablePercentile;
      this.percHighCtrl.enabled = enablePercentile;

      var enableSigma = (rej === ImageIntegration.SigmaClip ||
                         rej === ImageIntegration.WinsorizedSigmaClip ||
                         rej === ImageIntegration.AveragedSigmaClip);
      this.sigLowCtrl.enabled = enableSigma;
      this.sigHighCtrl.enabled = enableSigma;

      var enableLinear = (rej === ImageIntegration.LinearFit);
      this.linLowCtrl.enabled = enableLinear;
      this.linHighCtrl.enabled = enableLinear;

      var enableESD = (rej === ImageIntegration.Rejection_ESD);
      this.esdOutliersCtrl.enabled = enableESD;
      this.esdSigCtrl.enabled = enableESD;

      var enableRCR = (rej === ImageIntegration.Rejection_RCR);
      this.rcrLimitCtrl.enabled = enableRCR;
   };

   // OK button
   this.okButton = new PushButton(this);
   this.okButton.text = "OK";
   this.okButton.onClick = function(){ self.ok(); };

   var buttonRow = new HorizontalSizer;
   buttonRow.spacing = 6;
   buttonRow.addStretch();
   buttonRow.add(this.okButton);

   // Layout
   var mainSizer = new VerticalSizer;
   mainSizer.margin = 8;
   mainSizer.spacing = 4;
   mainSizer.add(rejSizer);
   mainSizer.addSpacing(6);
   mainSizer.add(normSizer);
   mainSizer.add(rejNormSizer);
   mainSizer.addSpacing(6);
   mainSizer.add(this.percLowCtrl);
   mainSizer.add(this.percHighCtrl);
   mainSizer.add(this.sigLowCtrl);
   mainSizer.add(this.sigHighCtrl);
   mainSizer.add(this.linLowCtrl);
   mainSizer.add(this.linHighCtrl);
   mainSizer.add(this.esdOutliersCtrl);
   mainSizer.add(this.esdSigCtrl);
   mainSizer.add(this.rcrLimitCtrl);
   mainSizer.addSpacing(6);
   mainSizer.add(this.rangeClipLowCheck);
   mainSizer.add(this.rangeLowCtrl);
   mainSizer.add(this.rangeClipHighCheck);
   mainSizer.add(this.rangeHighCtrl);
   mainSizer.addSpacing(6);
   mainSizer.add(this.largeScaleLowCheck);
   mainSizer.add(this.lsLowLayersCtrl);
   mainSizer.add(this.lsLowGrowthCtrl);
   mainSizer.add(this.largeScaleHighCheck);
   mainSizer.add(this.lsHighLayersCtrl);
   mainSizer.add(this.lsHighGrowthCtrl);
   mainSizer.addSpacing(6);
   mainSizer.add(this.genRejMapsCheck);
   mainSizer.add(this.clipLowCheck);
   mainSizer.add(this.clipHighCheck);
   mainSizer.add(this.evalNoiseCheck);
   mainSizer.addSpacing(6);
   mainSizer.add(buttonRow);

   this.sizer = mainSizer;
   this.adjustToContents();

   // 初始化控件状态
   this.updateControlsForRejection();
}
};

// ================== Weighting Formula Dialog ==================
var WeightingFormulaDialog = class extends Dialog
{
constructor()
{
   super();

   var self = this;
   var labelWidth = this.font.width("PSF Signal Weight:M");

   this.windowTitle = "Weighting Formula Parameters";

   this.fwhmCtrl = new NumericControl(this);
   this.fwhmCtrl.label.text = "FWHM Weight:";
   this.fwhmCtrl.label.setScaledMinWidth(labelWidth);
   this.fwhmCtrl.setRange(0, 100);
   this.fwhmCtrl.slider.setRange(0, 1000);
   this.fwhmCtrl.setPrecision(1);
   this.fwhmCtrl.setValue(g_fwhmWeight);
   this.fwhmCtrl.onValueUpdated = function(v){ g_fwhmWeight = v; };

   this.eccCtrl = new NumericControl(this);
   this.eccCtrl.label.text = "Eccentricity Weight:";
   this.eccCtrl.label.setScaledMinWidth(labelWidth);
   this.eccCtrl.setRange(0, 100);
   this.eccCtrl.slider.setRange(0, 1000);
   this.eccCtrl.setPrecision(1);
   this.eccCtrl.setValue(g_eccentricityWeight);
   this.eccCtrl.onValueUpdated = function(v){ g_eccentricityWeight = v; };

   this.snrCtrl = new NumericControl(this);
   this.snrCtrl.label.text = "SNR Weight:";
   this.snrCtrl.label.setScaledMinWidth(labelWidth);
   this.snrCtrl.setRange(0, 100);
   this.snrCtrl.slider.setRange(0, 1000);
   this.snrCtrl.setPrecision(1);
   this.snrCtrl.setValue(g_snrWeight);
   this.snrCtrl.onValueUpdated = function(v){ g_snrWeight = v; };

   this.starsCtrl = new NumericControl(this);
   this.starsCtrl.label.text = "Stars Weight:";
   this.starsCtrl.label.setScaledMinWidth(labelWidth);
   this.starsCtrl.setRange(0, 100);
   this.starsCtrl.slider.setRange(0, 1000);
   this.starsCtrl.setPrecision(1);
   this.starsCtrl.setValue(g_starsWeight);
   this.starsCtrl.onValueUpdated = function(v){ g_starsWeight = v; };

   this.psfSigCtrl = new NumericControl(this);
   this.psfSigCtrl.label.text = "PSF Signal Weight:";
   this.psfSigCtrl.label.setScaledMinWidth(labelWidth);
   this.psfSigCtrl.setRange(0, 100);
   this.psfSigCtrl.slider.setRange(0, 1000);
   this.psfSigCtrl.setPrecision(1);
   this.psfSigCtrl.setValue(g_psfSignalWeight);
   this.psfSigCtrl.onValueUpdated = function(v){ g_psfSignalWeight = v; };

   this.psfSNRCtrl = new NumericControl(this);
   this.psfSNRCtrl.label.text = "PSF SNR Weight:";
   this.psfSNRCtrl.label.setScaledMinWidth(labelWidth);
   this.psfSNRCtrl.setRange(0, 100);
   this.psfSNRCtrl.slider.setRange(0, 1000);
   this.psfSNRCtrl.setPrecision(1);
   this.psfSNRCtrl.setValue(g_psfSNRWeight);
   this.psfSNRCtrl.onValueUpdated = function(v){ g_psfSNRWeight = v; };

   this.okButton = new PushButton(this);
   this.okButton.text = "OK";
   this.okButton.onClick = function(){ self.ok(); };

   var buttonRow = new HorizontalSizer;
   buttonRow.spacing = 6;
   buttonRow.addStretch();
   buttonRow.add(this.okButton);

   var mainSizer = new VerticalSizer;
   mainSizer.margin = 8;
   mainSizer.spacing = 4;
   mainSizer.add(this.fwhmCtrl);
   mainSizer.add(this.eccCtrl);
   mainSizer.add(this.snrCtrl);
   mainSizer.add(this.starsCtrl);
   mainSizer.add(this.psfSigCtrl);
   mainSizer.add(this.psfSNRCtrl);
   mainSizer.addSpacing(6);
   mainSizer.add(buttonRow);

   this.sizer = mainSizer;
   this.adjustToContents();
}
};

// ================== Main Dialog ==================
var ExpandDialog = class extends Dialog
{
constructor()
{
   super();

   var self = this;
   this.windowTitle = "Expand Integration V1.3 (V8)";
   var labelWidth = this.font.width("Rejection algorithm:M");

   // --- Target Frames ---
   this.framesGroup = new GroupBox(this);
   this.framesGroup.title = "Target Frames";
   this.framesGroup.sizer = new VerticalSizer;
   this.framesGroup.sizer.margin = 6;
   this.framesGroup.sizer.spacing = 4;

   this.framesTree = new TreeBox(this.framesGroup);
   this.framesTree.multipleSelection = true;
   this.framesTree.rootDecoration = false;
   this.framesTree.alternateRowColor = true;
   this.framesTree.setScaledMinSize(700, 200);
   this.framesTree.numberOfColumns = 4;
   this.framesTree.setHeaderText(0, "#");
   this.framesTree.setHeaderText(1, "File");
   this.framesTree.setHeaderText(2, "Observation Time");
   this.framesTree.setHeaderText(3, "Source Image Path");
   this.framesTree.setHeaderAlignment(0, TextAlignment.Center);

   this.updateFramesTree = function(){
      self.framesTree.clear();
      for (var i=0; i<g_targetFrames.length; i++){
         var node = new TreeBoxNode(self.framesTree);
         node.setText(0, (i+1).toString());
         node.setText(1, g_targetFrames[i].name);
         node.setText(2, g_targetFrames[i].timeStr || "N/A");
         node.setText(3, g_targetFrames[i].path);
         node.selected = true;
      }
      self.framesTree.adjustColumnWidthToContents(0);
      self.framesTree.adjustColumnWidthToContents(1);
      self.framesTree.adjustColumnWidthToContents(2);
      self.framesTree.setColumnWidth(3, self.framesTree.logicalPixelsToPhysical(320));
   };

   // 主水平布局：Tree在左，按钮在右
   var framesMainSizer = new HorizontalSizer;
   framesMainSizer.spacing = 6;
   framesMainSizer.add(this.framesTree, 100);

   // 右侧按钮垂直排列
   var btnSizer = new VerticalSizer;
   btnSizer.spacing = 4;

   this.addFilesBtn = new PushButton(this.framesGroup);
   this.addFilesBtn.text = "Add Files";
   this.addFilesBtn.onClick = function(){
      var ofd = new OpenFileDialog;
      ofd.multipleSelections = true;
      ofd.caption = "Select Target Frames";
      ofd.filters = [["FITS/XISF", "*.fits", "*.fit", "*.fts", "*.xisf"]];
      if (ofd.execute()){
         for (var i=0; i<ofd.filePaths.length; i++){
            if (g_pattern.test(ofd.filePaths[i])){
               g_targetFrames.push(createFrameObject(ofd.filePaths[i]));
            }
         }
         self.updateFramesTree();
      }
   };

   this.addLNBtn = new PushButton(this.framesGroup);
   this.addLNBtn.text = "Add L.Norm. Files";
   this.addLNBtn.onClick = function(){
      var ofd = new OpenFileDialog;
      ofd.multipleSelections = true;
      ofd.caption = "Select LocalNormalization Files";
      ofd.filters = [["XNML files", "*.xnml"]];
      if (ofd.execute()){
         var added = 0;
         for (var i=0; i<ofd.filePaths.length; i++){
            var lnName = File.extractName(ofd.filePaths[i]).replace(/_n\.xnml$/i, "");
            for (var j=0; j<g_targetFrames.length; j++){
               if (g_targetFrames[j].name === lnName){
                  g_targetFrames[j].lnPath = ofd.filePaths[i];
                  added++;
                  break;
               }
            }
         }
         console.noteln("Added ", added, " LocalNormalization files.");
         self.updateFramesTree();
      }
   };

   this.clearLNBtn = new PushButton(this.framesGroup);
   this.clearLNBtn.text = "Clear L.Norm. Files";
   this.clearLNBtn.onClick = function(){
      for (var i=0; i<g_targetFrames.length; i++)
         g_targetFrames[i].lnPath = "";
      console.noteln("Cleared LocalNormalization files.");
      self.updateFramesTree();
   };

   this.selectAllBtn = new PushButton(this.framesGroup);
   this.selectAllBtn.text = "Select All";
   this.selectAllBtn.onClick = function(){
      for (var i=0; i<self.framesTree.numberOfChildren; i++)
         self.framesTree.child(i).selected = true;
   };

   this.invertBtn = new PushButton(this.framesGroup);
   this.invertBtn.text = "Invert Selection";
   this.invertBtn.onClick = function(){
      for (var i=0; i<self.framesTree.numberOfChildren; i++){
         var node = self.framesTree.child(i);
         node.selected = !node.selected;
      }
   };

   this.clearBtn = new PushButton(this.framesGroup);
   this.clearBtn.text = "Clear";
   this.clearBtn.onClick = function(){
      g_targetFrames = [];
      self.updateFramesTree();
   };

   // 按照ImageIntegration的顺序排列按钮
   btnSizer.add(this.addFilesBtn);
   btnSizer.add(this.addLNBtn);
   btnSizer.add(this.clearLNBtn);
   btnSizer.add(this.selectAllBtn);
   btnSizer.add(this.invertBtn);
   btnSizer.add(this.clearBtn);
   btnSizer.addStretch();

   framesMainSizer.add(btnSizer);
   this.framesGroup.sizer.add(framesMainSizer);

   // --- Output Directory ---
   var outDirSizer = new HorizontalSizer;
   outDirSizer.spacing = 6;
   var outDirLabel = new Label(this);
   outDirLabel.text = "Output Directory:";
   outDirLabel.textAlignment = TextAlignment.Right | TextAlignment.VertCenter;
   outDirLabel.setScaledMinWidth(labelWidth);
   this.outDirEdit = new Edit(this);
   this.outDirEdit.text = g_outputDir;
   this.outDirEdit.toolTip = "<p>Optional. If empty, results are saved beside the selected frame " +
                             "with the earliest observation time.</p>";
   this.outDirEdit.onTextUpdated = function(val){ g_outputDir = val; };
   this.outDirBtn = new ToolButton(this);
   this.outDirBtn.icon = this.scaledResource(":/browser/select-file.png");
   this.outDirBtn.onClick = function(){
      var gdd = new GetDirectoryDialog;
      gdd.caption = "Select Output Directory";
      if (gdd.execute()){
         g_outputDir = gdd.directoryPath;
         self.outDirEdit.text = g_outputDir;
      }
   };
   outDirSizer.add(outDirLabel);
   outDirSizer.add(this.outDirEdit, 100);
   outDirSizer.add(this.outDirBtn);

   // --- Output file prefix ---
   var prefixSizer = new HorizontalSizer;
   prefixSizer.spacing = 6;
   var prefixLabel = new Label(this);
   prefixLabel.text = "Output Prefix:";
   prefixLabel.textAlignment = TextAlignment.Right | TextAlignment.VertCenter;
   prefixLabel.setScaledMinWidth(labelWidth);
   this.prefixEdit = new Edit(this);
   this.prefixEdit.text = g_outputPrefix;
   this.prefixEdit.toolTip = "<p>This is the complete literal prefix, including separators. " +
                             "For example, A6_expand_ generates A6_expand_stack_NNN.xisf. " +
                             "Leave empty to generate stack_NNN.xisf.</p>";
   this.prefixEdit.onTextUpdated = function(value){ g_outputPrefix = value; };
   prefixSizer.add(prefixLabel);
   prefixSizer.add(this.prefixEdit, 100);

   // --- Sort preference ---
   this.sortCheck = new CheckBox(this);
   this.sortCheck.text = "Prefer FITS header time (DATE-OBS/JD)";
   this.sortCheck.checked = g_sortPreferHeader;
   this.sortCheck.onCheck = function(val){ g_sortPreferHeader = val; };

   // --- Window and Step ---
   this.windowCtrl = new NumericControl(this);
   this.windowCtrl.label.text = "Frames per stack:";
   this.windowCtrl.label.setScaledMinWidth(labelWidth);
   this.windowCtrl.setRange(1, 30);
   this.windowCtrl.slider.setRange(1, 30);
   this.windowCtrl.setPrecision(0);
   this.windowCtrl.setValue(g_windowSize);
   this.windowCtrl.onValueUpdated = function(v){ g_windowSize = Math.round(v); };

   this.stepCtrl = new NumericControl(this);
   this.stepCtrl.label.text = "Slide step:";
   this.stepCtrl.label.setScaledMinWidth(labelWidth);
   this.stepCtrl.setRange(1, 10);
   this.stepCtrl.slider.setRange(1, 10);
   this.stepCtrl.setPrecision(0);
   this.stepCtrl.setValue(g_stepSize);
   this.stepCtrl.onValueUpdated = function(v){ g_stepSize = Math.round(v); };

   // --- Integration Parameters Group ---
   this.iiGroup = new GroupBox(this);
   this.iiGroup.title = "Integration Parameters";
   this.iiGroup.sizer = new VerticalSizer;
   this.iiGroup.sizer.margin = 6;
   this.iiGroup.sizer.spacing = 4;

   // Combination
   var combSizer = new HorizontalSizer;
   combSizer.spacing = 6;
   var combLabel = new Label(this.iiGroup);
   combLabel.text = "Combination:";
   combLabel.textAlignment = TextAlignment.Right | TextAlignment.VertCenter;
   combLabel.setScaledMinWidth(labelWidth);
   this.combCombo = new ComboBox(this.iiGroup);
   this.combCombo.addItem("Average");
   this.combCombo.addItem("Median");
   this.combCombo.addItem("Minimum");
   this.combCombo.addItem("Maximum");
   this.combCombo.currentItem = g_combination;
   this.combCombo.onItemSelected = function(idx){ g_combination = idx; };
   combSizer.add(combLabel);
   combSizer.add(this.combCombo);
   combSizer.addStretch();
   this.iiGroup.sizer.add(combSizer);

   // Min Weight
   this.minWeightCtrl = new NumericControl(this.iiGroup);
   this.minWeightCtrl.label.text = "Minimum weight:";
   this.minWeightCtrl.label.setScaledMinWidth(labelWidth);
   this.minWeightCtrl.setRange(0, 1);
   this.minWeightCtrl.slider.setRange(0, 1000);
   this.minWeightCtrl.setPrecision(3);
   this.minWeightCtrl.setValue(g_minWeight);
   this.minWeightCtrl.onValueUpdated = function(v){ g_minWeight = v; };
   this.iiGroup.sizer.add(this.minWeightCtrl);

   // --- Subframe Weighting ---
   this.swCheck = new CheckBox(this.iiGroup);
   this.swCheck.text = "Subframe Weighting";
   this.swCheck.checked = g_subframeWeightingEnabled;
   this.swCheck.onCheck = function(val){
      g_subframeWeightingEnabled = val;
      self.updateSubframeWeightingControls();
   };
   this.iiGroup.sizer.add(this.swCheck);

   // Weight mode
   var weightSizer = new HorizontalSizer;
   weightSizer.spacing = 6;
   var weightLabel = new Label(this.iiGroup);
   weightLabel.text = "Weights:";
   weightLabel.textAlignment = TextAlignment.Right | TextAlignment.VertCenter;
   weightLabel.setScaledMinWidth(labelWidth);
   this.weightCombo = new ComboBox(this.iiGroup);
   this.weightCombo.addItem("PSF Signal Weight");
   this.weightCombo.addItem("PSF SNR");
   this.weightCombo.addItem("PSF Scale SNR");
   this.weightCombo.addItem("SNR Estimate");
   this.weightCombo.addItem("WBPPWGHT keyword (CSV)");
   this.weightCombo.currentItem = g_weightMode;
   this.weightCombo.onItemSelected = function(idx){
      g_weightMode = idx;
      self.updateSubframeWeightingControls();
   };
   weightSizer.add(weightLabel);
   weightSizer.add(this.weightCombo);
   weightSizer.addStretch();
   this.weightSizer = weightSizer;
   this.iiGroup.sizer.add(weightSizer);

   var keywordSizer = new HorizontalSizer;
   keywordSizer.spacing = 6;
   var keywordLabel = new Label(this.iiGroup);
   keywordLabel.text = "Weight keyword:";
   keywordLabel.textAlignment = TextAlignment.Right | TextAlignment.VertCenter;
   keywordLabel.setScaledMinWidth(labelWidth);
   this.weightKeywordEdit = new Edit(this.iiGroup);
   this.weightKeywordEdit.text = g_weightKeyword;
   this.weightKeywordEdit.onTextUpdated = function(value){
      g_weightKeyword = value.trim();
   };
   keywordSizer.add(keywordLabel);
   keywordSizer.add(this.weightKeywordEdit, 100);
   this.keywordSizer = keywordSizer;
   this.iiGroup.sizer.add(keywordSizer);

   // Integration parameters button
   this.intParamsButton = new PushButton(this.iiGroup);
   this.intParamsButton.text = "→ Integration parameters...";
   this.intParamsButton.onClick = function(){
      var dlg = new IntegrationParametersDialog();
      dlg.execute();
   };
   this.iiGroup.sizer.add(this.intParamsButton);

   this.updateSubframeWeightingControls = function(){
      var enabled = g_subframeWeightingEnabled;
      this.weightSizer.visible = enabled;
      this.keywordSizer.visible = enabled && g_weightMode === 4;
   };

   // --- Run and Cancel ---
   this.runButton = new PushButton(this);
   this.runButton.text = "Run Expand Integration";
   this.runButton.icon = this.scaledResource(":/icons/power.png");
   this.runButton.onClick = function(){
      try {
         var selectedFrames = [];
         for (var i = 0; i < self.framesTree.numberOfChildren; ++i)
            if (self.framesTree.child(i).selected)
               selectedFrames.push(g_targetFrames[i]);
         if (selectedFrames.length === 0)
            throw new Error("No target frames selected in the list.");
         self.ok();
         runExpand(selectedFrames);
      } catch(e) {
         var mb = new MessageBox(
            "Error: " + e.toString(),
            "Expand Integration Error",
            StdIcon.Error,
            StdButton.Ok
         );
         mb.execute();
         console.criticalln("Error: " + e.toString());
      }
   };

   this.cancelButton = new PushButton(this);
   this.cancelButton.text = "Cancel";
   this.cancelButton.onClick = function(){
      self.cancel();
   };

   // --- Copyright Label ---
   this.copyrightLabel = new Label(this);
   this.copyrightLabel.text = "© Fluorine Zhu 2026";
   this.copyrightLabel.textAlignment = TextAlignment.Left | TextAlignment.VertCenter;

   var buttonRow = new HorizontalSizer;
   buttonRow.spacing = 6;
   buttonRow.add(this.copyrightLabel);
   buttonRow.addStretch();
   buttonRow.add(this.runButton);
   buttonRow.add(this.cancelButton);

   // --- Main Layout ---
   var mainSizer = new VerticalSizer;
   mainSizer.margin = 8;
   mainSizer.spacing = 6;
   mainSizer.add(this.framesGroup, 100);
   mainSizer.add(outDirSizer);
   mainSizer.add(prefixSizer);
   mainSizer.add(this.sortCheck);
   mainSizer.add(this.windowCtrl);
   mainSizer.add(this.stepCtrl);
   mainSizer.add(this.iiGroup);
   mainSizer.addSpacing(6);
   mainSizer.add(buttonRow);

   this.sizer = mainSizer;
   this.adjustToContents();
   this.setScaledMinWidth(750);

   // Initialize
   this.updateSubframeWeightingControls();
   this.updateFramesTree();
}
};

// ================== Main ==================
function main(){
   console.noteln("");
   console.noteln("=".repeat(60));
   console.noteln("<b>Expand Integration V1.3 (V8)</b>");
   console.noteln("Similar to the time domain noise reduction method");
   console.noteln("Suitable for making time-lapse images of comets or other objects that change appearance");
   console.noteln("Author: Fluorine Zhu, 2026");
   console.noteln("=".repeat(60));
   console.noteln("");

   var dialog = new ExpandDialog();
   dialog.execute();
}

main();
