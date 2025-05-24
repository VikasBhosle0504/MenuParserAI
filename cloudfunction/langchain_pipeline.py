from langchain.chains import MapReduceDocumentsChain, LLMChain, StuffDocumentsChain
from langchain.prompts import PromptTemplate
from langchain_community.chat_models import ChatOpenAI
from langchain_core.documents import Document
import os
import json
import re
from jsonschema import validate, ValidationError
from difflib import get_close_matches

# Load system and user prompts from external files for easy editing
PROMPT_DIR = os.path.dirname(os.path.abspath(__file__))
SYSTEM_PROMPT_PATH = os.path.join(PROMPT_DIR, 'system_prompts.txt')
USER_PROMPT_PATH = os.path.join(PROMPT_DIR, 'user_prompts.txt')



with open(SYSTEM_PROMPT_PATH, 'r', encoding='utf-8') as f:
    SYSTEM_PROMPT = f.read()
with open(USER_PROMPT_PATH, 'r', encoding='utf-8') as f:
    USER_PROMPT = f.read()



# 1. Define the prompt template
prompt = PromptTemplate(
    template=SYSTEM_PROMPT + USER_PROMPT,
    input_variables=["chunk"]
)

# 2. Define the LLM (no output parser)
llm = ChatOpenAI(model="gpt-4.1-mini", temperature=0.2, max_tokens=4096)

# 3. Define the mapping chain (for each chunk)
mapping_chain = LLMChain(
    llm=llm,
    prompt=prompt
)

# 4. Define a simple reduce chain (just concatenate results)
reduce_chain = StuffDocumentsChain(
    llm_chain=mapping_chain,
    document_variable_name="chunk"
)

# 5. Define the MapReduce chain
menu_parsing_chain = MapReduceDocumentsChain(
    llm_chain=mapping_chain,
    reduce_documents_chain=reduce_chain,
    document_variable_name="chunk",
    return_intermediate_steps=True
)

# Canonical subcategory mapping
CANONICAL_SUBCATS = {
    "dessert": "Dessert",
    "desserts": "Dessert",
    "drinks": "Drinks",
    "beverages": "Drinks",
    "main dishes": "Main Course",
    "main course": "Main Course",
    "appetizer": "Appetizer",
    "chef's specials": "Chef's Specials"
}

def canonicalize_subcat(title):
    title_lc = title.strip().lower()
    # Only map if it's a known variant, otherwise return the original
    if title_lc in CANONICAL_SUBCATS:
        return CANONICAL_SUBCATS[title_lc]
    match = get_close_matches(title_lc, CANONICAL_SUBCATS.keys(), n=1, cutoff=0.85)
    if match:
        return CANONICAL_SUBCATS[match[0]]
    # If not found, return the original title (preserve new/unknown subcategories)
    return title.strip()

def chunk_menu_text(menu_text, max_length=2000):
    """Split menu text into manageable chunks for LLM processing."""
    chunks = []
    start = 0
    while start < len(menu_text):
        end = min(start + max_length, len(menu_text))
        # Try to split at a newline if possible
        if end < len(menu_text):
            last_newline = menu_text.rfind('\n', start, end)
            if last_newline > start:
                end = last_newline
        chunks.append(menu_text[start:end])
        start = end
    return chunks

def parse_menu(menu_ocr):
    print("parse_menu called")
    """
    Accepts OCR data as a list of dicts (structured OCR output) or plain text.
    Serializes and chunks as needed, then runs the MapReduce chain.
    """
    # If input is a string, try to parse as JSON
    if isinstance(menu_ocr, str):
        try:
            ocr_data = json.loads(menu_ocr)
        except Exception:
            # fallback: treat as plain text
            ocr_data = menu_ocr
    else:
        ocr_data = menu_ocr

    # If ocr_data is a list (structured OCR), serialize for LLM
    if isinstance(ocr_data, list):
        serialized = json.dumps(ocr_data, ensure_ascii=False, indent=2)
        chunks = chunk_menu_text(serialized)
        docs = [Document(page_content=chunk) for chunk in chunks]
    else:
        # fallback: treat as plain text
        chunks = chunk_menu_text(str(ocr_data))
        docs = [Document(page_content=chunk) for chunk in chunks]

    all_results = []
    for i, doc in enumerate(docs):
        print(f"Processing chunk {i+1}/{len(docs)}")
        try:
            result = mapping_chain.invoke({"chunk": doc.page_content})
            print(f"RAW LLM MAPPING CHAIN RESULT (chunk {i+1}):", result)
        except Exception as e:
            print(f"Exception during LLM mapping chain invoke (chunk {i+1}):", e)
            raise

        if isinstance(result, dict) and "text" in result:
            cleaned = result["text"].strip()
        else:
            cleaned = str(result).strip()
        print(f"About to parse LLM output for chunk {i+1}. Type:", type(cleaned))
        print(f"LLM OUTPUT BEFORE PARSING (chunk {i+1}):\n", cleaned)
        # Remove markdown code block markers if present
        cleaned_for_json = re.sub(r'^```json\s*|```$', '', cleaned.strip(), flags=re.MULTILINE).strip()
        try:
            parsed_result = json.loads(cleaned_for_json)
            all_results.append(parsed_result)
        except Exception as e:
            print(f"JSON parsing failed for chunk {i+1}. Output was:\n", cleaned_for_json)
            print("Exception type:", type(e), "Exception:", e)
            raise ValueError(f"Could not parse LLM output as JSON: {e}\nOutput was:\n{cleaned_for_json}")

    # Merge all_results into a single menu JSON
    def merge_menu_json(results):
        merged = {
            "data": {
                "category": [],
                "sub_category": [],
                "items": []
            }
        }
        cat_id_map = {}
        subcat_id_map = {}
        canonical_subcat_map = {}
        next_cat_id = 1
        next_subcat_id = 1
        next_item_id = 1

        for res in results:
            data = res.get("data", res)
            # Categories
            for cat in data.get("category", []):
                cat_key = cat["title"].strip().lower()
                if cat_key not in cat_id_map:
                    new_cat = cat.copy()
                    new_cat["id"] = next_cat_id
                    cat_id_map[cat_key] = next_cat_id
                    merged["data"]["category"].append(new_cat)
                    next_cat_id += 1
            # Subcategories with canonicalization
            for subcat in data.get("sub_category", []):
                canonical_title = canonicalize_subcat(subcat["title"])
                subcat_key = (canonical_title.lower(), subcat.get("catId", 1))
                if subcat_key not in subcat_id_map:
                    new_subcat = subcat.copy()
                    new_subcat["title"] = canonical_title
                    new_subcat["id"] = next_subcat_id
                    # Remap catId
                    cat_title = None
                    for cat in data.get("category", []):
                        if cat["id"] == subcat["catId"]:
                            cat_title = cat["title"].strip().lower()
                            break
                    if cat_title and cat_title in cat_id_map:
                        new_subcat["catId"] = cat_id_map[cat_title]
                    else:
                        new_subcat["catId"] = 1
                    subcat_id_map[subcat_key] = next_subcat_id
                    canonical_subcat_map[canonical_title.lower()] = next_subcat_id
                    merged["data"]["sub_category"].append(new_subcat)
                    next_subcat_id += 1
            # Items with improved subCatId assignment
            for item in data.get("items", []):
                new_item = item.copy()
                # Try to find canonical subcategory
                subcat_title = None
                for subcat in data.get("sub_category", []):
                    if subcat["id"] == item["subCatId"]:
                        subcat_title = canonicalize_subcat(subcat["title"])
                        break
                # Fuzzy match if not found
                subcat_id = 1
                if subcat_title:
                    # Try direct canonical map
                    if subcat_title.lower() in canonical_subcat_map:
                        subcat_id = canonical_subcat_map[subcat_title.lower()]
                    else:
                        # Fuzzy match
                        match = get_close_matches(subcat_title.lower(), canonical_subcat_map.keys(), n=1, cutoff=0.8)
                        if match:
                            subcat_id = canonical_subcat_map[match[0]]
                new_item["subCatId"] = subcat_id
                new_item["itemId"] = next_item_id
                next_item_id += 1
                merged["data"]["items"].append(new_item)
        return merged

    merged_result = merge_menu_json(all_results)

    # Step 2: JSON schema validation
    # Expanded schema for menu structure
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
        validate(instance=merged_result, schema=menu_schema)
    except ValidationError as e:
        print("Schema validation error:", e)
        raise ValueError(f"Menu JSON schema validation failed: {e}")

    return merged_result 