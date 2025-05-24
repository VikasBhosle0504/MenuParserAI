import firebase_admin
from firebase_admin import credentials, firestore
import os
import tempfile
import json
# Initialize Firebase Admin SDK
firebase_app = None

def init_firebase():
    global firebase_app
    if not firebase_app:
        print("Initializing Firebase app...")
        cred_json = os.getenv('FIREBASE_SERVICE_ACCOUNT')
        if cred_json:
            print("Found FIREBASE_SERVICE_ACCOUNT env var.")
            try:
                with tempfile.NamedTemporaryFile(delete=False, mode='w', suffix='.json') as f:
                    f.write(cred_json)
                    cred_path = f.name
                cred = credentials.Certificate(cred_path)
            except Exception as e:
                print("Error writing service account JSON:", e)
                raise
        else:
            print("FIREBASE_SERVICE_ACCOUNT env var not found, falling back to GOOGLE_APPLICATION_CREDENTIALS.")
            cred_path = os.getenv('GOOGLE_APPLICATION_CREDENTIALS', 'serviceAccountKey.json')
            print("GOOGLE_APPLICATION_CREDENTIALS:", cred_path)
            if cred_path.strip().startswith('{'):
                with tempfile.NamedTemporaryFile(delete=False, mode='w', suffix='.json') as f:
                    f.write(cred_path)
                    cred_path = f.name
            cred = credentials.Certificate(cred_path)
        try:
            firebase_app = firebase_admin.initialize_app(cred)
            print("Firebase app initialized!")
        except Exception as e:
            print("Error initializing Firebase app:", e)
            raise
    return firestore.client()

def store_menu_json(doc_id, menu_json, collection_name='menus_langchain'):
    db = init_firebase()
    doc_ref = db.collection(collection_name).document(doc_id)
    doc_ref.set(menu_json) 