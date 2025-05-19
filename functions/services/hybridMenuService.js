const functions = require('firebase-functions');
const admin = require('firebase-admin');
const { Storage } = require('@google-cloud/storage');
const path = require('path');
const os = require('os');
const fs = require('fs');
const { extractTextFromFile } = require('./documentai'); // reuse your existing OCR logic
const { hybridModeExtractMenu } = require('./hybridResearch');

const db = admin.firestore();
const storage = new Storage();

const SUPPORTED_EXTENSIONS = ['.pdf', '.jpg', '.jpeg', '.png', '.docx', '.xlsx'];

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
      menuJson = await hybridModeExtractMenu({ ocrData });
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