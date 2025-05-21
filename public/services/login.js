// login.js
// Handles user login for the Menu Parser web app using Firebase Authentication.
// Reads credentials from the login form and redirects to the main app page on success.

// Remove inline firebaseConfig and use shared config
// const firebaseConfig = { ... } (remove this)
if (!firebase.apps.length) {
  firebase.initializeApp(window.firebaseConfig);
}

const loginForm = document.getElementById('loginForm');
const loginError = document.getElementById('loginError');

// Reset the login form on page load to avoid stale data
document.addEventListener('DOMContentLoaded', function() {
  if (loginForm) loginForm.reset();
});

loginForm.addEventListener('submit', function(e) {
  e.preventDefault();
  const email = document.getElementById('loginEmail').value;
  const password = document.getElementById('loginPassword').value;
  console.log('Email entered:', '"' + email + '"', 'Length:', email.length);
  console.log('Password entered:', '"' + password + '"', 'Length:', password.length);
  console.log('Attempting login with:', email, password); // Log credentials for debugging
  firebase.auth().signInWithEmailAndPassword(email, password)
    .then(async () => {
      // Fetch user permissions from Firestore
      const user = firebase.auth().currentUser;
      const db = firebase.firestore();
      const userDoc = await db.collection('users').doc(user.uid).get();
      const role = userDoc.exists && userDoc.data().role ? userDoc.data().role : 'viewer';
      const permissions = userDoc.exists && userDoc.data().permissions ? userDoc.data().permissions : null;
      // List of possible pages (should match NAV_LINKS in permissions.js)
      const pages = [
        'visionai.html',
        'visionaiocrtexts.html',
        'documentai.html',
        'documentaiocrtexts.html',
        'hybridai.html',
        'hybridaiocrtexts.html'
      ];
      let redirectPage = 'visionai.html'; // fallback
      if (role === 'admin') {
        redirectPage = 'visionai.html';
      } else if (role === 'viewer' && permissions && typeof permissions === 'object') {
        const allowed = pages.find(page => permissions[page] === 1);
        if (allowed) redirectPage = allowed;
      }
      window.location.href = 'components/' + redirectPage;
    })
    .catch(function(error) {
      console.log(error); // Log error for debugging
      loginError.textContent = error.message;
    });
}); 