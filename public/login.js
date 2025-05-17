// Firebase config (same as app.js)
const firebaseConfig = {
    apiKey: "AIzaSyAwWm0vb9O3f8bZdKxvVtux46IzcXooCvo",
    authDomain: "aimenudigitiliser.firebaseapp.com",
    projectId: "aimenudigitiliser",
    storageBucket: "aimenudigitiliser.firebasestorage.app",
    messagingSenderId: "827186649635",
    appId: "1:827186649635:web:3dd9e2a0ab84f2b6426f96"
};

firebase.initializeApp(firebaseConfig);

const loginForm = document.getElementById('loginForm');
const loginError = document.getElementById('loginError');

loginForm.addEventListener('submit', function(e) {
  e.preventDefault();
  const email = document.getElementById('loginEmail').value;
  const password = document.getElementById('loginPassword').value;
  firebase.auth().signInWithEmailAndPassword(email, password)
    .then(() => {
      window.location.href = 'app.html';
    })
    .catch(function(error) {
      loginError.textContent = error.message;
    });
}); 