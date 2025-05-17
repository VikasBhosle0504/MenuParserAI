// debug_documentai.js
// Displays and manages debug raw text files for Document AI uploads in the Menu Parser app.
// Handles user authentication, file listing, and viewing raw extracted text from Document AI.

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
const logoutBtn = document.getElementById('logoutBtn');

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

// List all raw text files from debug_documentai/ and map to images/timestamps
async function loadDebugList() {
  debugList.innerHTML = '<div style="color:var(--muted);padding:12px;">Loading debug files...</div>';
  try {
    // List all files in debug_documentai/
    const debugRef = storage.ref('debug_documentai');
    const debugFiles = await debugRef.listAll();
    if (!debugFiles.items.length) {
      debugList.innerHTML = '<div style="color:var(--muted);padding:12px;">No debug files found.</div>';
      return;
    }
    debugList.innerHTML = '';
    // List all images in menus_documentai/ for mapping
    const menusRef = storage.ref('menus_documentai');
    const menuFiles = await menusRef.listAll();
    const menuImages = menuFiles.items.filter(item => item.name.match(/\.(jpg|jpeg|png)$/i));
    // Map base name to image ref
    const imageMap = {};
    menuImages.forEach(img => {
      const base = img.name.replace(/\.[^.]+$/, '');
      imageMap[base] = img;
    });
    // Collect and sort debug files by timestamp (descending)
    const debugFileInfos = debugFiles.items
      .filter(item => item.name.endsWith('.raw.txt'))
      .map(item => {
        const { base, timestamp } = parseBaseAndTimestamp(item.name);
        return { item, fileName: item.name, base, timestamp };
      })
      .sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));

    for (const { item, fileName, base, timestamp } of debugFileInfos) {
      // Try to find matching image
      let thumbUrl = '';
      if (imageMap[base]) {
        try {
          thumbUrl = await imageMap[base].getDownloadURL();
        } catch {}
      }
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
    }
  } catch (err) {
    debugList.innerHTML = '<div style="color:red;">Failed to load debug files.</div>';
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

firebase.auth().onAuthStateChanged(function(user) {
  if (user) {
    loadDebugList();
  } else {
    window.location.href = '../../index.html';
  }
});

document.addEventListener('DOMContentLoaded', function() {
  if (logoutBtn) {
    logoutBtn.addEventListener('click', function() {
      firebase.auth().signOut().then(() => {
        window.location.href = '../../index.html';
      });
    });
  }
}); 