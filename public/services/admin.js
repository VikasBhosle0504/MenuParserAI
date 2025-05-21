// admin.js
// Handles user management for admins
if (!firebase.apps.length) {
  firebase.initializeApp(window.firebaseConfig);
}
const db = firebase.firestore();
const auth = firebase.auth();

let currentUserRole = null;

const NAV_LINKS = [
  { href: 'visionai.html', label: '🏠 Using Vision AI', roles: ['admin', 'viewer'] },
  { href: 'visionaiocrtexts.html', label: '📝 Vision AI OCR Texts', roles: ['admin', 'viewer'] },
  { href: 'documentai.html', label: '📄 Using Document AI', roles: ['admin', 'viewer'] },
  { href: 'documentaiocrtexts.html', label: '🤖 Document AI OCR Texts', roles: ['admin', 'viewer'] },
  { href: 'hybridai.html', label: '🧬 Using Hybrid', roles: ['admin', 'viewer'] },
  { href: 'hybridaiocrtexts.html', label: '�� Hybrid OCR Texts', roles: ['admin', 'viewer'] },
  { href: 'admin.html', label: '👤 Admin Panel', roles: ['admin'] }
];

function renderNavLinks(role) {
  const navLinks = document.getElementById('navLinks');
  if (!navLinks) return;
  navLinks.innerHTML = NAV_LINKS
    .filter(link => link.roles.includes(role))
    .map(link => `<li><a href="${link.href}" class="nav-link${window.location.pathname.endsWith(link.href) ? ' active' : ''}"><span>${link.label.split(' ')[0]}</span> ${link.label.split(' ').slice(1).join(' ')}</a></li>`)
    .join('');
}

function renderUsers(users) {
  const tbody = document.getElementById('userTableBody');
  tbody.innerHTML = '';
  users.forEach(user => {
    const tr = document.createElement('tr');
    let permissionsHtml = '';
    if (user.role === 'viewer') {
      const perms = user.permissions && typeof user.permissions === 'object' ? user.permissions : {};
      permissionsHtml = '<div style="display:flex;flex-wrap:wrap;gap:8px;">' +
        NAV_LINKS.filter(l => l.roles.includes('viewer')).map(link => {
          const checked = perms[link.href] === 1 ? 'checked' : '';
          return `<label style='font-weight:normal;'><input type='checkbox' class='perm-checkbox' data-uid='${user.uid}' data-file='${link.href}' ${checked}/> ${link.label}</label>`;
        }).join('') + '</div>';
    }
    tr.innerHTML = `
      <td>${user.email}</td>
      <td>
        <select class="form-select form-select-sm user-role-select" data-uid="${user.uid}">
          <option value="admin"${user.role === 'admin' ? ' selected' : ''}>admin</option>
          <option value="viewer"${user.role === 'viewer' ? ' selected' : ''}>viewer</option>
        </select>
        ${permissionsHtml}
      </td>
      <td>
        ${user.uid === auth.currentUser.uid ? '<span class="text-muted">(You)</span>' : ''}
      </td>
    `;
    tbody.appendChild(tr);
  });
  // Add event listeners for role changes
  document.querySelectorAll('.user-role-select').forEach(select => {
    select.addEventListener('change', async function() {
      const uid = this.getAttribute('data-uid');
      const newRole = this.value;
      await db.collection('users').doc(uid).update({ role: newRole });
      loadUsers();
    });
  });
  // Add event listeners for permission checkboxes
  document.querySelectorAll('.perm-checkbox').forEach(checkbox => {
    checkbox.addEventListener('change', async function() {
      const uid = this.getAttribute('data-uid');
      const file = this.getAttribute('data-file');
      const userDoc = await db.collection('users').doc(uid).get();
      let perms = userDoc.exists && userDoc.data().permissions && typeof userDoc.data().permissions === 'object' ? userDoc.data().permissions : {};
      perms[file] = this.checked ? 1 : 0;
      await db.collection('users').doc(uid).update({ permissions: perms });
      // Optionally, show a status message
    });
  });
}

async function loadUsers() {
  const snapshot = await db.collection('users').get();
  const users = [];
  snapshot.forEach(doc => {
    users.push({ uid: doc.id, ...doc.data() });
  });
  renderUsers(users);
}

auth.onAuthStateChanged(async function(user) {
  if (user) {
    // Fetch user role from Firestore
    const userDoc = await db.collection('users').doc(user.uid).get();
    currentUserRole = userDoc.exists && userDoc.data().role ? userDoc.data().role : 'viewer';
    renderNavLinks(currentUserRole);
    if (currentUserRole !== 'admin') {
      window.location.href = 'visionai.html';
      return;
    }
    loadUsers();
  } else {
    window.location.href = '../index.html';
  }
});

document.getElementById('logoutBtn').addEventListener('click', function() {
  auth.signOut().then(() => {
    window.location.href = '../index.html';
  });
});

// Create new user as viewer
const createUserForm = document.getElementById('createUserForm');
const createUserStatus = document.getElementById('createUserStatus');
const createUserPermissionsDiv = document.createElement('div');
createUserPermissionsDiv.className = 'col-12';
createUserPermissionsDiv.innerHTML = '<label style="font-weight:600;">Viewer Page Permissions:</label><div id="createUserPerms" style="display:flex;flex-wrap:wrap;gap:8px;margin-top:4px;">' +
  NAV_LINKS.filter(l => l.roles.includes('viewer')).map(link =>
    `<label style='font-weight:normal;'><input type='checkbox' class='create-perm-checkbox' data-file='${link.href}' ${link.href === 'documentai.html' ? 'checked' : ''}/> ${link.label}</label>`
  ).join('') + '</div>';
// Insert before the submit button
const createUserFormRows = createUserForm.querySelectorAll('.col-auto, .col-12');
createUserForm.insertBefore(createUserPermissionsDiv, createUserFormRows[createUserFormRows.length - 1]);

// Update the submit handler to use the selected permissions
createUserForm.addEventListener('submit', async function(e) {
  e.preventDefault();
  const email = document.getElementById('newUserEmail').value;
  const password = document.getElementById('newUserPassword').value;
  createUserStatus.textContent = 'Creating user...';
  // Build permissions object from checkboxes
  const permCheckboxes = createUserForm.querySelectorAll('.create-perm-checkbox');
  const permissions = {};
  permCheckboxes.forEach(cb => {
    permissions[cb.getAttribute('data-file')] = cb.checked ? 1 : 0;
  });
  try {
    // Use callable function instead of frontend SDK
    const result = await firebase.functions().httpsCallable('createUserWithPermissions')({
      email,
      password,
      role: 'viewer',
      permissions
    });
    createUserStatus.textContent = 'User created successfully!';
    createUserForm.reset();
    permCheckboxes.forEach(cb => { cb.checked = cb.getAttribute('data-file') === 'documentai.html'; });
    loadUsers();
  } catch (err) {
    createUserStatus.textContent = 'Error: ' + (err.message || err);
  }
}); 