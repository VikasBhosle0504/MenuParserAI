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
    .then(() => {
      window.location.href = 'components/app.html';
    })
    .catch(function(error) {
      console.log(error); // Log error for debugging
      loginError.textContent = error.message;
    });
}); 