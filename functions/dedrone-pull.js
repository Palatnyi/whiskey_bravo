import _ from 'lodash';
import axios from 'axios';
import cron from 'node-cron';
import TelegramBot from 'node-telegram-bot-api';
import { MongoClient, ServerApiVersion } from 'mongodb';

class FlightActivityTracker {
  constructor() {
    this._dbCache;
    this.isPulling = false;
    this._dbName = process.env.dbName;
    this._chat_id = process.env.chat_id;
    this._pullUrl = process.env.pullUrl;
    this._mongoUri = process.env.mongoUri;
    this._token = process.env.token;
    this._pullFrequency = process.env.pullFrequency;
    this._collectionName = process.env.collectionName;
    this._deleteFrequency = process.env.deleteFrequency;
    this._maxAlertLifetime = parseInt(process.env.maxAlertLifetime);
    this._maxDroneDistance = parseInt(process.env.maxDroneDistance);
    this._maxRemoteDistance = parseInt(process.env.maxRemoteDistance);
    this._alertHistoryCollection = process.env.alertsHistoryCollection;
    this._maxDroneTimestampWindow = parseInt(process.env.maxDroneTimestampWindow);
    this._maxRemoteTimestampWindow = parseInt(process.env.maxRemoteTimestampWindow);
    this._header = process.env.header;

    this._bots = {
      drone: new TelegramBot(process.env.drone),
      remote: new TelegramBot(process.env.remote)
    };

    this._alertsStatuses = {};
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

  getExtendedSearchQuery = ({ detectionType, identification = {}, position, maxDistance }) => {
    const query = [];
    const keys = ['manufacturer', 'protocol', 'detectionType', 'uuid'];

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

  requestSystemState = async () => {
    let response;
    try {
      console.log('requesting /systemstate...');
      const { data } = await axios.get(this._pullUrl, { headers: { [this._header]: this._token } });
      response = data;
    } catch (e) {
      console.log('error')
      response = { error: true, msg: 'Failed to request API' };
    }

    return response;
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

  getOutdatedDocuments = async ({ client }) => {
    return await client.db(this._dbName).collection(this._collectionName).aggregate([{
      $project: { _id: 0 }
    },
    {
      $addFields: {
        alertLifetime: { $subtract: [Date.now(), '$timestamp'] }
      }
    },
    {
      $match: {
        alertLifetime: { $gt: this._maxAlertLifetime }
      }
    },
    { $project: { alertLifetime: 0 } }
    ]).toArray();
  }

  deleteMany = async ({ client, query = {} }) => {
    let result;

    try {
      console.log('deleting data form the main collection');
      result = await client.db(this._dbName).collection(this._collectionName).deleteMany(query);
    } catch (e) {
      console.log('Failed to delete many documents from the DB');

    }
    
    return result.deletedCount;
  }

  getReplyMarkup = ({ detectionType, latitude, longitude, identification }) => {
    const text = detectionType === 'drone' ? `Дрон 🚨 ${identification.model || ''}` : `Оператор 🥸 ${identification.model || ''}`
    const reply_markup = [[
      {
        text,
        url: `http://www.google.com/maps/place/${latitude},${longitude}`,
        callback_data: 'ololo'
      }
    ]];

    return reply_markup;
  }

  sendLocation = async ({
    latitude,
    longitude,
    detectionType,
    identification,
  }) => {
    const bot = this._bots[detectionType];

    const location = await bot.sendLocation(
      this._chat_id,
      latitude,
      longitude,
      {
        live_period: 4000,
        protect_content: true,
        reply_markup: { inline_keyboard: this.getReplyMarkup({ detectionType, latitude, longitude, identification }) }
      });

    return {
      locationMessageId: location.message_id,
    }
  }


  updateLocation = async ({
    latitude,
    longitude,
    message_id,
    detectionType,
    identification,
  }) => {
    const bot = this._bots[detectionType];

    await bot.editMessageLiveLocation(
      latitude,
      longitude,
      {
        message_id,
        chat_id: this._chat_id,
        horizontal_accuracy: 1,
        reply_markup: { inline_keyboard: this.getReplyMarkup({ detectionType, latitude, longitude, identification }) }
      }
    );

  }

  deleteTelegramMessages = async ({ msgs, detectionType }) => {
    for (let msgId of msgs) {
      try {
        await this._bots[detectionType].deleteMessage(this._chat_id, msgId);
      } catch (e) {
        console.log('Faile to delete msg from telegram:', msgId);
      }
    }
  }

  setAlertStatus = (key, value) => {
    this._alertsStatuses = {
      ...this._alertsStatuses,
      [key]: value
    };
  }

  pullAlerts = async () => {
    if (this.isPulling) {
      return
    }

    console.log('pulling...');

    this.isPulling = true;
    this._alertsStatuses = {};

    let systemState = await this.requestSystemState();

    if (systemState.error) {
      console.log(systemState.msg);
      this.isPulling = false;
      return { ...systemState };
    }

    const alerts = _.get(systemState, 'currentAlertState.alerts', [])

    if (!alerts.length) {
      console.log('No alerts in systemState response');
      this.isPulling = false;
      return { error: false, msg: 'No alerts in systemState response' }
    }

    for (const alert of alerts) {
      const { internalId, detections = [] } = alert;

      if (!detections.length) {
        this.setAlertStatus(internalId, {
          msg: 'no detections in the alert'
        });
        console.log('no detections in the alert');
        continue
      }

      const singleDetection = detections.find(det => det.detectionId === internalId);

      if (!singleDetection) {
        this.setAlertStatus(internalId, {
          msg: 'no singleDetection in the detections array'
        });
        console.log('no singleDetection in the detections array');
        continue
      }

      let { detectionId } = singleDetection;
      let { positions = [] } = singleDetection;
      const { identification } = singleDetection;

      const { detectionType } = identification;

      if (!detectionType) {
        this.setAlertStatus(internalId, {
          msg: 'device not recognized'
        });
        console.log('device (remote/drone) has not been recognised yet');
        continue
      }

      if (!positions.length) {
        this.setAlertStatus(internalId, {
          msg: 'no positions in singleDetection object'
        });
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
        maxDistance: detectionType === 'drone' ? this._maxDroneDistance : this._maxRemoteDistance,
      });

      const currentDoc = await this.getCurrentAlert({ client, query })

      const oldPosition = _.get(currentDoc, `position`, {});

      if (this.isPositionEquals({ oldPosition, newPosition })) {
        console.log('positions equals');
        continue
      }

      const timestamp = Date.now();
      const timestampWindow = detectionType === 'drone' ? timestamp + this._maxDroneTimestampWindow : timestamp + this._maxRemoteTimestampWindow;

      let set = {
        detectionType,
        [`timestamp`]: timestamp,
        [`position`]: newPosition,
        [`identification`]: identification,
        [`timestampWindow`]: timestampWindow,
      }

      const longitude = newPosition.coordinates[0]
      const latitude = newPosition.coordinates[1]

      if (currentDoc && currentDoc.liveLocationStarted) {
        try {
          await this.updateLocation({
            latitude,
            longitude,
            detectionType,
            identification,
            protect_content: true,
            message_id: currentDoc.message_id
          });
          console.log('EDIT', { latitude, longitude });
        } catch (e) {
          console.log('edit errror', e);
        }
      } else {
        try {
          const { locationMessageId } = await this.sendLocation({
            latitude,
            longitude,
            detectionType,
            identification,
          });

          set.message_id = locationMessageId;
          set.liveLocationStarted = true;
          set.messagesIds = [locationMessageId];

          console.log('Live location started', { latitude, longitude }, locationMessageId)
        } catch (e) {
          console.error('START LIVE LOCATION FAILED', { latitude, longitude }, e);
        }
      }

      const doc = { $set: set, $addToSet: { detectionIds: detectionId } };
      await this.updateCurrentAlert({ client, query, doc });

    }

    this.isPulling = false;

    return { ...this._alertsStatuses };
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

    if (this._deteleTask) {
      this._deteleTask.stop();
    }
  }

  mergeAlertsHistory = async ({ client }) => {
    try {
      console.log('persisting data to the history collection');
      const result = await client.db(this._dbName).collection(this._collectionName).aggregate([{
        $merge: {
          on: '_id',
          into: this._alertHistoryCollection,
          whenMatched: 'replace',
          whenNotMatched: 'insert'
        }
      }]);

      return result.toArray();
    } catch (e) {
      console.log('Failed to persist data to the history collection', e);
    }
  }

  getAlertsHistory = async ({ client, stages = [] }) => {
    const result = await client.db(this._dbName).collection(this._alertHistoryCollection).find({});

    return result.toArray();
  }

  dropHistoryCollection = async ({ client }) => {
    let result;

    try {
      console.log('deleting data form the main collection');
      result = await client.db(this._dbName).collection(this._alertHistoryCollection).drop();
    } catch (e) {
      console.log('Failed to delete many documents from the DB');

    }
    
    return result;
  }

  saveHistory = async () => {
    this._deteleTask = cron.schedule(this._deleteFrequency, async () => {
      const { client } = await this.connectToMongo();
      await this.mergeAlertsHistory({ client });
      await this.deleteMany({ client });
    });
  }
}

export default FlightActivityTracker



