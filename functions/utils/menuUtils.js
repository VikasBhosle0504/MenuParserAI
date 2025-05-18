// menuUtils.js
// Contains pure helper functions for menu text processing and formatting in the Menu Parser backend.
// Used by services for text normalization, merging, and chunking.

/**
 * Dynamically clusters lines into columns using k-means on x or y coordinates, supporting both vertical and horizontal menus.
 * @param {Array<{text: string, x: number, y: number}>} lines
 * @param {number} [maxColumns=4] - Maximum number of columns to try.
 * @returns {string} Menu text grouped by columns, separated by '### COLUMN BREAK ###'.
 */
function dynamicColumnBreaks(lines, maxColumns = 4) {
  if (!Array.isArray(lines) || lines.length === 0) return '';
  if (lines.length < 8) return lines.map(l => l.text).join('\n'); // Not enough lines for columns

  // Try both x and y clustering, pick the one with the best separation
  const xVals = lines.map(l => l.x);
  const yVals = lines.map(l => l.y);
  const xSpread = Math.max(...xVals) - Math.min(...xVals);
  const ySpread = Math.max(...yVals) - Math.min(...yVals);

  // If menu is wider than tall, cluster on x (vertical columns); else on y (horizontal rows)
  const clusterOn = xSpread > ySpread ? 'x' : 'y';
  const vals = clusterOn === 'x' ? xVals : yVals;

  // Simple k-means clustering (1 to maxColumns), pick best by inertia
  let bestLabels = null, bestK = 1, bestInertia = Infinity;
  for (let k = 1; k <= Math.min(maxColumns, lines.length); k++) {
    // Init centroids evenly spaced
    const minV = Math.min(...vals), maxV = Math.max(...vals);
    let centroids = Array.from({length: k}, (_, i) => minV + (i * (maxV - minV) / (k - 1 || 1)));
    let labels = new Array(vals.length).fill(0);
    let changed = true, iter = 0;
    while (changed && iter++ < 20) {
      changed = false;
      // Assign labels
      for (let i = 0; i < vals.length; i++) {
        let minDist = Infinity, minIdx = 0;
        for (let j = 0; j < centroids.length; j++) {
          const dist = Math.abs(vals[i] - centroids[j]);
          if (dist < minDist) { minDist = dist; minIdx = j; }
        }
        if (labels[i] !== minIdx) { labels[i] = minIdx; changed = true; }
      }
      // Update centroids
      for (let j = 0; j < centroids.length; j++) {
        const group = vals.filter((_, i) => labels[i] === j);
        if (group.length > 0) centroids[j] = group.reduce((a, b) => a + b, 0) / group.length;
      }
    }
    // Compute inertia (sum of squared distances)
    let inertia = 0;
    for (let i = 0; i < vals.length; i++) {
      inertia += Math.pow(vals[i] - centroids[labels[i]], 2);
    }
    if (inertia < bestInertia) {
      bestInertia = inertia;
      bestLabels = [...labels];
      bestK = k;
    }
  }
  // Group lines by label
  const groups = Array.from({length: bestK}, () => []);
  lines.forEach((l, i) => groups[bestLabels[i]].push(l));
  // Sort groups by centroid value
  const centroids = groups.map(g => g.length ? g.reduce((sum, l) => sum + (clusterOn === 'x' ? l.x : l.y), 0) / g.length : 0);
  const sorted = groups.map((g, i) => ({g, c: centroids[i]})).sort((a, b) => a.c - b.c).map(obj => obj.g);
  // Sort lines within each group by y (if vertical) or x (if horizontal)
  const colTexts = sorted.map(col => col.sort((a, b) => (clusterOn === 'x' ? a.y - b.y : a.x - b.x)).map(l => l.text).join('\n'));
  return colTexts.join('\n### COLUMN BREAK ###\n');
}

/**
 * Detects section headers using a list of common headers and y-gaps.
 * @param {string[]} lines
 * @returns {string[]} Section header lines
 */
function detectSectionHeaders(lines) {
  const COMMON_HEADERS = ['STARTERS','MAIN','SALADS','DESSERTS','DRINKS','SOUPS','SIDES','APPETIZERS','BEVERAGES','ENTREES','SPECIALS','BREAKFAST','LUNCH','DINNER'];
  const headers = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].toUpperCase().trim();
    if (COMMON_HEADERS.includes(line)) headers.push(lines[i]);
    // Heuristic: if line is all uppercase and short, likely a header
    else if (/^[A-Z\s]{3,20}$/.test(line) && line.length < 20) headers.push(lines[i]);
    // Heuristic: large y-gap (not available here, but could be added if needed)
  }
  return headers;
}

/**
 * Filters out non-menu text using keywords and patterns.
 * @param {string[]} lines
 * @returns {string[]} Filtered lines
 */
function filterNonMenuText(lines) {
  const NON_MENU_PATTERNS = [/BOOK NOW/i, /\d{2,3} \d{2,3} \d{2,3}/, /Delivery Available/i, /DAILY FROM/i, /\d{1,2} ?am-?\d{1,2} ?pm/i, /\d{2,}-\d{2,}/, /\d{2,}:\d{2,}/, /\bphone\b/i, /contact/i];
  return lines.filter(line => !NON_MENU_PATTERNS.some(pat => pat.test(line)));
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

/**
 * Merges price-only lines with the nearest item line above or to the left.
 * @param {Array<{text: string, x: number, y: number}>} lines
 * @param {number} maxYGap - Maximum vertical distance to consider for merging.
 * @param {number} maxXGap - Maximum horizontal distance to consider for merging.
 * @returns {Array<{text: string, x: number, y: number}>}
 */
function mergeNearbyPrices(lines, maxYGap = 30, maxXGap = 120) {
  const isPrice = (t) => /^\$?\d+(\.\d{1,2})?$/.test(t.trim());
  const merged = [];
  const used = new Set();

  for (let i = 0; i < lines.length; i++) {
    if (used.has(i)) continue;
    const line = lines[i];
    if (!isPrice(line.text)) {
      // Find the closest price-only line nearby
      let bestIdx = -1, bestDist = Infinity;
      for (let j = 0; j < lines.length; j++) {
        if (i === j || used.has(j)) continue;
        const cand = lines[j];
        if (isPrice(cand.text)) {
          const yDist = Math.abs(cand.y - line.y);
          const xDist = Math.abs(cand.x - line.x);
          // Prefer price below or to the right, within reasonable distance
          if ((cand.y > line.y && yDist < maxYGap && xDist < maxXGap) ||
              (cand.x > line.x && xDist < maxXGap && yDist < maxYGap)) {
            const dist = yDist + xDist;
            if (dist < bestDist) {
              bestDist = dist;
              bestIdx = j;
            }
          }
        }
      }
      if (bestIdx !== -1) {
        merged.push({
          text: line.text + ' ' + lines[bestIdx].text,
          x: line.x,
          y: line.y
        });
        used.add(bestIdx);
      } else {
        merged.push(line);
      }
      used.add(i);
    } else if (!used.has(i)) {
      merged.push(line);
      used.add(i);
    }
  }
  return merged;
}

// Patch injectColumnBreaks to use dynamicColumnBreaks
function injectColumnBreaks(lines, xThreshold = 180) {
  return dynamicColumnBreaks(lines, 4); // Use up to 4 columns by default
}

module.exports = {
  injectColumnBreaks,
  normalizeOCR,
  mergePriceLinesWithItems,
  dynamicColumnBreaks,
  detectSectionHeaders,
  filterNonMenuText,
  mergeNearbyPrices
}; 