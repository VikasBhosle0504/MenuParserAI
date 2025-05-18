// menuUtils.js
// Contains pure helper functions for menu text processing and formatting in the Menu Parser backend.
// Used by services for text normalization, merging, and chunking.

/**
 * Groups lines into columns based on x coordinate, sorts each column by y, and joins with column breaks.
 * @param {Array<{text: string, x: number, y: number}>} lines - Array of line objects with text, x, y.
 * @param {number} [xThreshold=150] - Max x distance to consider lines in the same column.
 * @returns {string} Menu text grouped by columns, separated by '### COLUMN BREAK ###'.
 *
 * Example input:
 * [
 *   { text: 'Starters', x: 100, y: 10 },
 *   { text: 'Spicy Lemon', x: 100, y: 50 },
 *   { text: 'Main', x: 400, y: 10 },
 *   { text: 'Zesty Prawns', x: 400, y: 50 }
 * ]
 */
function injectColumnBreaks(lines, xThreshold = 150) {
  if (!Array.isArray(lines) || lines.length === 0) return '';

  // Step 1: Group into columns based on x proximity
  const columns = [];

  for (const line of lines) {
    let found = false;
    for (const col of columns) {
      const avgX = col.lines.reduce((sum, l) => sum + l.x, 0) / col.lines.length;
      if (Math.abs(avgX - line.x) <= xThreshold) {
        col.lines.push(line);
        found = true;
        break;
      }
    }
    if (!found) {
      columns.push({ lines: [line] });
    }
  }

  // Step 2: Sort each column top-to-bottom
  for (const col of columns) {
    col.lines.sort((a, b) => a.y - b.y);
  }

  // Step 3: Sort columns left-to-right using average X
  columns.sort((a, b) => {
    const avgX1 = a.lines.reduce((sum, l) => sum + l.x, 0) / a.lines.length;
    const avgX2 = b.lines.reduce((sum, l) => sum + l.x, 0) / b.lines.length;
    return avgX1 - avgX2;
  });

  // Step 4: Join all lines
  const columnBlocks = columns.map(col => col.lines.map(l => l.text).join('\n'));
  return columnBlocks.join('\n### COLUMN BREAK ###\n');
}


/**
 * Normalizes OCR text by fixing spacing and line breaks.
 * @param {string} text - The OCR text to normalize.
 * @returns {string} The normalized text.
 */
function normalizeOCR(text) {
  return text
    .replace(/([A-Z])\s{2,}([A-Z])/g, '$1\n$2')
    .replace(/([^\d])\s+(\d+\.\d{2})/g, '$1 $2')
    .replace(/\s{3,}/g, ' ')
    .trim();
}

/**
 * Merges price lines with their corresponding menu items in the text.
 * @param {string} text - The input text.
 * @returns {string} The merged text.
 */
function mergePriceLinesWithItems(text) {
  const lines = text.split('\n');
  const merged = [];

  const isLikelyPrice = (line) => /^(\$?\d+(\.\d{1,2})?)$/.test(line.trim());

  for (let i = 0; i < lines.length; i++) {
    const current = lines[i].trim();
    const prev = merged[merged.length - 1] || '';

    if (isLikelyPrice(current) && prev && !isLikelyPrice(prev)) {
      merged[merged.length - 1] = `${prev} ${current}`;
    } else {
      merged.push(current);
    }
  }

  return merged.join('\n');
}


module.exports = {
  injectColumnBreaks,
  normalizeOCR,
  mergePriceLinesWithItems
}; 