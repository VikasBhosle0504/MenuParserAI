// hybriduploadmenu.js
// Handles the hybrid menu upload, polling, and display logic for the Using Hybrid frontend.
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

function createToggleIcon() {
  const icon = document.createElement('span');
  icon.className = 'toggle-icon';
  icon.innerHTML = '<svg width="18" height="18" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M6 8L10 12L14 8" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  return icon;
}

function formatPrice(price) {
  return Number(price).toFixed(2);
}

function renderChoices(choices) {
  if (!choices || !choices.length) return null;
  const choicesList = document.createElement('div');
  choicesList.className = 'choices-list';
  choices.forEach(choice => {
    const choiceItem = document.createElement('div');
    choiceItem.className = 'choice-item';
    choiceItem.textContent = choice.title;
    choicesList.appendChild(choiceItem);
  });
  return choicesList;
}

function renderHybridMenuPreview(menuData) {
  const hybridMenuPreviewContent = document.getElementById('hybridMenuPreviewContent');
  if (!hybridMenuPreviewContent) return;
  hybridMenuPreviewContent.innerHTML = '';
  menuData.menu.forEach(menuSection => {
    const { category, sub_category, items } = menuSection.data;
    category.forEach(cat => {
      const categorySection = document.createElement('div');
      categorySection.className = 'category-section';
      const categoryHeader = document.createElement('div');
      categoryHeader.className = 'category-header';
      const categoryTitle = document.createElement('h2');
      categoryTitle.className = 'category-title';
      categoryTitle.textContent = cat.title;
      categoryHeader.appendChild(categoryTitle);
      categoryHeader.appendChild(createToggleIcon());
      const categoryContent = document.createElement('div');
      categoryContent.className = 'category-content';
      if (cat.description) {
        const categoryDesc = document.createElement('p');
        categoryDesc.className = 'description';
        categoryDesc.textContent = cat.description;
        categoryContent.appendChild(categoryDesc);
      }
      const subcategories = sub_category.filter(sub => sub.catId === cat.id);
      subcategories.forEach(subcat => {
        const subcategorySection = document.createElement('div');
        subcategorySection.className = 'subcategory-section';
        const subcategoryHeader = document.createElement('div');
        subcategoryHeader.className = 'subcategory-header';
        const subcategoryTitle = document.createElement('h3');
        subcategoryTitle.className = 'subcategory-title';
        subcategoryTitle.textContent = subcat.title;
        subcategoryHeader.appendChild(subcategoryTitle);
        subcategoryHeader.appendChild(createToggleIcon());
        const subcategoryContent = document.createElement('div');
        subcategoryContent.className = 'subcategory-content';
        if (subcat.description) {
          const subcatDesc = document.createElement('p');
          subcatDesc.className = 'description';
          subcatDesc.textContent = subcat.description;
          subcategoryContent.appendChild(subcatDesc);
        }
        const subcategoryItems = items.filter(item => item.subCatId === subcat.id);
        subcategoryItems.forEach(item => {
          const itemElement = document.createElement('div');
          itemElement.className = 'menu-item';
          // Item name always first
          const itemTitle = document.createElement('div');
          itemTitle.className = 'item-title';
          itemTitle.textContent = item.title;
          itemElement.appendChild(itemTitle);
          // Variants (if any)
          if (item.variantAvailable && item.variants.length > 0) {
            const variantsList = document.createElement('div');
            variantsList.className = 'variants-list';
            item.variants.forEach(variant => {
              const variantElement = document.createElement('div');
              variantElement.className = 'variant-item';
              const variantTitle = document.createElement('span');
              variantTitle.className = 'variant-title';
              variantTitle.textContent = variant.variantTitle;
              const variantPrice = document.createElement('span');
              variantPrice.className = 'price';
              variantPrice.textContent = formatPrice(variant.price);
              variantElement.appendChild(variantTitle);
              variantElement.appendChild(variantPrice);
              // Choices under variant (if any)
              if (variant.choices && variant.choices.length > 0) {
                const choicesList = renderChoices(variant.choices);
                if (choicesList) variantElement.appendChild(choicesList);
              }
              variantsList.appendChild(variantElement);
            });
            itemElement.appendChild(variantsList);
          } else {
            // No variants, just price
            const priceSpan = document.createElement('span');
            priceSpan.className = 'price';
            priceSpan.textContent = formatPrice(item.price);
            itemElement.appendChild(priceSpan);
          }
          // Options (if any)
          if (item.optionsAvailable && item.options.length > 0) {
            const optionsList = document.createElement('div');
            optionsList.className = 'variants-list';
            item.options.forEach(option => {
              const optionElement = document.createElement('div');
              optionElement.className = 'variant-item';
              const optionTitle = document.createElement('span');
              optionTitle.className = 'variant-title';
              optionTitle.textContent = option.optTitle;
              if (option.commonChoicePriceAvailable) {
                const optionPrice = document.createElement('span');
                optionPrice.className = 'price';
                optionPrice.textContent = formatPrice(option.price);
                optionElement.appendChild(optionPrice);
              }
              optionElement.appendChild(optionTitle);
              // Choices under option
              if (option.choices && option.choices.length > 0) {
                const choicesList = renderChoices(option.choices);
                if (choicesList) optionElement.appendChild(choicesList);
              }
              optionsList.appendChild(optionElement);
            });
            itemElement.appendChild(optionsList);
          }
          subcategoryContent.appendChild(itemElement);
        });
        subcategorySection.appendChild(subcategoryHeader);
        subcategorySection.appendChild(subcategoryContent);
        categoryContent.appendChild(subcategorySection);
      });
      categorySection.appendChild(categoryHeader);
      categorySection.appendChild(categoryContent);
      hybridMenuPreviewContent.appendChild(categorySection);
    });
  });
  // Modern chevron expand/collapse
  hybridMenuPreviewContent.querySelectorAll('.category-header, .subcategory-header').forEach(header => {
    header.addEventListener('click', function(e) {
      if (e.target.tagName === 'A' || e.target.tagName === 'BUTTON') return;
      const section = this.parentElement;
      section.classList.toggle('collapsed');
      const icon = this.querySelector('.toggle-icon');
      if (section.classList.contains('collapsed')) {
        icon.style.transform = 'rotate(-90deg)';
      } else {
        icon.style.transform = 'rotate(0deg)';
      }
    });
  });
}

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

firebase.auth().onAuthStateChanged(function(user) {
  if (user) {
    hybridUploadForm.addEventListener('submit', hybridUploadHandler);
    loadHybridMenus();
    setInterval(loadHybridMenus, 30000);
  } else {  
    window.location.href = '../index.html';
  }
});


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
  const previewContainer = document.getElementById('hybridMenuSourcePreviewContainer');
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
  // Show the overlay modal
  document.getElementById('hybridMenuDetailsOverlay').style.display = 'flex';
  // Add copy/download functionality
  setTimeout(() => { // Wait for DOM
    const previewItemsBtn = document.getElementById('previewHybridItemsBtn');
    const copyBtn = document.getElementById('copyHybridJsonBtn');
    const downloadBtn = document.getElementById('downloadHybridJsonBtn');
    const copyRawOcrBtn = document.getElementById('copyHybridRawOcrBtn');

    if (previewItemsBtn) {
      previewItemsBtn.onclick = function() {
        const menuJson = document.getElementById('hybridMenuJson').textContent;
        try {
          const menuData = JSON.parse(menuJson);
        
          console.log('menuJson:',menuData.data); 
          openHybridMenuItemsPreview(menuData);
          // Debug log

        } catch (error) {
          console.error('Error parsing menu data:', error);
        }
      };
    }
    if (copyBtn) {
      copyBtn.onclick = () => {
        const menuJson = document.getElementById('hybridMenuJson').textContent;
        navigator.clipboard.writeText(menuJson).then(() => {
          copyBtn.textContent = 'Copied!';
          setTimeout(() => { copyBtn.innerHTML = '<span aria-hidden="true">📋</span>'; }, 1200);
        });
      };
    }
    if (downloadBtn) {
      downloadBtn.onclick = () => {
        const menuJson = document.getElementById('hybridMenuJson').textContent;
        const blob = new Blob([menuJson], {type: 'application/json'});
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
    if (copyRawOcrBtn) {
      copyRawOcrBtn.onclick = async () => {
        if (data.debugRawTextPath) {
          try {
            const url = await storage.ref(data.debugRawTextPath).getDownloadURL();
            const res = await fetch(url);
            const text = await res.text();
            await navigator.clipboard.writeText(text);
            copyRawOcrBtn.textContent = 'Copied!';
            setTimeout(() => { copyRawOcrBtn.innerHTML = '<span aria-hidden="true">📝</span>'; }, 1200);
          } catch (err) {
            copyRawOcrBtn.textContent = 'Error!';
            setTimeout(() => { copyRawOcrBtn.innerHTML = '<span aria-hidden="true">📝</span>'; }, 1200);
          }
        } else {
          copyRawOcrBtn.textContent = 'No OCR Text';
          setTimeout(() => { copyRawOcrBtn.innerHTML = '<span aria-hidden="true">📝</span>'; }, 1200);
        }
      };
    }
  }, 0);
}

document.getElementById('closeHybridMenuDetails').onclick = () => {
  document.getElementById('hybridMenuDetailsOverlay').style.display = 'none';
};

document.addEventListener('DOMContentLoaded', function() {
  const logoutBtn = document.getElementById('logoutBtn');
  if (logoutBtn) {
    logoutBtn.addEventListener('click', function() {
      firebase.auth().signOut().then(() => {
        window.location.href = '../index.html';
      });
    });
  }
  // Hybrid Menu Preview Modal logic (copied/adapted from documentai.html)
  const hybridMenuPreviewModal = document.getElementById('hybridMenuPreviewModal');
  const hybridMenuPreviewContent = document.getElementById('hybridMenuPreviewContent');
  const closeHybridMenuPreview = document.getElementById('closeHybridMenuPreview');

  if (closeHybridMenuPreview) {
    closeHybridMenuPreview.addEventListener('click', function() {
      hybridMenuPreviewModal.style.display = 'none';
    });
  }
  window.addEventListener('click', function(event) {
    if (event.target === hybridMenuPreviewModal) {
      hybridMenuPreviewModal.style.display = 'none';
    }
  });
});

// New: Simple Items Preview Modal
function openHybridMenuItemsPreview(menuData) {
  // Create modal if it doesn't exist
  let modal = document.getElementById('hybridItemsPreviewModal');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'hybridItemsPreviewModal';
    modal.className = 'hybrid-items-preview-modal';
    modal.innerHTML = `
      <div class="hybrid-items-preview-content">
        <button id="closeHybridItemsPreview" class="hybrid-items-preview-close" aria-label="Close">&times;</button>
        <h2 class="hybrid-items-preview-title">Menu Items Preview</h2>
        <div id="hybridItemsPreviewContent"></div>
      </div>
    `;
    document.body.appendChild(modal);
    // Add close logic
    modal.querySelector('#closeHybridItemsPreview').onclick = function() {
      modal.style.display = 'none';
    };
    modal.onclick = function(e) {
      if (e.target === modal) modal.style.display = 'none';
    };
  }
  // Render menu visually (like Document AI)
  const content = modal.querySelector('#hybridItemsPreviewContent');
  content.innerHTML = '';

  // Support both menuData.menu and menuData.data structures
  let menuSections = [];

  if (Array.isArray(menuData.menu)) {
    menuSections = menuData.menu;
  } else if (menuData.data && Array.isArray(menuData.data.items)) {
    // Synthesize a single menu section if only items are present
    menuSections = [{ data: { category: [{ title: 'Menu', id: 'default' }], sub_category: [], items: menuData.data.items } }];
  }

  if (!menuSections.length) {
    content.innerHTML = '<div style="color:#888;">No menu data found.</div>';
    modal.style.display = 'flex';
    return;
  }

  

  menuData.menu.forEach(menuSection => {
    const { category, sub_category, items } = menuSection.data;
    category.forEach(cat => {
      const categorySection = document.createElement('div');
      categorySection.className = 'category-section';
      const categoryHeader = document.createElement('div');
      categoryHeader.className = 'category-header';
      const categoryTitle = document.createElement('h2');
      categoryTitle.className = 'category-title';
      categoryTitle.textContent = cat.title;
      categoryHeader.appendChild(categoryTitle);
      categoryHeader.appendChild(createToggleIcon());
      const categoryContent = document.createElement('div');
      categoryContent.className = 'category-content';
      if (cat.description) {
        const categoryDesc = document.createElement('p');
        categoryDesc.className = 'description';
        categoryDesc.textContent = cat.description;
        categoryContent.appendChild(categoryDesc);
      }
      const subcategories = sub_category.filter(sub => sub.catId === cat.id);
      subcategories.forEach(subcat => {
        const subcategorySection = document.createElement('div');
        subcategorySection.className = 'subcategory-section';
        const subcategoryHeader = document.createElement('div');
        subcategoryHeader.className = 'subcategory-header';
        const subcategoryTitle = document.createElement('h3');
        subcategoryTitle.className = 'subcategory-title';
        subcategoryTitle.textContent = subcat.title;
        subcategoryHeader.appendChild(subcategoryTitle);
        subcategoryHeader.appendChild(createToggleIcon());
        const subcategoryContent = document.createElement('div');
        subcategoryContent.className = 'subcategory-content';
        if (subcat.description) {
          const subcatDesc = document.createElement('p');
          subcatDesc.className = 'description';
          subcatDesc.textContent = subcat.description;
          subcategoryContent.appendChild(subcatDesc);
        }
        const subcategoryItems = items.filter(item => item.subCatId === subcat.id);
        subcategoryItems.forEach(item => {
          const itemElement = document.createElement('div');
          itemElement.className = 'menu-item';
          // Item name always first
          const itemTitle = document.createElement('div');
          itemTitle.className = 'item-title';
          itemTitle.textContent = item.title;
          itemElement.appendChild(itemTitle);
          // Variants (if any)
          if (item.variantAvailable && item.variants.length > 0) {
            const variantsList = document.createElement('div');
            variantsList.className = 'variants-list';
            item.variants.forEach(variant => {
              const variantElement = document.createElement('div');
              variantElement.className = 'variant-item';
              const variantTitle = document.createElement('span');
              variantTitle.className = 'variant-title';
              variantTitle.textContent = variant.variantTitle;
              const variantPrice = document.createElement('span');
              variantPrice.className = 'price';
              variantPrice.textContent = formatPrice(variant.price);
              variantElement.appendChild(variantTitle);
              variantElement.appendChild(variantPrice);
              // Choices under variant (if any)
              if (variant.choices && variant.choices.length > 0) {
                const choicesList = renderChoices(variant.choices);
                if (choicesList) variantElement.appendChild(choicesList);
              }
              variantsList.appendChild(variantElement);
            });
            itemElement.appendChild(variantsList);
          } else {
            // No variants, just price
            const priceSpan = document.createElement('span');
            priceSpan.className = 'price';
            priceSpan.textContent = formatPrice(item.price);
            itemElement.appendChild(priceSpan);
          }
          // Options (if any)
          if (item.optionsAvailable && item.options.length > 0) {
            const optionsList = document.createElement('div');
            optionsList.className = 'variants-list';
            item.options.forEach(option => {
              const optionElement = document.createElement('div');
              optionElement.className = 'variant-item';
              const optionTitle = document.createElement('span');
              optionTitle.className = 'variant-title';
              optionTitle.textContent = option.optTitle;
              if (option.commonChoicePriceAvailable) {
                const optionPrice = document.createElement('span');
                optionPrice.className = 'price';
                optionPrice.textContent = formatPrice(option.price);
                optionElement.appendChild(optionPrice);
              }
              optionElement.appendChild(optionTitle);
              // Choices under option
              if (option.choices && option.choices.length > 0) {
                const choicesList = renderChoices(option.choices);
                if (choicesList) optionElement.appendChild(choicesList);
              }
              optionsList.appendChild(optionElement);
            });
            itemElement.appendChild(optionsList);
          }
          subcategoryContent.appendChild(itemElement);
        });
        subcategorySection.appendChild(subcategoryHeader);
        subcategorySection.appendChild(subcategoryContent);
        categoryContent.appendChild(subcategorySection);
      });
      categorySection.appendChild(categoryHeader);
      categorySection.appendChild(categoryContent);
      content.appendChild(categorySection);
    });
    // Modern chevron expand/collapse
    content.querySelectorAll('.category-header, .subcategory-header').forEach(header => {
      header.addEventListener('click', function(e) {
        if (e.target.tagName === 'A' || e.target.tagName === 'BUTTON') return;
        const section = this.parentElement;
        section.classList.toggle('collapsed');
        const icon = this.querySelector('.toggle-icon');
        if (section.classList.contains('collapsed')) {
          icon.style.transform = 'rotate(-90deg)';
        } else {
          icon.style.transform = 'rotate(0deg)';
        }
      });
    });
  });

  modal.style.display = 'flex';
}

// Add minimal CSS for the new modal
(function() {
  const style = document.createElement('style');
  style.textContent = `
    .hybrid-items-preview-modal {
      display: none;
      position: fixed;
      top: 0; left: 0; width: 100vw; height: 100vh;
      background: rgba(0,0,0,0.5);
      z-index: 2000;
      align-items: center;
      justify-content: center;
    }
    .hybrid-items-preview-modal[style*="display: flex"] {
      display: flex !important;
    }
    .hybrid-items-preview-content {
      background: #fff;
      border-radius: 14px;
      box-shadow: 0 8px 32px rgba(0,0,0,0.18);
      padding: 2rem 2.5rem 1.5rem 2.5rem;
      max-width: 800px;
      width: 98vw;
      max-height: 80vh;
      overflow-y: auto;
      position: relative;
    }
    .hybrid-items-preview-close {
      position: absolute;
      top: 18px;
      right: 18px;
      background: #252b9c;
      border-radius: 50%;
      border: none;
      width: 36px;
      height: 36px;
      font-size: 1.5rem;
      cursor: pointer;
      box-shadow: 0 2px 8px rgba(44,62,80,0.08);
      display: flex;
      align-items: center;
      justify-content: center;
      transition: background 0.2s;
    }
    .hybrid-items-preview-close:hover, .hybrid-items-preview-close:focus {
      background:rgb(30, 109, 155);
    }
    .hybrid-items-preview-title {
      color: #1a237e;
      font-size: 1.25rem;
      font-weight: 600;
      margin-bottom: 1.2rem;
      text-align: center;
      text-transform: uppercase;
      letter-spacing: 1px;
    }
  `;
  document.head.appendChild(style);
})(); 