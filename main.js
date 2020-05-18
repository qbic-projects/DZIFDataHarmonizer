/**
 * @fileOverview Handsontable grid with standardized COVID-19 metadata.
 * Implemented with vanilla JavaScript and locally downloaded libaries.
 * Functionality for uploading, downloading and validating data.
 */

/**
 * Create a blank instance of Handsontable.
 * @param {Object} data - See `data.js`.
 * @return {Object} Handsontable instance.
 */
const createHot = (data) => {
  const hot = new Handsontable($('#grid')[0], {
    data: getHeaders(DATA),
    columns: getDropdowns(DATA),
    colHeaders: true,
    rowHeaders: true,
    fixedRowsTop: 2,
    fixedColumnsLeft: 1,
    minRows: 1000,
    minSpareRows: 100,
    width: '100%',
    height: '75vh',
    hiddenColumns: {
      copyPasteEnabled: true,
      indicators: true,
      columns: [],
    },
    licenseKey: 'non-commercial-and-evaluation',
    readOnlyCellClassName: 'read-only',
    afterRender: () => void $('#header-row').css('visibility', 'visible'),
  });

  hot.updateSettings({
    cells: function(row, col) {
      addClassNamesToCell(row, col, hot);
      if (row === 0 || row === 1) {
        return {readOnly: true};
      }
    },
  });

  return hot;
};

/**
 * Create a matrix containing the first two rows of the grid.
 * @param {Object} data - See `data.js`.
 * @return {Array<Array<String>>} First two rows of the grid.
 */
const getHeaders = (data) => {
  const rows = [[], []];
  for (const parent of data) {
    rows[0].push(parent.fieldName);
    rows[0].push(...Array(parent.children.length - 1).fill(''));
    rows[1].push(...parent.children.map(child => child.fieldName));
  }
  return rows;
};

/**
 * Create an array of cell properties specifying autocomplete data for all grid
 * columns.
 * @param {Object} data - See `data.js`.
 * @return {Array<Object>} Cell properties for each grid column.
 */
const getDropdowns = (data) => {
  const fields =
      Array.prototype.concat.apply([], data.map(parent => parent.children));
  const vocabularies = fields.map(child => child.vocabulary);
  const ret = [];
  for (const vocabulary of vocabularies) {
    if (Object.keys(vocabulary).length) {
      ret.push({
        type: 'autocomplete',
        source: stringifyNestedVocabulary(vocabulary),
      });
    } else ret.push({});
  }
  return ret;
};

/**
 * Recursively flatten vocabulary into an array of strings, with each string's
 * level of depth in the vocabulary being indicated by leading spaces.
 * e.g., `vocabulary: 'a': {'b':{}},, 'c': {}` becomes `['a', '  b', 'c']`.
 * @param {Object} vocabulary - See `vocabulary` fields in `data.js`.
 * @param {number} level - Nested level of `vocabulary` we are currently
 *     processing.
 * @return {Array<Array<String>>} Flattened vocabulary.
 */
const stringifyNestedVocabulary = (vocabulary, level=0) => {
  if (Object.keys(vocabulary).length === 0) {
    return [];
  }

  let ret = [];
  for (const val of Object.keys(vocabulary)) {
    ret.push('  '.repeat(level) + val);
    ret = ret.concat(stringifyNestedVocabulary(vocabulary[val], level+1));
  }
  return ret;
};

/**
 * Add varying classes to to a grid cell.
 * @param {number} row Cell row.
 * @param {number} col Cell column.
 * @param {Object} hot Handsontable instance of grid.
 */
const addClassNamesToCell = (row, col, hot) => {
    const classNames = [];
    const val = hot.getDataAtCell(row, col);

    if (row === 0) {
      if (val !== '') {
        classNames.push('primary-header-cell');
      } else {
        classNames.push('empty-primary-header-cell');
      }
    } else if (row === 1) {
      classNames.push('secondary-header-cell');
    } else {
      classNames.push('non-header-cell');
    }

    hot.setCellMeta(row, col, 'className', classNames.join(' '));
};

/**
 * Write data to `xlsx` file.
 * @param {Array<Array<String>>} matrix - Data to write to `xlsx` file.
 * @param {String} baseName - Basename of file to write.
 * @param {Object} xlsx - SheetJS variable.
 */
const exportToXlsx = (matrix, baseName, xlsx) => {
  const worksheet = xlsx.utils.aoa_to_sheet(matrix);
  const workbook = xlsx.utils.book_new();
  xlsx.utils.book_append_sheet(workbook, worksheet, 'Sheet1');
  xlsx.writeFile(workbook, `${baseName}.xlsx`);
};

/**
 * Write data to `tsv` file.
 * @param {Array<Array<String>>} matrix - Data to write to `xlsx` file.
 * @param {String} baseName - Basename of file to write.
 * @param {Object} xlsx - `SheetJS` variable.
 */
const exportToTsv = (matrix, baseName, xlsx) => {
  const worksheet = xlsx.utils.aoa_to_sheet(matrix);
  const workbook = xlsx.utils.book_new();
  xlsx.utils.book_append_sheet(workbook, worksheet, 'Sheet1');
  xlsx.writeFile(workbook, `${baseName}.tsv`, {bookType: 'csv', FS: '\t'});
};

/**
 * Upload user file data to grid.
 * @param {File} file - User file.
 * @param {String} ext - User file extension.
 * @param {Object} hot - Handsontable instance of grid.
 * @param {Object} xlsx - SheetJS variable.
 */
const importFile = (file, ext, hot, xlsx) => {
  const fileReader = new FileReader();
  if (ext === 'xlsx') {
    fileReader.readAsBinaryString(file);
    fileReader.onload = (e) => {
      const workbook = xlsx.read(e.target.result, {type: 'binary'});
      const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
      const sheetCsvStr = xlsx.utils.sheet_to_csv(firstSheet);
      hot.loadData(sheetCsvStr.split('\n').map(line => line.split(',')));
    };
  } else if (ext === 'tsv') {
    fileReader.readAsText(file);
    fileReader.onload = (e) => {
      hot.loadData(e.target.result.split('\n').map(line => line.split('\t')));
    };
  } else if (ext === 'csv') {
    fileReader.readAsText(file);
    fileReader.onload = (e) => {
      hot.loadData(e.target.result.split('\n').map(line => line.split(',')));
    };
  }
};

/**
 * Highlight invalid cells in grid.
 * @param {Object} hot - Handsontable instance of grid.
 */
const validateGrid = (hot) => {
  hot.updateSettings({
    cells: function(row, col) {
      addClassNamesToCell(row, col, hot)
      if (row === 0 || row === 1) {
        // Do not validate read-only cells. Must set props again.
        return {readOnly: true};
      } else {
        if (this.source !== undefined) {
          let valid = false;
          const cellVal = hot.getDataAtCell(row, col);
          if (cellVal !== null) {
            if (this.source.map(sourceVal => sourceVal.trim().toLowerCase())
                .includes(cellVal.trim().toLowerCase())) {
              valid = true;
            }
          }
          // Do not want to remove prior classes
          const invalidClass = `${this.className} invalid-cell`
          if (!valid) hot.setCellMeta(row, col, 'className', invalidClass);
        }
      }
    },
  })
};

$(document).ready(() => {
  window.HOT = createHot(DATA);

  // File -> New
  $('#new-dropdown-item, #clear-data-confirm-btn').click((e) => {
    if (e.target.id === 'new-dropdown-item') {
      if ((HOT.countRows() - HOT.countEmptyRows()) !== 2) {
        $('#clear-data-warning-modal').modal('show');
      }
    } else {
      HOT.destroy();
      window.HOT = createHot(DATA);
    }
  });

  // File -> Open
  const $fileInput = $('#open-file-input');
  $fileInput.change(() => {
    const file = $fileInput[0].files[0];
    const ext = file.name.split('.').pop();
    const acceptedExts = ['xlsx', 'tsv', 'csv'];

    if (!acceptedExts.includes(ext)) {
      const errMsg = `Only ${acceptedExts.join(', ')} files are supported`;
      $('#open-err-msg').text(errMsg);
      $('#open-error-modal').modal('show');
    } else {
      importFile(file, ext, HOT, XLSX);
    }

    // Allow consecutive uploads of the same file
    $fileInput[0].value = '';
  });

  // File -> Save
  $('#save-as-confirm-btn').click((e) => {
    try {
      const baseName = $('#base-name-save-as-input').val();
      const ext = $('#file-ext-save-as-select').val();
      if (ext === 'xlsx') {
        exportToXlsx(HOT.getData(), baseName, XLSX);
      } else if (ext === 'tsv') {
        exportToTsv(HOT.getData(), baseName, XLSX);
      } else if (ext === 'csv') {
        HOT.getPlugin('exportFile').downloadFile('csv', {filename: baseName});
      }
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

  // Validate
  $('#validate-btn').click(() => void validateGrid(HOT));

  // Show fields
  $('#view_all_fields, #view_recommended_fields').on('click', (e) => {
    const hiddenColumns = [1, 2, 9]
    const hiddenColumnsPlugin = HOT.getPlugin('hiddenColumns');
    if (e.target.id === 'view_all_fields') {
      hiddenColumnsPlugin.showColumns(hiddenColumns);
    } else {
      hiddenColumnsPlugin.hideColumns(hiddenColumns);
    }
    HOT.render();
  });
});
