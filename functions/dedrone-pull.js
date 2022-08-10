import _ from 'lodash';
import cors from 'cors';
import axios from 'axios';
import cron from 'node-cron';
import express from 'express';
import TelegramBot from 'node-telegram-bot-api';
import { MongoClient, ServerApiVersion } from 'mongodb';

class FlightActivityTracker {
  constructor() {
    this._dbCache;
    this.isPulling = false;
    this._dbName = process.env.dbName;
    this._collectionName = process.env.collectionName
    this.chat_id = process.env.chat_id;
    this._pullFrequency = process.env.pullFrequency;
    this._dedroneToken = process.env.dedroneToken;
    this._pullUrl = process.env.pullUrl;
    this._mongoUri = process.env.mongoUri;;

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

  sendLocation = async ({
    latitude,
    longitude,
    detectionType,
  }) => {
    const bot = this._bots[detectionType];
    await bot.sendMessage(this.chat_id, this.getWelcomeMessage(detectionType));

    return await bot.sendLocation(
      this.chat_id,
      latitude,
      longitude, {
      live_period: 4000,
      protect_content: true
    });
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
        chat_id: this.chat_id,
        horizontal_accuracy: 1
      }
    );

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

    let alertsStatuses = {};

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
          const { message_id } = await this.sendLocation({
            latitude,
            longitude,
            detectionType,
          });

          set.message_id = message_id;
          set.liveLocationStarted = true;

          console.log('Live location started', { latitude, longitude }, message_id)
        } catch (e) {
          console.error('START LIVE LOCATION FAILED', { latitude, longitude }, e);
        }
      }

      const doc = { $set: set, $addToSet: { detectionIds: [detectionId] } };
      await this.updateCurrentAlert({ client, query, doc })

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
  }
}

export default FlightActivityTracker



