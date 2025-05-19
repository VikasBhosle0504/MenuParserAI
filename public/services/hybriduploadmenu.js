// hybriduploadmenu.js
// Handles the hybrid menu upload, polling, and display logic for the Hybrid Upload Menu frontend.
// Uses Firebase for authentication, storage, and Firestore database.

if (!firebase.apps.length) {
  firebase.initializeApp(window.firebaseConfig);
}
const storage = firebase.storage();
const db = firebase.firestore();

const hybridUploadForm = document.getElementById('hybridUploadForm');
const hybridFileInput = document.getElementById('hybridFileInput');
const hybridUploadStatus = document.getElementById('hybridUploadStatus');
const hybridMenusList = document.getElementById('hybridMenusList');
const hybridMenuDetails = document.getElementById('hybridMenuDetails');
const hybridMenuJson = document.getElementById('hybridMenuJson');
const closeHybridMenuDetails = document.getElementById('closeHybridMenuDetails');

function hybridUploadHandler(e) {
  e.preventDefault();
  const file = hybridFileInput.files[0];
  if (!file) return;
  hybridUploadStatus.textContent = '';

  // Make filename unique by appending timestamp
  const ext = file.name.substring(file.name.lastIndexOf('.'));
  const base = file.name.substring(0, file.name.lastIndexOf('.'));
  const uniqueName = `${base}_${Date.now()}${ext}`;
  const docId = `${base}_${Date.now()}`; // Used for Firestore doc id

  const storageRef = storage.ref(`menus_hybrid/${uniqueName}`);
  const uploadTask = storageRef.put(file);

  hybridUploadStatus.textContent = 'Uploading...';
  hybridUploadForm.querySelector('button').disabled = true;

  uploadTask.on('state_changed', (snapshot) => {
    const percent = Math.round((snapshot.bytesTransferred / snapshot.totalBytes) * 100);
    hybridUploadStatus.textContent = `Uploading: ${percent}%`;
  }, (error) => {
    hybridUploadStatus.textContent = 'Upload failed: ' + error.message;
    hybridUploadForm.querySelector('button').disabled = false;
  }, () => {
    hybridUploadStatus.textContent = 'Processing...';
    hybridUploadForm.querySelector('button').disabled = false;
    hybridFileInput.value = '';
    // Start polling for the processed menu
    pollForProcessedHybridMenu(docId, 0);
  });
}

// Poll Firestore for the new hybrid menu document
function pollForProcessedHybridMenu(docId, attempt) {
  const maxAttempts = 40; // e.g., poll for up to 2 minutes (40 x 3s)
  const pollInterval = 3000; // 3 seconds
  db.collection('menus_hybrid').doc(docId).get().then((doc) => {
    if (doc.exists) {
      hybridUploadStatus.textContent = 'Done!';
      loadHybridMenus(); // Refresh menus list
    } else if (attempt < maxAttempts) {
      setTimeout(() => pollForProcessedHybridMenu(docId, attempt + 1), pollInterval);
    } else {
      hybridUploadStatus.textContent = 'Processing is taking longer than expected.';
    }
  }).catch(() => {
    if (attempt < maxAttempts) {
      setTimeout(() => pollForProcessedHybridMenu(docId, attempt + 1), pollInterval);
    } else {
      hybridUploadStatus.textContent = 'Processing is taking longer than expected.';
    }
  });
}

// List parsed hybrid menus from Firestore
async function loadHybridMenus() {
  hybridMenusList.innerHTML = '<div style="color:var(--muted);padding:12px;">Loading hybrid menus...</div>';
  try {
    const snapshot = await db.collection('menus_hybrid').orderBy('createdAt', 'desc').get();
    if (snapshot.empty) {
      hybridMenusList.innerHTML = '<div style="color:var(--muted);padding:12px;">No parsed hybrid menus found.</div>';
      return;
    }
    hybridMenusList.innerHTML = '';
    snapshot.forEach(doc => {
      const data = doc.data();
      const card = document.createElement('div');
      card.className = 'card menu-card shadow-sm border-0';
      let createdAtText = '';
      if (data.createdAt && data.createdAt.toDate) {
        const date = data.createdAt.toDate();
        createdAtText = `<div class=\"menu-time\">📅 ${date.toLocaleString()}</div>`;
      } else if (data.createdAt && data.createdAt.seconds) {
        const date = new Date(data.createdAt.seconds * 1000);
        createdAtText = `<div class=\"menu-time\">📅 ${date.toLocaleString()}</div>`;
      }
      // Thumbnail logic
      let thumbHtml = '';
      if (data.sourceFilePath && data.sourceFilePath.match(/\.(jpg|jpeg|png)$/i)) {
        thumbHtml = `<img src='' alt='thumb' class='menu-thumb me-3 rounded' style='width:48px;height:48px;object-fit:cover;display:none;' />`;
      }
      card.innerHTML = `
        <div class=\"card-body d-flex align-items-center p-3\">
          ${thumbHtml}
          <div class=\"menu-card-content flex-grow-1\">
            <div class=\"menu-title\">${data.restaurant_name || 'Menu'}</div>
            <div class=\"menu-id\">${doc.id}</div>
            ${createdAtText}
          </div>
          <span class=\"menu-card-arrow ms-2\">&#8594;</span>
        </div>
      `;
      // If thumbnail, fetch URL
      if (thumbHtml) {
        const img = card.querySelector('.menu-thumb');
        storage.ref(data.sourceFilePath).getDownloadURL().then(url => {
          img.src = url;
          img.style.display = 'block';
        });
      }
      card.onclick = () => showHybridMenuDetails(data);
      hybridMenusList.appendChild(card);
    });
  } catch (err) {
    hybridMenusList.innerHTML = '<div style="color:red;padding:12px;">Failed to load hybrid menus.</div>';
  }
}

function showHybridMenuDetails(data) {
  hybridMenuJson.textContent = JSON.stringify(data, null, 2);
  hybridMenuDetails.classList.remove('hidden');
  // Placeholder: add logic for overlays, debug raw text, etc.
}

closeHybridMenuDetails.onclick = () => {
  hybridMenuDetails.classList.add('hidden');
};

// Add event listeners
hybridUploadForm.addEventListener('submit', hybridUploadHandler);
window.addEventListener('DOMContentLoaded', loadHybridMenus); 