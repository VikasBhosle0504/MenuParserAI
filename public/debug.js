// TODO: Replace with your Firebase project config
const firebaseConfig = {
    apiKey: "AIzaSyAwWm0vb9O3f8bZdKxvVtux46IzcXooCvo",
    authDomain: "aimenudigitiliser.firebaseapp.com",
    projectId: "aimenudigitiliser",
    storageBucket: "aimenudigitiliser.firebasestorage.app",
    messagingSenderId: "827186649635",
    appId: "1:827186649635:web:3dd9e2a0ab84f2b6426f96"
};

if (!firebase.apps.length) {
  firebase.initializeApp(firebaseConfig);
}
const storage = firebase.storage();
const db = firebase.firestore();

const debugList = document.getElementById('debugList');
const debugRawTextModal = document.getElementById('debugRawTextModal');
const debugRawTextContent = document.getElementById('debugRawTextContent');
const closeDebugRawText = document.getElementById('closeDebugRawText');
const copyRawTextBtn = document.getElementById('copyRawTextBtn');

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

// List all raw text files from Storage and map to images/timestamps
async function loadDebugList() {
  debugList.innerHTML = '<div style="color:var(--muted);padding:12px;">Loading debug files...</div>';
  try {
    // List all files in debug/
    const debugRef = storage.ref('debug');
    const debugFiles = await debugRef.listAll();
    if (!debugFiles.items.length) {
      debugList.innerHTML = '<div style="color:var(--muted);padding:12px;">No debug files found.</div>';
      return;
    }
    debugList.innerHTML = '';
    // List all images in menus/ for mapping
    const menusRef = storage.ref('menus');
    const menuFiles = await menusRef.listAll();
    const menuImages = menuFiles.items.filter(item => item.name.match(/\.(jpg|jpeg|png)$/i));
    // Map base name to image ref
    const imageMap = {};
    menuImages.forEach(img => {
      const base = img.name.replace(/\.[^.]+$/, '');
      imageMap[base] = img;
    });
    // For each debug file, show card
    for (const item of debugFiles.items) {
      const fileName = item.name;
      if (!fileName.endsWith('.raw.txt')) continue;
      const { base, timestamp } = parseBaseAndTimestamp(fileName);
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

// Initial load
firebase.auth().onAuthStateChanged(function(user) {
  if (user) {
    loadDebugList();
  } else {
    window.location.href = 'index.html';
  }
});

document.addEventListener('DOMContentLoaded', function() {
  const logoutBtn = document.getElementById('logoutBtn');
  if (logoutBtn) {
    logoutBtn.addEventListener('click', function() {
      firebase.auth().signOut().then(() => {
        window.location.href = 'index.html';
      });
    });
  }
}); 