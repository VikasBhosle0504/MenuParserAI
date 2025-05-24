// langchain.js
// Handles the main menu upload, display, and user session logic for the LangChain-powered Menu Parser web app.
// Uses Firebase for authentication, storage, and Firestore database.

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

  const storageRef = storage.ref(`menus_langchain_vision/${uniqueName}`);
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
    // Create Firestore doc in menus_langchain
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
  db.collection('menus_langchain_vision').doc(docId).get().then((doc) => {
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
  let query = db.collection('menus_langchain_vision').orderBy('createdAt', 'desc').limit(pageSize);
  if (direction === 'next' && lastSnapshot) {
    query = query.startAfter(lastSnapshot);
  } else if (direction === 'prev' && currentPage > 1) {
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
      card.onclick = ()  => showMenuDetails(data);
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
  const menuJsonDiv = document.getElementById('menuJson');
  const viewSwitch = document.getElementById('viewSwitch');
  // Helper to render JSON view
  function renderJsonView() {
    // Remove scroll from parent, only <pre> should scroll
    const modalRight = document.querySelector('.menu-modal-right');
    if (modalRight) {
      modalRight.style.overflowY = 'unset';
      modalRight.style.maxHeight = 'unset';
    }
    menuJsonDiv.innerHTML = `<pre style="background:#18181b;color:#f1f5f9;padding:12px;border-radius:8px;max-height:60vh;overflow:auto;font-size:0.92em;">${JSON.stringify(data, null, 2)}</pre>`;
  }
  // Helper to render visual view
  function renderVisualView() {
    // Restore parent scroll for visual view
    const modalRight = document.querySelector('.menu-modal-right');
    if (modalRight) {
      modalRight.style.overflowY = '';
      modalRight.style.maxHeight = '';
    }
    openMenuItemsPreview(data, true);
  }
  // Initial state: Visual View
  if (viewSwitch) viewSwitch.checked = false;
  renderVisualView();
  // Toggle logic
  if (viewSwitch) {
    viewSwitch.onchange = function() {
      if (viewSwitch.checked) {
        renderJsonView();
      } else {
        renderVisualView();
      }
    };
  }
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
  document.getElementById('menuDetailsOverlay').style.display = 'flex';

  // Add copy/download functionality
  setTimeout(() => { // Wait for DOM
    const copyBtn = document.getElementById('copyJsonBtn');
    const downloadBtn = document.getElementById('downloadJsonBtn');
    if (copyBtn) {
      copyBtn.onclick = () => {
        navigator.clipboard.writeText(JSON.stringify(data, null, 2)).then(() => {
          copyBtn.textContent = 'Copied!';
          setTimeout(() => { copyBtn.innerHTML = '<span aria-hidden="true">📋</span> Copy'; }, 1200);
        });
      };
    }
    if (downloadBtn) {
      downloadBtn.onclick = () => {
        const blob = new Blob([JSON.stringify(data, null, 2)], {type: 'application/json'});
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
        if (data.debugRawTextPath) {
          try {
            const url = await storage.ref(data.debugRawTextPath).getDownloadURL();
            const res = await fetch(url);
            const text = await res.text();
            await navigator.clipboard.writeText(text);
            copyRawOcrBtn.textContent = 'Copied!';
            setTimeout(() => { copyRawOcrBtn.innerHTML = '<span aria-hidden="true">📝</span> Copy Raw OCR Text'; }, 1200);
          } catch (err) {
            copyRawOcrBtn.textContent = 'Error!';
            setTimeout(() => { copyRawOcrBtn.innerHTML = '<span aria-hidden="true">📝</span> Copy Raw OCR Text'; }, 1200);
          }
        } else {
          copyRawOcrBtn.textContent = 'No OCR Text';
          setTimeout(() => { copyRawOcrBtn.innerHTML = '<span aria-hidden="true">📝</span> Copy Raw OCR Text'; }, 1200);
        }
      };
    }

    // Add preview button logic (match hybridai.js style)
    const previewMenuBtn = document.getElementById('previewMenuBtn');
    if (previewMenuBtn) {
      previewMenuBtn.onclick = function() {
        openMenuItemsPreview(data, false);
      };
    }
  }, 0);
}

document.getElementById('closeMenuDetails').onclick = () => {
  document.getElementById('menuDetailsOverlay').style.display = 'none';
};

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

// --- Menu Preview Modal Logic (adapted from HybridAI) ---
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

function renderMenuPreview(menuData) {
  const menuPreviewContent = document.getElementById('menuPreviewContent');
  if (!menuPreviewContent) return;
  menuPreviewContent.innerHTML = '';
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
          if (item.description) {
            const itemDesc = document.createElement('div');
            itemDesc.className = 'description';
            itemDesc.textContent = item.description;
            itemElement.appendChild(itemDesc);
          }
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
      menuPreviewContent.appendChild(categorySection);
    });
  });
  // Modern chevron expand/collapse
  menuPreviewContent.querySelectorAll('.category-header, .subcategory-header').forEach(header => {
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

// Refactor openMenuItemsPreview to support rendering in menuJson
function openMenuItemsPreview(menuData, renderInMenuJson = false) {
  let content;
  if (renderInMenuJson) {
    content = document.getElementById('menuJson');
    content.innerHTML = '';
  } else {
    // Create modal if it doesn't exist
    let modal = document.getElementById('menuItemsPreviewModal');
    if (!modal) {
      modal = document.createElement('div');
      modal.id = 'menuItemsPreviewModal';
      modal.className = 'menu-items-preview-modal';
      modal.innerHTML = `
        <div class="menu-items-preview-content">
          <button id="closeMenuItemsPreview" class="menu-items-preview-close" aria-label="Close">&times;</button>
          <h2 class="menu-items-preview-title">Menu Items Preview</h2>
          <div id="menuItemsPreviewContent"></div>
        </div>
      `;
      document.body.appendChild(modal);
      // Add close logic
      modal.querySelector('#closeMenuItemsPreview').onclick = function() {
        modal.style.display = 'none';
      };
      modal.onclick = function(e) {
        if (e.target === modal) modal.style.display = 'none';
      };
    }
    content = modal.querySelector('#menuItemsPreviewContent');
    content.innerHTML = '';
  }

  // Support both menuData.menu and menuData.data structures
  let menuSections = [];
  if (Array.isArray(menuData.menu)) {
    menuSections = menuData.menu;
  } else if (menuData.data && Array.isArray(menuData.data.items)) {
    menuSections = [{ data: { category: [{ title: 'Menu', id: 'default' }], sub_category: [], items: menuData.data.items } }];
  }
  if (!menuSections.length) {
    content.innerHTML = '<div style="color:#888;">No menu data found.</div>';
    if (!renderInMenuJson) {
      document.getElementById('menuItemsPreviewModal').style.display = 'flex';
    }
    return;
  }
  menuSections.forEach(menuSection => {
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
          if (item.description) {
            const itemDesc = document.createElement('div');
            itemDesc.className = 'description';
            itemDesc.textContent = item.description;
            itemElement.appendChild(itemDesc);
          }
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
  if (!renderInMenuJson) {
    document.getElementById('menuItemsPreviewModal').style.display = 'flex';
  }
} 