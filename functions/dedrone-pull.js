import _ from 'lodash';
import axios from 'axios';
import cron from 'node-cron';
import TelegramBot from 'node-telegram-bot-api';
import { MongoClient, ServerApiVersion } from 'mongodb';


let isPulling;
const chat_id = '-1001678724997';
const dedroneToken = 'BedRxVUpuiZytmsqLnjEcxMhcsypWJhJ';
const droneToken = '5401170277:AAGXh_DUBGLqJCJAEVVnHDR9LY2KFrbPXng';
const remoteToken = '5307737139:AAGsvSzJWtGjpAf_miSXcIBaCViOVzH0SjI';
const pullUrl = 'https://ukr2.cloud.dedrone.com/api/1.0/systemstate';
const testurl = 'http://localhost:3000/test-pull';

const bots = {
  drone: new TelegramBot(droneToken),
  remote: new TelegramBot(remoteToken)
};

let dbCache;
const getDBCache = () => dbCache;
const setDBCache = (cache) => dbCache = cache;
const mongoUri = "mongodb+srv://m001-student:m001-mongodb-basics@sandbox.wiznw.mongodb.net/?retryWrites=true&w=majority";
const connectToMongo = async (uri) => {
  const cache = getDBCache();
  if (cache && cache.client) return cache;

  const client = new MongoClient(uri, { useNewUrlParser: true, useUnifiedTopology: true, serverApi: ServerApiVersion.v1 });

  try {
    await client.connect();
    console.log('CONNECTED TO MONGODB');
  } catch (e) {
    console.log('FAILED CONNECT TO MONGO', e);
    return { error: true, msg: 'failed connect to mongoDB' }
  }
  setDBCache({ client })

  return { client };
}

const closeConnection = async () => {
  const cache = getDBCache();
  if (cache && cache.client) {
    cache.client.close();
    setDBCache({})
  }
}

const getCollection = async (client, dbName, collectionName) => {
  if (!dbName) {
    console.log('No DB provided');
    return { error: true, msg: 'No DB provided' };
  }

  if (!collectionName) {
    console.log('NoCollection name provided');
    return { error: true, msg: 'No DB provided' }
  }

  return await client.db(dbName).collection(collectionName);
}

const getExtendedSearchQuery = ({ detectionId, identification, detectionType }) => {
  const keys = ['manufacturer', 'protocol', 'detectionType', 'label'];

  const extendedQuery = keys.map(key => {
    const value = identification[key];

    return {
      $or: [{
        [`${detectionType}.identification.${key}`]: { $eq: value }
      }, {
        [`${detectionType}.identification.${key}`]: { $type: 9 }
      }, {
        [`${detectionType}.identification.${key}`]: { $exists: false }
      },]
    }
  });

  const and = extendedQuery.concat([
    { $and: [{ [`${detectionType}.timestampWindow`]: { $exists: true } }, { [`${detectionType}.timestampWindow`]: { $gte: Date.now() } }] },
  ])

  return {
    $or: [{
      detectionId
    }, {
      $and: and
    }]
  }
}

const isPositionEquals = ({ oldPosition = {}, newPosition = {} }) => {
  const oldCoordinates = _.pick(oldPosition, ['latitude', 'longitude']);
  const newCoordinates = _.pick(newPosition, ['latitude', 'longitude']);

  return _.isEqual(oldCoordinates, newCoordinates);
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

const requestSystemState = async ({ url, token }) => {
  let response;
  try {
    console.log('requesting /systemstate...');
    const { data } = await axios.get(url, { headers: { 'Dedrone-Auth-Token': token } });
    response = data;
  } catch (e) {
    console.log('error')
    response = { error: true, msg: 'Failed to request dedrone API' };
  }

  return response;
}

const pullAlerts = async () => {
  if (isPulling) {
    return;
  }

  console.log('pulling...');
  isPulling = true;

  const { client } = await connectToMongo(mongoUri);
  const collection = await getCollection(client, 'dedrone', 'alerts');
  let systemState = await requestSystemState({ url: testurl, token: dedroneToken });

  if (systemState.error) {
    console.log(systemState.msg);
    isPulling = false;
    return
  }

  const alerts = _.get(systemState, 'data.currentAlertState.alerts', [])

  if (!alerts.length) {
    console.log('No alerts in systemState response');
    isPulling = false;
    return
  }

  for (const alert of alerts) {
    const { internalId, detections = [] } = alert;

    if (!detections.length) {
      console.log('no detections in the alert');
      continue
    }

    const singleDetection = detections.find(det => det.detectionId === internalId);

    if (!singleDetection) {
      console.log('no singleDetection in the detections array');
      continue
    }

    let { detectionId } = singleDetection;
    let { positions = [] } = singleDetection;
    const { identification } = singleDetection;

    const { detectionType } = identification;

    if (!detectionType) {
      console.log('device (remote/drone) has not been recognised yet');
      continue
    }

    if (!positions.length) {
      console.log('no positions in singleDetection object');
      continue
    }

    positions = _.last(positions);

    const newPosition = {
      longitude: positions[0],
      latitude: positions[1]
    }

    const currentDoc = await collection.findOne(getExtendedSearchQuery({ detectionId, identification, detectionType }));
    const oldPosition = _.get(currentDoc, `${detectionType}.position`, {});

    if (isPositionEquals({ oldPosition, newPosition })) {
      console.log('positions equals');
      continue
    }

    const timestamp = Date.now();
    const timestampWindow = timestamp + 120000;
    detectionId = _.get(currentDoc, 'detectionId', detectionId);

    let set = {
      detectionId,
      [`${detectionType}.timestamp`]: timestamp,
      [`${detectionType}.position`]: newPosition,
      [`${detectionType}.identification`]: identification,
      [`${detectionType}.timestampWindow`]: timestampWindow,
    }

    const bot = bots[detectionType];
    const { latitude, longitude } = newPosition;

    if (currentDoc && currentDoc[detectionType] && currentDoc[detectionType].liveLocationStarted) {
      try {
        await bot.editMessageLiveLocation(
          latitude,
          longitude,
          {
            chat_id,
            message_id: currentDoc[detectionType].message_id,
            horizontal_accuracy: 1
          }
        );
        console.log('EDIT', { latitude, longitude });
      } catch (e) {
        console.log('edit errror', e);
      }
    } else {
      try {

        await bot.sendMessage(chat_id, getWelcomeMessage(detectionType));

        const { message_id } = await bot.sendLocation(
          chat_id,
          latitude,
          longitude, {
          live_period: 4000,
          protect_content: true
        });

        set = {
          ...set,
          [`${detectionType}.message_id`]: message_id,
          [`${detectionType}.liveLocationStarted`]: true,
        }

        console.log('Live location started', { latitude, longitude }, message_id)
      } catch (e) {
        console.error('START LIVE LOCATION FAILED', { latitude, longitude }, e);
      }
    }

    await collection.findOneAndUpdate({ detectionId }, { $set: set }, { upsert: true });
  }

  isPulling = false;
}

const task = cron.schedule("*/5 * * * * *", async () => {
  await pullAlerts();
}, { scheduled: false });


export default {
  task,
  pullAlerts,
  isPositionEquals,
  getWelcomeMessage,
  requestSystemState,
  getExtendedSearchQuery,
  getCollection,
  connectToMongo,
  mongoUri,
  dbCache,
  pullUrl,
  dedroneToken,
  closeConnection,
  getDBCache, 
  setDBCache
}


