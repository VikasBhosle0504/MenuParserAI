/**
 * Import function triggers from their respective submodules:
 *
 * const {onCall} = require("firebase-functions/v2/https");
 * const {onDocumentWritten} = require("firebase-functions/v2/firestore");
 *
 * See a full list of supported triggers at https://firebase.google.com/docs/functions
 */

// controllers/index.js
// Entry point for backend cloud functions in the Menu Parser project.
// Wires up and exports all Firebase cloud functions, delegating business logic to services.

const functions = require('firebase-functions'); // Firebase Functions SDK
const admin = require('firebase-admin'); // Firebase Admin SDK
const {Storage} = require('@google-cloud/storage');
const vision = require('@google-cloud/vision');
const pdfParse = require('pdf-parse');
const xlsx = require('xlsx');
const mammoth = require('mammoth');
const {Configuration, OpenAIApi} = require('openai');
const path = require('path');
const os = require('os');
const fs = require('fs');

admin.initializeApp(); // Initialize Firebase Admin
const db = admin.firestore();
const storage = new Storage();
const visionClient = new vision.ImageAnnotatorClient();

const OPENAI_API_KEY = functions.config().openai.key;
const openai = new OpenAIApi(new Configuration({apiKey: OPENAI_API_KEY}));

const SUPPORTED_EXTENSIONS = ['.pdf', '.jpg', '.jpeg', '.png', '.docx', '.xlsx'];

// Import services
const { processMenuUpload } = require('../services/menuService');
const { processMenuUploadDocumentAI } = require('../services/documentai');

async function extractTextFromFile(filePath, extension) {
  if (['.jpg', '.jpeg', '.png', '.pdf'].includes(extension)) {
    const [result] = await visionClient.documentTextDetection(filePath);
    const pages = result.fullTextAnnotation?.pages || [];

    let allWords = [];

    // Extract word-level data with positions
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

    // Group words into rows (based on Y proximity)
    const rows = [];
    const yThreshold = 15;

    allWords.forEach(word => {
      const row = rows.find(r => Math.abs(r.y - word.y) < yThreshold);
      if (row) {
        row.words.push(word);
        row.y = (row.y + word.y) / 2; // average y to keep it stable
      } else {
        rows.push({ y: word.y, words: [word] });
      }
    });

    const processedLines = rows
      .map(row => {
        const sortedWords = row.words.sort((a, b) => a.x - b.x);
        const lineText = sortedWords.map(w => w.text).join(' ');

        // Detect last word that looks like a price
        const priceMatch = sortedWords.findLast(w => /^[£]?\d+(\.\d{2})?$/.test(w.text));
        const price = priceMatch?.text || null;

        // Everything before the price is considered name/desc
        const textParts = sortedWords.map(w => w.text);
        const priceIndex = priceMatch ? textParts.indexOf(priceMatch.text) : -1;
        const nameDesc = priceIndex > 0 ? textParts.slice(0, priceIndex).join(' ') : lineText;

        return `${nameDesc}${price ? ` ${price}` : ''}`;
      })
      .sort((a, b) => a.y - b.y); // sort lines top-down

    const combinedText = processedLines.join('\n');
    return mergeMultiLineItems(combinedText);
  }

  // Handle other file types
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


function mergeMultiLineItems(text) {
  const lines = text.split('\n');
  const merged = [];

  for (let i = 0; i < lines.length; i++) {
    const current = lines[i].trim();
    const prev = merged[merged.length - 1] || '';

    const isPriceOnly = /^[\d£\s/.]+$/.test(current) && /\d/.test(current);
    const isShortDesc = /^[a-zA-Z].{10,}$/.test(current) && !/£/.test(current);

    if ((isPriceOnly || isShortDesc) && prev && !/^\d/.test(prev)) {
      merged[merged.length - 1] = `${prev} ${current}`;
    } else {
      merged.push(current);
    }
  }

  return merged.join('\n');
}


async function extractMenuJson(rawText) {
  const prompt = `You are a menu parser.

Extract structured restaurant menu data from the following text and return valid, clean JSON.

### Requirements:
The menu may include:
- A restaurant name (optional)
- Categories and subcategories (e.g., Starters, Drinks, Desserts)(each with optional descriptions)
- Items, each of which may include:

  - a name (required)
  - a description (optional)
  - a single price (optional)
  - multiple variants (e.g., sizes, flavors), each with:
    - name
    - price
    - description (optional)
  - options (e.g., add-ons, toppings, modifiers), each with:
    - name
    - price (optional)
    - description (optional)
  - both variants and options (e.g., each variant can have its own options)

**Auto-naming rules**:
- If there are multiple prices without a name, label them as "variant1", "variant2", etc.
  Example : MIRASSOU, CA 9 40 
  Result:
    {
      "name": "MIRASSOU",
      "variants": [
        { "name": "variant1", "price": 9 },
        { "name": "variant2", "price": 40 }
      ]
    }
- If only some prices have names (e.g., "old fashioned 12 / manhatttan 13 9"):
  - Label the extra unnamed price as "Plain"
- If options have prices but no names, label them as "option1", "option2", etc.
- Variants with no names only prices:
   - If only some items have names, and has muliple prices without names.
    Example:
      Coke
      1.25 18.25 13.56
      Result:
        {
          "name": "Coke",
          "variants": [
            { "name": "variant1", "price": 1.25 },
            { "name": "variant2", "price": 18.25 },
            { "name": "variant3", "price": 13.56 }
          ]
        }
- Variants with partial names:
   - If only some prices have names, label the unnamed one as "Plain".
    Example:
      Coke
      Small - 1.99 / Medium - 2.99  3.99
      Result:
        {
          "name": "Coke",
          "variants": [
            { "name": "Small", "price": 1.99 },
            { "name": "Medium", "price": 2.99 },
            { "name": "Plain", "price": 3.99 }
          ]
        }

- Shared variants:
  - If a block of size/price lines (e.g., "Small - 1.99") appears before a list of item names, apply those variants to each item below until the next section.
    Example:
      Small - 1.99
      Medium - 2.99
      Large - 3.99

      Coke
      Sprite

      Result:
        {
          "name": "Coke",
          "variants": [
            { "name": "Small", "price": 1.99 },
            { "name": "Medium", "price": 2.99 },
            { "name": "Plain", "price": 3.99 }
          ]
        },{
          "name": "Sprite",
          "variants": [
            { "name": "Small", "price": 1.99 },
            { "name": "Medium", "price": 2.99 },
            { "name": "Plain", "price": 3.99 }
          ]
        }

- Grouped prices:
  - When a line like "per piece cake - 1.99" precedes a list of item names, treat "per piece cake" as the main item and the list below as options, all sharing the same price.
    Example:
    per piece cake - 1.99

    Chocolate cake 
    Mosse cake
    Mango cake

    Result:
        {
          "name": "per piece cake",
          "options": [
            { "name": "Chocolate cake ", "price": 1.99 },
            { "name": "Mosse cake", "price": 1.99 }
            { "name": "Mango cake", "price": 1.99 }
          ]
        }

**Clarify**:
- Do not infer names from lines that appear to be descriptions.
- If a description is listed directly below an item or variant, include it in the "description" field.
- Always group variants and their options under the correct item.
- Look for the spacing between to group properly the items, variants, options, etc.


JSON Examples:

// Single price item
{
  "name": "Paneer Tikka",
  "price": 8.99,
  "description": "Grilled paneer with spices",
  "dietary": ["Vegetarian"]
}

// Item with variants (e.g., sizes)
{
  "name": "Coke",
  "variants": [
    { "name": "200ml", "price": 1.99 },
    { "name": "500ml", "price": 2.99 },
    { "name": "1000ml", "price": 4.99 }
  ]
}

// Item with options (e.g., add-ons)
{
  "name": "Burger",
  "price": 5.99,
  "options": [
    { "name": "Cheese", "price": 0.5 },
    { "name": "Bacon", "price": 1.0 }
  ]
}

// Item with variants and options for each variant
{
  "name": "Pizza",
  "variants": [
    {
      "name": "Small",
      "price": 7.99,
      "options": [
        { 
          "title": "Choose your toppings", 
          "choices": [
            {"name": "Extra Cheese", "price": 1.5 },
            { "name": "Olives", "price": 0.75 }
          ]
        } 
      ]
    },
    {
      "name": "Large",
      "price": 12.99,
      "options": [
        { 
          "title": "Choose your toppings", 
          "choices": [
            {"name": "Extra Cheese", "price": 1.5 },
            { "name": "Olives", "price": 0.75 }
          ]
        } 
      ]
    }
  ]
}


// Category with subcategory example
{
  "restaurant_name": "Optional",
  "menu": [
    {
      "category": "Drinks",
      "description": "Chilled and refreshing",
      "subcategories": [
        {
          "subcategory": "Soft Drinks",
          "items": [ /* items here */ ]
        }
      ]
    }
  ]
}

- If the menu structure is ambiguous, make your best guess and preserve all possible information.
- Prefer to keep items grouped with their nearest category, rather than reclassifying based on item name alone.

Text:
"""
${rawText}
"""
`;

const sysContent = `You are an expert restaurant menu parsing assistant.

You take raw OCR or extracted text (from PDFs, images, or digital menus) and convert it into well-structured JSON that captures the true layout and grouping of the menu.

Your responsibilities:
- Preserve the vertical and visual grouping of items. Items listed below a category heading belong to that category until a new heading appears.
- Do not move items between categories unless a clear new category heading is present.
- Assume the menu text is laid out in visual blocks or columns — interpret based on vertical proximity.
- Honor any provided separators like "### COLUMN BREAK ###" to separate columns, and parse vertically within each.
- Output clean, valid JSON only — no markdown, no explanations, no extra text.

Be precise and strictly follow the item, variant, option, and nesting structures as described in the users instructions.
`;

  const response = await openai.createChatCompletion({
    model: 'gpt-4',
    messages: [
      {role: 'system', content: sysContent},
      {role: 'user', content: prompt}
    ],
    temperature: 0.2,
    max_tokens: 2048
  });
  // Find the first JSON block in the response
  const match = response.data.choices[0].message.content.match(/\{[\s\S]*\}/);
  if (match) {
    return JSON.parse(match[0]);
  }
  throw new Error('No JSON found in OpenAI response');
}

/**
 * Cloud Function: processMenuUpload
 * Handles standard menu file uploads and processing.
 */
exports.processMenuUpload = processMenuUpload;

/**
 * Cloud Function: processMenuUploadDocumentAI
 * Handles Document AI-based menu file uploads and processing.
 */
exports.processMenuUploadDocumentAI = processMenuUploadDocumentAI;

/**
 * Cloud Function: createUserDoc
 * Creates a Firestore user document with a default role when a new user is created in Firebase Auth.
 */
exports.createUserDoc = functions.auth.user().onCreate((user) => {
  return admin.firestore().collection('users').doc(user.uid).set({
    email: user.email,
    role: 'viewer' // default role, change as needed
  });
});
