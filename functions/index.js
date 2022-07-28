const cors = require('cors');
const express = require('express');
const admin = require("firebase-admin");
const functions = require('firebase-functions');
const serviceAccount = require('./permissions.json');
const connect = require('./mongod_connect');
const { v4: uuidv4 } = require('uuid');
const TelegramBot = require('node-telegram-bot-api');
const { get: _get, uniqWith: _uniqWith, isEqual: _isEqual, last: _last, pick: _pick, transform: _transform } = require('lodash');

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  apiKey: "AIzaSyB1HMtSp4EbsMXNPutIl3djFKx3fJhbLhI",
  authDomain: "whiskeybravo-9aa4d.firebaseapp.com",
  projectId: "whiskeybravo-9aa4d",
  storageBucket: "whiskeybravo-9aa4d.appspot.com",
  messagingSenderId: "706482771815",
  appId: "1:706482771815:web:610b0dad02d958df9881c2"
});

const chat_id = '-1001678724997';
const botToken = '5401170277:AAGXh_DUBGLqJCJAEVVnHDR9LY2KFrbPXng';
const bot = new TelegramBot(botToken);
const app = express();
app.use(cors({ origin: true }));


const getWelcomeMessage = (detectionType, identification) => {
  let message = `Запілінговано оператора дрону 🥸 🏴‍☠`;

  if (detectionType === 'drone') {
    message =
      `Запілінговано дрон 🚨🚨🚨
Модель: ${identification.model || ''}
Надсилаю координати...`
  }

  return message;
}

const db = admin.firestore();
app.use(express.json());
app.post('/dedrone', async (req, res) => {

  // const docRef = db.collection('users').doc(uuidv4());
  // console.log(req.body);
  // await docRef.set(req.body);

  // return;
  // connect(async (client) => {
  // const docRef = db.collection('users').doc(uuidv4());
  // console.log(req.body);
  // await docRef.set(req.body);

  const data = req.body;
  const alertId = _get(data, 'data.alertId');
  const alertState = _get(data, 'data.alertState');
  const detections = _get(data, 'data.detections', []);
  // const incomingPositionsCollection = await client.db("dedrone").collection('incomingPositions');
  const incomingPositionsCollection = db.collection('incomingPositions');

  if (!detections.length) return;

  detections.forEach(async ({ positions = [], detectionType, positionState, identification }) => {

    let position = _uniqWith(positions, (arg1, arg2) => {
      const pos1 = _pick(arg1, ['latitude', 'longitude']);
      const pos2 = _pick(arg2, ['latitude', 'longitude']);
      return _isEqual(pos1, pos2);
    });

    position = _last(position);
    position = _pick(position, ['latitude', 'longitude']);

    position = _transform(position, (result, value, key) => {
      (result[key]) = parseFloat(value.toFixed(4));
    }, {});

    if (alertState === 'start') {

      try {
        await bot.sendMessage(chat_id, getWelcomeMessage(detectionType, identification));

        setTimeout(async () => {

          const { message_id } = await bot.sendLocation(
            chat_id,
            position.latitude,
            position.longitude,
            {
              live_period: 4000,
              protect_content: true
            }
          );
          console.log('Success:', 'BOT sendLiveLocation.', 'AlertID:', alertId);

          await incomingPositionsCollection.doc(`${alertId}_${detectionType}`).set({ position, positionState, detectionType, alertId, message_id, alertState });
          // const insertDoc = {
          //   $set: { position, positionState, detectionType, alertId, message_id, alertState }
          // };
          // await incomingPositionsCollection.updateOne({ alertId, alertState, message_id }, insertDoc, { upsert: true });
          // client.close();

          console.log('Success:', 'INSERT document.', 'AlertID:', alertId);
        }, 0);
      } catch (e) {
        console.error('Error:', 'BOT sendLiveLocation.', 'AlertID:', alertId);
      }


    } else if (alertState === 'update') {

      // const doc = await incomingPositionsCollection.findOne({ alertId, detectionType });
      const doc = await incomingPositionsCollection.doc(`${alertId}_${detectionType}`).get();
      if (!doc.exists) {
        console.log('No data:', 'document does not exists', 'AlertId:', alertId, 'detectionType:', detectionType);
        return
      }

      // const { message_id, position: oldPosition } = doc;

      if (_isEqual(doc.data().position, position)) {
        console.log('Same position');
        return;
      }

      setTimeout(async () => {
        // const newDocument = {
        //   $set: {
        //     ...doc,
        //     position
        //   }
        // }
        // await incomingPositionsCollection.updateOne({ alertId, detectionType, message_id }, newDocument);

        // client.close();


        await incomingPositionsCollection.doc(`${alertId}_${detectionType}`).update({ position });

        const { message_id } = doc.data();
        try {
          await bot.editMessageLiveLocation(
            position.latitude,
            position.longitude,
            {
              chat_id,
              message_id,
              horizontal_accuracy: 100
            }
          );

          console.log('Success:', 'bot editMessaheLiveLocation', 'AlertID', alertId, position, 'message_id', message_id);
        } catch (e) {
          console.error('Error:', 'Bot editMessageLiveLocation', 'AlertID', alertId, position, 'message_id', message_id)
          console.log(e);
        }
      }, 4000);
    } else if (alertState === 'end') {
      try {
        // const doc = await incomingPositionsCollection.findOne({ alertId, detectionType });
        const doc = await incomingPositionsCollection.doc(`${alertId}_${detectionType}`).get();


        if (!doc.exists) {
          console.log('No data:', 'document does not exists', 'AlertId:', alertId, 'detectionType:', detectionType);
          return
        }

        const { message_id } = doc.data();

        await bot.stopMessageLiveLocation({ chat_id, message_id });
        // await incomingPositionsCollection.deleteMany({ alertId, detectionType, message_id });
        await incomingPositionsCollection.doc(`${alertId}_${detectionType}`).delete()
        console.log('Success:', 'DELETE document', 'alertId', alertId, 'detectionType', detectionType);

      } catch (e) {
        console.error('Error:', 'DELETE document', 'alertId', alertId, 'detectionType', detectionType);

      }
    }
  });

  return res.status(200).send({ 'oloo': 123 });
  // });
});

app.listen(5001, () => {
  console.log('app listening on port 5001');
})

// exports.app = functions.https.onRequest(app);