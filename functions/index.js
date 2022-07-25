const cors = require('cors');
const express = require('express');
const admin = require("firebase-admin");
const functions = require('firebase-functions');
const serviceAccount = require('./permissions.json');
const { v4: uuidv4 } = require('uuid');
const connect = require('./mongod_connect');

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  apiKey: "AIzaSyB1HMtSp4EbsMXNPutIl3djFKx3fJhbLhI",
  authDomain: "whiskeybravo-9aa4d.firebaseapp.com",
  projectId: "whiskeybravo-9aa4d",
  storageBucket: "whiskeybravo-9aa4d.appspot.com",
  messagingSenderId: "706482771815",
  appId: "1:706482771815:web:610b0dad02d958df9881c2"
});

const app = express();
const db = admin.firestore();
app.use(cors({ origin: true }));

async function getMarker() {
  const snapshot = await db.collection('users').get()
  return snapshot.docs.map(doc => doc.data());
}

async function transferToMongodb() { 
  const records = await getMarker();
  console.log(records);
  connect(records);
}

app.post('/dedrone', async (req, res) => {
  const { data } = req.body;
  transferToMongodb();

  // if (data.alertId) {
  //   const docRef = db.collection('users').doc(uuidv4());

  //   await docRef.set(req.body);
  // }

  return res.status(200).send();

});

exports.app = functions.https.onRequest(app);