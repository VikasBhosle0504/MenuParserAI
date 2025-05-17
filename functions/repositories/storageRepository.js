// storageRepository.js
// Provides data access functions for Firebase Storage and Firestore in the Menu Parser backend.
// Used by services to upload files and save data to Firestore.

const admin = require('firebase-admin');
const { Storage } = require('@google-cloud/storage');
const db = admin.firestore();
const storage = new Storage();

/**
 * Uploads a file to Firebase Storage.
 * @param {string} bucket - The storage bucket name.
 * @param {string} filePath - The destination path in the bucket.
 * @param {string} localPath - The local file path to upload.
 * @param {string} contentType - The MIME type of the file.
 * @returns {Promise<void>}
 */
async function uploadToStorage(bucket, filePath, localPath, contentType) {
  await storage.bucket(bucket).upload(localPath, { destination: filePath, contentType });
}

/**
 * Saves a document to Firestore.
 * @param {string} collection - The Firestore collection name.
 * @param {string} docId - The document ID.
 * @param {Object} data - The data to save.
 * @returns {Promise<void>}
 */
async function saveToFirestore(collection, docId, data) {
  await db.collection(collection).doc(docId).set(data);
}

module.exports = {
  uploadToStorage,
  saveToFirestore
}; 