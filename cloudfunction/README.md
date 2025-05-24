# cloudfunction

This folder contains a Python-based Google Cloud Function for advanced menu parsing using LangChain and LLMs.

## Purpose
- Accept menu data (text, OCR output, or image) via HTTP.
- Process the menu using a chunked, multi-step LangChain pipeline (MapReduce + validation).
- Return or store structured JSON output compatible with your menu schema.

## Setup
1. Install dependencies:
   ```bash
   pip install -r requirements.txt
   ```
2. Set up your Firebase service account and LLM API keys as environment variables or in a secure config.
3. Deploy to Google Cloud Functions (Python runtime).

## Files
- `main.py`: Entry point for the Cloud Function (HTTP trigger)
- `requirements.txt`: Python dependencies
- `langchain_pipeline.py`: LangChain logic for menu parsing
- `firebase_utils.py`: Firebase Admin SDK helpers

---

See each file for more details. 