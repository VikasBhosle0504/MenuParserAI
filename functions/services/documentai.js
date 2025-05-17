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
const { injectColumnBreaks, normalizeOCR, mergePriceLinesWithItems } = require('../utils/menuUtils');

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
    const {text} = result.document;
    // Normalize and merge lines, then inject column breaks
    const normalized = normalizeOCR(text);
    const merged = mergePriceLinesWithItems(normalized);
    return injectColumnBreaks(merged);
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
  const prompt = userPromptTemplate.replace('{{RAW_TEXT}}', rawText);
  const sysContent = systemPrompt;
  const response = await openai.createChatCompletion({
    model: 'gpt-4',
    messages: [
      {role: 'system', content: sysContent},
      {role: 'user', content: prompt}
    ],
    temperature: 0.2,
    max_tokens: 4096
  });
  const content = response.data.choices[0].message.content;
  // Try strict JSON parse
  try {
    return JSON.parse(content);
  } catch (strictErr) {
    // Try fuzzy match for JSON block
    const match = content.match(/\{[\s\S]*\}/);
    if (match) {
      try {
        return JSON.parse(match[0]);
      } catch (innerErr) {
        console.error('Fuzzy JSON parse failed:', innerErr);
      }
    }
    console.error('GPT response:', content);
    throw new Error('No valid JSON could be parsed from GPT response');
  }
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
      fs.writeFileSync(tempRawTextPath, rawText);
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
      const chunks = rawText.split('### COLUMN BREAK ###');
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
