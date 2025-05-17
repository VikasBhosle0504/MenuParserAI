# MenuParser

A Firebase-based web app and cloud function for extracting structured restaurant menu data from images, PDFs, DOCX, and XLSX files using Google Cloud Vision, Document AI, and OpenAI.

## Features
- Upload menu files (PDF, image, DOCX, XLSX)
- Extracts text using OCR and file parsers
- Uses OpenAI to convert raw text into structured JSON menu data
- Web interface for uploading and viewing results
- Secure backend with Firebase Functions

## Demo
*Add screenshots or a link to a live demo if available*

## Getting Started

### 1. Clone the repository
```sh
git clone https://github.com/VikasBhosle0504/MenuParserAI.git
cd MenuParserAI
```

### 2. Install dependencies
```sh
cd functions
npm install
cd ../public
npm install # if you have frontend dependencies (optional)
cd ..
```

### 3. Set up Firebase
- Create a Firebase project at https://console.firebase.google.com/
- Install Firebase CLI if you haven't:
  ```sh
  npm install -g firebase-tools
  ```
- Log in:
  ```sh
  firebase login
  ```
- Initialize Firebase in your project directory:
  ```sh
  firebase init
  ```
  - Choose Hosting, Functions, and Storage as needed
  - Set `public` as your public directory

### 4. Set your OpenAI API key (do NOT commit this)
```sh
firebase functions:config:set openai.key="YOUR_OPENAI_KEY"
```

### 5. Replace Firebase API Keys in All Frontend Files

- You must update the Firebase configuration in all frontend files (such as `/public/app.js`, `/public/login.js`, `/public/debug.js`, `/public/documentai/app.js`, etc.) with your own Firebase project's API keys and settings.
- You can find your Firebase config in the Firebase Console under Project Settings > General > Your apps > Firebase SDK snippet.

**Example:**
```js
// Replace this config with your own from the Firebase Console
const firebaseConfig = {
  apiKey: "YOUR_API_KEY",
  authDomain: "YOUR_PROJECT_ID.firebaseapp.com",
  projectId: "YOUR_PROJECT_ID",
  storageBucket: "YOUR_PROJECT_ID.appspot.com",
  messagingSenderId: "YOUR_SENDER_ID",
  appId: "YOUR_APP_ID"
};
```

### 6. Deploy or run locally
- To run locally with emulators:
  ```sh
  firebase emulators:start
  ```
- To deploy to Firebase:
  ```sh
  firebase deploy
  ```

## Security Notes
- **Never commit your OpenAI API key or any secrets.**
- The Firebase API key in frontend is required, but secure your Firebase rules.
- Check and update your `storage.rules` and Firestore rules for proper access control.

## Contributing
Pull requests are welcome! For major changes, please open an issue first to discuss what you would like to change.

## License
[MIT](LICENSE) 