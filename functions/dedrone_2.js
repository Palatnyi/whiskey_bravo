const cron = require('node-cron');
const connect = require('./mongod_connect');
const TelegramBot = require('node-telegram-bot-api');
const { get: _get, uniqWith: _uniqWith, isEqual: _isEqual, last: _last, pick: _pick, transform: _transform, maxBy: _maxBy, isEmpty: _isEmpty, toArray: _toArray, identity, sortedIndex } = require('lodash');
const updateJson = require('../testPositionsUpdate_4.json');
const process = require('process');
const admin = require("firebase-admin");
const serviceAccount = require('./permissions.json');
const { compileFunction } = require('vm');


admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  apiKey: "AIzaSyB1HMtSp4EbsMXNPutIl3djFKx3fJhbLhI",
  authDomain: "whiskeybravo-9aa4d.firebaseapp.com",
  projectId: "whiskeybravo-9aa4d",
  storageBucket: "whiskeybravo-9aa4d.appspot.com",
  messagingSenderId: "706482771815",
  appId: "1:706482771815:web:610b0dad02d958df9881c2"
});

let collection = {};
const db = admin.firestore();
const chat_id = '-1001678724997';
const botToken = '5401170277:AAGXh_DUBGLqJCJAEVVnHDR9LY2KFrbPXng';
const bot = new TelegramBot(botToken);
const incomingPositionsCollection = db.collection('incomingPositions');

const processMessage = async (message) => {
  const alertId = _get(message, 'data.alertId');
  const alertState = _get(message, 'data.alertState');
  const detections = _get(message, 'data.detections', []);

  // detections.forEach(async ({ positions: _positions, detectionType }) => {
  for (const detection of detections) {
    const { positions: _positions, detectionType } = detection;
    //remove before production
    const positions = _positions.map(pos => {
      pos.timestamp = pos.timestamp.$numberLong;
      return { ...pos }
    });

    const newPosition = _maxBy(positions, (pos) => {
      return parseFloat(pos.timestamp);
    });

    // const oldPosition = _get(collection, `${alertId}.${detectionType}.position`, {});

    let oldPosition = await incomingPositionsCollection.doc(alertId).get();
    oldPosition = _get(oldPosition.data(), `${detectionType}.position`, {});

    const isPositionEquals = ({ oldPosition = {}, newPosition = {} }) => {
      const oldCoordinates = _pick(oldPosition, ['latitude', 'longitude']);
      const newCoordinates = _pick(newPosition, ['latitude', 'longitude']);

      return _isEqual(oldCoordinates, newCoordinates);
    }

    if (isPositionEquals({ oldPosition, newPosition })) {
      return;
    }

    let doc = await incomingPositionsCollection.doc(alertId).get();
    doc = _get(doc.data(), detectionType, {})
    await incomingPositionsCollection.doc(alertId).set({
      alertId,
      alertState,
      detectionType,
      [detectionType]: {
        ...doc,
        delete: alertState === 'end',
        position: newPosition,
      },
    })
  };
}


const task = cron.schedule('*/4 * * * * *', async () => {
  console.log('TASK STARTED')

  const updateDeviceLocation = async ({ alertState, alertId, collection, detectionType, device }) => {
    if (!device || !device.position) return;

    if (device.delete) {
      console.log('MARK FOR DELETION');
      return;
    }


    const { syncTimestamp, position: { timestamp, latitude, longitude } } = device;

    if (syncTimestamp === timestamp) return;

    if (device.liveLocationStarted) {
      try {
        console.log(latitude, longitude);
        await bot.editMessageLiveLocation(
          latitude.toFixed(4),
          longitude.toFixed(4),
          {
            chat_id,
            message_id: device.message_id,
            horizontal_accuracy: 100
          }
        );
        console.log('EDIT', { latitude, longitude });
      } catch (e) {
        console.log('EDIT FAILED', { latitude, longitude }, e);
      }
      await collection.doc(alertId).set({
        alertId,
        alertState,
        detectionType,
        [detectionType]: {
          ...device,
          syncTimestamp: timestamp,
        },
      });
    } else {
      let message_id;

      try {
        const response = await bot.sendLocation(
          chat_id,
          latitude,
          longitude, {
          live_period: 4000,
          protect_content: true
        });
        message_id = response.message_id;
        console.log('START', { latitude, longitude }, message_id)
      } catch (e) {
        console.log('START FAILED', { latitude, longitude }, e)
      }

      await collection.doc(alertId).set({
        alertId,
        alertState,
        detectionType,
        [detectionType]: {
          ...device,
          message_id,
          syncTimestamp: timestamp,
          liveLocationStarted: true,
        },
      });
    }
  }


  let alerts = await incomingPositionsCollection.get();
  alerts = alerts.docs.map(doc => doc.data())
  for (const alert of alerts) {
    const { alertState, alertId, detectionType, drone, remote } = alert;
    await updateDeviceLocation({ alertState, alertId, detectionType: 'drone', device: drone, collection: incomingPositionsCollection });
    await updateDeviceLocation({ alertState, alertId, detectionType: 'remote', device: remote, collection: incomingPositionsCollection });
  }

});


let index = 2700;
const interval = setInterval(async () => {

  processMessage(updateJson[index]);
  console.log(index);
  index += 1;
  if (index > updateJson.length) {
    clearInterval(interval);
  }
}, 100)

task.start();




