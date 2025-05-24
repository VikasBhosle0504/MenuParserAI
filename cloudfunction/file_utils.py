import io
from firebase_admin import storage
import pandas as pd
from firebase_utils import init_firebase  # Ensure Firebase is initialized
import os

def download_file_from_firebase(source_path):
    init_firebase()  # Ensure Firebase app is initialized before using storage
    bucket_name = os.getenv('FIREBASE_STORAGE_BUCKET')
    if not bucket_name:
        raise RuntimeError("FIREBASE_STORAGE_BUCKET environment variable not set")
    bucket = storage.bucket(bucket_name)
    blob = bucket.blob(source_path)
    file_bytes = blob.download_as_bytes()
    return file_bytes

def extract_text_from_image(image_bytes):
    # TODO: Implement OCR extraction (e.g., with pytesseract)
    return "[Extracted text from image placeholder]"

def extract_text_from_pdf(pdf_bytes):
    # TODO: Implement PDF text extraction (e.g., with pdfplumber)
    return "[Extracted text from PDF placeholder]"

def extract_data_from_excel(excel_bytes):
    df = pd.read_excel(io.BytesIO(excel_bytes))
    return df.to_dict(orient='records') 