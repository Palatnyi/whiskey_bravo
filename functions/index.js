const cors = require('cors');
const cron = require('node-cron');
const express = require('express');
const TelegramBot = require('node-telegram-bot-api');
const { MongoClient, ServerApiVersion } = require('mongodb');

const {
  get: _get,
  last: _last,
  pick: _pick,
  maxBy: _maxBy,
  isEmpty: _isEmpty,
  toArray: _toArray,
  isEqual: _isEqual,
  uniqWith: _uniqWith,
  transform: _transform,
  uniqueId: _uniqueId,
} = require('lodash');


let dbCache = {};
let tasks = {};
const PORT = 3000;
const chat_id = '-1001678724997';
const botToken = '5401170277:AAGXh_DUBGLqJCJAEVVnHDR9LY2KFrbPXng';
const bot = new TelegramBot(botToken);

const connectToMongo = async () => {
  if (dbCache.client) return dbCache;

  const uri = "mongodb+srv://m001-student:m001-mongodb-basics@sandbox.wiznw.mongodb.net/?retryWrites=true&w=majority";
  const client = new MongoClient(uri, { useNewUrlParser: true, useUnifiedTopology: true, serverApi: ServerApiVersion.v1 });

  try {
    await client.connect();
    console.log('CONNECTED TO MONGODB');
  } catch (e) {
    console.log('FAILED CONNECT TO MONGO', e);
  }
  dbCache = { client };

  return { client };
}

const app = express();

app.use(express.json());
app.use(cors({ origin: true }));

app.get('/health', (req, res) => {
  res.send('<b>health: ok </b>');
})

app.post('/collect-data', async (req, res) => {
  const { client } = await connectToMongo();
  const dedroneDB = await client.db('dedrone');
  try {
    await dedroneDB.collection('alertsTest').insertOne({ ...req.body, timestamp: Date.now() });
    console.log('item saved'.toUpperCase());
    res.status(200).send({ status: 'ok' });
  } catch (e) {
    console.error('item saving failed'.toUpperCase(), e);
    res.status(500).send({ status: 'failed' });
  }
});

app.post('/dedrone', async (req, res) => {

  const { client } = await connectToMongo();

  let alertId = _get(req.body, 'data.alertId');
  const dedroneDB = await client.db('dedrone');
  const alertState = _get(req.body, 'data.alertState');
  const detections = _get(req.body, 'data.detections', []);

  if (!detections.length) {
    console.log('detections list is empty'.toUpperCase(), alertId);
    return;
  }

  for (const detection of detections) {
    const { positions: _positions, detectionType, identification } = detection;
    if (!_positions.length) {
      console.log('NO POSITIONS in detection object');
      return;
    }
    //remove before production
    const positions = _positions.map(pos => {
      pos.timestamp = pos.timestamp.$numberLong || pos.timestamp;
      return { ...pos }
    });

    const newPosition = _maxBy(positions, pos => pos.timestamp);

    let currentDoc = await dedroneDB.collection('alerts').findOne(getExtendedSearchQuery({ alertId, identification }));
    oldPosition = _get(currentDoc, `${detectionType}.position`, {});

    const isPositionEquals = ({ oldPosition = {}, newPosition = {} }) => {
      const oldCoordinates = _pick(oldPosition, ['latitude', 'longitude']);
      const newCoordinates = _pick(newPosition, ['latitude', 'longitude']);

      return _isEqual(oldCoordinates, newCoordinates);
    }

    if (isPositionEquals({ oldPosition, newPosition })) {
      console.log('POSITIONS ARE EQUALS');
      return;
    }

    const timestamp = Date.now();
    const timestampWindow = timestamp + 30000;
    alertId = _get(currentDoc, 'alertId', alertId);

    const insertOrUpdate = {
      $set: {
        alertId,
        timestamp,
        alertState,
        detectionType,
        identification,
        timestampWindow,
        [`${detectionType}.position`]: newPosition,
      },
      $addToSet: { alertIds: { alertId, timestamp} }
    }

    await dedroneDB.collection('alerts').findOneAndUpdate({ alertId }, insertOrUpdate, { upsert: true });

  };

  if (!tasks[alertId]) {
    console.log('UPDATE location task started.', 'alertId:', alertId);
    tasks[alertId] = cron.schedule("*/5 * * * * *", async () => {
      await updateLocationTask(alertId, dedroneDB);
    });
  }

  console.debug(Object.keys(tasks));

  res.status(200).send({ ok: 'ok' });

});


const getExtendedSearchQuery = ({ alertId, identification }) => {

  const extendedQuery = Object.keys(identification).map(key => {
    const value = identification[key];

    return {
      $or: [{
        [`identification.${key}`]: { $eq: value }
      }, {
        [`identification.${key}`]: { $type: 9 }
      }, {
        [`identification.${key}`]: { $exists: false }
      },]
    }
  });

  // const ololo = (olo) => { 
  //   console.log('ololo within $where', 5+19/4, olo);
  // }

  const and = extendedQuery.concat([
    { $and: [{ timestampWindow: { $exists: true } }, { timestampWindow: { $gte: Date.now() } }] },
  //   {
  //     $exp: { $function: {
  //       body: function (position) {
  //         console.log('$function', position);
  //         return true
  //       },
  //       args: [ "$position" ],
  //       lang: "js"
  // } }
  //   }
  ])

  return {
    $or: [{
      alertId
    }, {
      $and: and
    }]
  }
}


const updateLocationTask = async (alertId, dedroneDB) => {
  console.log('TASK IS RUNNING...', 'alertId:', alertId);
  const alert = await dedroneDB.collection('alerts').findOne({ alertId });
  const { alertState, drone, remote } = alert;

  const isPositionSynced = (device = {}) => {
    const { syncTimestamp, position: { timestamp } } = device;

    return syncTimestamp === timestamp;
  }

  const getWelcomeMessage = (detectionType) => {
    let message = `Запілінговано оператора дрону 🥸 🏴‍☠`;

    if (detectionType === 'drone') {
      message =
        `Запілінговано дрон 🚨🚨🚨
  Надсилаю координати...`
    }

    return message;
  }


  const updateDeviceLocation = async ({ alertState, alertId, dedroneDB, detectionType, device }) => {

    if (!device || !device.position) return;

    const { position: { timestamp, latitude, longitude } } = device;

    if (device.liveLocationStarted) {
      try {
        await bot.editMessageLiveLocation(
          latitude,
          longitude,
          {
            chat_id,
            message_id: device.message_id,
            horizontal_accuracy: 100
          }
        );
        console.log('EDIT', { latitude, longitude });
      } catch (e) {
        console.error('EDIT FAILED', { latitude, longitude }, e);
      }

      const update = {
        $set: {
          [`${detectionType}.syncTimestamp`]: timestamp,
        }
      };
      await dedroneDB.collection('alerts').findOneAndUpdate({ alertId }, update);

    } else {
      let message_id;

      try {

        await bot.sendMessage(chat_id, getWelcomeMessage(detectionType));

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
        console.error('START LIVE LOCATION FAILED', { latitude, longitude }, e);
      }

      const update = {
        $set: {
          alertId,
          alertState,
          detectionType,
          [`${detectionType}.message_id`]: message_id,
          [`${detectionType}.syncTimestamp`]: timestamp,
          [`${detectionType}.liveLocationStarted`]: true,
        }
      };

      // await dedroneDB.collection('alerts').updateOne({ alertId }, updateDoc);
      await dedroneDB.collection('alerts').findOneAndUpdate({ alertId }, update);

    }
  }


  if (!isPositionSynced(drone)) {
    await updateDeviceLocation({ alertState, alertId, detectionType: 'drone', device: drone, dedroneDB });
  }

  if (!isPositionSynced(remote)) {
    await updateDeviceLocation({ alertState, alertId, detectionType: 'remote', device: remote, dedroneDB });
  }
};

const deleteInactiveAlertsTask = cron.schedule('0 */4 * * *', async () => {
  console.log('DELETE alert task is running...');
  const { client } = await connectToMongo();
  const timestamp = Date.now();
  const alerts = await client.db('dedrone').collection('alerts').find({}).toArray();

  if (alerts.length < 1) {
    console.log('NO ALERTS TO DELETE');
    return
  };

  const alertsToDelete = alerts.filter(alert => (timestamp - alert.timestamp) > 86400000)
    .map((alert) => {
      if (tasks[alert.alertId]) {
        tasks[alert.alertId].stop();
      }
      return alert.alertId;
    });


  try {
    await client.db('dedrone').collection('alerts').deleteMany({ alertId: { $in: alertsToDelete } });
    console.log('SUCCESS: inactive alerts deleted');
  } catch (e) {
    console.error('FAILED: task failed delete inactive alerts', e);

  }

  console.log('DELETE alert task finished...');

}, { scheduled: false });


app.listen(PORT, async () => {
  await connectToMongo();
  deleteInactiveAlertsTask.start();
});
