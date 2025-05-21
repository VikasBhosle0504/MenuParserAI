// permissions.js
// Shared script for role-based nav rendering
(function() {
console.log('permissions.js loaded');
if (!firebase.apps.length) {
  firebase.initializeApp(window.firebaseConfig);
}
let db = firebase.firestore();
const auth = firebase.auth();

window.currentUserRole = null;
window.currentUserPermissions = null;

const NAV_LINKS = [
  { href: 'visionai.html', label: '🏠 Using Vision AI', roles: ['admin', 'viewer'] },
  { href: 'visionaiocrtexts.html', label: '📝 Vision AI OCR Texts', roles: ['admin', 'viewer'] },
  { href: 'documentai.html', label: '📄 Using Document AI', roles: ['admin', 'viewer'] },
  { href: 'documentaiocrtexts.html', label: '🤖 Document AI OCR Texts', roles: ['admin', 'viewer'] },
  { href: 'hybridai.html', label: '🧬 Using Hybrid', roles: ['admin', 'viewer'] },
  { href: 'hybridaiocrtexts.html', label: '🧪 Hybrid OCR Texts', roles: ['admin', 'viewer'] },
  { href: 'admin.html', label: '👤 Admin Panel', roles: ['admin'] }
];

function renderNavLinks(role, permissions) {
  const navLinks = document.getElementById('navLinks');
  if (!navLinks) return;
  navLinks.innerHTML = NAV_LINKS
    .filter(link => {
      if (role === 'admin') return true;
      if (role === 'viewer') {
        // If permissions is an object, only show links with value 1
        if (permissions && typeof permissions === 'object' && !Array.isArray(permissions)) {
          return permissions[link.href] === 1;
        }
        // If no permissions object, show all viewer links (backward compatibility)
        return link.roles.includes('viewer');
      }
      return false;
    })
    .map(link => `<li><a href="${link.href}" class="nav-link${window.location.pathname.endsWith(link.href) ? ' active' : ''}"><span>${link.label.split(' ')[0]}</span> ${link.label.split(' ').slice(1).join(' ')}</a></li>`)
    .join('');
}

function enforcePagePermission(role, permissions) {
  if (role === 'admin') return; // Admins can access everything
  if (role === 'viewer' && permissions && typeof permissions === 'object') {
    const page = window.location.pathname.split('/').pop();
    if (permissions[page] !== 1) {
      document.body.innerHTML = '<div style="padding:2rem;text-align:center;color:red;font-size:1.5rem;">Access Denied</div>';
    }
  }
}

function showLoadingSpinner() {
  const navLinks = document.getElementById('navLinks');
  if (navLinks) navLinks.innerHTML = '<li style="padding:1rem;text-align:center;width:100%"><span>Loading...</span></li>';
}

showLoadingSpinner();

auth.onAuthStateChanged(async function(user) {
  if (user) {
    const userDoc = await db.collection('users').doc(user.uid).get();
    window.currentUserRole = userDoc.exists && userDoc.data().role ? userDoc.data().role : 'viewer';
    window.currentUserPermissions = userDoc.exists && userDoc.data().permissions ? userDoc.data().permissions : null;
    console.log('Rendering nav for role:', window.currentUserRole, 'with permissions:', window.currentUserPermissions);
    renderNavLinks(window.currentUserRole, window.currentUserPermissions);
    enforcePagePermission(window.currentUserRole, window.currentUserPermissions);
    document.dispatchEvent(new CustomEvent('userRoleLoaded', { detail: { role: window.currentUserRole, permissions: window.currentUserPermissions } }));
  } else {
    window.location.href = '../index.html';
  }
});
})(); 