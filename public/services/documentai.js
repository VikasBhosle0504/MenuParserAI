// app.js
// Handles the main menu upload, display, and user session logic for the Menu Parser web app.
// Uses Firebase for authentication, storage, and Firestore database.

// Remove inline firebaseConfig and use shared config
// const firebaseConfig = { ... } (remove this)
if (!firebase.apps.length) {
  firebase.initializeApp(window.firebaseConfig);
}
const storage = firebase.storage();
const db = firebase.firestore();

const uploadForm = document.getElementById('uploadForm');
const fileInput = document.getElementById('fileInput');
const uploadStatus = document.getElementById('uploadStatus');
const menusList = document.getElementById('menusList');
const menuDetails = document.getElementById('menuDetails');
const menuJson = document.getElementById('menuJson');
const closeMenuDetails = document.getElementById('closeMenuDetails');

// Pagination state
let pageSize = 10;
let menuCursors = [];
let currentPage = 0;
let lastSnapshot = null;

// Add pagination controls
const paginationControls = document.createElement('div');
paginationControls.id = 'paginationControls';
paginationControls.style.display = 'flex';
paginationControls.style.justifyContent = 'center';
paginationControls.style.gap = '12px';
menusList.parentNode.appendChild(paginationControls);

function uploadHandler(e) {
  e.preventDefault();
  const file = fileInput.files[0];
  if (!file) return;
  uploadStatus.textContent = '';

  // Make filename unique by appending timestamp
  const ext = file.name.substring(file.name.lastIndexOf('.'));
  const base = file.name.substring(0, file.name.lastIndexOf('.'));
  const uniqueName = `${base}_${Date.now()}${ext}`;
  const docId = `${base}_${Date.now()}`; // Used for Firestore doc id

  const storageRef = storage.ref(`menus_documentai/${uniqueName}`);
  const uploadTask = storageRef.put(file);

  uploadStatus.textContent = 'Uploading...';
  uploadForm.querySelector('button').disabled = true;

  uploadTask.on('state_changed', (snapshot) => {
    const percent = Math.round((snapshot.bytesTransferred / snapshot.totalBytes) * 100);
    uploadStatus.textContent = `Uploading: ${percent}%`;
  }, (error) => {
    uploadStatus.textContent = 'Upload failed: ' + error.message;
    uploadForm.querySelector('button').disabled = false;
  }, () => {
    uploadStatus.textContent = 'Processing...';
    uploadForm.querySelector('button').disabled = false;
    fileInput.value = '';
    // Start polling for the processed menu
    pollForProcessedMenu(docId, 0);
  });
}

firebase.auth().onAuthStateChanged(function(user) {
  if (user) {
    uploadForm.addEventListener('submit', uploadHandler);
    loadMenus();
    setInterval(loadMenus, 30000);
  } else {
    window.location.href = '../index.html';
  }
});

// Poll Firestore for the new menu document
function pollForProcessedMenu(docId, attempt) {
  const maxAttempts = 40; // e.g., poll for up to 2 minutes (40 x 3s)
  const pollInterval = 3000; // 3 seconds
  db.collection('menus_documentai').doc(docId).get().then((doc) => {
    if (doc.exists) {
      uploadStatus.textContent = 'Done!';
      loadMenus(); // Refresh menus list
    } else if (attempt < maxAttempts) {
      setTimeout(() => pollForProcessedMenu(docId, attempt + 1), pollInterval);
    } else {
      uploadStatus.textContent = 'Processing is taking longer than expected.';
    }
  }).catch(() => {
    if (attempt < maxAttempts) {
      setTimeout(() => pollForProcessedMenu(docId, attempt + 1), pollInterval);
    } else {
      uploadStatus.textContent = 'Processing is taking longer than expected.';
    }
  });
}

// List parsed menus from Firestore
async function loadMenus(direction = null) {
  menusList.innerHTML = '<div style="color:var(--muted);padding:12px;">Loading menus...</div>';
  let query = db.collection('menus_documentai').orderBy('createdAt', 'desc').limit(pageSize);
  if (direction === 'next' && lastSnapshot) {
    query = query.startAfter(lastSnapshot);
  } else if (direction === 'prev' && currentPage > 1) {
    // Go back to the cursor for the previous page
    query = query.startAfter(menuCursors[currentPage - 2]);
  }
  try {
    const snapshot = await query.get();
    if (snapshot.empty) {
      menusList.innerHTML = '<div style="color:var(--muted);padding:12px;">No parsed menus found.</div>';
      paginationControls.innerHTML = '';
      return;
    }
    menusList.innerHTML = '';
    let docs = snapshot.docs;
    // Save cursor for this page
    if (direction === 'next') {
      currentPage++;
      menuCursors[currentPage - 1] = lastSnapshot;
    } else if (direction === 'prev') {
      currentPage--;
    } else {
      currentPage = 1;
      menuCursors = [];
    }
    lastSnapshot = docs[docs.length - 1];
    docs.forEach(doc => {
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
      card.addEventListener('click', () => showMenuDetails(data));
      menusList.appendChild(card);
    });
    // Pagination controls
    paginationControls.innerHTML = '';
    if (currentPage > 1) {
      const prevBtn = document.createElement('button');
      prevBtn.textContent = 'Previous';
      prevBtn.className = 'btn btn-outline-primary btn-sm';
      prevBtn.onclick = () => loadMenus('prev');
      paginationControls.appendChild(prevBtn);
    }
    if (docs.length === pageSize) {
      const nextBtn = document.createElement('button');
      nextBtn.textContent = 'Next';
      nextBtn.className = 'btn btn-outline-primary btn-sm';
      nextBtn.onclick = () => loadMenus('next');
      paginationControls.appendChild(nextBtn);
    }
    // Show page number
    const pageInfo = document.createElement('span');
    pageInfo.textContent = `Page ${currentPage}`;
    pageInfo.style.alignSelf = 'center';
    pageInfo.style.margin = '0 8px';
    paginationControls.appendChild(pageInfo);
  } catch (err) {
    menusList.innerHTML = '<div style="color:red;">Failed to load menus.</div>';
    paginationControls.innerHTML = '';
  }
}

function showMenuDetails(data) {
  menuJson.textContent = JSON.stringify(data, null, 2);
  const previewContainer = document.getElementById('menuSourcePreviewContainer');
  previewContainer.innerHTML = '';
  if (data.sourceFilePath) {
    storage.ref(data.sourceFilePath).getDownloadURL().then(url => {
      let el;
      if (data.sourceFilePath.match(/\.(jpg|jpeg|png)$/i)) {
        el = document.createElement('img');
        el.src = url;
        el.className = 'menu-modal-image';
        el.alt = 'Menu Source Image';
        // Add zoom-on-hover functionality
        el.addEventListener('mouseenter', (e) => {
          let tooltip = document.getElementById('menuImageZoomTooltip');
          if (!tooltip) {
            tooltip = document.createElement('div');
            tooltip.id = 'menuImageZoomTooltip';
            tooltip.className = 'menu-image-zoom-tooltip';
            document.body.appendChild(tooltip);
          }
          tooltip.style.backgroundImage = `url('${url}')`;
          tooltip.style.display = 'block';
        });
        el.addEventListener('mousemove', (e) => {
          const tooltip = document.getElementById('menuImageZoomTooltip');
          if (tooltip) {
            // Get image position and size
            const rect = el.getBoundingClientRect();
            const x = e.clientX - rect.left;
            const y = e.clientY - rect.top;
            const percentX = x / rect.width * 100;
            const percentY = y / rect.height * 100;
            tooltip.style.backgroundPosition = `${percentX}% ${percentY}%`;
            // Tooltip position
            let tx = e.clientX + 24;
            let ty = e.clientY - 40;
            const tooltipRect = tooltip.getBoundingClientRect();
            if (tx + tooltipRect.width > window.innerWidth) tx = window.innerWidth - tooltipRect.width - 12;
            if (ty + tooltipRect.height > window.innerHeight) ty = window.innerHeight - tooltipRect.height - 12;
            if (ty < 0) ty = 12;
            tooltip.style.left = tx + 'px';
            tooltip.style.top = ty + 'px';
          }
        });
        el.addEventListener('mouseleave', () => {
          const tooltip = document.getElementById('menuImageZoomTooltip');
          if (tooltip) tooltip.style.display = 'none';
        });
      } else {
        el = document.createElement('a');
        el.href = url;
        el.textContent = 'View/Download Source Document';
        el.target = '_blank';
        el.className = 'menu-modal-link';
      }
      previewContainer.appendChild(el);
    });
  }
  menuDetails.classList.remove('hidden');
  // Add copy/download functionality
  setTimeout(() => { // Wait for DOM
    const copyBtn = document.getElementById('copyJsonBtn');
    const downloadBtn = document.getElementById('downloadJsonBtn');
    if (copyBtn) {
      copyBtn.onclick = () => {
        navigator.clipboard.writeText(menuJson.textContent).then(() => {
          copyBtn.textContent = 'Copied!';
          setTimeout(() => { copyBtn.innerHTML = '<span aria-hidden="true">📋</span> Copy'; }, 1200);
        });
      };
    }
    if (downloadBtn) {
      downloadBtn.onclick = () => {
        const blob = new Blob([menuJson.textContent], {type: 'application/json'});
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = (data.restaurant_name || 'menu') + '.json';
        document.body.appendChild(a);
        a.click();
        setTimeout(() => {
          document.body.removeChild(a);
          URL.revokeObjectURL(url);
        }, 100);
      };
    }
    const copyRawOcrBtn = document.getElementById('copyRawOcrBtn');
    if (copyRawOcrBtn) {
      copyRawOcrBtn.onclick = async () => {
        console.log('debugRawTextPath:', data.debugRawTextPath);
        if (data.debugRawTextPath) {
          try {
            const url = await storage.ref(data.debugRawTextPath).getDownloadURL();
            console.log('Download URL:', url);
            const res = await fetch(url);
            const text = await res.text();
            console.log('Raw OCR Text:', text);
            await navigator.clipboard.writeText(text);
            copyRawOcrBtn.textContent = 'Copied!';
            setTimeout(() => { copyRawOcrBtn.innerHTML = '<span aria-hidden="true">📝</span> Copy Raw OCR Text'; }, 1200);
          } catch (err) {
            console.error('Copy error:', err);
            copyRawOcrBtn.textContent = 'Error!';
            setTimeout(() => { copyRawOcrBtn.innerHTML = '<span aria-hidden="true">📝</span> Copy Raw OCR Text'; }, 1200);
          }
        } else {
          copyRawOcrBtn.textContent = 'No OCR Text';
          setTimeout(() => { copyRawOcrBtn.innerHTML = '<span aria-hidden="true">📝</span> Copy Raw OCR Text'; }, 1200);
        }
      };
    }
  }, 0);
}

closeMenuDetails.addEventListener('click', () => {
  menuDetails.classList.add('hidden');
});

// Hide modal on background click
menuDetails.addEventListener('click', (e) => {
  if (e.target === menuDetails) menuDetails.classList.add('hidden');
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