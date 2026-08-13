/*
 * Batch Image Keyword Editor
 *
 * A complete modular rewrite of the BatchFITSKeywordEdit workflow with native
 * FITS/XISF metadata access, separated validation, and transactional output.
 *
 * Original concept and implementation:
 * Copyright (C) 2021-2024, Mike Cranfield
 *
 * This restructured implementation:
 * Modifications Copyright (C) 2026, Fluorine Zhu
 *
 * Version history
 * 1.0   2021-09-14  first release
 * 2.0   2023-08-04  added facility to copy values and comments from an existing keyword
 *                   added ability to check which files would be validly edited
 *                   added additional controls to select and deselect files
 *                   added ability to choose whether to output unedited files as well
 * 2.1   2024-01-10  added the ability to overwrite existing files
 * 2.2   2024-12-15  added icon and CosmicPhotons dedicated directory
 * 3.0   2026-05-04  update for V8 PJSR runtime
 * 4.0   2026-08-12  complete modular rewrite with native FITS/XISF metadata access,
 *                   reference caching, output conflict detection, separated validation
 *                   and processing, and transactional overwrite; by Fluorine Zhu.
 *
 * SPDX-License-Identifier: GPL-3.0-only
 *
 * This program is free software: you can redistribute it and/or modify it
 * under the terms of the GNU General Public License as published by the Free
 * Software Foundation, version 3 of the License.
 *
 * This program is distributed in the hope that it will be useful, but WITHOUT
 * ANY WARRANTY; without even the implied warranty of MERCHANTABILITY or
 * FITNESS FOR A PARTICULAR PURPOSE. See the GNU General Public License for
 * more details: <https://www.gnu.org/licenses/gpl-3.0.html>.
 */

#engine v8

#script-id Fluorine7BatchImageKeywordEditor
#feature-id Fluorine7BatchImageKeywordEditor : Batch Processing > Batch Image Keyword Editor

#feature-info A modular batch editor for FITS-compatible keywords in FITS and XISF files.<br/>\
Supports metadata-only validation, reference keyword caching, and safe transactional overwrite.<br/>\
Copyright &copy; 2021-2024, Mike Cranfield; modifications &copy; 2026, Fluorine Zhu.

CoreApplication.ensureMinimumVersion( 1, 9, 4 );

#define TITLE "Batch Image Keyword Editor"
#define VERSION "4.0"

// ----------------------------------------------------------------------------
// Small utility functions
// ----------------------------------------------------------------------------

function normalizedKeywordName( name )
{
   return name.toUpperCase().trim();
}

function cloneKeywords( keywords )
{
   let result = new Array;
   for ( let i = 0; i < keywords.length; ++i )
      result.push( new FITSKeyword( keywords[i].name,
                                   keywords[i].value,
                                   keywords[i].comment ) );
   return result;
}

function keywordIndex( keywords, name )
{
   let n = normalizedKeywordName( name );
   if ( n.length == 0 )
      return -1;
   for ( let i = 0; i < keywords.length; ++i )
      if ( normalizedKeywordName( keywords[i].name ) == n )
         return i;
   return -1;
}

function isStructuralKeyword( name )
{
   let n = normalizedKeywordName( name );
   return n == "SIMPLE" || n == "BITPIX" || n == "EXTEND" || n == "END" ||
          n == "XTENSION" || n == "PCOUNT" || n == "GCOUNT" ||
          /^NAXIS[0-9]*$/.test( n );
}

function pathKey( path )
{
   // Case-folding is intentionally conservative: it also prevents collisions on
   // the default case-insensitive macOS and Windows file systems.
   return File.fullPath( path ).toLowerCase();
}

function sameFilePath( a, b )
{
   return pathKey( a ) == pathKey( b );
}

function directoryOf( filePath )
{
   let d = File.extractDrive( filePath ) + File.extractDirectory( filePath );
   if ( !d.endsWith( '/' ) )
      d += '/';
   return d;
}

// ----------------------------------------------------------------------------
// Metadata reader: opening a FileFormatInstance reads container metadata only.
// Pixel samples are not read here.
// ----------------------------------------------------------------------------

class ImageMetadataReader
{
   constructor()
   {
      this.cachedPath = "";
      this.cachedKeywords = new Array;
   }

   checkExtension( filePath )
   {
      let ext = File.extractExtension( filePath ).toLowerCase();
      if ( ext != ".fit" && ext != ".fits" && ext != ".fts" && ext != ".xisf" )
         throw new Error( "Unsupported file type: " + ext +
                          ". Expected FITS (*.fit, *.fits, *.fts) or XISF (*.xisf)." );
      return ext;
   }

   read( filePath )
   {
      if ( !File.exists( filePath ) )
         throw new Error( "File does not exist." );

      let ext = this.checkExtension( filePath );
      let format = new FileFormat( ext, true/*toRead*/, false/*toWrite*/ );
      if ( format.isNull )
         throw new Error( "No installed file format can read " + ext + "." );
      if ( !format.canStoreKeywords )
         throw new Error( "The installed " + format.name +
                          " format cannot expose FITS-compatible keywords." );

      let instance = new FileFormatInstance( format );
      if ( instance.isNull )
         throw new Error( "Unable to instantiate file format: " + format.name );

      let opened = false;
      try
      {
         let descriptions = instance.open( filePath );
         opened = true;
         if ( descriptions.length < 1 )
            throw new Error( "Unable to open file." );
         if ( descriptions.length > 1 )
            throw new Error( "Multi-image containers are not supported." );
         return cloneKeywords( instance.keywords );
      }
      finally
      {
         if ( opened )
            instance.close();
      }
   }

   readReference( filePath, forceReload = false )
   {
      if ( !forceReload && this.cachedPath.length > 0 &&
           sameFilePath( this.cachedPath, filePath ) )
         return cloneKeywords( this.cachedKeywords );

      let keys = this.read( filePath );
      this.cachedPath = filePath;
      this.cachedKeywords = cloneKeywords( keys );
      return keys;
   }

   clearReferenceCache()
   {
      this.cachedPath = "";
      this.cachedKeywords.length = 0;
   }
}

// ----------------------------------------------------------------------------
// Edit specification and keyword transformation
// ----------------------------------------------------------------------------

class KeywordEditSpecification
{
   constructor()
   {
      this.action = 0; // 0 add, 1 edit, 2 remove
      this.targetName = "";
      this.allowDuplicate = false;
      this.locationName = ""; // empty means append
      this.insertAfter = false;
      this.copySource = false;
      this.sourceName = "";
      this.manualFallback = true;
      this.value = "";
      this.comment = "";
   }

   validate( keywords )
   {
      let targetName = normalizedKeywordName( this.targetName );
      if ( targetName.length == 0 )
         return { ok:false, kind:"skip", message:"Target keyword is empty." };
      if ( targetName.length > 8 )
         return { ok:false, kind:"skip", message:"A standard FITS keyword name cannot exceed 8 characters." };
      if ( !/^[A-Z0-9_-]+$/.test( targetName ) )
         return { ok:false, kind:"skip", message:"Target keyword contains invalid characters." };
      if ( isStructuralKeyword( targetName ) )
         return { ok:false, kind:"skip", message:"Structural keyword cannot be modified: " + targetName };

      let target = keywordIndex( keywords, targetName );
      let location = keywordIndex( keywords, this.locationName );
      let source = keywordIndex( keywords, this.sourceName );

      if ( this.action == 0 )
      {
         if ( target >= 0 && !this.allowDuplicate )
            return { ok:false, kind:"skip", message:"Target keyword already exists." };
         if ( this.locationName.trim().length > 0 && location < 0 )
            return { ok:false, kind:"skip", message:"Location keyword was not found." };
      }
      else if ( target < 0 )
         return { ok:false, kind:"skip", message:"Target keyword was not found." };

      if ( this.action != 2 && this.copySource )
      {
         if ( this.sourceName.trim().length == 0 && !this.manualFallback )
            return { ok:false, kind:"skip", message:"Source keyword is empty and manual fallback is disabled." };
         if ( source < 0 && !this.manualFallback )
            return { ok:false, kind:"skip", message:"Source keyword was not found." };
      }

      return {
         ok:true,
         kind:"valid",
         message:"",
         targetIndex:target,
         locationIndex:location,
         sourceIndex:source
      };
   }

   transformedKeywords( keywords, validation )
   {
      if ( !validation.ok )
         throw new Error( validation.message );

      let output = cloneKeywords( keywords );
      if ( this.action == 2 )
      {
         output.splice( validation.targetIndex, 1 );
         return output;
      }

      let value = this.value;
      let comment = this.comment;
      if ( this.copySource && validation.sourceIndex >= 0 )
      {
         value = keywords[validation.sourceIndex].value;
         comment = keywords[validation.sourceIndex].comment;
      }

      if ( this.action == 1 )
      {
         output[validation.targetIndex].value = value;
         output[validation.targetIndex].comment = comment;
         return output;
      }

      let newKeyword = new FITSKeyword( normalizedKeywordName( this.targetName ),
                                        value, comment );
      let insertionIndex = output.length;
      if ( validation.locationIndex >= 0 )
         insertionIndex = validation.locationIndex + (this.insertAfter ? 1 : 0);
      output.splice( insertionIndex, 0, newKeyword );
      return output;
   }
}

// ----------------------------------------------------------------------------
// Transactional output path generation and file replacement
// ----------------------------------------------------------------------------

class TransactionalImageWriter
{
   constructor()
   {
      this.outputDirectory = "";
      this.prefix = "";
      this.postfix = "_f";
      this.overwrite = false;
   }

   desiredPath( sourcePath )
   {
      let dir = this.outputDirectory.length > 0 ? this.outputDirectory : directoryOf( sourcePath );
      if ( !dir.endsWith( '/' ) )
         dir += '/';
      return dir + this.prefix + File.extractName( sourcePath ) + this.postfix +
             File.extractExtension( sourcePath );
   }

   uniquePath( path )
   {
      if ( !File.exists( path ) )
         return path;
      for ( let i = 1; ; ++i )
      {
         let candidate = File.appendToName( path, '_' + i.toString() );
         if ( !File.exists( candidate ) )
            return candidate;
      }
   }

   outputPath( sourcePath, reservedPaths = null )
   {
      let desired = this.desiredPath( sourcePath );
      if ( this.overwrite )
         return desired;

      let candidate = desired;
      for ( let i = 1; File.exists( candidate ) ||
                           (reservedPaths != null && reservedPaths[pathKey( candidate )]); ++i )
         candidate = File.appendToName( desired, '_' + i.toString() );
      return candidate;
   }

   temporaryPath( targetPath, label )
   {
      for ( let i = 1; ; ++i )
      {
         let candidate = File.appendToName( targetPath,
                           ".__" + label + "_" + i.toString() );
         if ( !File.exists( candidate ) )
            return candidate;
      }
   }

   installStagedFile( stagedPath, targetPath )
   {
      if ( !File.exists( targetPath ) )
      {
         File.move( stagedPath, targetPath );
         return;
      }

      let backupPath = this.temporaryPath( targetPath, "keyword_backup" );
      File.move( targetPath, backupPath );
      try
      {
         File.move( stagedPath, targetPath );
      }
      catch ( error )
      {
         if ( !File.exists( targetPath ) && File.exists( backupPath ) )
            File.move( backupPath, targetPath );
         if ( File.exists( stagedPath ) )
            File.remove( stagedPath );
         throw error;
      }

      // Installation has succeeded. Failure to delete this backup must not be
      // reported as a failed edit, since the edited target is already valid.
      try
      {
         File.remove( backupPath );
      }
      catch ( cleanupError )
      {
         console.warningln( "<end><cbr>** Warning: Edited file installed, but backup " +
                            "could not be removed: <raw>" + backupPath + "</raw>" );
      }
   }

   writeEdited( sourcePath, keywords, targetPath = "" )
   {
      if ( targetPath.length == 0 )
         targetPath = this.outputPath( sourcePath );
      let stagedPath = this.temporaryPath( targetPath, "keyword_output" );
      let windows = new Array;
      let saved = false;

      try
      {
         windows = ImageWindow.open( sourcePath );
         if ( windows.length != 1 )
            throw new Error( "Multi-image containers are not supported." );

         windows[0].keywords = keywords;
         saved = windows[0].saveAs( stagedPath,
                                    false/*queryOptions*/,
                                    false/*allowMessages*/,
                                    true/*strict*/,
                                    false/*verifyOverwrite*/ );
         if ( !saved )
            throw new Error( "Unable to write staged output file." );
      }
      finally
      {
         for ( let i = 0; i < windows.length; ++i )
            if ( !windows[i].isNull )
               windows[i].forceClose();
         if ( !saved && File.exists( stagedPath ) )
            File.remove( stagedPath );
      }

      this.installStagedFile( stagedPath, targetPath );
      return targetPath;
   }

   copyUnchanged( sourcePath, targetPath = "" )
   {
      if ( targetPath.length == 0 )
         targetPath = this.outputPath( sourcePath );
      if ( sameFilePath( sourcePath, targetPath ) )
         return targetPath;

      let stagedPath = this.temporaryPath( targetPath, "keyword_copy" );
      try
      {
         File.copyFile( stagedPath, sourcePath );
         this.installStagedFile( stagedPath, targetPath );
      }
      catch ( error )
      {
         if ( File.exists( stagedPath ) )
            File.remove( stagedPath );
         throw error;
      }
      return targetPath;
   }
}

// ----------------------------------------------------------------------------
// Batch processor: validation and processing are deliberately separate.
// ----------------------------------------------------------------------------

class BatchKeywordProcessor
{
   constructor()
   {
      this.files = new Array;
      this.reader = new ImageMetadataReader;
      this.specification = new KeywordEditSpecification;
      this.writer = new TransactionalImageWriter;
      this.includeInvalidUnchanged = false;
   }

   validateFile( filePath )
   {
      try
      {
         let keywords = this.reader.read( filePath );
         let result = this.specification.validate( keywords );
         result.keywords = keywords;
         return result;
      }
      catch ( error )
      {
         return { ok:false, kind:"error", message:error.message, keywords:new Array };
      }
   }

   planOutputs()
   {
      let errors = new Array;
      let paths = new Array;
      let inputOwners = {};
      let outputOwners = {};
      let reserved = {};

      for ( let i = 0; i < this.files.length; ++i )
      {
         let key = pathKey( this.files[i] );
         if ( inputOwners[key] !== undefined )
            errors.push( "Duplicate input file: " + this.files[i] );
         else
            inputOwners[key] = i;
      }

      for ( let i = 0; i < this.files.length; ++i )
      {
         let outputPath = this.writer.outputPath( this.files[i], reserved );
         let outputKey = pathKey( outputPath );
         paths.push( outputPath );

         if ( outputOwners[outputKey] !== undefined )
            errors.push( "Multiple inputs map to the same output: " + outputPath );
         else
            outputOwners[outputKey] = i;
         reserved[outputKey] = true;

         // Replacing its own input is explicitly supported. Replacing another
         // input would make processing order destructive and is never allowed.
         if ( inputOwners[outputKey] !== undefined && inputOwners[outputKey] != i )
            errors.push( "Output would overwrite another input file: " + outputPath );
      }

      return { ok:errors.length == 0, errors:errors, paths:paths };
   }

   validateAll( progressCallback )
   {
      let results = new Array;
      for ( let i = 0; i < this.files.length; ++i )
      {
         console.writeln( format( "<end><cbr><br><b>Validating file %u of %u:</b>",
                                  i + 1, this.files.length ) );
         console.writeln( "<raw>" + this.files[i] + "</raw>" );
         let result = this.validateFile( this.files[i] );
         results.push( result );
         if ( progressCallback != null )
            progressCallback( i, result );
         CoreApplication.processEvents();
      }
      return results;
   }

   processAll( progressCallback, outputPlan )
   {
      if ( outputPlan == null || !outputPlan.ok )
         throw new Error( "A valid output plan is required." );

      let succeeded = 0;
      let failed = 0;
      let skipped = 0;

      for ( let i = 0; i < this.files.length; ++i )
      {
         let path = this.files[i];
         console.writeln( format( "<end><cbr><br><b>Processing file %u of %u:</b>",
                                  i + 1, this.files.length ) );
         console.writeln( "<raw>" + path + "</raw>" );

         let status;
         try
         {
            let validation = this.validateFile( path );
            if ( !validation.ok )
            {
               if ( validation.kind == "error" )
               {
                  ++failed;
                  status = validation;
                  console.criticalln( "<end><cbr>*** Error: " + validation.message );
               }
               else if ( this.includeInvalidUnchanged && File.exists( path ) )
               {
                  let copiedPath = this.writer.copyUnchanged( path, outputPlan.paths[i] );
                  ++skipped;
                  status = { ok:false, kind:"skip", message:"Unchanged: " + validation.message,
                             outputPath:copiedPath };
               }
               else
               {
                  ++skipped;
                  status = validation;
               }
            }
            else
            {
               let outputKeywords = this.specification.transformedKeywords(
                                       validation.keywords, validation );
               let outputPath = this.writer.writeEdited( path, outputKeywords,
                                                          outputPlan.paths[i] );
               ++succeeded;
               status = { ok:true, message:"Written", outputPath:outputPath };
               console.writeln( "Output: <raw>" + outputPath + "</raw>" );
            }
         }
         catch ( error )
         {
            ++failed;
            status = { ok:false, kind:"error", message:error.message };
            console.criticalln( "<end><cbr>*** Error: " + error.message );
         }

         if ( progressCallback != null )
            progressCallback( i, status );
         CoreApplication.processEvents();
      }

      console.writeln( format( "<end><cbr><br>===== %u written, %u failed, %u skipped =====",
                               succeeded, failed, skipped ) );
      return { succeeded:succeeded, failed:failed, skipped:skipped };
   }
}

// ----------------------------------------------------------------------------
// User interface. UI updates never perform file I/O except loadReference().
// ----------------------------------------------------------------------------

class BatchImageKeywordEditorDialog extends Dialog
{
   constructor( processor )
   {
      super();
      this.processor = processor;
      this.referenceIndex = -1;
      this.referenceKeywords = new Array;

      let labelWidth = this.font.width( "Manual fallback comment:" );
      let editWidth = 34 * this.font.width( "M" );

      // Input files -----------------------------------------------------------

      this.filesTree = new TreeBox( this );
      this.filesTree.numberOfColumns = 2;
      this.filesTree.setHeaderText( 0, "Input file" );
      this.filesTree.setHeaderText( 1, "Status" );
      this.filesTree.headerVisible = true;
      this.filesTree.rootDecoration = false;
      this.filesTree.alternateRowColor = true;
      this.filesTree.multipleSelection = true;
      this.filesTree.setScaledMinSize( 620, 190 );
      // Reserve 45% of the list width for file names and keep this proportion
      // when the dialog is resized.
      this.filesTree.setColumnWidth( 0, 280 );
      this.filesTree.setColumnWidth( 1, 330 );
      this.filesTree.onResize = function()
      {
         let available = Math.max( 200, this.width - 8 );
         let fileColumnWidth = Math.round( available * 0.45 );
         this.setColumnWidth( 0, fileColumnWidth );
         this.setColumnWidth( 1, available - fileColumnWidth );
      };
      this.filesTree.onNodeDoubleClicked = function( node, column )
      {
         this.dialog.setReferenceIndex( this.childIndex( node ) );
      };

      this.addButton = new PushButton( this );
      this.addButton.text = "Add Files";
      this.addButton.onClick = function()
      {
         let d = new OpenFileDialog;
         d.caption = "Select FITS or XISF Images";
         d.multipleSelections = true;
         d.loadImageFilters();
         if ( d.execute() )
         {
            for ( let i = 0; i < d.filePaths.length; ++i )
            {
               let ext = File.extractExtension( d.filePaths[i] ).toLowerCase();
               if ( ext == ".fit" || ext == ".fits" || ext == ".fts" || ext == ".xisf" )
               {
                  let duplicate = false;
                  for ( let j = 0; j < this.dialog.processor.files.length; ++j )
                     if ( sameFilePath( this.dialog.processor.files[j], d.filePaths[i] ) )
                     {
                        duplicate = true;
                        break;
                     }
                  if ( !duplicate )
                     this.dialog.processor.files.push( d.filePaths[i] );
               }
            }
            this.dialog.rebuildFileTree();
            if ( this.dialog.referenceIndex < 0 && this.dialog.processor.files.length > 0 )
               this.dialog.setReferenceIndex( 0 );
         }
      };

      this.removeButton = new PushButton( this );
      this.removeButton.text = "Remove Selected";
      this.removeButton.onClick = function()
      {
         for ( let i = this.dialog.filesTree.numberOfChildren; --i >= 0; )
            if ( this.dialog.filesTree.child( i ).selected )
               this.dialog.processor.files.splice( i, 1 );
         this.dialog.referenceIndex = this.dialog.processor.files.length > 0 ? 0 : -1;
         this.dialog.processor.reader.clearReferenceCache();
         this.dialog.rebuildFileTree();
         this.dialog.loadReference();
      };

      this.clearButton = new PushButton( this );
      this.clearButton.text = "Clear";
      this.clearButton.onClick = function()
      {
         this.dialog.processor.files.length = 0;
         this.dialog.referenceIndex = -1;
         this.dialog.referenceKeywords.length = 0;
         this.dialog.processor.reader.clearReferenceCache();
         this.dialog.rebuildFileTree();
         this.dialog.rebuildKeywordChoices();
         this.dialog.updateReferenceLabel();
      };

      this.reloadReferenceButton = new PushButton( this );
      this.reloadReferenceButton.text = "Reload Reference";
      this.reloadReferenceButton.onClick = function()
      {
         this.dialog.loadReference( true );
      };

      let fileButtonSizer = new VerticalSizer;
      fileButtonSizer.spacing = 4;
      fileButtonSizer.add( this.addButton );
      fileButtonSizer.add( this.removeButton );
      fileButtonSizer.add( this.clearButton );
      fileButtonSizer.addSpacing( 8 );
      fileButtonSizer.add( this.reloadReferenceButton );
      fileButtonSizer.addStretch();

      let filesSizer = new HorizontalSizer;
      filesSizer.spacing = 6;
      filesSizer.add( this.filesTree, 100 );
      filesSizer.add( fileButtonSizer );

      this.referenceLabel = new Label( this );
      this.referenceLabel.useRichText = true;
      this.referenceLabel.textAlignment = TextAlignment.Left | TextAlignment.VertCenter;

      let inputGroup = new GroupBox( this );
      inputGroup.title = "Input files (double-click a file to use it as reference)";
      inputGroup.sizer = new VerticalSizer;
      inputGroup.sizer.margin = 8;
      inputGroup.sizer.spacing = 5;
      inputGroup.sizer.add( filesSizer );
      inputGroup.sizer.add( this.referenceLabel );

      // Action ---------------------------------------------------------------

      this.actionCombo = new ComboBox( this );
      this.actionCombo.addItem( "Add" );
      this.actionCombo.addItem( "Edit" );
      this.actionCombo.addItem( "Remove" );
      this.actionCombo.currentItem = 0;
      this.actionCombo.onItemSelected = function( index )
      {
         this.dialog.processor.specification.action = index;
         this.dialog.updateControlStates();
         this.dialog.clearStatuses();
      };

      this.targetEdit = new Edit( this );
      this.targetEdit.minWidth = editWidth;
      this.targetEdit.onEditCompleted = function()
      {
         this.text = normalizedKeywordName( this.text );
         this.dialog.processor.specification.targetName = this.text;
         this.dialog.clearStatuses();
      };

      this.targetChoice = new ComboBox( this );
      this.targetChoice.onItemSelected = function( index )
      {
         if ( index > 0 )
         {
            let k = this.dialog.referenceKeywords[index - 1];
            this.dialog.targetEdit.text = k.name;
            this.dialog.processor.specification.targetName = k.name;
            this.dialog.valueEdit.text = k.value;
            this.dialog.commentEdit.text = k.comment;
            this.dialog.processor.specification.value = k.value;
            this.dialog.processor.specification.comment = k.comment;
            this.dialog.clearStatuses();
         }
      };

      this.allowDuplicateCheck = new CheckBox( this );
      this.allowDuplicateCheck.text = "Allow duplicate target keyword";
      this.allowDuplicateCheck.onCheck = function( checked )
      {
         this.dialog.processor.specification.allowDuplicate = checked;
         this.dialog.clearStatuses();
      };

      this.locationChoice = new ComboBox( this );
      this.locationChoice.onItemSelected = function( index )
      {
         this.dialog.processor.specification.locationName = index > 0 ?
            this.dialog.referenceKeywords[index - 1].name : "";
         this.dialog.updateControlStates();
         this.dialog.clearStatuses();
      };

      this.positionCombo = new ComboBox( this );
      this.positionCombo.addItem( "Before" );
      this.positionCombo.addItem( "After" );
      this.positionCombo.onItemSelected = function( index )
      {
         this.dialog.processor.specification.insertAfter = index == 1;
         this.dialog.clearStatuses();
      };

      let actionGrid = new VerticalSizer;
      actionGrid.spacing = 5;

      // PJSR provides horizontal and vertical sizers, but no GridSizer.
      // Build each two-column form row explicitly with a HorizontalSizer.
      function addGridRow( grid, parent, width, text, control )
      {
         let label = new Label( parent );
         label.text = text;
         label.setFixedWidth( width );
         label.textAlignment = TextAlignment.Right | TextAlignment.VertCenter;

         let row = new Control( parent );
         row.sizer = new HorizontalSizer;
         row.sizer.spacing = 5;
         row.sizer.add( label );
         row.sizer.add( control, 100 );
         grid.add( row );
      }

      addGridRow( actionGrid, this, labelWidth, "Action:", this.actionCombo );
      addGridRow( actionGrid, this, labelWidth, "Target keyword:", this.targetEdit );
      addGridRow( actionGrid, this, labelWidth, "Choose from reference:", this.targetChoice );

      let duplicateSizer = new HorizontalSizer;
      duplicateSizer.add( this.allowDuplicateCheck );
      duplicateSizer.addStretch();
      let duplicateControl = new Control( this );
      duplicateControl.sizer = duplicateSizer;
      addGridRow( actionGrid, this, labelWidth, "", duplicateControl );

      let locationSizer = new HorizontalSizer;
      locationSizer.spacing = 5;
      locationSizer.add( this.positionCombo );
      locationSizer.add( this.locationChoice, 100 );
      let locationControl = new Control( this );
      locationControl.sizer = locationSizer;
      addGridRow( actionGrid, this, labelWidth, "Insertion location:", locationControl );

      let actionGroup = new GroupBox( this );
      actionGroup.title = "Keyword operation";
      actionGroup.sizer = new VerticalSizer;
      actionGroup.sizer.margin = 8;
      actionGroup.sizer.add( actionGrid );

      // Data source ----------------------------------------------------------

      this.copySourceCheck = new CheckBox( this );
      this.copySourceCheck.text = "Copy value and comment from a source keyword";
      this.copySourceCheck.onCheck = function( checked )
      {
         this.dialog.processor.specification.copySource = checked;
         this.dialog.updateControlStates();
         this.dialog.clearStatuses();
      };

      this.sourceChoice = new ComboBox( this );
      this.sourceChoice.onItemSelected = function( index )
      {
         this.dialog.processor.specification.sourceName = index > 0 ?
            this.dialog.referenceKeywords[index - 1].name : "";
         this.dialog.clearStatuses();
      };

      this.fallbackCheck = new CheckBox( this );
      this.fallbackCheck.text = "Use manual data when source keyword is unavailable";
      this.fallbackCheck.checked = true;
      this.fallbackCheck.onCheck = function( checked )
      {
         this.dialog.processor.specification.manualFallback = checked;
         this.dialog.updateControlStates();
         this.dialog.clearStatuses();
      };

      this.valueEdit = new Edit( this );
      this.valueEdit.minWidth = editWidth;
      this.valueEdit.onEditCompleted = function()
      {
         this.dialog.processor.specification.value = this.text.trim();
         this.dialog.clearStatuses();
      };

      this.commentEdit = new Edit( this );
      this.commentEdit.minWidth = editWidth;
      this.commentEdit.onEditCompleted = function()
      {
         this.dialog.processor.specification.comment = this.text.trim();
         this.dialog.clearStatuses();
      };

      let sourceGrid = new VerticalSizer;
      sourceGrid.spacing = 5;
      let sourceCheckControl = new Control( this );
      sourceCheckControl.sizer = new HorizontalSizer;
      sourceCheckControl.sizer.add( this.copySourceCheck );
      sourceCheckControl.sizer.addStretch();
      addGridRow( sourceGrid, this, labelWidth, "", sourceCheckControl );
      addGridRow( sourceGrid, this, labelWidth, "Source keyword:", this.sourceChoice );
      let fallbackControl = new Control( this );
      fallbackControl.sizer = new HorizontalSizer;
      fallbackControl.sizer.add( this.fallbackCheck );
      fallbackControl.sizer.addStretch();
      addGridRow( sourceGrid, this, labelWidth, "", fallbackControl );
      addGridRow( sourceGrid, this, labelWidth, "Manual value:", this.valueEdit );
      addGridRow( sourceGrid, this, labelWidth, "Manual comment:", this.commentEdit );

      let sourceGroup = new GroupBox( this );
      sourceGroup.title = "Data source";
      sourceGroup.sizer = new VerticalSizer;
      sourceGroup.sizer.margin = 8;
      sourceGroup.sizer.add( sourceGrid );
      this.sourceGroup = sourceGroup;

      // Output ---------------------------------------------------------------

      this.outputDirectoryEdit = new Edit( this );
      this.outputDirectoryEdit.readOnly = true;
      this.outputDirectoryEdit.minWidth = editWidth;

      this.outputDirectoryButton = new ToolButton( this );
      this.outputDirectoryButton.icon = this.scaledResource( ":/browser/select-file.png" );
      this.outputDirectoryButton.setScaledFixedSize( 20, 20 );
      this.outputDirectoryButton.onClick = function()
      {
         let d = new GetDirectoryDialog;
         d.caption = "Select Output Directory";
         d.initialPath = this.dialog.processor.writer.outputDirectory;
         if ( d.execute() )
         {
            this.dialog.processor.writer.outputDirectory = d.directoryPath;
            this.dialog.outputDirectoryEdit.text = d.directoryPath;
         }
      };

      this.clearOutputDirectoryButton = new ToolButton( this );
      this.clearOutputDirectoryButton.icon = this.scaledResource( ":/icons/clear.png" );
      this.clearOutputDirectoryButton.setScaledFixedSize( 20, 20 );
      this.clearOutputDirectoryButton.toolTip = "Use each input file's directory";
      this.clearOutputDirectoryButton.onClick = function()
      {
         this.dialog.processor.writer.outputDirectory = "";
         this.dialog.outputDirectoryEdit.text = "";
      };

      let directorySizer = new HorizontalSizer;
      directorySizer.spacing = 4;
      directorySizer.add( this.outputDirectoryEdit, 100 );
      directorySizer.add( this.outputDirectoryButton );
      directorySizer.add( this.clearOutputDirectoryButton );
      let directoryControl = new Control( this );
      directoryControl.sizer = directorySizer;

      this.prefixEdit = new Edit( this );
      this.prefixEdit.onEditCompleted = function()
      {
         this.dialog.processor.writer.prefix = this.text;
      };

      this.postfixEdit = new Edit( this );
      this.postfixEdit.text = "_f";
      this.postfixEdit.onEditCompleted = function()
      {
         this.dialog.processor.writer.postfix = this.text;
      };

      let nameSizer = new HorizontalSizer;
      nameSizer.spacing = 5;
      let prefixLabel = new Label( this );
      prefixLabel.text = "Prefix:";
      prefixLabel.textAlignment = TextAlignment.Right | TextAlignment.VertCenter;
      let postfixLabel = new Label( this );
      postfixLabel.text = "Postfix:";
      postfixLabel.textAlignment = TextAlignment.Right | TextAlignment.VertCenter;
      nameSizer.add( prefixLabel );
      nameSizer.add( this.prefixEdit );
      nameSizer.addSpacing( 12 );
      nameSizer.add( postfixLabel );
      nameSizer.add( this.postfixEdit );
      nameSizer.addStretch();
      let nameControl = new Control( this );
      nameControl.sizer = nameSizer;

      this.overwriteCheck = new CheckBox( this );
      this.overwriteCheck.text = "Overwrite existing files (empty prefix/postfix allows safe in-place replacement)";
      this.overwriteCheck.onCheck = function( checked )
      {
         this.dialog.processor.writer.overwrite = checked;
      };

      this.includeInvalidCheck = new CheckBox( this );
      this.includeInvalidCheck.text = "Copy invalid/skipped files unchanged";
      this.includeInvalidCheck.onCheck = function( checked )
      {
         this.dialog.processor.includeInvalidUnchanged = checked;
      };

      let outputGrid = new VerticalSizer;
      outputGrid.spacing = 5;
      addGridRow( outputGrid, this, labelWidth, "Output directory:", directoryControl );
      addGridRow( outputGrid, this, labelWidth, "Output file name:", nameControl );
      let overwriteControl = new Control( this );
      overwriteControl.sizer = new HorizontalSizer;
      overwriteControl.sizer.add( this.overwriteCheck );
      overwriteControl.sizer.addStretch();
      addGridRow( outputGrid, this, labelWidth, "", overwriteControl );
      let invalidControl = new Control( this );
      invalidControl.sizer = new HorizontalSizer;
      invalidControl.sizer.add( this.includeInvalidCheck );
      invalidControl.sizer.addStretch();
      addGridRow( outputGrid, this, labelWidth, "", invalidControl );

      let outputGroup = new GroupBox( this );
      outputGroup.title = "Output";
      outputGroup.sizer = new VerticalSizer;
      outputGroup.sizer.margin = 8;
      outputGroup.sizer.add( outputGrid );

      // Bottom buttons -------------------------------------------------------

      this.copyrightLabel = new Label( this );
      this.copyrightLabel.useRichText = true;
      this.copyrightLabel.text = "<p style='line-height:120%'>Copyright &copy; 2021-2024, Mike Cranfield<br/>" +
                                 "Modifications Copyright &copy; 2026, Fluorine Zhu</p>";

      this.validateButton = new PushButton( this );
      this.validateButton.text = "Validate";
      this.validateButton.icon = this.scaledResource( ":/icons/gear.png" );
      this.validateButton.onClick = function()
      {
         this.dialog.runValidation();
      };

      this.processButton = new PushButton( this );
      this.processButton.text = "Process";
      this.processButton.icon = this.scaledResource( ":/icons/ok.png" );
      this.processButton.onClick = function()
      {
         this.dialog.runProcessing();
      };

      this.closeButton = new PushButton( this );
      this.closeButton.text = "Close";
      this.closeButton.icon = this.scaledResource( ":/icons/cancel.png" );
      this.closeButton.onClick = function()
      {
         this.dialog.cancel();
      };

      let bottomSizer = new HorizontalSizer;
      bottomSizer.spacing = 6;
      bottomSizer.add( this.copyrightLabel );
      bottomSizer.addStretch();
      bottomSizer.add( this.validateButton );
      bottomSizer.add( this.processButton );
      bottomSizer.add( this.closeButton );

      this.sizer = new VerticalSizer;
      this.sizer.margin = 8;
      this.sizer.spacing = 7;
      this.sizer.add( inputGroup, 100 );
      this.sizer.add( actionGroup );
      this.sizer.add( sourceGroup );
      this.sizer.add( outputGroup );
      this.sizer.add( bottomSizer );

      this.windowTitle = TITLE + " — Version " + VERSION;
      this.userResizable = true;
      this.rebuildFileTree();
      this.rebuildKeywordChoices();
      this.updateReferenceLabel();
      this.updateControlStates();
      this.adjustToContents();
   }

   rebuildFileTree()
   {
      this.filesTree.clear();
      for ( let i = 0; i < this.processor.files.length; ++i )
      {
         let node = new TreeBoxNode( this.filesTree );
         node.setText( 0, File.extractNameAndExtension( this.processor.files[i] ) );
         node.setToolTip( 0, this.processor.files[i] );
         node.setText( 1, "" );
      }
   }

   clearStatuses()
   {
      for ( let i = 0; i < this.filesTree.numberOfChildren; ++i )
      {
         this.filesTree.child( i ).setText( 1, "" );
         this.filesTree.child( i ).setIcon( 1, "" );
      }
   }

   showStatus( index, result )
   {
      if ( index < 0 || index >= this.filesTree.numberOfChildren )
         return;
      let node = this.filesTree.child( index );
      node.setText( 1, result.ok ? (result.message || "Valid") : result.message );
      node.setIcon( 1, result.ok ? ":/icons/check.png" : ":/icons/warning.png" );
   }

   setReferenceIndex( index )
   {
      if ( index < 0 || index >= this.processor.files.length )
         return;
      this.referenceIndex = index;
      this.loadReference();
   }

   updateReferenceLabel()
   {
      if ( this.referenceIndex < 0 || this.referenceIndex >= this.processor.files.length )
         this.referenceLabel.text = "<b>Reference:</b> None";
      else
         this.referenceLabel.text = "<b>Reference:</b> " + this.processor.files[this.referenceIndex];
   }

   loadReference( forceReload = false )
   {
      this.updateReferenceLabel();
      this.referenceKeywords.length = 0;
      if ( this.referenceIndex >= 0 && this.referenceIndex < this.processor.files.length )
      {
         try
         {
            console.writeln( "<end><cbr><br><b>Reading reference metadata:</b>" );
            console.writeln( "<raw>" + this.processor.files[this.referenceIndex] + "</raw>" );
            this.referenceKeywords = this.processor.reader.readReference(
               this.processor.files[this.referenceIndex], forceReload );
         }
         catch ( error )
         {
            (new MessageBox( error.message, TITLE, StdIcon.Error, StdButton.Ok )).execute();
         }
      }
      this.rebuildKeywordChoices();
   }

   rebuildKeywordChoices()
   {
      let currentTarget = normalizedKeywordName( this.targetEdit ? this.targetEdit.text : "" );
      let currentLocation = normalizedKeywordName( this.processor.specification.locationName );
      let currentSource = normalizedKeywordName( this.processor.specification.sourceName );

      this.targetChoice.clear();
      this.locationChoice.clear();
      this.sourceChoice.clear();
      this.targetChoice.addItem( "(select from reference)" );
      this.locationChoice.addItem( "(append at end)" );
      this.sourceChoice.addItem( "(select source)" );

      let targetItem = 0;
      let locationItem = 0;
      let sourceItem = 0;
      for ( let i = 0; i < this.referenceKeywords.length; ++i )
      {
         let name = this.referenceKeywords[i].name;
         this.targetChoice.addItem( name );
         this.locationChoice.addItem( name );
         this.sourceChoice.addItem( name );
         if ( normalizedKeywordName( name ) == currentTarget ) targetItem = i + 1;
         if ( normalizedKeywordName( name ) == currentLocation ) locationItem = i + 1;
         if ( normalizedKeywordName( name ) == currentSource ) sourceItem = i + 1;
      }
      this.targetChoice.currentItem = targetItem;
      this.locationChoice.currentItem = locationItem;
      this.sourceChoice.currentItem = sourceItem;
   }

   updateControlStates()
   {
      let spec = this.processor.specification;
      let removal = spec.action == 2;
      this.allowDuplicateCheck.enabled = spec.action == 0;
      this.locationChoice.enabled = spec.action == 0;
      this.positionCombo.enabled = spec.action == 0 && spec.locationName.length > 0;
      this.sourceGroup.enabled = !removal;
      this.sourceChoice.enabled = !removal && spec.copySource;
      this.fallbackCheck.enabled = !removal && spec.copySource;
      let manualEnabled = !removal && (!spec.copySource || spec.manualFallback);
      this.valueEdit.enabled = manualEnabled;
      this.commentEdit.enabled = manualEnabled;
   }

   runValidation()
   {
      if ( this.processor.files.length == 0 )
      {
         (new MessageBox( "No input files have been specified.", TITLE,
                          StdIcon.Error, StdButton.Ok )).execute();
         return;
      }
      console.show();
      console.abortEnabled = true;
      let dialog = this;
      this.enabled = false;
      try
      {
         this.processor.validateAll( function( index, result )
         {
            dialog.showStatus( index, result );
         } );
      }
      catch ( error )
      {
         (new MessageBox( error.message, TITLE, StdIcon.Error, StdButton.Ok )).execute();
      }
      finally
      {
         this.enabled = true;
      }
   }

   runProcessing()
   {
      if ( !this.checkBeforeProcessing() )
         return;

      console.show();
      console.abortEnabled = true;
      let outputPlan = this.processor.planOutputs();
      if ( !outputPlan.ok )
      {
         let message = "<p><b>Output path conflict:</b></p><ul>";
         for ( let i = 0; i < outputPlan.errors.length; ++i )
            message += "<li>" + outputPlan.errors[i] + "</li>";
         message += "</ul><p>Change the output directory, prefix/postfix, or input list.</p>";
         (new MessageBox( message, TITLE, StdIcon.Error, StdButton.Ok )).execute();
         return;
      }

      this.enabled = false; // Parameters must not change while a batch is running.
      let summary;
      let dialog = this;
      try
      {
         summary = this.processor.processAll( function( index, result )
         {
            dialog.showStatus( index, result );
         }, outputPlan );
      }
      catch ( error )
      {
         (new MessageBox( error.message, TITLE, StdIcon.Error, StdButton.Ok )).execute();
         return;
      }
      finally
      {
         this.enabled = true;
      }

      // An in-place operation may have changed the reference file metadata.
      // Invalidate the cache now; it will be refreshed only when needed.
      this.processor.reader.clearReferenceCache();
      this.loadReference( true );

      (new MessageBox( format( "%u file(s) written, %u failed, %u skipped.",
                               summary.succeeded, summary.failed, summary.skipped ),
                       TITLE, summary.failed > 0 ? StdIcon.Warning : StdIcon.Information,
                       StdButton.Ok )).execute();
   }

   checkBeforeProcessing()
   {
      if ( this.processor.files.length == 0 )
      {
         (new MessageBox( "No input files have been specified.", TITLE,
                          StdIcon.Error, StdButton.Ok )).execute();
         return false;
      }

      if ( this.processor.writer.outputDirectory.length > 0 &&
           !File.directoryExists( this.processor.writer.outputDirectory ) )
      {
         (new MessageBox( "The output directory does not exist.", TITLE,
                          StdIcon.Error, StdButton.Ok )).execute();
         return false;
      }

      if ( this.processor.writer.overwrite )
      {
         let answer = (new MessageBox(
            "<p><b>Overwrite is enabled.</b></p>" +
            "<p>Existing targets will be replaced transactionally. If prefix and postfix " +
            "are empty, input files can be replaced in place.</p><p>Continue?</p>",
            TITLE, StdIcon.Warning, StdButton.Yes, StdButton.No )).execute();
         if ( answer != StdButton.Yes )
            return false;
      }
      return true;
   }
}

// ----------------------------------------------------------------------------
// Entry point
// ----------------------------------------------------------------------------

function main()
{
   let processor = new BatchKeywordProcessor;
   let dialog = new BatchImageKeywordEditorDialog( processor );
   dialog.execute();
}

main();

// ----------------------------------------------------------------------------
// EOF BatchImageKeywordEditor.js
