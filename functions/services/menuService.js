// menuService.js
// Handles standard menu extraction, parsing, and storage for the Menu Parser backend.
// Contains business logic for processing uploaded menus using OCR, OpenAI, and Firestore.

const functions = require('firebase-functions');
const admin = require('firebase-admin');
const { uploadToStorage, saveToFirestore } = require('../repositories/storageRepository');
const { injectColumnBreaks, mergePriceLinesWithItems } = require('../utils/menuUtils');
const path = require('path');
const os = require('os');
const fs = require('fs');
const mammoth = require('mammoth');
const xlsx = require('xlsx');
const vision = require('@google-cloud/vision');
const { Configuration, OpenAIApi } = require('openai');

const visionClient = new vision.ImageAnnotatorClient();
const OPENAI_API_KEY = functions.config().openai.key;
const openai = new OpenAIApi(new Configuration({ apiKey: OPENAI_API_KEY }));
const SUPPORTED_EXTENSIONS = ['.pdf', '.jpg', '.jpeg', '.png', '.docx', '.xlsx'];

/**
 * Extracts text from a file using Vision API, Mammoth, or XLSX depending on the file extension.
 * @param {string} filePath - Path to the file.
 * @param {string} extension - File extension.
 * @returns {Promise<string>} Extracted text.
 */
async function extractTextFromFile(filePath, extension) {
  if (['.jpg', '.jpeg', '.png', '.pdf'].includes(extension)) {
    // Use Google Vision API for image and PDF files
    const [result] = await visionClient.documentTextDetection(filePath);
    const pages = result.fullTextAnnotation?.pages || [];
    let allWords = [];
    pages.forEach(page => {
      page.blocks.forEach(block => {
        block.paragraphs.forEach(paragraph => {
          paragraph.words.forEach(word => {
            const text = word.symbols.map(s => s.text).join('');
            const x = word.boundingBox?.vertices?.[0]?.x || 0;
            const y = word.boundingBox?.vertices?.[0]?.y || 0;
            allWords.push({ x, y, text });
          });
        });
      });
    });
    // Group words into rows based on Y proximity
    const rows = [];
    const yThreshold = 15;
    allWords.forEach(word => {
      const row = rows.find(r => Math.abs(r.y - word.y) < yThreshold);
      if (row) {
        row.words.push(word);
        row.y = (row.y + word.y) / 2;
      } else {
        rows.push({ y: word.y, words: [word] });
      }
    });
    // Sort and merge lines
    const processedLines = rows
      .map(row => {
        const sortedWords = row.words.sort((a, b) => a.x - b.x);
        const lineText = sortedWords.map(w => w.text).join(' ');
        const priceMatch = sortedWords.findLast(w => /^[£]?\d+(\.\d{2})?$/.test(w.text));
        const price = priceMatch?.text || null;
        const textParts = sortedWords.map(w => w.text);
        const priceIndex = priceMatch ? textParts.indexOf(priceMatch.text) : -1;
        const nameDesc = priceIndex > 0 ? textParts.slice(0, priceIndex).join(' ') : lineText;
        return `${nameDesc}${price ? ` ${price}` : ''}`;
      })
      .sort((a, b) => a.y - b.y);
    const combinedText = processedLines.join('\n');
    return mergePriceLinesWithItems(combinedText);
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
  // Use a prompt template or inline prompt as needed
  const prompt = `You are a menu parser.\nExtract structured restaurant menu data from the following text and return valid, clean JSON.\nText:\n"""\n${rawText}\n"""`;
  const sysContent = `You are an expert restaurant menu parsing assistant.`;
  const response = await openai.createChatCompletion({
    model: 'gpt-4',
    messages: [
      { role: 'system', content: sysContent },
      { role: 'user', content: prompt }
    ],
    temperature: 0.2,
    max_tokens: 2048
  });
  const match = response.data.choices[0].message.content.match(/\{[\s\S]*\}/);
  if (match) {
    return JSON.parse(match[0]);
  }
  throw new Error('No JSON found in OpenAI response');
}

/**
 * Cloud Function: processMenuUpload
 * Handles file upload, text extraction, menu parsing, and storage for standard menus.
 */
const processMenuUpload = functions
  .region('us-central1')
  .runWith({ memory: '1GB', timeoutSeconds: 300 })
  .storage.object()
  .onFinalize(async (object) => {
    const fileBucket = object.bucket;
    const filePath = object.name;
    const fileName = path.basename(filePath);
    const extension = path.extname(fileName).toLowerCase();
    // Only process files in 'menus/' with supported extensions
    if (!filePath.startsWith('menus/') || !SUPPORTED_EXTENSIONS.includes(extension)) {
      return;
    }
    const tempFilePath = path.join(os.tmpdir(), fileName);
    await uploadToStorage(fileBucket, filePath, tempFilePath, undefined);
    let rawText = '';
    let rawTextPath = undefined;
    try {
      rawText = await extractTextFromFile(tempFilePath, extension);
      const rawTextFileName = fileName.replace(extension, '.raw.txt');
      rawTextPath = `debug/${rawTextFileName}`;
      const tempRawTextPath = path.join(os.tmpdir(), rawTextFileName);
      fs.writeFileSync(tempRawTextPath, rawText);
      await uploadToStorage(fileBucket, rawTextPath, tempRawTextPath, 'text/plain');
      fs.unlinkSync(tempRawTextPath);
    } catch (err) {
      fs.unlinkSync(tempFilePath);
      return;
    }
    let menuJson;
    try {
      menuJson = await extractMenuJson(rawText);
    } catch (err) {
      fs.unlinkSync(tempFilePath);
      return;
    }
    // Save JSON to Storage
    const jsonFileName = fileName.replace(extension, '.json');
    const parsedPath = `parsed/${jsonFileName}`;
    const tempJsonPath = path.join(os.tmpdir(), jsonFileName);
    fs.writeFileSync(tempJsonPath, JSON.stringify(menuJson, null, 2));
    await uploadToStorage(fileBucket, parsedPath, tempJsonPath, 'application/json');
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
    await saveToFirestore('menus', docId, docData);
    // Cleanup temp files
    fs.unlinkSync(tempFilePath);
    fs.unlinkSync(tempJsonPath);
  });

module.exports = {
  processMenuUpload
}; 