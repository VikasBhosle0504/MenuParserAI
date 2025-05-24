print("FastAPI app starting")

from dotenv import load_dotenv
load_dotenv()

from fastapi import FastAPI, Request, HTTPException, Body
from pydantic import BaseModel
from langchain_pipeline import parse_menu
import uvicorn
from firebase_utils import store_menu_json
import os
from firebase_admin import firestore
from menu_parser_with_file import parse_menu_with_file

app = FastAPI()

class MenuRequest(BaseModel):
    menu_text: str
    docId: str = None
    sourceFilePath: str = None
    def __init__(self, **data):
        print("MenuRequest __init__ called with:", data)
        super().__init__(**data)

class FileMenuRequest(BaseModel):
    sourceFilePath: str
    docId: str = None
    ocr_data: str = None
    def __init__(self, **data):
        print("FileMenuRequest __init__ called with:", data)
        super().__init__(**data)

@app.get("/health")
def health_check():
    return {"status": "ok"}

@app.post("/parse-menu")
def parse_menu_endpoint(request: MenuRequest):
    print(">>> PYTHON CLOUD RUN ENDPOINT HIT 11<<<")
    print("parse_menu_endpoint called, request:", request)
    try:
        result = parse_menu(request.menu_text)
        # Guarantee only one object in the menu array
        if isinstance(result, list):
            # If result is a list (shouldn't be, but just in case), flatten to first object
            single_result = result[0] if result else {}
        else:
            single_result = result
        # If docId is provided, store in Firestore
        print("parse_menu_endpoint 1 result:", single_result)
        print("parse_menu_endpoint 1 result:", request.docId)
        if request.docId:
            # Remove extension from docId if present
            doc_id_no_ext = os.path.splitext(request.docId)[0]
            wrapped_result = {"menu": [single_result]}  # Always a single merged result
            debug_raw_text_path = f'debug_langchain/{doc_id_no_ext}.raw.txt'
            doc_data = {
                **wrapped_result,
                'sourceFilePath': request.sourceFilePath,
                'source': 'langchain',
                'createdAt': firestore.SERVER_TIMESTAMP,
                'debugRawTextPath': debug_raw_text_path,
            }
            print("doc_data :", doc_id_no_ext)
            print("doc_data :", doc_data)
            store_menu_json(doc_id_no_ext, doc_data)
        return {"success": True}
    except Exception as e:
        print("Exception in parse_menu_endpoint:", e)
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/parse-menu-raw")
async def parse_menu_raw(request: Request):
    body = await request.json()
    print("parse_menu_raw called, body:", body)
    return body

@app.post("/test-echo")
def test_echo(request: dict):
    print("test_echo called")
    print("Request body:", request)
    return request

@app.post("/parse-menu-from-file")
def parse_menu_from_file_endpoint(request: FileMenuRequest = Body(...)):
    print("parse_menu_from_file_endpoint called, request:", request)
    try:
        result = parse_menu_with_file(request.sourceFilePath, request.ocr_data)
        if isinstance(result, list):
            single_result = result[0] if result else {}
        else:
            single_result = result
        print("parse_menu_from_file_endpoint result:", single_result)
        if request.docId:
            doc_id_no_ext = os.path.splitext(request.docId)[0]
            wrapped_result = {"menu": [single_result]}
            debug_raw_text_path = f'debug_langchain_vision/{doc_id_no_ext}.raw.txt'
            doc_data = {
                **wrapped_result,
                'sourceFilePath': request.sourceFilePath,
                'source': 'langchain',
                'createdAt': firestore.SERVER_TIMESTAMP,
                'debugRawTextPath': debug_raw_text_path,
            }
            print("doc_data :", doc_id_no_ext)
            print("doc_data :", doc_data)
            store_menu_json(doc_id_no_ext, doc_data,collection_name='menus_langchain_vision')
        return {"success": True}
    except Exception as e:
        print("Exception in parse_menu_from_file_endpoint:", e)
        raise HTTPException(status_code=500, detail=str(e))

if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=8080) 