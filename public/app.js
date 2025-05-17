// TODO: Replace with your Firebase project config
const firebaseConfig = {
    apiKey: "AIzaSyAwWm0vb9O3f8bZdKxvVtux46IzcXooCvo",
    authDomain: "aimenudigitiliser.firebaseapp.com",
    projectId: "aimenudigitiliser",
    storageBucket: "aimenudigitiliser.firebasestorage.app",
    messagingSenderId: "827186649635",
    appId: "1:827186649635:web:3dd9e2a0ab84f2b6426f96"
};

firebase.initializeApp(firebaseConfig);
const storage = firebase.storage();
const db = firebase.firestore();

const uploadForm = document.getElementById('uploadForm');
const fileInput = document.getElementById('fileInput');
const uploadStatus = document.getElementById('uploadStatus');
const menusList = document.getElementById('menusList');
const menuDetails = document.getElementById('menuDetails');
const menuJson = document.getElementById('menuJson');
const closeMenuDetails = document.getElementById('closeMenuDetails');

// Redirect to login if not authenticated
firebase.auth().onAuthStateChanged(function(user) {
  if (!user) {
    window.location.href = 'index.html';
  }
});

// Wait for auth before enabling upload and menu load
firebase.auth().onAuthStateChanged(function(user) {
  if (user) {
    uploadForm.addEventListener('submit', uploadHandler);
    loadMenus();
  } else {
    uploadForm.querySelector('button').disabled = true;
    menusList.innerHTML = '<div style="color:var(--muted);padding:12px;">Please wait, signing in...</div>';
  }
});

// Move upload handler to a function
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

  const storageRef = storage.ref(`menus/${uniqueName}`);
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

// Poll Firestore for the new menu document
function pollForProcessedMenu(docId, attempt) {
  const maxAttempts = 40; // e.g., poll for up to 2 minutes (40 x 3s)
  const pollInterval = 3000; // 3 seconds
  db.collection('menus').doc(docId).get().then((doc) => {
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
async function loadMenus() {
  menusList.innerHTML = '<div style="color:var(--muted);padding:12px;">Loading menus...</div>';
  try {
    const snapshot = await db.collection('menus').orderBy('createdAt', 'desc').get();
    if (snapshot.empty) {
      menusList.innerHTML = '<div style="color:var(--muted);padding:12px;">No parsed menus found.</div>';
      return;
    }
    menusList.innerHTML = '';
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
      card.addEventListener('click', () => showMenuDetails(data));
      menusList.appendChild(card);
    });
  } catch (err) {
    menusList.innerHTML = '<div style="color:red;">Failed to load menus.</div>';
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
  }, 0);
}

closeMenuDetails.addEventListener('click', () => {
  menuDetails.classList.add('hidden');
});

// Hide modal on background click
menuDetails.addEventListener('click', (e) => {
  if (e.target === menuDetails) menuDetails.classList.add('hidden');
});

// Initial load
loadMenus();

// Optionally, refresh menu list every 30s
setInterval(loadMenus, 30000);

// Logout button logic
const logoutBtn = document.getElementById('logoutBtn');
if (logoutBtn) {
  logoutBtn.addEventListener('click', function() {
    firebase.auth().signOut();
  });
} 