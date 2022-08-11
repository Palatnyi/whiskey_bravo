import _ from 'lodash';
import cors from 'cors';
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
    this._dedroneToken = process.env.dedroneToken;
    this._pullFrequency = process.env.pullFrequency;
    this._collectionName = process.env.collectionName;
    this._deleteFrequency = process.env.deleteFrequency;
    this._maxAlertLifetime = parseInt(process.env.maxAlertLifetime);
    this._maxDroneDistance = parseInt(process.env.maxDroneDistance);
    this._maxRemoteDistance = parseInt(process.env.maxRemoteDistance);
    this._maxDroneTimestampWindow = parseInt(process.env.maxDroneTimestampWindow);
    this._maxRemoteTimestampWindow = parseInt(process.env.maxRemoteTimestampWindow);

    console.log(this._maxAlertLifetime, this._maxDroneDistance , this._maxRemoteDistance, this._maxDroneDistance, this._maxDroneTimestampWindow, this._maxRemoteTimestampWindow )


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
    let response;
    try {
      console.log('requesting /systemstate...');
      const { data } = await axios.get(this._pullUrl, { headers: { 'Dedrone-Auth-Token': this._dedroneToken } });
      response = data;
    } catch (e) {
      console.log('error')
      response = { error: true, msg: 'Failed to request dedrone API' };
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
      result = await client.db(this._dbName).collection(this._collectionName).deleteMany(query);
    } catch (e) {
      console.log('Failed to delete many documents from the DB');

    }
    return result.deletedCount;
  }

  sendLocation = async ({
    latitude,
    longitude,
    detectionType,
  }) => {
    const bot = this._bots[detectionType];

    const welcome = await bot.sendMessage(this._chat_id, this.getWelcomeMessage(detectionType));

    const location = await bot.sendLocation(
      this._chat_id,
      latitude,
      longitude, {
      live_period: 4000,
      protect_content: true
    });

    return {
      welcomeMessageId: welcome.message_id,
      locationMessageId: location.message_id,
    }
  }


  updateLocation = async ({
    latitude,
    longitude,
    message_id,
    detectionType,
  }) => {
    const bot = this._bots[detectionType];

    await bot.editMessageLiveLocation(
      latitude,
      longitude,
      {
        message_id,
        chat_id: this._chat_id,
        horizontal_accuracy: 1
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

    let systemState = await this.requestSystemState({ url: this._pullUrl, token: this._dedroneToken });

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
          msg: 'device (remote/drone) not recognized'
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
            message_id: currentDoc.message_id
          });
          console.log('EDIT', { latitude, longitude });
        } catch (e) {
          console.log('edit errror', e);
        }
      } else {
        try {
          const { welcomeMessageId, locationMessageId } = await this.sendLocation({
            latitude,
            longitude,
            detectionType,
          });

          set.message_id = locationMessageId;
          set.liveLocationStarted = true;
          set.messagesIds = [welcomeMessageId, locationMessageId];

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

  runAutoClean = async () => {
    this._deteleTask = cron.schedule(this._deleteFrequency, async () => {
      console.log('delete task is running');
      const { client } = await this.connectToMongo();
      const outDatedAlerts = await this.getOutdatedDocuments({ client });

      if (!outDatedAlerts.length) {
        console.log('no document found for auto delete');
        return;
      }

      let detectionIds = [];
      const msgs = {
        drone: [],
        remote: [],
      }

      for (let alert of outDatedAlerts) {
        detectionIds = detectionIds.concat(alert.detectionIds || [])
        msgs[alert.detectionType] = msgs[alert.detectionType].concat(alert.messagesIds || []);
      }
   
      await this.deleteTelegramMessages({ detectionType: 'drone', msgs: msgs.drone });
      await this.deleteTelegramMessages({ detectionType: 'remote', msgs: msgs.remote });

      const query = {
        detectionIds: {
          $in: detectionIds
        }
      }

      await this.deleteMany({ client, query });
    });
  }
}

export default FlightActivityTracker



