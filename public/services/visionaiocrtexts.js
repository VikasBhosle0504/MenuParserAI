// debug.js
// Displays and manages debug raw text files uploaded to Firebase Storage for the Menu Parser app.
// Handles user authentication, file listing, and viewing raw OCR text.

// Remove inline firebaseConfig and use shared config
// const firebaseConfig = { ... } (remove this)
if (!firebase.apps.length) {
  firebase.initializeApp(window.firebaseConfig);
}
const storage = firebase.storage();
const db = firebase.firestore();

const debugList = document.getElementById('debugList');
const debugRawTextModal = document.getElementById('debugRawTextModal');
const debugRawTextContent = document.getElementById('debugRawTextContent');
const closeDebugRawText = document.getElementById('closeDebugRawText');
const copyRawTextBtn = document.getElementById('copyRawTextBtn');

let debugFilesData = [];
let debugPageSize = 10;
let debugCurrentPage = 1;
const debugPaginationControls = document.createElement('div');
debugPaginationControls.id = 'debugPaginationControls';
debugPaginationControls.style.display = 'flex';
debugPaginationControls.style.justifyContent = 'center';
debugPaginationControls.style.gap = '12px';
debugList.parentNode.appendChild(debugPaginationControls);

// Utility to extract base name and timestamp from filename
function parseBaseAndTimestamp(filename) {
  // Example: mm2_1747336838767.raw.txt
  const match = filename.match(/^(.*)_(\d+)\.raw\.txt$/);
  if (match) {
    return { base: match[1], timestamp: Number(match[2]) };
  }
  return { base: filename.replace(/\.raw\.txt$/, ''), timestamp: null };
}

// Utility to format timestamp
function formatTimestamp(ts) {
  if (!ts) return '';
  const date = new Date(ts);
  return date.toLocaleString();
}

function renderDebugListPage() {
  debugList.innerHTML = '';
  const startIdx = (debugCurrentPage - 1) * debugPageSize;
  const pageItems = debugFilesData.slice(startIdx, startIdx + debugPageSize);
  if (pageItems.length === 0) {
    debugList.innerHTML = '<div style="color:var(--muted);padding:12px;">No debug files found.</div>';
    debugPaginationControls.innerHTML = '';
    return;
  }
  pageItems.forEach(({ item, fileName, base, timestamp, thumbUrl }) => {
    const card = document.createElement('div');
    card.className = 'card menu-card shadow-sm border-0';
    let thumbHtml = '';
    if (thumbUrl) {
      thumbHtml = `<img src='${thumbUrl}' alt='thumb' class='menu-thumb me-3 rounded' style='width:48px;height:48px;object-fit:cover;' />`;
    }
    card.innerHTML = `
      <div class="card-body d-flex align-items-center p-3">
        ${thumbHtml}
        <div class="menu-card-content flex-grow-1">
          <div class="menu-title">${base}</div>
          <div class="menu-id">${fileName}</div>
          <div class="menu-time">${formatTimestamp(timestamp)}</div>
        </div>
        <button class="btn btn-outline-secondary btn-sm ms-2">View Raw Text</button>
      </div>
    `;
    const btn = card.querySelector('button');
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      btn.disabled = true;
      btn.textContent = 'Loading...';
      try {
        const url = await item.getDownloadURL();
        const res = await fetch(url);
        const text = await res.text();
        debugRawTextContent.textContent = text;
        debugRawTextModal.classList.remove('hidden');
      } catch (err) {
        debugRawTextContent.textContent = 'Failed to load raw text.';
        debugRawTextModal.classList.remove('hidden');
      } finally {
        btn.disabled = false;
        btn.textContent = 'View Raw Text';
      }
    });
    debugList.appendChild(card);
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

async function loadDebugList() {
  debugList.innerHTML = '<div style="color:var(--muted);padding:12px;">Loading debug files...</div>';
  try {
    const debugRef = storage.ref('debug');
    const debugFiles = await debugRef.listAll();
    if (!debugFiles.items.length) {
      debugList.innerHTML = '<div style="color:var(--muted);padding:12px;">No debug files found.</div>';
      debugPaginationControls.innerHTML = '';
      return;
    }
    // List all images in menus/ for mapping
    const menusRef = storage.ref('menus');
    const menuFiles = await menusRef.listAll();
    const menuImages = menuFiles.items.filter(item => item.name.match(/\.(jpg|jpeg|png)$/i));
    const imageMap = {};
    menuImages.forEach(img => {
      const base = img.name.replace(/\.[^.]+$/, '');
      imageMap[base] = img;
    });
    debugFilesData = debugFiles.items
      .filter(item => item.name.endsWith('.raw.txt'))
      .map(item => {
        const { base, timestamp } = parseBaseAndTimestamp(item.name);
        return { item, fileName: item.name, base, timestamp };
      })
      .sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
    // Add thumbUrl
    for (const info of debugFilesData) {
      info.thumbUrl = '';
      if (imageMap[info.base]) {
        try {
          info.thumbUrl = await imageMap[info.base].getDownloadURL();
        } catch {}
      }
    }
    debugCurrentPage = 1;
    renderDebugListPage();
  } catch (err) {
    debugList.innerHTML = '<div style="color:red;">Failed to load debug files.</div>';
    debugPaginationControls.innerHTML = '';
  }
}

closeDebugRawText.addEventListener('click', () => {
  debugRawTextModal.classList.add('hidden');
  debugRawTextContent.textContent = '';
});
debugRawTextModal.addEventListener('click', (e) => {
  if (e.target === debugRawTextModal) {
    debugRawTextModal.classList.add('hidden');
    debugRawTextContent.textContent = '';
  }
});

copyRawTextBtn.addEventListener('click', () => {
  const text = debugRawTextContent.textContent;
  navigator.clipboard.writeText(text).then(() => {
    copyRawTextBtn.textContent = 'Copied!';
    setTimeout(() => {
      copyRawTextBtn.innerHTML = '<span aria-hidden="true">📋</span> Copy';
    }, 1200);
  });
});

// Initial load
firebase.auth().onAuthStateChanged(function(user) {
  if (user) {
    loadDebugList();
  } else {
    window.location.href = '../index.html';
  }
});

document.addEventListener('DOMContentLoaded', function() {
  const logoutBtn = document.getElementById('logoutBtn');
  if (logoutBtn) {
    logoutBtn.addEventListener('click', function() {
      firebase.auth().signOut().then(() => {
        window.location.href = '../index.html';
      });
    });
  }
}); 