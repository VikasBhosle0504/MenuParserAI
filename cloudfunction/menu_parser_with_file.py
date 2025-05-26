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
        temperature=0,
        top_p=1,
    )
    return response.choices[0].message.content

def chunk_ocr_by_sections(ocr_data, max_items_per_chunk=60):
    """
    Improved: Chunk OCR data by detected section/category headers.
    Each chunk will contain all items under one or more sections/categories.
    Section headers are not included as items. Each chunk is a dict with section_title and items.
    """
    import re
    if not isinstance(ocr_data, list):
        return [ocr_data]

    section_indices = []
    section_titles = []
    for i, item in enumerate(ocr_data):
        text = item.get('text', '').strip()
        # Improved heuristics for section headers
        if (
            text.isupper() and len(text) > 2 and len(text.split()) < 6
            and not re.search(r'\$|\d+\.\d{2}|HALF|WHOLE|SMALL|LARGE', text)
        ) or re.match(r'^(starters|appetizers|main course|desserts|beverages|drinks|sides|salads|soups|specials|breakfast|lunch|dinner)s?$', text, re.I):
            section_indices.append(i)
            section_titles.append(text)
    if not section_indices or section_indices[0] != 0:
        section_indices = [0] + section_indices
        section_titles = [ocr_data[0].get('text', '').strip()] + section_titles
    section_indices.append(len(ocr_data))

    chunks = []
    for idx in range(len(section_indices) - 1):
        section = ocr_data[section_indices[idx]:section_indices[idx+1]]
        # Remove the section header from items
        if section:
            section_header = section[0]
            items = section[1:]
            # If section is too large, split by size
            for i in range(0, len(items), max_items_per_chunk):
                chunk = {
                    "section_title": section_header.get('text', '').strip(),
                    "items": items[i:i+max_items_per_chunk]
                }
                chunks.append(chunk)
    return chunks

def parse_menu_with_gpt4_vision(ocr_data, image_bytes, openai_api_key=None):
    # Parse OCR data if it's a string
    if isinstance(ocr_data, str):
        ocr_data = json.loads(ocr_data)
    # Improved chunking: Chunk by logical sections/categories
    chunks = chunk_ocr_by_sections(ocr_data, max_items_per_chunk=60)
    all_results = []
    for chunk in chunks:
        # Compose chunk JSON with section title and items
        chunk_json = json.dumps({
            "section_title": chunk["section_title"],
            "items": chunk["items"]
        }, ensure_ascii=False)
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
    # Merge single-item subcategories into parent (e.g., DESSERTS)
    merged = merge_single_item_subcategories(merged, parent_subcat_title="DESSERTS")
    # OCR-aware postprocessing for look-ahead price blocks and inline prices
    merged = robust_ocr_postprocessing(merged, ocr_data)
    # Generalized: propagate shared variants and extract variants from descriptions for all subcategories
    merged = extract_variants_from_description_all(merged)
    merged = propagate_shared_variants_all(merged)
    merged = reindex_menu_ids(merged)
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

def merge_single_item_subcategories(menu_json, parent_subcat_title="DESSERTS"):
    """
    Merge single-item subcategories (where the subcategory title matches the item title)
    back into the parent subcategory (e.g., 'DESSERTS').
    """
    if not menu_json or "data" not in menu_json or "sub_category" not in menu_json["data"]:
        return menu_json
    subcats = menu_json["data"]["sub_category"]
    items = menu_json["data"]["items"]
    # Find the parent subcategory id
    parent_subcat = next((sc for sc in subcats if sc["title"].upper() == parent_subcat_title.upper()), None)
    if not parent_subcat:
        return menu_json
    parent_id = parent_subcat["id"]
    to_remove = []
    for sc in subcats:
        if sc["title"].upper() == parent_subcat_title.upper():
            continue
        # Find items in this subcategory
        sc_items = [item for item in items if item["subCatId"] == sc["id"]]
        if len(sc_items) == 1 and sc["title"].upper() == sc_items[0]["title"].upper():
            # Move item to parent subcategory
            sc_items[0]["subCatId"] = parent_id
            to_remove.append(sc)
    # Remove merged subcategories
    for sc in to_remove:
        subcats.remove(sc)
    return menu_json

def normalize_variant_title(title):
    # Capitalize first letter, rest lowercase
    return title.capitalize()

def normalize_price(price):
    try:
        return round(float(price), 2)
    except Exception:
        return 0.0

def propagate_shared_variants_all(menu_json):
    """
    For all subcategories, if any item has variants, propagate those variants to all items in the subcategory that are missing them.
    Normalize variant titles and prices.
    """
    if not menu_json or "data" not in menu_json or "sub_category" not in menu_json["data"]:
        return menu_json
    subcats = menu_json["data"]["sub_category"]
    items = menu_json["data"]["items"]
    for subcat in subcats:
        subcat_id = subcat["id"]
        # Find all variants in this subcategory
        all_variants = []
        for item in items:
            if item["subCatId"] == subcat_id and item.get("variants") and len(item["variants"]) > 0:
                all_variants = item["variants"]
                break
        # Normalize variant titles and prices
        all_variants = [
            {"variantTitle": normalize_variant_title(v["variantTitle"]), "price": normalize_price(v["price"]), "description": v.get("description", "")}
            for v in all_variants
        ]
        for item in items:
            if item["subCatId"] == subcat_id:
                # Normalize existing variants
                if item.get("variants") and len(item["variants"]) > 0:
                    item["variants"] = [
                        {"variantTitle": normalize_variant_title(v["variantTitle"]), "price": normalize_price(v["price"]), "description": v.get("description", "")}
                        for v in item["variants"]
                    ]
                    item["variantAvailable"] = 1
                    item["price"] = 0
                # Propagate if missing
                elif all_variants:
                    item["variants"] = all_variants
                    item["variantAvailable"] = 1
                    item["price"] = 0
    return menu_json

def extract_variants_from_description_all(menu_json):
    """
    For all subcategories, if an item has a description like 'PINT $2.00 QUART $3.00',
    extract these as variants and clear the description. Normalize titles and prices.
    """
    if not menu_json or "data" not in menu_json or "sub_category" not in menu_json["data"]:
        return menu_json
    subcats = menu_json["data"]["sub_category"]
    items = menu_json["data"]["items"]
    for subcat in subcats:
        subcat_id = subcat["id"]
        for item in items:
            if item["subCatId"] == subcat_id and item.get("description"):
                desc = item["description"]
                # Look for patterns like 'PINT $2.00 QUART $3.00'
                matches = re.findall(r'(\w+)\s*\$([0-9]+(?:\.[0-9]{1,2})?)', desc)
                if matches:
                    item["variants"] = [
                        {"variantTitle": normalize_variant_title(m[0]), "price": normalize_price(m[1]), "description": ""} for m in matches
                    ]
                    item["variantAvailable"] = 1
                    item["price"] = 0
                    item["description"] = ""
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
        temperature=0,
        top_p=1,
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
        refined_json = reindex_menu_ids(refined_json)
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
                    repaired = reindex_menu_ids(repaired)
                    return repaired
                except ValidationError as e2:
                    print("Repair failed schema validation:", e2)
        print("Falling back to initial text-based parse result.")
        initial_json = reindex_menu_ids(initial_json)
        return initial_json 

def fuzzy_fix_price(text):
    # Fixes prices like 'Small $1.' to 'Small $1.00', 'Je $2.00' to 'Large $2.00', etc.
    import re
    text = text.replace('Je', 'Large')  # OCR quirk
    m = re.match(r'^(.*?)(\$\d+)(\.|)$', text)
    if m and m.group(3) == '.':
        return f"{m.group(1)}{m.group(2)}.00"
    m2 = re.match(r'^(.*?)(\$\d+)$', text)
    if m2:
        return f"{m2.group(1)}{m2.group(2)}.00"
    return text

def is_section_header(line):
    return line.isupper() and len(line) > 2 and len(line.split()) < 6

def is_price_line(line):
    import re
    return bool(re.search(r'\$\d', line))

def is_item_name(line):
    # Heuristic: not a price, not a header, not empty, not a variant label
    if not line or is_section_header(line) or is_price_line(line):
        return False
    if re.match(r'^(SMALL|MEDIUM|LARGE|HALF|WHOLE|PINT|QUART)$', line.strip(), re.I):
        return False
    return True

def normalize_title(title):
    return re.sub(r'\s+', '', title).strip().lower()

def robust_ocr_postprocessing(menu_json, ocr_data):
    """
    Ultra-robust: fuzzy matching, tolerant to breaks, finalizes parent-with-options and shared variant blocks at section end,
    and groups all subsequent item names as options or applies variants, regardless of minor breaks.
    Adds a post-finalization sweep to catch any missed groupings or variant assignments.
    """
    import re
    if not menu_json or "data" not in menu_json or "sub_category" not in menu_json["data"]:
        return menu_json
    subcats = menu_json["data"]["sub_category"]
    items = menu_json["data"]["items"]
    subcat_map = {sc["title"].upper(): sc["id"] for sc in subcats}
    def normalize_title(title):
        return re.sub(r'\s+', '', title).strip().lower()
    item_map = {(item["subCatId"], normalize_title(item["title"])): item for item in items}
    section_indices = []
    for i, ocr in enumerate(ocr_data):
        text = ocr.get('text', '').strip()
        if is_section_header(text):
            section_indices.append(i)
    if not section_indices or section_indices[0] != 0:
        section_indices = [0] + section_indices
    section_indices.append(len(ocr_data))
    # Track shared variants per section for post-sweep
    shared_variants_per_section = {}
    for idx in range(len(section_indices) - 1):
        section = ocr_data[section_indices[idx]:section_indices[idx+1]]
        if not section:
            continue
        section_title = section[0].get('text', '').strip().upper()
        subcat_id = subcat_map.get(section_title)
        if not subcat_id:
            continue
        i = 1
        shared_variants = []
        parent_item = None
        in_shared_variant_block = False
        in_parent_options_block = False
        parent_options_price = None
        parent_options_choices = []
        handled_items = set()
        option_titles_to_remove = []
        all_option_lines = []
        while i < len(section):
            line = section[i].get('text', '').strip()
            line = fuzzy_fix_price(line)
            # Detect shared variant/price block
            variant_block = []
            j = i
            while j+1 < len(section):
                vtitle = section[j].get('text', '').strip()
                vtitle = fuzzy_fix_price(vtitle)
                vprice = section[j+1].get('text', '').strip()
                vprice = fuzzy_fix_price(vprice)
                if re.match(r'^(SMALL|MEDIUM|LARGE|HALF|WHOLE|PINT|QUART)$', vtitle, re.I) and re.match(r'^\$?\d+(\.\d{1,2})?$', vprice):
                    variant_block.append({
                        "variantTitle": vtitle.capitalize(),
                        "price": float(vprice.replace('$','')),
                        "description": ""
                    })
                    j += 2
                else:
                    break
            if variant_block:
                shared_variants = variant_block
                shared_variants_per_section[subcat_id] = shared_variants
                in_shared_variant_block = True
                i = j
                parent_item = None
                in_parent_options_block = False
                continue
            # Parent-with-options: e.g., PIE BY THE SLICE $2.50
            m = re.match(r'^(.*?)(?:\s+|\s*\$)(\$?\d+(?:\.\d{1,2})?)$', line)
            if m:
                parent_title = m.group(1).strip().upper()
                price = float(m.group(2).replace('$',''))
                norm_parent_title = normalize_title(parent_title)
                parent_item = None
                for (scid, norm_title), item in item_map.items():
                    if scid == subcat_id and norm_title == norm_parent_title:
                        parent_item = item
                        break
                if parent_item:
                    parent_item["price"] = 0.00
                    parent_item["variantAvailable"] = 0
                    parent_item["variants"] = []
                    parent_item["options"] = []
                    parent_item["optionsAvailable"] = 1
                    parent_options_price = price
                    parent_options_choices = []
                    in_parent_options_block = True
                    all_option_lines = []
                in_shared_variant_block = False
                i += 1
                continue
            # If in parent-with-options block, collect all possible option lines (even if not contiguous)
            if in_parent_options_block:
                if is_item_name(line):
                    all_option_lines.append(line)
                i += 1
                continue
            # If in shared variant block and line is an item name, apply variants
            if in_shared_variant_block and is_item_name(line):
                norm_line = normalize_title(line)
                for (scid, norm_title), item in item_map.items():
                    if scid == subcat_id and norm_title == norm_line:
                        item["variants"] = shared_variants
                        item["variantAvailable"] = 1
                        item["price"] = 0
                        handled_items.add((scid, norm_title))
                        break
                i += 1
                continue
            # End parent-with-options or shared variant block if we hit a price, section, or non-item
            if is_section_header(line) or is_price_line(line) or not is_item_name(line):
                parent_item = None
                in_parent_options_block = False
                in_shared_variant_block = False
            i += 1
        # FINALIZE: If parent-with-options block is still open at section end, group all collected option lines
        if in_parent_options_block and parent_item and all_option_lines:
            parent_options_choices = [{
                "title": opt,
                "description": "",
                "allergenInfo": "",
                "dietary": "",
                "price": parent_options_price if parent_options_price is not None else 0.00
            } for opt in all_option_lines]
            parent_item["options"] = [{
                "optTitle": "choose one",
                "commonChoicePriceAvailable": 1,
                "price": 0.00,
                "choices": parent_options_choices
            }]
            # Remove all option items using fuzzy matching
            remove_titles = set(normalize_title(t) for t in all_option_lines)
            items[:] = [item for item in items if not (item["subCatId"] == subcat_id and normalize_title(item["title"]) in remove_titles and item is not parent_item)]
            item_map = {(item["subCatId"], normalize_title(item["title"])): item for item in items}
        # FINALIZE: If shared variant block is still open at section end, apply to all remaining items
        if in_shared_variant_block and shared_variants:
            for item in items:
                key = (item["subCatId"], normalize_title(item["title"]))
                if item["subCatId"] == subcat_id and key not in handled_items and (not item.get("variants") or len(item["variants"]) == 0):
                    item["variants"] = shared_variants
                    item["variantAvailable"] = 1
                    item["price"] = 0
    # POST-FINALIZATION SWEEP
    # 1. Group any remaining pie/cake/etc. items as options under a parent-with-options if their price matches a parent
    # 2. Apply shared variants to any item in a section that is missing them
    # (A) Parent-with-options sweep
    for parent_item in items[:]:
        if parent_item.get("optionsAvailable", 0) == 1 and parent_item.get("options"):
            # Find all items in same subCatId that could be options (fuzzy match, price match)
            parent_price = None
            for opt in parent_item["options"]:
                if opt.get("choices") and len(opt["choices"]) > 0:
                    parent_price = opt["choices"][0]["price"]
                    break
            if parent_price is not None:
                option_candidates = []
                for item in items[:]:
                    if item is parent_item:
                        continue
                    if item["subCatId"] == parent_item["subCatId"] and abs(item.get("price", 0) - parent_price) < 0.01:
                        # Looks like an option
                        option_candidates.append(item)
                # Add as options and remove from items
                for opt_item in option_candidates:
                    parent_item["options"][0]["choices"].append({
                        "title": opt_item["title"],
                        "description": opt_item.get("description", ""),
                        "allergenInfo": "",
                        "dietary": "",
                        "price": parent_price
                    })
                    items.remove(opt_item)
    # (B) Shared variant sweep (force apply to all items in subcat if variants exist)
    for subcat in subcats:
        subcat_id = subcat["id"]
        shared_variants = shared_variants_per_section.get(subcat_id)
        if shared_variants:
            for item in items:
                if item["subCatId"] == subcat_id:
                    item["variants"] = shared_variants
                    item["variantAvailable"] = 1
                    item["price"] = 0
    # Aggressive parent-with-options sweep: group all items with the same price as a parent-with-options
    for subcat in subcats:
        subcat_id = subcat["id"]
        # Find parent-with-options candidates (e.g., 'BY THE SLICE', 'BY THE PIECE', 'BY THE GLASS', etc.)
        for parent_item in items[:]:
            if parent_item["subCatId"] == subcat_id and (
                re.search(r"BY THE (SLICE|PIECE|GLASS|BOWL|CUP|ORDER|PLATE)", parent_item["title"], re.I)
                or re.search(r"CHOOSE ONE", parent_item["title"], re.I)
            ):
                parent_price = parent_item.get("price", 0)
                option_candidates = []
                for opt_item in items[:]:
                    if (
                        opt_item is not parent_item
                        and opt_item["subCatId"] == subcat_id
                        and abs(opt_item.get("price", 0) - parent_price) < 0.01
                    ):
                        option_candidates.append(opt_item)
                if option_candidates:
                    parent_item["options"] = [{
                        "optTitle": "choose one",
                        "commonChoicePriceAvailable": 1,
                        "price": 0.00,
                        "choices": [
                            {
                                "title": opt_item["title"],
                                "description": opt_item.get("description", ""),
                                "allergenInfo": "",
                                "dietary": "",
                                "price": parent_price
                            }
                            for opt_item in option_candidates
                        ]
                    }]
                    parent_item["optionsAvailable"] = 1
                    # Remove option items from items list
                    for opt_item in option_candidates:
                        items.remove(opt_item)
    return menu_json 

def reindex_menu_ids(menu_json):
    """
    Reassigns unique, sequential IDs to categories, subcategories, and items,
    and fixes references (catId, subCatId) accordingly.
    """
    if not menu_json or "data" not in menu_json:
        return menu_json

    data = menu_json["data"]
    new_cat_ids = {}
    new_subcat_ids = {}
    new_item_ids = {}

    # Reindex categories
    for i, cat in enumerate(data.get("category", []), start=1):
        new_cat_ids[cat["id"]] = i
        cat["id"] = i

    # Reindex subcategories
    for i, sub in enumerate(data.get("sub_category", []), start=1):
        new_subcat_ids[sub["id"]] = i
        sub["id"] = i
        sub["catId"] = new_cat_ids.get(sub["catId"], 1)  # fallback to 1

    # Reindex items
    for i, item in enumerate(data.get("items", []), start=1):
        item["itemId"] = i
        item["subCatId"] = new_subcat_ids.get(item["subCatId"], 1)

    return menu_json 