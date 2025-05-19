// hybridResearch.js
// Research and prototyping for hybrid (vision + LLM) menu extraction.
// This module is for experimenting with combining visual block detection (e.g., via Google Vision/Document AI)
// and LLM (OpenAI GPT) parsing for improved menu structure extraction.

/**
 * Research Plan:
 * 1. Use Google Vision/Document AI to extract both text and layout (coordinates, blocks, etc.).
 * 2. Experiment with passing both the raw image (if using GPT-4 Vision) and the structured layout data to the LLM.
 * 3. Encode visual grouping (columns, blocks, bounding boxes) in the prompt for GPT-4-turbo.
 * 4. If GPT-4 Vision API is available, send both the image and the extracted text for richer context.
 * 5. Compare results of text-only, layout-encoded, and vision+text approaches.
 * 6. Develop a unified function (hybridModeExtractMenu) that can switch between modes based on config or input.
 */

const fs = require('fs');
const path = require('path');
const { OpenAIApi, Configuration } = require('openai');
const functions = require('firebase-functions');

const OPENAI_API_KEY = functions.config().openai.key;
const openai = new OpenAIApi(new Configuration({ apiKey: OPENAI_API_KEY }));

// Load hybrid prompt templates
const hybridSystemPrompt = fs.readFileSync(path.join(__dirname, '../resources/prompts/hybrid/hybridSystemPrompt.txt'), 'utf8');
const hybridUserPromptTemplate = fs.readFileSync(path.join(__dirname, '../resources/prompts/hybrid/hybridUserPrompt.txt'), 'utf8');

// Main hybrid extraction function
async function hybridModeExtractMenu({ imagePath, ocrData, useVision = false }) {
  if (useVision) {
    // TODO: Implement GPT-4 Vision API call with image and ocrData
    throw new Error('GPT-4 Vision mode not implemented yet.');
  } else {
    // Encode ocrData as JSON in the prompt
    const userPrompt = hybridUserPromptTemplate.replace('{{RAW_TEXT}}', JSON.stringify(ocrData, null, 2));
    const response = await openai.createChatCompletion({
      model: 'gpt-4-turbo',
      messages: [
        { role: 'system', content: hybridSystemPrompt },
        { role: 'user', content: userPrompt }
      ],
      temperature: 0.2,
      max_tokens: 4096
    });
    const content = response.data.choices[0].message.content;
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
}

module.exports = { hybridModeExtractMenu }; 