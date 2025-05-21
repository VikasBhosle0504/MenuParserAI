// debug_hybrid.js
// Handles listing and viewing of hybrid debug raw text files for the Hybrid OCR Texts page.

if (!firebase.apps.length) {
  firebase.initializeApp(window.firebaseConfig);
}
const storage = firebase.storage();

const debugHybridList = document.getElementById('debugHybridList');
const debugHybridRawTextModal = document.getElementById('debugHybridRawTextModal');
const debugHybridRawTextContent = document.getElementById('debugHybridRawTextContent');
const closeDebugHybridRawText = document.getElementById('closeDebugHybridRawText');
const copyHybridRawTextBtn = document.getElementById('copyHybridRawTextBtn');

let debugFilesData = [];
let debugPageSize = 10;
let debugCurrentPage = 1;
const debugPaginationControls = document.createElement('div');
debugPaginationControls.id = 'debugPaginationControls';
debugPaginationControls.style.display = 'flex';
debugPaginationControls.style.justifyContent = 'center';
debugPaginationControls.style.gap = '12px';
debugHybridList.parentNode.appendChild(debugPaginationControls);

function renderDebugListPage() {
  debugHybridList.innerHTML = '';
  const startIdx = (debugCurrentPage - 1) * debugPageSize;
  const pageItems = debugFilesData.slice(startIdx, startIdx + debugPageSize);
  if (pageItems.length === 0) {
    debugHybridList.innerHTML = '<div style="color:var(--muted);padding:12px;">No debug files found.</div>';
    debugPaginationControls.innerHTML = '';
    return;
  }
  pageItems.forEach(({ itemRef, fileName }) => {
    const fileDiv = document.createElement('div');
    fileDiv.className = 'card debug-file-card shadow-sm border-0 p-2 mb-2';
    fileDiv.innerHTML = `<div class="d-flex align-items-center justify-content-between">
      <span>${fileName}</span>
      <button class="btn btn-outline-primary btn-sm" data-filename="${fileName}">View</button>
    </div>`;
    fileDiv.querySelector('button').onclick = () => showHybridRawText(itemRef, fileName);
    debugHybridList.appendChild(fileDiv);
  });
  // Pagination controls
  debugPaginationControls.innerHTML = '';
  if (debugCurrentPage > 1) {
    const prevBtn = document.createElement('button');
    prevBtn.textContent = 'Previous';
    prevBtn.className = 'btn btn-outline-primary btn-sm';
    prevBtn.onclick = () => { debugCurrentPage--; renderDebugListPage(); };
    debugPaginationControls.appendChild(prevBtn);
  }
  if (debugFilesData.length > debugCurrentPage * debugPageSize) {
    const nextBtn = document.createElement('button');
    nextBtn.textContent = 'Next';
    nextBtn.className = 'btn btn-outline-primary btn-sm';
    nextBtn.onclick = () => { debugCurrentPage++; renderDebugListPage(); };
    debugPaginationControls.appendChild(nextBtn);
  }
  const pageInfo = document.createElement('span');
  pageInfo.textContent = `Page ${debugCurrentPage}`;
  pageInfo.style.alignSelf = 'center';
  pageInfo.style.margin = '0 8px';
  debugPaginationControls.appendChild(pageInfo);
}

async function loadHybridDebugFiles() {
  debugHybridList.innerHTML = '<div style="color:var(--muted);padding:12px;">Loading debug files...</div>';
  try {
    const listRef = storage.ref('debug_hybrid');
    const res = await listRef.listAll();
    if (res.items.length === 0) {
      debugHybridList.innerHTML = '<div style="color:var(--muted);padding:12px;">No debug files found.</div>';
      debugPaginationControls.innerHTML = '';
      return;
    }
    debugFilesData = res.items.map(itemRef => ({ itemRef, fileName: itemRef.name }));
    debugCurrentPage = 1;
    renderDebugListPage();
  } catch (err) {
    debugHybridList.innerHTML = '<div style="color:red;padding:12px;">Failed to load debug files.</div>';
    debugPaginationControls.innerHTML = '';
  }
}

async function showHybridRawText(itemRef, fileName) {
  debugHybridRawTextContent.textContent = 'Loading...';
  debugHybridRawTextModal.classList.remove('hidden');
  try {
    const url = await itemRef.getDownloadURL();
    const resp = await fetch(url);
    const text = await resp.text();
    debugHybridRawTextContent.textContent = text;
    copyHybridRawTextBtn.onclick = () => {
      navigator.clipboard.writeText(text).then(() => {
        copyHybridRawTextBtn.textContent = 'Copied!';
        setTimeout(() => { copyHybridRawTextBtn.innerHTML = '<span aria-hidden="true">📋</span> Copy'; }, 1200);
      });
    };
  } catch (err) {
    debugHybridRawTextContent.textContent = 'Failed to load file.';
  }
}

closeDebugHybridRawText.onclick = () => {
  debugHybridRawTextModal.classList.add('hidden');
};

window.addEventListener('DOMContentLoaded', loadHybridDebugFiles); 