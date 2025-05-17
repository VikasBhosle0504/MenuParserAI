/**
 * Import function triggers from their respective submodules:
 *
 * const {onCall} = require("firebase-functions/v2/https");
 * const {onDocumentWritten} = require("firebase-functions/v2/firestore");
 *
 * See a full list of supported triggers at https://firebase.google.com/docs/functions
 */

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

const db = admin.firestore();
const storage = new Storage();
const documentaiClient = new DocumentProcessorServiceClient();

const OPENAI_API_KEY = functions.config().openai.key;
const openai = new OpenAIApi(new Configuration({apiKey: OPENAI_API_KEY}));

const SUPPORTED_EXTENSIONS = ['.pdf', '.jpg', '.jpeg', '.png', '.docx', '.xlsx'];

const systemPrompt = fs.readFileSync(path.join(__dirname, 'prompts/systemPrompt.txt'), 'utf8');
const userPromptTemplate = fs.readFileSync(path.join(__dirname, 'prompts/userPrompt.txt'), 'utf8');

async function extractTextFromFile(filePath, extension) {
  if ([".jpg", ".jpeg", ".png", ".pdf"].includes(extension)) {
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
    const normalized = normalizeOCR(text);
    const merged = mergePriceLinesWithItems(normalized);
    return injectColumnBreaks(merged);
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
function injectColumnBreaks(text) {
  const lines = text.split('\n');
  for (let i = 40; i < lines.length; i += 40) {
    lines.splice(i, 0, '### COLUMN BREAK ###');
  }
  return lines.join('\n');
}
function normalizeOCR(text) {
  return text
    .replace(/([A-Z])\s{2,}([A-Z])/g, '$1\n$2')
    .replace(/([^\d])\s+(\d+\.\d{2})/g, '$1 $2')
    .replace(/\s{3,}/g, ' ')
    .trim();
}

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
  // Find the first JSON block in the response
  const content = response.data.choices[0].message.content;
  console.log("OpenAI raw response:", content);
  console.log("Token usage:", response.data.usage); // <-- logs token count

// Try strict JSON parse
    try {
      return JSON.parse(content);
    } catch (strictErr) {
      // Try fuzzy match for JSON block
      const match = content.match(/\\{[\\s\\S]*\\}/);
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

const processMenuUploadDocumentAI = functions
  .region('us-central1')
  .runWith({ memory: '1GB', timeoutSeconds: 540 })
  .storage.object()
  .onFinalize(async (object) => {
    const fileBucket = object.bucket;
    const filePath = object.name;
    const fileName = path.basename(filePath);
    const extension = path.extname(fileName).toLowerCase();

    // Only process files in 'menus_documentai/'
    if (!filePath.startsWith('menus_documentai/') || !SUPPORTED_EXTENSIONS.includes(extension)) {
      return;
    }

    const tempFilePath = path.join(os.tmpdir(), fileName);
    await storage.bucket(fileBucket).file(filePath).download({destination: tempFilePath});

    let rawText = '';
    let rawTextPath = undefined; // Always define it
    try {
      rawText = await extractTextFromFile(tempFilePath, extension);
      console.log('Raw text:', rawText);
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

    // --- CHUNKING LOGIC START ---
    let mergedMenu = [];
    let menuJson = {};
    try {
      const chunks = rawText.split('### COLUMN BREAK ###');
      for (const chunk of chunks) {
        if (chunk.trim().length === 0) continue;
        try {
          const chunkJson = await extractMenuJson(chunk);
          // If chunkJson has a 'menu' array, merge it; else, merge as array
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
    // --- CHUNKING LOGIC END ---

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

    // Cleanup
    fs.unlinkSync(tempFilePath);
    fs.unlinkSync(tempJsonPath);
  });

module.exports = { processMenuUploadDocumentAI };
