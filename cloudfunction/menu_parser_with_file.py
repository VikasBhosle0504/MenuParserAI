import os
import base64
import openai
import json
import re
from file_utils import download_file_from_firebase, extract_data_from_excel
from langchain_pipeline import parse_menu
from jsonschema import validate, ValidationError
from pdf2image import convert_from_bytes
from io import BytesIO

# Load system prompt from file
PROMPT_DIR = os.path.dirname(os.path.abspath(__file__))
SYSTEM_PROMPT_PATH = os.path.join(PROMPT_DIR, 'system_prompts_vision.txt')
with open(SYSTEM_PROMPT_PATH, 'r', encoding='utf-8') as f:
    SYSTEM_PROMPT = f.read()

def call_gpt4_vision_on_chunk(chunk_json, image_bytes, openai_api_key=None):
    if openai_api_key:
        openai.api_key = openai_api_key
    image_b64 = base64.b64encode(image_bytes).decode("utf-8")
    image_data_url = f"data:image/png;base64,{image_b64}"
    response = openai.chat.completions.create(
        model="gpt-4.1-mini",
        messages=[
            {"role": "system", "content": SYSTEM_PROMPT},
            {
                "role": "user",
                "content": [
                    {"type": "text", "text": chunk_json},
                    {"type": "image_url", "image_url": {"url": image_data_url}},
                ],
            },
        ],
        max_tokens=4096,
        temperature=0.2,
    )
    return response.choices[0].message.content

def parse_menu_with_gpt4_vision(ocr_data, image_bytes, openai_api_key=None):
    # Parse OCR data if it's a string
    if isinstance(ocr_data, str):
        ocr_data = json.loads(ocr_data)
    # Improved chunking: Only chunk if OCR data is extremely large (e.g., >120 items)
    # For most menus, send the full OCR array and image together for full context
    if len(ocr_data) <= 120:
        chunks = [ocr_data]
    else:
        # TODO: Ideally chunk by logical sections, not just by size
        chunk_size = 60
        chunks = [ocr_data[i:i+chunk_size] for i in range(0, len(ocr_data), chunk_size)]
    all_results = []
    for chunk in chunks:
        chunk_json = json.dumps(chunk, ensure_ascii=False)
        result = call_gpt4_vision_on_chunk(chunk_json, image_bytes, openai_api_key)
        # Remove markdown code block markers if present
        cleaned_for_json = result.strip().removeprefix('```json').removesuffix('```').strip()
        try:
            parsed = json.loads(cleaned_for_json)
            all_results.append(parsed)
        except Exception as e:
            print("Error parsing vision model output:", e)
            continue
    # Use parse_menu to merge results (it already merges multiple results)
    merged = parse_menu(all_results)
    # Post-processing: Remove hallucinated subcategories
    merged = filter_hallucinated_subcategories(merged)
    return merged

def filter_hallucinated_subcategories(menu_json):
    """
    Remove subcategories with suspicious/hallucinated names (e.g., 'Column 1', '16v', etc.)
    """
    if not menu_json or "data" not in menu_json or "sub_category" not in menu_json["data"]:
        return menu_json
    hallucinated_patterns = [
        r"^Column \\d+$", r"^\\d+[a-zA-Z]?$", r"^\\d+$", r"^\\d+v$", r"^\\d+c$", r"^$"
    ]
    import re
    def is_hallucinated(title):
        for pat in hallucinated_patterns:
            if re.match(pat, title.strip()):
                return True
        return False
    filtered_subcats = [sc for sc in menu_json["data"]["sub_category"] if not is_hallucinated(sc.get("title", ""))]
    menu_json["data"]["sub_category"] = filtered_subcats
    # Optionally, remove items that reference removed subcategories
    valid_subcat_ids = set(sc["id"] for sc in filtered_subcats)
    menu_json["data"]["items"] = [item for item in menu_json["data"]["items"] if item.get("subCatId") in valid_subcat_ids]
    return menu_json

def pdf_to_images(pdf_bytes):
    """
    Convert PDF bytes to a list of image bytes (PNG format).
    Returns a list of bytes objects.
    """
    pil_images = convert_from_bytes(pdf_bytes)
    image_bytes_list = []
    for img in pil_images:
        buf = BytesIO()
        img.save(buf, format='PNG')
        image_bytes_list.append(buf.getvalue())
    return image_bytes_list

def parse_menu_with_file(source_file_path, ocr_data=None):
    file_bytes = None
    if source_file_path.lower().endswith((".png", ".jpg", ".jpeg", ".pdf")):
        file_bytes = download_file_from_firebase(source_file_path)
    openai_api_key = os.getenv("OPENAI_API_KEY")
    if ocr_data and file_bytes:
        if source_file_path.lower().endswith(".pdf"):
            # Convert PDF to images and process each page
            image_bytes_list = pdf_to_images(file_bytes)
            # Assume ocr_data is a list of lists (one per page) or a flat list
            if isinstance(ocr_data, str):
                ocr_data = json.loads(ocr_data)
            if isinstance(ocr_data, list) and len(image_bytes_list) == len(ocr_data):
                results = []
                for page_ocr, page_img in zip(ocr_data, image_bytes_list):
                    result = parse_menu_two_step(page_ocr, page_img, openai_api_key)
                    results.append(result)
                # Merge results (simple merge: combine categories, subcategories, items)
                merged = {"data": {"category": [], "sub_category": [], "items": []}}
                for res in results:
                    if "data" in res:
                        merged["data"]["category"].extend(res["data"].get("category", []))
                        merged["data"]["sub_category"].extend(res["data"].get("sub_category", []))
                        merged["data"]["items"].extend(res["data"].get("items", []))
                return merged
            else:
                # Fallback: treat as single page
                return parse_menu_two_step(ocr_data, image_bytes_list[0], openai_api_key)
        else:
            # Use the new two-step process for images
            return parse_menu_two_step(ocr_data, file_bytes, openai_api_key)
    elif ocr_data:
        return parse_menu(ocr_data)
    elif source_file_path.lower().endswith((".xls", ".xlsx")):
        file_bytes = download_file_from_firebase(source_file_path)
        menu_input = extract_data_from_excel(file_bytes)
        return parse_menu(menu_input)
    else:
        raise ValueError("OCR data must be provided for images and PDFs.")

def refine_menu_with_vision(initial_json, image_bytes, openai_api_key=None):
    """
    Refine the initial menu JSON using the menu image and a vision model.
    The model is instructed to only make corrections based on the image, not to start from scratch.
    """
    PROMPT_DIR = os.path.dirname(os.path.abspath(__file__))
    SYSTEM_PROMPT_PATH = os.path.join(PROMPT_DIR, 'system_prompts_vision_refine.txt')
    with open(SYSTEM_PROMPT_PATH, 'r', encoding='utf-8') as f:
        SYSTEM_PROMPT = f.read()

    if openai_api_key:
        openai.api_key = openai_api_key
    image_b64 = base64.b64encode(image_bytes).decode("utf-8")
    image_data_url = f"data:image/png;base64,{image_b64}"

    user_content = [
        {"type": "text", "text": json.dumps(initial_json, ensure_ascii=False)},
        {"type": "image_url", "image_url": {"url": image_data_url}},
    ]

    response = openai.chat.completions.create(
        model="gpt-4.1-mini",
        messages=[
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": user_content},
        ],
        max_tokens=4096,
        temperature=0.2,
    )
    result = response.choices[0].message.content
    cleaned_for_json = result.strip().removeprefix('```json').removesuffix('```').strip()
    try:
        return json.loads(cleaned_for_json)
    except Exception as e:
        print("Error parsing vision model output:", e)
        return cleaned_for_json  # Return raw output for debugging 

def attempt_repair_json(json_str):
    """
    Attempt to repair common JSON issues: remove trailing commas, fix brackets, etc.
    Returns parsed JSON if successful, else None.
    """
    # Remove markdown code block markers if present
    cleaned = re.sub(r'^```json\s*|```$', '', json_str.strip(), flags=re.MULTILINE).strip()
    # Remove trailing commas before } or ]
    cleaned = re.sub(r',\s*([}\]])', r'\1', cleaned)
    # Try to load
    try:
        return json.loads(cleaned)
    except Exception:
        pass
    # Try to fix unbalanced brackets (very basic)
    open_braces = cleaned.count('{')
    close_braces = cleaned.count('}')
    if open_braces > close_braces:
        cleaned += '}' * (open_braces - close_braces)
    elif close_braces > open_braces:
        cleaned = cleaned.rstrip('}')
    try:
        return json.loads(cleaned)
    except Exception:
        return None

def parse_menu_two_step(ocr_data, image_bytes, openai_api_key=None):
    """
    Two-step menu parsing:
    1. Parse OCR data with text-based parser to get initial JSON.
    2. Refine the initial JSON using the vision model and the menu image.
    Returns the final refined JSON.
    """
    # Step 1: Text-based parse
    initial_json = parse_menu(ocr_data)
    # Step 2: Vision-based refinement
    refined_json = refine_menu_with_vision(initial_json, image_bytes, openai_api_key)

    # Menu schema (copied from langchain_pipeline.py)
    menu_schema = {
        "type": "object",
        "properties": {
            "data": {
                "type": "object",
                "properties": {
                    "category": {
                        "type": "array",
                        "items": {
                            "type": "object",
                            "properties": {
                                "id": {"type": "integer"},
                                "title": {"type": "string"},
                                "description": {"type": "string"}
                            },
                            "required": ["id", "title", "description"]
                        }
                    },
                    "sub_category": {
                        "type": "array",
                        "items": {
                            "type": "object",
                            "properties": {
                                "id": {"type": "integer"},
                                "catId": {"type": "integer"},
                                "title": {"type": "string"},
                                "description": {"type": "string"}
                            },
                            "required": ["id", "catId", "title", "description"]
                        }
                    },
                    "items": {
                        "type": "array",
                        "items": {
                            "type": "object",
                            "properties": {
                                "itemId": {"type": "integer"},
                                "subCatId": {"type": "integer"},
                                "title": {"type": "string"},
                                "description": {"type": "string"},
                                "price": {"type": "number"},
                                "variantAvailable": {"type": "integer"},
                                "variants": {"type": "array"},
                                "optionsAvailable": {"type": "integer"},
                                "options": {"type": "array"}
                            },
                            "required": ["itemId", "subCatId", "title", "description", "price", "variantAvailable", "variants", "optionsAvailable", "options"]
                        }
                    }
                },
                "required": ["category", "sub_category", "items"]
            }
        },
        "required": ["data"]
    }
    try:
        validate(instance=refined_json, schema=menu_schema)
        return refined_json
    except ValidationError as e:
        print("Schema validation error after vision model refinement:", e)
        print("Attempting to repair vision model output...")
        # If the vision model output was a string (malformed JSON), try to repair
        if isinstance(refined_json, str):
            repaired = attempt_repair_json(refined_json)
            if repaired is not None:
                try:
                    validate(instance=repaired, schema=menu_schema)
                    print("Repair successful. Returning repaired JSON.")
                    return repaired
                except ValidationError as e2:
                    print("Repair failed schema validation:", e2)
        print("Falling back to initial text-based parse result.")
        return initial_json 