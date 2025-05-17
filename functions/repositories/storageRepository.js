const admin = require('firebase-admin');
const { Storage } = require('@google-cloud/storage');
const db = admin.firestore();
const storage = new Storage();

async function uploadToStorage(bucket, filePath, localPath, contentType) {
  await storage.bucket(bucket).upload(localPath, { destination: filePath, contentType });
}

async function saveToFirestore(collection, docId, data) {
  await db.collection(collection).doc(docId).set(data);
}

module.exports = {
  uploadToStorage,
  saveToFirestore
}; 