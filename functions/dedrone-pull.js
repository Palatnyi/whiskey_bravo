import _ from 'lodash';
import axios from 'axios';
import cron from 'node-cron';
import TelegramBot from 'node-telegram-bot-api';
import { MongoClient, ServerApiVersion } from 'mongodb';


class FlightActivityTracker {
  constructor() {
    this._dbCache;
    this.isPulling;
    this._dbName = 'dedrone';
    this._collectionName = 'alerts'
    this.chat_id = '-1001678724997';
    this._pullFrequency = "*/5 * * * * *"
    this._testurl = 'http://localhost:3000/test-pull';
    this._dedroneToken = 'BedRxVUpuiZytmsqLnjEcxMhcsypWJhJ';
    this._pullUrl = 'https://ukr2.cloud.dedrone.com/api/1.0/systemstate';
    this._mongoUri = 'mongodb+srv://m001-student:m001-mongodb-basics@sandbox.wiznw.mongodb.net/?retryWrites=true&w=majority';

    this._bots = {
      drone: new TelegramBot('5401170277:AAGXh_DUBGLqJCJAEVVnHDR9LY2KFrbPXng'),
      remote: new TelegramBot('5307737139:AAGsvSzJWtGjpAf_miSXcIBaCViOVzH0SjI')
    };

    this._telegramMessagesCount = {};

  }

  setCollectionName = name => this._collectionName = name;

  getDBCache = () => this._dbCache;

  setDBCache = (cache) => this._dbCache = cache;

  connectToMongo = async () => {
    const cache = this.getDBCache();
    if (cache && cache.client) return Promise.resolve(cache);

    const client = new MongoClient(this._mongoUri, { useNewUrlParser: true, useUnifiedTopology: true, serverApi: ServerApiVersion.v1 });

    try {
      await client.connect();
      console.log('CONNECTED TO MONGODB');
    } catch (e) {
      console.log('FAILED CONNECT TO MONGO', e);
      return { error: true, msg: 'failed connect to mongoDB' }
    }
    this.setDBCache({ client })

    return Promise.resolve({ client });
  }

  closeConnection = async () => {
    const cache = this.getDBCache();
    if (cache && cache.client) {
      cache.client.close();
      this.setDBCache({})
    }
  }

  getCollection = async (client, dbName, collectionName) => {
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

  getExtendedSearchQuery = ({ detectionId, identification, detectionType }) => {
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

  isPositionEquals = ({ oldPosition = {}, newPosition = {} }) => {
    const oldCoordinates = _.pick(oldPosition, ['latitude', 'longitude']);
    const newCoordinates = _.pick(newPosition, ['latitude', 'longitude']);

    return _.isEqual(oldCoordinates, newCoordinates);
  }

  getWelcomeMessage = (detectionType) => {
    let message = `Запілінговано оператора дрону 🥸 🏴‍☠`;

    if (detectionType === 'drone') {
      message =
        `Запілінговано дрон 🚨🚨🚨
  Надсилаю координати...`
    }

    return message;
  }


  requestSystemState = async (opt = {}) => {
    const url = opt.url || this._pullUrl;
    const token = opt.token || this._dedroneToken;

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

  telegramOperationCount = (detectionType, internalId, type) => {
    const typeCounter = this._telegramMessagesCount[detectionType];

    if (!typeCounter) {
      typeCounter = {
        count: 1,
        messagesMeta: [{ internalId, type, detectionType }],
      };
    } else {
      typeCounter = {
        count: typeCounter.count + 1,
        messagesMeta: typeCounter.messagesMeta.concat([{ internalId, type, detectionType }])
      };
    }

    this._telegramMessagesCount[detectionType] = { ...typeCounter };
  }

  setAlertStatus = (internalId, msg) => {
    this._alertsStatuses = {
      [internalId]: { msg }
    }
  }

  pullAlerts = async () => {
    if (this.isPulling) {
      return
    }

    this._alertsStatuses = {};
    this._telegramMessagesCount = {};
    
    console.log('pulling...');
    this.isPulling = true;

    const { client } = await this.connectToMongo();
    const collection = await this.getCollection(client, this._dbName, this._collectionName);
    let systemState = await this.requestSystemState({ url: this._testurl, token: this._dedroneToken });

    if (systemState.error) {
      console.log(systemState.msg);
      this.isPulling = false;
      return { ...systemState };
    }

    const alerts = _.get(systemState, 'data.currentAlertState.alerts', [])

    if (!alerts.length) {
      console.log('No alerts in systemState response');
      this.isPulling = false;
      return { error: false, msg: 'No alerts in systemState response', ...this._telegramMessagesCount }
    }

    let alertsStatuses = {};

    for (const alert of alerts) {
      const { internalId, detections = [] } = alert;

      if (!detections.length) {
        alertsStatuses = {
          ...alertsStatuses,
          [internalId]: {
            msg: 'no detections in the alert'
          },
        }
        console.log('no detections in the alert');
        continue
      }

      const singleDetection = detections.find(det => det.detectionId === internalId);

      if (!singleDetection) {
        alertsStatuses = {
          ...alertsStatuses,
          [internalId]: {
            msg: 'no singleDetection in the detections array'
          },
        }
        console.log('no singleDetection in the detections array');
        continue
      }

      let { detectionId } = singleDetection;
      let { positions = [] } = singleDetection;
      const { identification } = singleDetection;

      const { detectionType } = identification;

      if (!detectionType) {
        alertsStatuses = {
          ...alertsStatuses,
          [internalId]: {
            msg: 'device (remote/drone) not recognized'
          },
        }
        console.log('device (remote/drone) has not been recognised yet');
        continue
      }

      if (!positions.length) {
        alertsStatuses = {
          ...alertsStatuses,
          [internalId]: {
            msg: 'no positions in singleDetection object'
          },
        }
        console.log('no positions in singleDetection object');
        continue
      }

      positions = _.last(positions);

      const newPosition = {
        longitude: positions[0],
        latitude: positions[1]
      }

      const currentDoc = await collection.findOne(this.getExtendedSearchQuery({ detectionId, identification, detectionType }));
      const oldPosition = _.get(currentDoc, `${detectionType}.position`, {});

      if (this.isPositionEquals({ oldPosition, newPosition })) {
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

      const bot = this._bots[detectionType];
      const { latitude, longitude } = newPosition;

      const isEditMessage = currentDoc && currentDoc[detectionType] && currentDoc[detectionType].liveLocationStarted;

      if (isEditMessage) {
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

          await bot.sendMessage(chat_id, this.getWelcomeMessage(detectionType));

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

      const type = isEditMessage ? 'edit' : 'start';
      this.telegramOperationCount(detectionType, internalId, type);
    }

    this.isPulling = false;

    return { ...alertsStatuses };
  }

  start = async () => {
    await this.connectToMongo();

    this._task = cron.schedule(this._pullFrequency, async () => {
      await this.pullAlerts();
    });

    this._task.start();
  }

  stop = () => {
    if (this._task) {
      this._task.stop();
    }
  }
}

export default FlightActivityTracker


