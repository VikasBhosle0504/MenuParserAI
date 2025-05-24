const functions = require('firebase-functions');
const admin = require('firebase-admin');
const { Storage } = require('@google-cloud/storage');
const path = require('path');
const os = require('os');
const fs = require('fs');
const { extractTextFromFile } = require('../utils/extractTextFromFile');
const { hybridModeExtractMenu } = require('./hybridResearch');
const axios = require('axios');

const db = admin.firestore();
const storage = new Storage();

const SUPPORTED_EXTENSIONS = ['.pdf', '.jpg', '.jpeg', '.png', '.docx', '.xlsx'];

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

const processHybridMenuUpload = functions
  .region('us-central1')
  .runWith({ memory: '1GB', timeoutSeconds: 540 })
  .storage.object()
  .onFinalize(async (object) => {
    const fileBucket = object.bucket;
    const filePath = object.name;
    const fileName = path.basename(filePath);
    const extension = path.extname(fileName).toLowerCase();
    if (!filePath.startsWith('menus_hybrid/') || !SUPPORTED_EXTENSIONS.includes(extension)) {
      return;
    }
    const tempFilePath = path.join(os.tmpdir(), fileName);
    await storage.bucket(fileBucket).file(filePath).download({ destination: tempFilePath });
    let ocrData = '';
    let rawTextPath = undefined;
    try {
      ocrData = await extractTextFromFile(tempFilePath, extension); // should return array of {text, x, y, ...}
      // Save raw OCR/layout to Storage for debugging
      const rawTextFileName = fileName.replace(extension, '.raw.txt');
      rawTextPath = `debug_hybrid/${rawTextFileName}`;
      const tempRawTextPath = path.join(os.tmpdir(), rawTextFileName);
      fs.writeFileSync(tempRawTextPath, JSON.stringify(ocrData, null, 2));
      await storage.bucket(fileBucket).upload(tempRawTextPath, { destination: rawTextPath, contentType: 'text/plain' });
      fs.unlinkSync(tempRawTextPath);
    } catch (err) {
      console.error('Hybrid text extraction failed:', err);
      fs.unlinkSync(tempFilePath);
      return;
    }
    let menuJson = {};
    try {
      let mergedMenu = [];
      let chunks = [];
      if (Array.isArray(ocrData)) {
        // If already an array (from OCR), join into a string for chunking
        const text = ocrData.map(lineObj => lineObj.text).join('\n');
        chunks = splitIntoChunks(text, 2000); // You can adjust 2000 as needed
      } else {
        // If string, split by column break first, then further chunk if needed
        const colChunks = ocrData.split('### COLUMN BREAK ###');
        for (const colChunk of colChunks) {
          if (colChunk.trim().length === 0) continue;
          const subChunks = splitIntoChunks(colChunk, 2000);
          chunks.push(...subChunks);
        }
      }
      for (const chunk of chunks) {
        if (chunk.trim().length === 0) continue;
        try {
          // For hybridModeExtractMenu, we want to pass the chunk as ocrData (array of objects)
          // So, if original ocrData was array, reconstruct the array for this chunk
          let chunkOcrData = chunk.split('\n').map((text, i) => ({ text, x: 0, y: i * 20 }));
          const chunkJson = await hybridModeExtractMenu({ ocrData: chunkOcrData });
          if (chunkJson && Array.isArray(chunkJson.menu)) {
            mergedMenu = mergedMenu.concat(chunkJson.menu);
          } else if (Array.isArray(chunkJson)) {
            mergedMenu = mergedMenu.concat(chunkJson);
          } else if (chunkJson) {
            mergedMenu.push(chunkJson);
          }
        } catch (err) {
          console.error('Hybrid OpenAI extraction failed for chunk:', err);
        }
      }
      menuJson = { menu: mergedMenu };
    } catch (err) {
      console.error('Hybrid OpenAI extraction failed:', err);
      fs.unlinkSync(tempFilePath);
      return;
    }
    // Save JSON to Storage
    const jsonFileName = fileName.replace(extension, '.json');
    const parsedPath = `parsed_hybrid/${jsonFileName}`;
    const tempJsonPath = path.join(os.tmpdir(), jsonFileName);
    fs.writeFileSync(tempJsonPath, JSON.stringify(menuJson, null, 2));
    await storage.bucket(fileBucket).upload(tempJsonPath, { destination: parsedPath, contentType: 'application/json' });
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
    await db.collection('menus_hybrid').doc(docId).set(docData);
    // Cleanup temp files
    fs.unlinkSync(tempFilePath);
    fs.unlinkSync(tempJsonPath);
  });

module.exports = { processHybridMenuUpload }; 