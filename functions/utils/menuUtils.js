// menuUtils.js
// Contains pure helper functions for menu text processing and formatting in the Menu Parser backend.
// Used by services for text normalization, merging, and chunking.

/**
 * Inserts column break markers every 40 lines in the text.
 * @param {string} text - The input text.
 * @returns {string} The text with column breaks inserted.
 */
function injectColumnBreaks(text) {
  const lines = text.split('\n');
  for (let i = 40; i < lines.length; i += 40) {
    lines.splice(i, 0, '### COLUMN BREAK ###');
  }
  return lines.join('\n');
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