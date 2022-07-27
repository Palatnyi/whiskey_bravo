const connect = require('./mongod_connect');
const TelegramBot = require('node-telegram-bot-api');
const { get: _get, uniqWith: _uniqWith, isEqual: _isEqual, last: _last, pick: _pick, transform: _transform } = require('lodash');
const startJson = require('../testPositionsStart.json');
const updateJson = require('../testPositionsUpdate_4.json');

const chat_id = '-1001678724997';
const botToken = '5401170277:AAGXh_DUBGLqJCJAEVVnHDR9LY2KFrbPXng';
const bot = new TelegramBot(botToken);


const runApp = async (client) => {

  const testApp = async (client, messages, index) => {
    console.log('TEST app', index);
    const incomingPositionsCollection = await client.db("dedrone").collection('incomingPositions');

    const alertId = _get(messages, 'data.alertId');
    const alertState = _get(messages, 'data.alertState');
    const detections = _get(messages, 'data.detections', []);
    detections.forEach(async ({ positions = [], detectionType, positionState, identification }) => {
      // if (!positions.length) return;

      let position = _uniqWith(positions, (arg1, arg2) => {
        let pos1 = _pick(arg1, ['latitude', 'longitude']);
        const pos2 = _pick(arg2, ['latitude', 'longitude']);
        return _isEqual(pos1, pos2);
      });


      position = _last(position);
      position = _pick(position, ['latitude', 'longitude']);

      console.log(position);

      position = _transform(position, (result, value, key) => {
        (result[key]) = parseFloat(value.toFixed(5));
      }, {});

      if (alertState === 'start') {
        try {

          await bot.sendMessage(chat_id, detectionType);

          const { message_id } = await bot.sendLocation(
            chat_id,
            position.latitude,
            position.longitude,
            {
              live_period: 4000,
            }
          );
          console.log('Success:', 'BOT sendLiveLocation.', 'AlertID:', alertId);

          const insertDoc = {
            $set: { position, positionState, detectionType, alertId, message_id }
          };

          await incomingPositionsCollection.updateOne({ alertId, alertState, message_id }, insertDoc, { upsert: true });
          console.log('Success:', 'INSERT document.', 'AlertID:', alertId);
        } catch (e) {
          console.log('Error:', 'BOT sendLiveLocation.', 'AlertID:', alertId);
        }


      } else if (alertState === 'update') {

        const doc = await incomingPositionsCollection.findOne({ alertId, detectionType });

        if (!doc) {
          console.log('No data:', 'document does not exists', 'AlertId:', alertId, 'detectionType:', detectionType);
          return
        }

        const { message_id, position: oldPosition } = doc;

        if (_isEqual(oldPosition, position)) {
          console.log('Same position');
          return;

        }

        const newDocument = {
          $set: {
            ...doc,
            position
          }
        }

        try {
          await incomingPositionsCollection.updateOne({ alertId, detectionType, message_id }, newDocument);
          console.log('Success:', 'UPDATE document.', 'AlertID:', alertId);
        } catch (e) {
          console.log('Error:', 'UPDATE document.', 'AlertID:', alertId,);

        }

        setTimeout(async () => {
          const { message_id } = doc;
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
            console.log(e);
            console.log('Error:', 'Bot editMessageLiveLocation', 'AlertID', alertId, position, 'message_id', message_id)
          }
        }, 3000);
      } else if (alertState === 'end') {
        try {
          const doc = await incomingPositionsCollection.findOne({ alertId, detectionType });

          if (!doc) {
            console.log('No data:', 'document does not exists', 'AlertId:', alertId, 'detectionType:', detectionType);
            return
          }

          const { message_id } = doc;

          await bot.stopMessageLiveLocation({ chat_id, message_id });
          await incomingPositionsCollection.deleteMany({ alertId, detectionType, message_id });
          console.log('Success:', 'DELETE document', 'alertId', alertId, 'detectionType', detectionType);

        } catch (e) {
          console.log('Error:', 'DELETE document', 'alertId', alertId, 'detectionType', detectionType);

        }

      }
    });
  }


  let index = 2700;
  updateJson[2700].data.alertState = 'start';

  const interval = setInterval(() => {
    testApp(client, updateJson[index], index);
    index += 1;
    if (index > updateJson.length - 1) {
      clearInterval(interval);
    }
  }, 100)
}

connect(runApp);
//{"data.alertId": "62d969c5ff8a76240c4726ee", "data.alertState": "update", "data.detections": {$elemMatch: {"detectionType": "dron"}}}
//{"data.alertState": "start", "data.detections": {$elemMatch: {"detectionType": "drone"}}}