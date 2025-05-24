const admin = require('firebase-admin');
const axios = require('axios');
const { Storage } = require('@google-cloud/storage');
const path = require('path');
const os = require('os');
const fs = require('fs');
const { extractTextFromFile } = require('../utils/extractTextFromFile');
const functions = require('firebase-functions');

const SUPPORTED_EXTENSIONS = ['.pdf', '.jpg', '.jpeg', '.png', '.docx', '.xlsx'];

const db = admin.firestore();
const storage = new Storage();
/**
 * Send OCR text (raw string or array of objects) to LangChain Cloud Function and store result in Firestore
 * @param {string|Array} ocrText - The extracted OCR text from the menu (string or array of objects)
 * @param {string} docId - The Firestore document ID to store the result
 * @param {string} [cloudFunctionUrl] - The URL of the deployed Python Cloud Function
 * @param {string} [sourceFilePath] - (Optional) The source file path for traceability
 * @returns {Promise<void>}
 */
async function processMenuWithLangchain(ocrText, docId, cloudFunctionUrl = 'https://YOUR_CLOUD_FUNCTION_URL/parse-menu', sourceFilePath) {
  try {
    // If ocrText is an array, stringify it for the API
    const menuText = Array.isArray(ocrText) ? JSON.stringify(ocrText) : ocrText;
    // Send OCR text to the Python Cloud Function
    const response = await axios.post(cloudFunctionUrl, { menu_text: menuText , docId: docId, sourceFilePath: sourceFilePath});
    if (!response.data || !response.data.success) {
      throw new Error('LangChain Cloud Function did not return a valid response');
    }
   
  } catch (err) {
    console.error('Error processing menu with LangChain:', err);
    throw err;
  }
}

/**
 * Cloud Function: processUploadedFileWithLangchain
 * Triggers on new documents in menus_langchain, extracts OCR using Document AI, sends to Cloud Run, and stores result.
 */
const processUploadedFileWithLangchain = functions
.region('us-central1')
.runWith({ memory: '1GB', timeoutSeconds: 540 })
.storage.object()
.onFinalize(async (object) => {
  const fileBucket = object.bucket;
  const filePath = object.name;
  const fileName = path.basename(filePath);
  const extension = path.extname(fileName).toLowerCase();
  // Only process files in 'menus_documentai/' with supported extensions
  if (!filePath.startsWith('menus_langchain/') || !SUPPORTED_EXTENSIONS.includes(extension)) {
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
    rawTextPath = `debug_langchain/${rawTextFileName}`;
    const tempRawTextPath = path.join(os.tmpdir(), rawTextFileName);
    fs.writeFileSync(tempRawTextPath, JSON.stringify(rawText, null, 2));
    await storage.bucket(fileBucket).upload(tempRawTextPath, {destination: rawTextPath, contentType: 'text/plain'});
    fs.unlinkSync(tempRawTextPath);
  } catch (err) {
    console.error('Text extraction failed:', err);
    fs.unlinkSync(tempFilePath);
    return;
  }
    // Fire-and-forget: send OCR text to Cloud Run but do not await the response
    processMenuWithLangchain(
      rawText,
      fileName,
      'https://menu-parser-api-uigq6w2r7a-uc.a.run.app/parse-menu',
      filePath
    ).catch(err => {
      console.error('Error processing menu with LangChain (fire-and-forget):', err);
    });
    // Cleanup temp file
    fs.unlinkSync(tempFilePath);
  });

module.exports = {
  processMenuWithLangchain,
  processUploadedFileWithLangchain,
}; 