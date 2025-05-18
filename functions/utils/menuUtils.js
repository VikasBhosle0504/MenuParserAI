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
  // Sort lines by x, then y for stable grouping
  const sorted = [...lines].sort((a, b) => a.x - b.x || a.y - b.y);
  // Group lines into columns by x coordinate
  const columns = [];
  for (const line of sorted) {
    // Try to find a column this line belongs to
    let col = columns.find(col => Math.abs(col.x - line.x) <= xThreshold);
    if (!col) {
      col = { x: line.x, lines: [] };
      columns.push(col);
    }
    col.lines.push(line);
  }
  // Sort lines in each column by y (top to bottom)
  const columnBlocks = columns.map(col =>
    col.lines.sort((a, b) => a.y - b.y).map(l => l.text).join('\n')
  );
  // Join columns with column break
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

  for (let i = 0; i < lines.length; i++) {
    const current = lines[i].trim();
    const prev = merged[merged.length - 1] || '';

    const isPriceOnly = /^[\d\s/.]+$/.test(current) && /\d/.test(current);

    if (isPriceOnly && prev && !/^\d/.test(prev)) {
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