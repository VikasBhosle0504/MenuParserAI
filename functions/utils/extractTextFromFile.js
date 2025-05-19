const fs = require('fs');
const mammoth = require('mammoth');
const xlsx = require('xlsx');
const { DocumentProcessorServiceClient } = require('@google-cloud/documentai').v1;

const documentaiClient = new DocumentProcessorServiceClient();

/**
 * Extracts text from a file using Document AI, Mammoth, or XLSX depending on the file extension.
 * @param {string} filePath - Path to the file.
 * @param {string} extension - File extension.
 * @returns {Promise<string|Array>} Extracted text or OCR objects.
 */
async function extractTextFromFile(filePath, extension) {
  if ([".jpg", ".jpeg", ".png", ".pdf"].includes(extension)) {
    // Use Google Document AI for image and PDF files
    const projectId = 'aimenudigitiliser';
    const location = 'us';
    const processorId = 'd863107b0752665c';
    const name = `projects/${projectId}/locations/${location}/processors/${processorId}`;
    const imageFile = fs.readFileSync(filePath);
    let mimeType = 'application/pdf';
    if ([".jpg", ".jpeg", ".png"].includes(extension)) {
      mimeType = 'image/jpeg';
    }
    const request = {
      name,
      rawDocument: {
        content: imageFile,
        mimeType,
      },
    };
    const [result] = await documentaiClient.processDocument(request);
    const { text } = result.document;
    // Extract lines with coordinates from Document AI result
    let lineObjs = [];
    if (result.document.pages && result.document.pages.length > 0) {
      for (const page of result.document.pages) {
        const blocks = page.lines && page.lines.length > 0 ? page.lines : (page.paragraphs || []);
        for (const block of blocks) {
          let blockText = '';
          if (block.layout && block.layout.textAnchor) {
            const { textAnchor } = block.layout;
            if (textAnchor.textSegments && textAnchor.textSegments.length > 0) {
              for (const seg of textAnchor.textSegments) {
                blockText += text.substring(seg.startIndex || 0, seg.endIndex);
              }
            }
          }
          let x = 0, y = 0;
          if (block.layout && block.layout.boundingPoly && block.layout.boundingPoly.vertices && block.layout.boundingPoly.vertices.length > 0) {
            x = block.layout.boundingPoly.vertices[0].x || 0;
            y = block.layout.boundingPoly.vertices[0].y || 0;
          }
          if (blockText.trim()) {
            lineObjs.push({ text: blockText.trim(), x, y });
          }
        }
      }
    }
    // Fallback: if no lines/paragraphs, split text into lines
    if (lineObjs.length === 0 && text) {
      lineObjs = text.split('\n').map((t, i) => ({ text: t, x: 0, y: i * 20 }));
    }
    return lineObjs;
  }
  if (extension === '.docx') {
    const data = await mammoth.extractRawText({ path: filePath });
    return data.value;
  }
  if (extension === '.xlsx') {
    const workbook = xlsx.readFile(filePath);
    let text = '';
    workbook.SheetNames.forEach(sheet => {
      text += xlsx.utils.sheet_to_csv(workbook.Sheets[sheet]) + '\n';
    });
    return text;
  }
  return '';
}

module.exports = { extractTextFromFile }; 