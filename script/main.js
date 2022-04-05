/**
 * @fileOverview Handsontable grid with standardized COVID-19 metadata.
 * Implemented with vanilla JavaScript and locally downloaded libaries.
 * Functionality for uploading, downloading and validating data.
 * 
 * NOTE: If you are using Chrome javascript debugger console: using this
 * tool disables double clicking on HandsonTable cells, so you won't see 
 * column help or cell insert/delete row actions, and it seems to disable 
 * the createHot afterRender event/method.
 */

const VERSION = '0.15.3';
const VERSION_TEXT = 'DataHarmonizer provenance: v' + VERSION;

/* A list of templates available for this app, which will be displayed in a 
 * menu. A template can also be accessed by adding it as a folder name in the
 * URL parameter. This enables testing of a template even if it hasn't been incorporated into the list below.
 *
 * main.html?template=test_template
 *
 * MIxS example schemas are available at:
 * https://github.com/GenomicsStandardsConsortium/mixs-source/tree/main/model/schema
 *
 */

  "canada_covid19": {
    "CanCOGeN Covid-19": {
      "name": "CanCOGeN Covid-19",
      "status": "published"
    }
  },
  "phac_dexa": {
    "PHAC Dexa (ALPHA)": {
      "name": "PHAC Dexa (ALPHA)",
      "status": "draft"
    }
  },
  "grdi": {
    "GRDI (ALPHA)": {
      "name": "GRDI (ALPHA)",
      "status": "draft"
    }
  },
  "gisaid": {
    "GISAID (ALPHA)": {
      "name": "GISAID (ALPHA)",
      "status": "draft"
    }
  },
  "pha4ge": {
    "PHA4GE": {
      "name": "PHA4GE",
      "status": "published"
    }
  }
}

// Currently selected cell range[row,col,row2,col2]
CURRENT_SELECTION = [null,null,null,null];

// Current data table content. Used by LinkML instead of data.js
TABLE = [];

/**
 * Controls what dropdown options are visible depending on grid settings.
 */
const toggleDropdownVisibility = () => {
  $('.hidden-dropdown-item').hide();

  $('#settings-dropdown-btn-group').off()
      .on('show.bs.dropdown', () => {

        const hiddenRows = HOT.getPlugin('hiddenRows').hiddenRows;
        
        if (hiddenRows.length) {
          $('#show-all-rows-dropdown-item').show();
        }

        if (!jQuery.isEmptyObject(INVALID_CELLS)) {
          $('#show-invalid-rows-dropdown-item').show();
        }
        const validRowCount = HOT.countRows() - HOT.countEmptyRows();
        if (validRowCount > Object.keys(INVALID_CELLS).length) {
          $('#show-valid-rows-dropdown-item').show();
        }
      })
      .on('hide.bs.dropdown', () => {
        $('.hidden-dropdown-item').hide();
      });
};


/**
 * Get a flat array of all fields in `data.json`.
 * @param {Object} data See SCHEMA.
 * @return {Array<Object>} Array of all objects under `children` in `data.json`.
 */
const getFields = (data) => {
  return Array.prototype.concat.apply([], data.map(parent => parent.children));
};

/**
 * Create a blank instance of Handsontable.
 * @param {Object} data See TABLE.
 * @return {Object} Handsontable instance.
 */
const createHot = (data) => {
  const fields = getFields(data);
  const hot = Handsontable($('#grid')[0], {
    nestedHeaders: getNestedHeaders(data),
    columns: getColumns(data),
    colHeaders: true,
    rowHeaders: true,
    manualColumnResize: true,
    //colWidths: [100], //Just fixes first column width
    contextMenu: ["remove_row","row_above","row_below"],
    minRows: 100,
    minSpareRows: 100,
    width: '100%',
    height: '75vh',
    fixedColumnsLeft: 1,
    hiddenColumns: {
      copyPasteEnabled: true,
      indicators: true,
      columns: [],
    },
    hiddenRows: {
      rows: [],
    },
    // Handsontable's validation is extremely slow with large datasets
    invalidCellClassName: '',
    licenseKey: 'non-commercial-and-evaluation',
    // beforeChange source: https://handsontable.com/docs/8.1.0/tutorial-using-callbacks.html#page-source-definition
    beforeChange: function(changes, source) { 
      if (!changes) return;

      // When a change in one field triggers a change in another field.
      var triggered_changes = []; 

      for (const change of changes) {
        const column = change[1];
        // Check field change rules
        fieldChangeRules(change, fields, triggered_changes);
      }
      // Add any indirect field changes onto end of existing changes.
      if (triggered_changes) 
        changes.push(...triggered_changes);
    },
    afterInit: () => {
      $('#next-error-button,#no-error-button').hide();
    },
    afterSelection: (row, column, row2, column2, preventScrolling, selectionLayerLevel) => {
      window.CURRENT_SELECTION = [row, column, row2, column2];
    },
    afterRender: (isForced) => {
      $('#header-row').css('visibility', 'visible');
      $('#footer-row').css('visibility', 'visible');

      // Bit of a hackey way to RESTORE classes to secondary headers. They are
      // removed by Handsontable when re-rendering main table.
      $('.secondary-header-text').each((_, e) => {
        const $cellElement = $(e).closest('th');
        $cellElement.addClass('secondary-header-cell');
        if ($(e).hasClass('required')) {
          $cellElement.addClass('required');
        } else if ($(e).hasClass('recommended')) {
          $cellElement.addClass('recommended');
        } 
      });
    },
    afterRenderer: (TD, row, col) => {
      if (INVALID_CELLS.hasOwnProperty(row)) {
        if (INVALID_CELLS[row].hasOwnProperty(col)) {
          const msg = INVALID_CELLS[row][col];
          $(TD).addClass(msg ? 'empty-invalid-cell' : 'invalid-cell');
        }
      }
    },
  });

  return enableMultiSelection(hot, data);
};

/**
 * Create a matrix containing the nested headers supplied to Handsontable.
 * These headers are HTML strings, with useful selectors for the primary and
 * secondary header cells.
 * @param {Object} data See TABLE.
 * @return {Array<Array>} Nested headers for Handontable grid.
 */
const getNestedHeaders = (data) => {
  const rows = [[], []];
  for (const parent of data) {
    rows[0].push({
      label: `<h5 class="pt-2 pl-1">${parent.title}</h5>`,
      colspan: parent.children.length
    });
    for (const child of parent.children) {
      const required = child.required ? ' required' : '';
      const recommended = child.recommended ? ' recommended' : '';
      const name = child.title;
      rows[1].push(`<div class="secondary-header-text${required}${recommended}">${name}</div>`);
    }
  }
  return rows;
};

/**
 * Create a matrix containing the grid's headers. Empty strings are used to
 * indicate merged cells.
 * @param {Object} data See TABLE.
 * @return {Array<Array<String>>} Grid headers.
 */
const getFlatHeaders = (data) => {
  const rows = [[], []];

  for (const parent of data) {
    let min_cols = parent.children.length;
    if (min_cols < 1) {
      // Close current dialog and switch to error message
      //$('specify-headers-modal').modal('hide');
      //$('#unmapped-headers-modal').modal('hide');
      const errMsg = `The template for the loaded file has a configuration error:<br/>
      <strong>${parent.title}</strong><br/>
      This is a field that has no parent, or a section that has no fields.`;
      $('#unmapped-headers-list').html(errMsg);
      $('#unmapped-headers-modal').modal('show');

      return false;
    }
    rows[0].push(parent.title);
    // pad remainder of first row columns with empty values
    if (min_cols > 1)
      rows[0].push(...Array(min_cols-1).fill(''));
    // Now add 2nd row child titles
    rows[1].push(...parent.children.map(child => child.title));
  }
  return rows;
};

/**
 * Create an array of cell properties specifying data type for all grid columns.
 * AVOID EMPLOYING VALIDATION LOGIC HERE -- HANDSONTABLE'S VALIDATION
 * PERFORMANCE IS AWFUL. WE MAKE OUR OWN IN `VALIDATE_GRID`.
 * @param {Object} data See TABLE.
 * @return {Array<Object>} Cell properties for each grid column.
 */
const getColumns = (data) => {
  let ret = [];
  for (const field of getFields(data)) {
    const col = {};
    if (field.required) {
      col.required = field.required;
    }
    if (field.recommended) {
      col.recommended = field.recommended;
    }
    // Compile field's regular expression for quick application.
    if (field.pattern) {
      field.pattern = new RegExp(field.pattern);
    }
    switch (field.datatype) {
      case 'xs:date': 
        col.type = 'date';
        // This controls calendar popup date format, default is mm/dd/yyyy
        // See https://handsontable.com/docs/8.3.0/Options.html#correctFormat
        col.dateFormat = 'YYYY-MM-DD';
        // If correctFormat = true, then on import and on data
        // entry of cell will convert date values like "2020" to "2020-01-01"
        // automatically.
        col.correctFormat = false; 
        break;
      case 'select':
        col.type = 'autocomplete';
        col.source = field.flatVocabulary;
        if (field.dataStatus) col.source.push(...field.dataStatus);
        col.trimDropdown = false;
        break;
      case 'xs:nonNegativeInteger':
      case 'xs:decimal':
        if (field.dataStatus) {
          col.type = 'autocomplete';
          col.source = field.dataStatus;
        }
        break;
      case 'multiple':
        // TODO: we need to find a better way to enable multi-selection
        col.editor = 'text';
        col.renderer = 'autocomplete';
        col.source = field.flatVocabulary;
        if (field.dataStatus) col.source.push(...field.dataStatus);
        break;
    }
    ret.push(col);
  }
  return ret;
};


/**
 * Enable multiselection on select rows.
 * Indentation workaround: multiples of "  " double space before label are 
 * taken to be indentation levels.
 * @param {Object} hot Handonstable grid instance.
 * @param {Object} data See TABLE.
 * @return {Object} Grid instance with multiselection enabled on columns
 * specified as such in the vocabulary.
 */
const enableMultiSelection = (hot, data) => {
  const fields = getFields(data);
  hot.updateSettings({
    afterBeginEditing: function(row, col) {
      if (fields[col].multivalued === true) {
        const value = this.getDataAtCell(row, col);
        let selections = value && value.split(';') || [];
        selections = selections.map(x => x.trim());
        selections2 = selections.filter(function (el) {return el != ''});
        // Cleanup of empty values that can occur with leading/trailing or double ";"
        if (selections.length != selections2.length)
          this.setDataAtCell(row, col, selections2.join('; '), 'thisChange');
        const self = this;
        let content = '';
        fields[col].flatVocabulary.forEach(function(field, i) {
          const field_trim = field.trim();
          let selected = selections.includes(field_trim) ? 'selected="selected"' : '';
          let indentation = field.search(/\S/) * 8; // pixels
          content += `<option value="${field_trim}" ${selected}' style="padding-left:${indentation}px">${field}</option>`;
        })

        $('#field-description-text').html(`${fields[col].title}<select multiple class="multiselect" rows="15">${content}</select>`);
        $('#field-description-modal').modal('show');
        $('#field-description-text .multiselect')
          .chosen() // must be rendered when html is visible
          .change(function () {
            let newValCsv = $('#field-description-text .multiselect').val().join('; ')
            self.setDataAtCell(row, col, newValCsv, 'thisChange');
          }); 
      }
    },
  });
  return hot;
};

/**
 * Get grid data without trailing blank rows.
 * @param {Object} hot Handonstable grid instance.
 * @return {Array<Array<String>>} Grid data without trailing blank rows.
 */
const getTrimmedData = (hot) => {
  const gridData = hot.getData();
  let lastEmptyRow = -1;
  for (let i=gridData.length; i>=0; i--) {
    if (hot.isEmptyRow(i)) {
      lastEmptyRow = i;
    } else {
      break;
    }
  }

  return lastEmptyRow === -1 ? gridData : gridData.slice(0, lastEmptyRow);
};

/**
 * Run void function behind loading screen.
 * Adds function to end of call queue. Does not handle functions with return
 * vals, unless the return value is a promise. Even then, it only waits for the
 * promise to resolve, and does not actually do anything with the value
 * returned from the promise.
 * @param {function} fn - Void function to run.
 * @param {Array} [args=[]] - Arguments for function to run.
 */
const runBehindLoadingScreen = (fn, args=[]) => {
  $('#loading-screen').show('fast', 'swing', function() {
    setTimeout(() => {
      const ret = fn.apply(null, args);
      if (ret && ret.then) {
        ret.then(() => {
          $('#loading-screen').hide();
        });
      } else {
        $('#loading-screen').hide();
      }
    }, 0);
  });
};

/**
 * Modify visibility of columns in grid. This function should only be called
 * after clicking a DOM element used to toggle column visibilities.
 * @param {String} id Id of element clicked to trigger this function. Defaults to show all.
 * @param {Object} data See TABLE.
 * @param {Object} hot Handsontable instance of grid.
 */
const changeColVisibility = (id = 'show-all-cols-dropdown-item', data, hot) => {
  // Grid becomes sluggish if viewport outside visible grid upon re-rendering
  hot.scrollViewportTo(0, 1);
  const domEl = $('#' + id);

  // Un-hide all currently hidden cols
  const hiddenColsPlugin = hot.getPlugin('hiddenColumns');
  hiddenColsPlugin.showColumns(hiddenColsPlugin.hiddenColumns);

  // Hide user-specied cols
  const hiddenColumns = [];

  // If accessed by menu, disable that menu item, and enable the others
  $('#show-all-cols-dropdown-item, #show-required-cols-dropdown-item, #show-recommended-cols-dropdown-item, .show-section-dropdown-item')
    .removeClass('disabled');
  domEl.addClass('disabled');

  //Request may be for only required fields, or required+recommended fields
  let required = (id === 'show-required-cols-dropdown-item');
  let recommended = (id === 'show-recommended-cols-dropdown-item');
  if (required || recommended) {
    getFields(data).forEach(function(field, i) {
      if (required && !field.required)
        hiddenColumns.push(i);
      else 
        if (recommended && !(field.required || field.recommended))
          hiddenColumns.push(i);
    });
  }

  // prefix of ID indicates if it is a command to show just one section.
  else if (id.indexOf('show-section-') === 0) {
    const section_name = domEl.text();
    let column_ptr = 0;
    for (section of data) {
      for (column of section.children) {
        // First condition ensures first (row identifier) column is not hidden
        if (column_ptr > 0 && section.title != section_name) {
          hiddenColumns.push(column_ptr)
        }
        column_ptr ++;
      }
    };
  }
  hiddenColsPlugin.hideColumns(hiddenColumns);
  hot.render();
};

/**
 * Modify visibility of rows in grid. This function should only be called
 * after clicking a DOM element used to toggle row visibilities.
 * @param {String} id Id of element clicked to trigger this function.
 * @param {Object<Number, Set<Number>>} invalidCells See `getInvalidCells`
 *     return value.
 * @param {Object} hot Handsontable instance of grid.
 */
const changeRowVisibility = (id, invalidCells, hot) => {
  // Grid becomes sluggish if viewport outside visible grid upon re-rendering
  hot.scrollViewportTo(0, 1);

  // Un-hide all currently hidden cols
  const hiddenRowsPlugin = hot.getPlugin('hiddenRows');
  hiddenRowsPlugin.showRows(hiddenRowsPlugin.hiddenRows);

  // Hide user-specified rows
  const rows = [...Array(HOT.countRows()).keys()];
  const emptyRows = rows.filter(row => hot.isEmptyRow(row));
  let hiddenRows = [];

  if (id === 'show-valid-rows-dropdown-item') {
    hiddenRows = Object.keys(invalidCells).map(Number);
    hiddenRows = [...hiddenRows, ...emptyRows];
  } 
  else if (id === 'show-invalid-rows-dropdown-item') {
    const invalidRowsSet = new Set(Object.keys(invalidCells).map(Number));
    hiddenRows = rows.filter(row => !invalidRowsSet.has(row));
    hiddenRows = [...hiddenRows, ...emptyRows];
  }

  hiddenRowsPlugin.hideRows(hiddenRows);
  hot.render();
}

/**
 * Get the 0-based y-index of every field on the grid.
 * @param {Object} data See TABLE.
 * @return {Object<String, Number>} Fields mapped to their 0-based y-index on
 *     the grid.
 */
const getFieldYCoordinates = (data) => {
  const ret = {};
  for (const [i, field] of getFields(data).entries()) {
    ret[field.title] = i;
  }
  return ret;
};

const getColumnCoordinates = (data) => {
  const ret = {};
  let column_ptr = 0;
  for (section of data) {
    ret[section.title] = column_ptr;
    for (column of section.children) {
      ret[' . . ' + column.title] = column_ptr;
      column_ptr ++;
    }
  }
  return ret;
};

/**
 * Scroll grid to specified column.
 * @param {String} row 0-based index of row to scroll to.
 * @param {String} column 0-based index of column to scroll to.
 * @param {Object} data See TABLE.
 * @param {Object} hot Handsontable instance of grid.
 */
const scrollTo = (row, column, data, hot) => {

  const hiddenCols = hot.getPlugin('hiddenColumns').hiddenColumns;
  if (hiddenCols.includes(column)) 
    changeColVisibility(undefined, data, hot);

  hot.selectCell(parseInt(row), parseInt(column), parseInt(row), parseInt(column), true);
  //Ensures field is positioned on left side of screen.
  hot.scrollViewportTo(row, column);

};



/**
 * Get an HTML string that describes a field, its examples etc. for display
 * in column header.
 * @param {Object} field Any object under `children` in `data.js`.
 * @return {String} HTML string describing field.
 */
const getComment = (field) => {
  let ret = `<p><strong>Label</strong>: ${field.title}</p>
<p><strong>Description</strong>: ${field.description}</p>
<p><strong>Guidance</strong>: ${field.guidance}</p>
<p><strong>Examples</strong>: ${field.examples}</p>`;
  if (field.dataStatus) {
    ret += `<p><strong>Null values</strong>: ${field.dataStatus}</p>`;
  }
  return ret;
};

/**
 * Enable template folder's export.js export options to be loaded dynamically.
 */
const exportOnload = () =>  {
  const select = $("#export-to-format-select")[0];
  while (select.options.length > 1) {
    select.remove(1);
  }
  for (const option in EXPORT_FORMATS) {
    select.append(new Option(option, option));
  }
};

/**
 * Show available templates, with sensitivity to "view draft template" checkbox
 */
const templateOptions = () =>  {
  // Select menu for available templates
  const select = $("#select-template");
  select.empty();

  const view_drafts = $("#view-template-drafts").is(':checked');
  for ([folder, templates] of Object.entries(TEMPLATES)) {
    for ([name, template] of Object.entries(templates)) {
      let label = folder + '/' + name;
      if (view_drafts || template.status == 'published') {
        select.append(new Option(label, label));
      }
    }
  }
};


/**
 * Wire up user controls which only need to happen once on load of page.
 */
const setupTriggers = () => {

  $('#version-dropdown-item').text(VERSION);

  // Select menu for available templates
  templateOptions();

  // Enable template to be loaded dynamically
  $('#select-template-load').on('click', (e) => {
    const template_folder = $('#select-template').val();
    setupTemplate(template_folder);
  })
  // Triggers show/hide of draft templates
  $("#view-template-drafts").on('change', templateOptions);

  // File -> New
  $('#new-dropdown-item, #clear-data-confirm-btn').click((e) => {
    const isNotEmpty = HOT.countRows() - HOT.countEmptyRows();
    if (e.target.id === 'new-dropdown-item' && isNotEmpty) {
      $('#clear-data-warning-modal').modal('show');
    } 
    else {
      // Clear current file indication
      $('#file_name_display').text('');

      runBehindLoadingScreen(() => {
        window.INVALID_CELLS = {};
        HOT.destroy();
        window.HOT = createHot(TABLE);
      });
    }
  });

  // File -> Open
  const $fileInput = $('#open-file-input');

  $fileInput.change(() => {
    const file = $fileInput[0].files[0];
    const ext = file.name.split('.').pop();
    const acceptedExts = ['xlsx', 'xls', 'tsv', 'csv'];
    if (!acceptedExts.includes(ext)) {
      const errMsg = `Only ${acceptedExts.join(', ')} files are supported`;
      $('#open-err-msg').text(errMsg);
      $('#open-error-modal').modal('show');
    } else {
      window.INVALID_CELLS = {};
      runBehindLoadingScreen(openFile, [file, HOT, TABLE, XLSX]);
    }
    // Allow consecutive uploads of the same file
    $fileInput[0].value = '';

    $('#next-error-button,#no-error-button').hide();
    window.CURRENT_SELECTION = [null,null,null,null];

  });
  // Reset specify header modal values when the modal is closed
  $('#specify-headers-modal').on('hidden.bs.modal', () => {
    $('#expected-headers-div').empty();
    $('#actual-headers-div').empty();
    $('#specify-headers-err-msg').hide();
    $('#specify-headers-confirm-btn').unbind();
  });

  // File -> Save
  $('#save-as-dropdown-item').click(() => {
    if (!jQuery.isEmptyObject(INVALID_CELLS)) {
      $('#save-as-invalid-warning-modal').modal('show');
    } else {
      $('#save-as-modal').modal('show');
    }
  });


  $('#save-as-confirm-btn').click(() => {
    try {
      const baseName = $('#base-name-save-as-input').val();
      const ext = $('#file-ext-save-as-select').val();
      const matrix = [...getFlatHeaders(TABLE), ...getTrimmedData(HOT)];
      runBehindLoadingScreen(exportFile, [matrix, baseName, ext, XLSX]);
      $('#save-as-modal').modal('hide');
    } catch (err) {
      $('#save-as-err-msg').text(err.message);
    }
  });
  // Reset save modal values when the modal is closed
  $('#save-as-modal').on('hidden.bs.modal', () => {
    $('#save-as-err-msg').text('');
    $('#base-name-save-as-input').val('');
  });

  // File -> Export to...
  $('#export-to-confirm-btn').click(() => {
    const baseName = $('#base-name-export-to-input').val();
    const exportFormat = $('#export-to-format-select').val();
    if (!exportFormat) {
      $('#export-to-err-msg').text('Select a format');
      return;
    }
    if (exportFormat in EXPORT_FORMATS) {
      const format = EXPORT_FORMATS[exportFormat];
      format['method'](baseName, HOT, TABLE, XLSX, format.fileType);
    }
    $('#export-to-modal').modal('hide');
  });
  $("#export-to-format-select").on('change', (e) => {
    const exportFormat = $('#export-to-format-select').val();
    $('#export_file_suffix').text('.' + EXPORT_FORMATS[exportFormat].fileType);
  });

  // Reset export modal values when the modal is closed
  $('#export-to-modal').on('hidden.bs.modal', () => {
    $('#export-to-err-msg').text('');
    $('#base-name-export-to-input').val('');
  });


  // File -> Export
  $('#export-to-dropdown-item').click(() => {
    if (!jQuery.isEmptyObject(INVALID_CELLS)) {
      $('#export-to-invalid-warning-modal').modal('show');
    } else {
      $('#export-to-modal').modal('show');
    }
  });

  // Settings -> Jump to...
  const $jumpToInput = $('#jump-to-input');
  $jumpToInput.bind('focus', () => void $jumpToInput.autocomplete('search'));

  $('#jump-to-modal').on('shown.bs.modal', () => {
    $jumpToInput.val('');
    $jumpToInput.focus();
  });

  // Settings -> Fill column ...
  const $fillValueInput = $('#fill-value-input');
  const $fillColumnInput = $('#fill-column-input');
  $fillColumnInput.bind('focus', () => void $fillColumnInput.autocomplete('search'));
  $('#fill-modal').on('shown.bs.modal', () => {
    $fillColumnInput.val('');
    $fillColumnInput.focus();
  });
  $('#fill-button').on('click', () => {
    runBehindLoadingScreen(() => {
      let value = $fillValueInput.val();
      let colname = $fillColumnInput.val();
      const fieldYCoordinates = getFieldYCoordinates(TABLE);
      // ENSURE colname hasn't been tampered with (the autocomplete allows
      // other text)
      if (colname in fieldYCoordinates) {
        let changes = [];
        for (let row=0; row<HOT.countRows(); row++) {
          if (!HOT.isEmptyRow(row)) {
            let col = fieldYCoordinates[colname];
            if (HOT.getDataAtCell(row, col) !== value)      
              changes.push([row, col, value]);
          }
        }
        if (changes.length > 0) {
          HOT.setDataAtCell(changes);
          HOT.render();
        }
      }
    });
  });

  // Locate next error based on current cursor cell row and column.
  $('#next-error-button').on('click', () => {
    // We can't use HOT.getSelectedLast() because "Next Error" button click 
    // removes that.
    let focus_row = window.CURRENT_SELECTION[0];
    let focus_col = window.CURRENT_SELECTION[1];

    const all_rows = Object.keys(window.INVALID_CELLS);
    const error1_row = all_rows[0];//0=index of key, not key!
    if (focus_row === null) {
      focus_row = error1_row;
      focus_col = Object.keys(window.INVALID_CELLS[focus_row])[0];
    }
    else {
      // Get all error rows >= focus row
      const rows = all_rows.filter(row => row >= focus_row);

      // One or more errors on focus row (lax string/numeric comparision):
      if (focus_row == rows[0]) {
        let cols = Object.keys(window.INVALID_CELLS[focus_row])
        cols = cols.filter(col => col > focus_col);
        if (cols.length) {
          focus_col = parseInt(cols[0]);
        }
        else {
          // No next column, so advance to next row or first row
          focus_row = (rows.length > 1) ? rows[1] : error1_row; 
          focus_col = Object.keys(window.INVALID_CELLS[focus_row])[0];
        }
      }
      else {
        // Advance to next row or first row
        focus_row = rows.length ? rows[0] : error1_row;
        focus_col = Object.keys(window.INVALID_CELLS[focus_row])[0];
      }
    };

    window.CURRENT_SELECTION[0] = focus_row;
    window.CURRENT_SELECTION[1] = focus_col;
    window.CURRENT_SELECTION[2] = focus_row;
    window.CURRENT_SELECTION[3] = focus_col;   
    scrollTo(focus_row, focus_col, TABLE, HOT);

  });

  // Validate
  $('#validate-btn').on('click', () => {
    runBehindLoadingScreen(() => {
      window.INVALID_CELLS = getInvalidCells(HOT, TABLE);
      HOT.render();

      // If any rows have error, show this.
      if (Object.keys(window.INVALID_CELLS).length > 0) {
        $('#next-error-button').show();
        $('#no-error-button').hide();
      }
      else {
        $('#next-error-button').hide();
        $('#no-error-button').show().delay(5000).fadeOut('slow');
      }
    });
  });

  // Field descriptions. Need to account for dynamically rendered
  // cells.
  $('#grid').on('dblclick', '.secondary-header-cell', (e) => {
    const innerText = e.target.innerText;
    const field =
        getFields(TABLE).filter(field => field.title === innerText)[0];
    $('#field-description-text').html(getComment(field));
    $('#field-description-modal').modal('show');
  });

  // Add more rows
  $('#add-rows-button').click(() => {
    runBehindLoadingScreen(() => {
      const numRows = $('#add-rows-input').val();
      HOT.alter('insert_row', HOT.countRows()-1 + numRows, numRows);
    });
  });

  // Settings -> Show ... rows
  const showRowsSelectors = [
    '#show-all-rows-dropdown-item',
    '#show-valid-rows-dropdown-item',
    '#show-invalid-rows-dropdown-item',
  ];
  $(showRowsSelectors.join(',')).click((e) => {
    const args = [e.target.id, INVALID_CELLS, HOT];
    runBehindLoadingScreen(changeRowVisibility, args);
  });

}

/**
 * Revise user interface elements to match template path, and trigger
 * load of schema.js and export.js scripts (if necessary).  script.onload goes on
 * to trigger launch(TABLE).
 * @param {String} template_path: path of template starting from app's
 * template/ folder.
 */
function switchTemplate (template_path) {


  // Redo of template triggers new data file
  $('#file_name_display').text('');
  $('#select-template').val('');  // CLEARS OUT?

  // Validate path if not null:
  if (template_path) {

    [template_folder, template_name] = template_path.split('/',2); 
    if (!(template_folder in TEMPLATES || template_name in TEMPLATES[template_folder]) ) {
      $('#template_name_display').text('Template ' + template_path + " not found!");
      // DISABLE MORE STUFF UNTIL GOOD TEMPLATE SELECTED?
      return;
    }
  }
  // If null, do default template setup - the first one in menu
  else {
    // Default template is first in TEMPLATES
    template_folder = Object.keys(TEMPLATES)[0];
    template_name = Object.keys(TEMPLATES[template_folder])[0];
    template_path = template_folder + '/' + template_name;
  }
 
  if (window.TABLE && TABLE.folder == template_folder) {
    // TABLE file of specifications already loaded
    setupTemplate(template_path);
    }
  else {
    // A switch to this template requires reloading TABLE
    reloadJs(template_folder, 'schema.js', setupTemplate, [template_path]);
  }

};

/**
 * With existing or newly loaded SCHEMA file, load of schema.js and then
 * export.js scripts.
 * @param {String} template_path: path of template starting from app's
 * template/ folder.
 */
const setupTemplate = (template_path) => {

  let [template_folder, template_name] = template_path.split('/',2);

  // If visible, show this as a selected item in template menu
  $('#select-template').val(template_path);
  $('#template_name_display').text(template_path);
  // Update reference doc links and SOP.
  $("#help_reference").attr('href',`template/${template_folder}/reference.html`);
  $("#help_sop").attr('href',`template/${template_folder}/SOP.pdf`);

  window.TABLE = processData(DATA, template_name);

  // Asynchronous. Since SCHEMA loaded, export.js should succeed as well.
  reloadJs(template_folder, 'export.js', exportOnload);

  runBehindLoadingScreen(() => {
    window.INVALID_CELLS = {};
    if (window.HOT) HOT.destroy(); // handles already existing data
    window.HOT = createHot(TABLE);
  });

  // Allows columnCoordinates to be accessed within select() below.
  const columnCoordinates = getColumnCoordinates(TABLE);


  $('#section-menu').empty();
  section_ptr = 0;
  for (section of TABLE) {
    $('#section-menu').append(`<div id="show-section-${section_ptr}" class="dropdown-item show-section-dropdown-item">${section.title}</div>`);
    section_ptr ++;
  }

  // Settings -> Show ... columns
  const showColsSelectors = [
      '#show-all-cols-dropdown-item', 
      '#show-required-cols-dropdown-item',
      '#show-recommended-cols-dropdown-item',
      '.show-section-dropdown-item',
      ];

    $(showColsSelectors.join(',')).on('click', function(e) {
    runBehindLoadingScreen(changeColVisibility, [e.target.id, TABLE, window.HOT]);
  });

  // Settings -> Jump to...
  $('#jump-to-input').autocomplete({
    source: Object.keys(columnCoordinates),
    minLength: 0,
    select: (e, ui) => {
      const columnX = columnCoordinates[ui.item.label];
      scrollTo(0, columnX, TABLE, window.HOT);
      $('#jump-to-modal').modal('hide');
    },
  })

  $('#fill-column-input').autocomplete({
    source: getFields(TABLE).map(a => a.title),
    minLength: 0
  })
};

/**
 * Post-processing of values in `data.js` at runtime. This calculates for each
 * categorical field (table column) in data.js a flat list of allowed values
 * in field.flatVocabulary,
 * @param {Object} data See TABLE.
 * @return {Object} Processed values of `data.js`.
 */
const processData = (data, template_name) => {
  // Useful to have this object for fields with a "source" vocabulary
  const flatVocabularies = {};
  const fields = getFields(data);
  for (const field of fields) {
    // TEMPORARY LinkML conversion field.title
    field.title = field.fieldName;
    if (field.requirement.indexOf('required') != -1 )
      field.required = true;
    if (field.requirement.indexOf('recommended') != -1 )
      field.recommended = true;

    field.multivalued = (fields[col].datatype === 'multiple');

    if ('schema:ItemList' in field) {
      flatVocabularies[field.title] =
          stringifyNestedVocabulary(field['schema:ItemList']);
    }
  }

  // parent is each data section
  for (const parent of data) {
    // parent.children is list of fields
    for (const child of parent.children) {
      if ('schema:ItemList' in child) {
        child.flatVocabulary = flatVocabularies[child.title];

        if (child.source) {
          // Duplicate vocabulary from other source field
          child.flatVocabulary =
              [...child.flatVocabulary, ...flatVocabularies[child.source]];
        }

        // Change case as needed
        for (const [i, val] of child.flatVocabulary.entries()) {
          if (!val || !child.capitalize) continue;
          child.flatVocabulary[i] = changeCase(val, child.capitalize);
        }
      }
    }
  }
  return data;
};

/**
 * Recursively flatten vocabulary into an array of strings, with each string's
 * level of depth in the vocabulary being indicated by leading spaces.
 * e.g., `vocabulary: 'a': {'b':{}},, 'c': {}` becomes `['a', '  b', 'c']`.
 * @param {Object} vocabulary See `vocabulary` fields in `data.js`.
 * @param {number} level Nested level of `vocabulary` we are currently
 *     processing.
 * @return {Array<String>} Flattened vocabulary.
 */
const stringifyNestedVocabulary = (vocab_list, level=0) => {

  let ret = [];
  for (const val of Object.keys(vocab_list)) {
    ret.push('  '.repeat(level) + val);
    if ('schema:ItemList' in vocab_list[val]) {
      ret = ret.concat(stringifyNestedVocabulary(vocab_list[val]['schema:ItemList'], level+1));
    }
  }
  return ret;
};

/**
 * Reloads a given javascript by removing any old script happening to have the
 * same URL, and loading the given one. Only in this way will browsers reload
 * the code. This is mainly designed to load a script that sets a global SCHEMA 
 * or TEMPLATE variable.
 * 
 * @param {String} src_url: path of template starting from app's template folder.
 * @param {Object} onloadfn: function to run when script is loaded. 
 */
const reloadJs = (template_folder, file_name, onloadfn, load_parameters = null) => {
  const src_url = `./template/${template_folder}/${file_name}`;
  $(`script[src="${src_url}"]`).remove();
  var script = document.createElement('script');
  if (onloadfn) {
    // Trigger onload with indication
    script.onload = function () {
      if (load_parameters) {
        onloadfn.apply(null, load_parameters);
      }
      else
        onloadfn();
    };
  };
  script.onerror = function() {
    $('#missing-template-msg').text(`Unable to load template file "${src_url}". Is the template name correct?`);
    $('#missing-template-modal').modal('show');
    $('#template_name_display').text('');
  };
  // triggers load
  script.src = src_url;
  document.head.appendChild(script);

}


