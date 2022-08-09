import _ from 'lodash';
import axios from 'axios';
import cron from 'node-cron';
import TelegramBot from 'node-telegram-bot-api';
import { MongoClient, ServerApiVersion } from 'mongodb';


class FlightActivityTracker {
  constructor() {
    this._dbCache;
    this.isPulling = false;
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

  getExtendedSearchQuery = ({ detectionType, identification, position, maxDistance }) => {
    const query = [];
    const keys = ['manufacturer', 'protocol', 'detectionType', 'label'];

    for (let i = 0; i <= keys.length; i += 1) {
      const key = keys[i];
      const value = identification[key];

      if (value) {
        query.push({
          $or: [{
            [`identification.${key}`]: { $eq: value }
          }, {
            [`identification.${key}`]: { $type: 9 }
          }, {
            [`identification.${key}`]: { $exists: false }
          },]
        })
      }
    }

    query.push({ detectionType });
    query.push({ 'timestampWindow': { $exists: true } });
    query.push({ 'timestampWindow': { $gte: Date.now() } });
    query.push({
      position: {
        $near: {
          $geometry: position,
          $maxDistance: maxDistance
        }
      }
    });


    return {
      $and: query
    }
  }

  isPositionEquals = ({ oldPosition = {}, newPosition = {} }) => {
    const oldCoordinates = _.pick(oldPosition, ['type', 'coordinates']);
    const newCoordinates = _.pick(newPosition, ['type', 'coordinates']);

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

  setAlertStatus = (internalId, msg) => {
    this._alertsStatuses = {
      [internalId]: { msg }
    }
  }

  getCurrentAlert = async ({ client, query }) => {
    let currentDoc;
    try {
      currentDoc = await client.db(this._dbName).collection(this._collectionName).find(query).sort({ timestampWindow: -1 }).limit(1).toArray();

    } catch (e) {
      console.log('Error. getCurrentAlert', e);
    }

    return currentDoc[0];
  }

  updateCurrentAlert = async ({ client, query, doc }) => {
    return await client.db(this._dbName).collection(this._collectionName).findOneAndUpdate(query, doc, { upsert: true });
  }

  pullAlerts = async () => {
    if (this.isPulling) {
      return
    }

    console.log('pulling...');

    this.isPulling = true;
    this._alertsStatuses = {};

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
      return { error: false, msg: 'No alerts in systemState response' }
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
        type: "Point",
        coordinates: [positions[0], positions[1]] // lon  lat
      }

      const { client } = await this.connectToMongo();

      const query = this.getExtendedSearchQuery({
        detectionType,
        identification,
        position: newPosition,
        maxDistance: detectionType === 'drone' ? 1000 : 200,
      });

      const currentDoc = await this.getCurrentAlert({ client, query })

      const oldPosition = _.get(currentDoc, `position`, {});

      if (this.isPositionEquals({ oldPosition, newPosition })) {
        console.log('positions equals');
        continue
      }

      const timestamp = Date.now();
      const timestampWindow = detectionType === 'drone' ? timestamp + 180000 : timestamp + 360000;

      let set = {
        detectionType,
        [`timestamp`]: timestamp,
        [`position`]: newPosition,
        [`identification`]: identification,
        [`timestampWindow`]: timestampWindow,
      }

      const bot = this._bots[detectionType];
      const longitude = newPosition.coordinates[0]
      const latitude = newPosition.coordinates[1]
      const isEditMessage = currentDoc && currentDoc.liveLocationStarted;

      if (isEditMessage) {
        try {
          await bot.editMessageLiveLocation(
            latitude,
            longitude,
            {
              chat_id: this.chat_id,
              message_id: currentDoc.message_id,
              horizontal_accuracy: 1
            }
          );
          console.log('EDIT', { latitude, longitude });
        } catch (e) {
          console.log('edit errror', e);
        }
      } else {
        try {

          await bot.sendMessage(this.chat_id, this.getWelcomeMessage(detectionType));

          const { message_id } = await bot.sendLocation(
            this.chat_id,
            latitude,
            longitude, {
            live_period: 4000,
            protect_content: true
          });

          set = {
            ...set,
            message_id,
            liveLocationStarted: true,
          }

          console.log('Live location started', { latitude, longitude }, message_id)
        } catch (e) {
          console.error('START LIVE LOCATION FAILED', { latitude, longitude }, e);
        }
      }

      const doc = { $set: set, $addToSet: { detectionIds: [detectionId] } };
      await this.updateCurrentAlert({ client, query, doc })

    }

    this.isPulling = false;

    return { ...alertsStatuses };
  }

  start = async () => {

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



