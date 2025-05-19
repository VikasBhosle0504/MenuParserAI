/**
 * Import function triggers from their respective submodules:
 *
 * const {onCall} = require("firebase-functions/v2/https");
 * const {onDocumentWritten} = require("firebase-functions/v2/firestore");
 *
 * See a full list of supported triggers at https://firebase.google.com/docs/functions
 */

// documentai.js
// Handles Document AI-based menu extraction, parsing, and storage for the Menu Parser backend.
// Contains business logic for processing uploaded documents using Google Document AI and OpenAI.

const functions = require('firebase-functions');
const admin = require('firebase-admin');
const {Storage} = require('@google-cloud/storage');
const vision = require('@google-cloud/vision');
const pdfParse = require('pdf-parse');
const xlsx = require('xlsx');
const mammoth = require('mammoth');
const {Configuration, OpenAIApi} = require('openai');
const path = require('path');
const os = require('os');
const fs = require('fs');
const {DocumentProcessorServiceClient} = require('@google-cloud/documentai').v1;

// Import repositories and utils
const { uploadToStorage, saveToFirestore } = require('../repositories/storageRepository');
const { injectColumnBreaks, normalizeOCR, mergePriceLinesWithItems, filterNonMenuText, mergeNearbyPrices } = require('../utils/menuUtils');

const db = admin.firestore();
const storage = new Storage();
const documentaiClient = new DocumentProcessorServiceClient();

const OPENAI_API_KEY = functions.config().openai.key;
const openai = new OpenAIApi(new Configuration({apiKey: OPENAI_API_KEY}));

const SUPPORTED_EXTENSIONS = ['.pdf', '.jpg', '.jpeg', '.png', '.docx', '.xlsx'];

// Load prompt templates from resources
const systemPrompt = fs.readFileSync(path.join(__dirname, '../resources/prompts/systemPrompt.txt'), 'utf8');
const userPromptTemplate = fs.readFileSync(path.join(__dirname, '../resources/prompts/userPrompt.txt'), 'utf8');

/**
 * Extracts text from a file using Document AI, Mammoth, or XLSX depending on the file extension.
 * @param {string} filePath - Path to the file.
 * @param {string} extension - File extension.
 * @returns {Promise<string>} Extracted text.
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
    const {text, paragraphs, lines, tokens, entities, pages} = result.document;
    // Extract lines with coordinates from Document AI result
    // Fallback: use paragraphs if lines are not available
    let lineObjs = [];
    if (result.document.pages && result.document.pages.length > 0) {
      for (const page of result.document.pages) {
        // Use lines if available, else paragraphs
        const blocks = page.lines && page.lines.length > 0 ? page.lines : (page.paragraphs || []);
        for (const block of blocks) {
          // Get text segment
          let blockText = '';
          if (block.layout && block.layout.textAnchor) {
            const {textAnchor} = block.layout;
            if (textAnchor.textSegments && textAnchor.textSegments.length > 0) {
              for (const seg of textAnchor.textSegments) {
                blockText += text.substring(seg.startIndex || 0, seg.endIndex);
              }
            }
          }
          // Get top-left x/y from bounding box
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

    // Return the raw OCR output as an array of objects with text and coordinates
    return lineObjs;
  }
  if (extension === '.docx') {
    // Use Mammoth for DOCX files
    const data = await mammoth.extractRawText({ path: filePath });
    return data.value;
  }
  if (extension === '.xlsx') {
    // Use XLSX for Excel files
    const workbook = xlsx.readFile(filePath);
    let text = '';
    workbook.SheetNames.forEach(sheet => {
      text += xlsx.utils.sheet_to_csv(workbook.Sheets[sheet]) + '\n';
    });
    return text;
  }
  return '';
}

/**
 * Extracts structured menu JSON from raw text using OpenAI.
 * @param {string} rawText - The raw text to parse.
 * @returns {Promise<Object>} Parsed menu JSON.
 */
async function extractMenuJson(rawText) {
  // Always stringify the chunk for the prompt
  const prompt = userPromptTemplate.replace('{{RAW_TEXT}}', JSON.stringify(rawText, null, 2));
  const sysContent = systemPrompt;
  const response = await openai.createChatCompletion({
    model: 'gpt-4-turbo',
    messages: [
      {role: 'system', content: sysContent},
      {role: 'user', content: prompt}
    ],
    temperature: 0.2,
    max_tokens: 4096
  });
  let content = response.data.choices[0].message.content;
  console.log('GPT raw response:', content);

  // Remove code block markers if present
  let cleaned = content.replace(/```json|```/g, '').trim();

  // Try strict JSON parse
  try {
    return JSON.parse(cleaned);
  } catch (strictErr) {
    // Try fuzzy match for object
    const objMatch = cleaned.match(/\{[\s\S]*\}/);
    if (objMatch) {
      try {
        return JSON.parse(objMatch[0]);
      } catch (innerErr) {
        console.error('Fuzzy object JSON parse failed:', innerErr);
      }
    }
    // Try fuzzy match for array
    const arrayMatch = cleaned.match(/\[[\s\S]*\]/);
    if (arrayMatch) {
      try {
        return JSON.parse(arrayMatch[0]);
      } catch (innerErr) {
        console.error('Fuzzy array JSON parse failed:', innerErr);
      }
    }
    console.error('GPT response (unparsable):', cleaned);
    throw new Error('No valid JSON could be parsed from GPT response');
  }
}

// Utility: Split text into chunks of maxLength characters, trying to split at newlines
function splitIntoChunks(text, maxLength = 2000) {
  const chunks = [];
  let start = 0;
  while (start < text.length) {
    let end = start + maxLength;
    // Try to split at a newline if possible
    if (end < text.length) {
      let lastNewline = text.lastIndexOf('\n', end);
      if (lastNewline > start) end = lastNewline;
    }
    chunks.push(text.slice(start, end));
    start = end;
  }
  return chunks;
}

/**
 * Cloud Function: processMenuUploadDocumentAI
 * Handles file upload, text extraction, menu parsing, and storage for Document AI menus.
 */
const processMenuUploadDocumentAI = functions
  .region('us-central1')
  .runWith({ memory: '1GB', timeoutSeconds: 540 })
  .storage.object()
  .onFinalize(async (object) => {
    const fileBucket = object.bucket;
    const filePath = object.name;
    const fileName = path.basename(filePath);
    const extension = path.extname(fileName).toLowerCase();
    // Only process files in 'menus_documentai/' with supported extensions
    if (!filePath.startsWith('menus_documentai/') || !SUPPORTED_EXTENSIONS.includes(extension)) {
      return;
    }
    const tempFilePath = path.join(os.tmpdir(), fileName);
    await storage.bucket(fileBucket).file(filePath).download({destination: tempFilePath});
    let rawText = '';
    let rawTextPath = undefined;
    try {
      rawText = await extractTextFromFile(tempFilePath, extension);
      // Save rawText to Cloud Storage for debugging
      const rawTextFileName = fileName.replace(extension, '.raw.txt');
      rawTextPath = `debug_documentai/${rawTextFileName}`;
      const tempRawTextPath = path.join(os.tmpdir(), rawTextFileName);
      fs.writeFileSync(tempRawTextPath, JSON.stringify(rawText, null, 2));
      await storage.bucket(fileBucket).upload(tempRawTextPath, {destination: rawTextPath, contentType: 'text/plain'});
      fs.unlinkSync(tempRawTextPath);
    } catch (err) {
      console.error('Text extraction failed:', err);
      fs.unlinkSync(tempFilePath);
      return;
    }
    // Chunking logic: split by column breaks and parse each chunk
    let mergedMenu = [];
    let menuJson = {};
    try {
      let chunks = [];
      if (Array.isArray(rawText)) {
        // If already an array (from OCR), join into a string for chunking
        const text = rawText.map(lineObj => lineObj.text).join('\n');
        chunks = splitIntoChunks(text, 2000); // You can adjust 2000 as needed
      } else {
        // If string, split by column break first, then further chunk if needed
        const colChunks = rawText.split('### COLUMN BREAK ###');
        for (const colChunk of colChunks) {
          if (colChunk.trim().length === 0) continue;
          const subChunks = splitIntoChunks(colChunk, 2000);
          chunks.push(...subChunks);
        }
      }
      for (const chunk of chunks) {
        if (chunk.trim().length === 0) continue;
        try {
          const chunkJson = await extractMenuJson(chunk);
          // Merge menu arrays or objects
          if (chunkJson && Array.isArray(chunkJson.menu)) {
            mergedMenu = mergedMenu.concat(chunkJson.menu);
          } else if (Array.isArray(chunkJson)) {
            mergedMenu = mergedMenu.concat(chunkJson);
          } else if (chunkJson) {
            mergedMenu.push(chunkJson);
          }
        } catch (err) {
          console.error('OpenAI extraction failed for chunk:', err);
        }
      }
      menuJson = { menu: mergedMenu };
    } catch (err) {
      console.error('OpenAI extraction failed:', err);
      fs.unlinkSync(tempFilePath);
      return;
    }
    // Save JSON to Storage
    const jsonFileName = fileName.replace(extension, '.json');
    const parsedPath = `parsed_documentai/${jsonFileName}`;
    const tempJsonPath = path.join(os.tmpdir(), jsonFileName);
    fs.writeFileSync(tempJsonPath, JSON.stringify(menuJson, null, 2));
    await storage.bucket(fileBucket).upload(tempJsonPath, {destination: parsedPath, contentType: 'application/json'});
    // Save JSON to Firestore
    const docId = path.basename(fileName, extension);
    const docData = {
      ...menuJson,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      sourceFilePath: filePath
    };
    if (rawTextPath) {
      docData.debugRawTextPath = rawTextPath;
    }
    await db.collection('menus_documentai').doc(docId).set(docData);
    // Cleanup temp files
    fs.unlinkSync(tempFilePath);
    fs.unlinkSync(tempJsonPath);
  });

module.exports = { processMenuUploadDocumentAI };
