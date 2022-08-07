import sinon from 'sinon';
import mocha from 'mocha';
import assert from 'node:assert';
import { MongoClient, ServerApiVersion } from 'mongodb';

import FlightActivityTracker from './dedrone-pull.js';
import pulledAlertsTest from '../pulledAlertsTest.json' assert { type: 'json'};

const dbName = 'dedrone';
const collectionName = 'alertsTest';

describe('dedron-pull.js', async () => {
  let flt;
  const sandbox = sinon.createSandbox();

  beforeEach('new FlightActivityTracker', () => {
    flt = new FlightActivityTracker();
  })

  afterEach(() => {
    sandbox.restore();
    flt = null;
  });

  it('connectToMongo', async () => {
    let cache = flt.getDBCache();
    assert.equal(cache, undefined);

    const { client } = await flt.connectToMongo();
    assert.equal(client.constructor.name, 'MongoClient');

    cache = flt.getDBCache()
    assert.ok(cache);
    assert.ok(cache.client);
    assert.equal(cache.client.constructor.name, 'MongoClient');

    return await flt.closeConnection();

  });

  it('getCollection', async () => {
    const { client } = await flt.connectToMongo();
    assert.equal(client.constructor.name, 'MongoClient');

    const collection = await flt.getCollection(client, dbName, collectionName);
    assert.equal(collection.collectionName, collectionName);
    return await flt.closeConnection();
  });

  it('requestSystemState. Succeded to request DD API', async () => {
    let systemState = await flt.requestSystemState();
    assert.equal(systemState.error, undefined)
  });

  it('requestSystemState. Failed to request DD API', async () => {
    let systemState = await flt.requestSystemState({ url: 'http://localhost:3000/ololo', token: 'ololo' });
    assert.equal(systemState.error, true)
  });

  it('pullAlerts. No alerts in the systemState response', async () => {
    const systemState = { data: { currentAlertState: { alerts: [] } } }

    sinon.replace(flt, "requestSystemState", sinon.fake(() => systemState));

    const result = await flt.pullAlerts();
    assert.equal(flt.isPulling, false);
    assert.equal(result.msg, 'No alerts in systemState response');

  });

  it('pullAlert. Detectionsarray is empty within requestSystemState response', async () => {
    const systemState = {
      data: {
        currentAlertState: {
          alerts: [{
            "internalId": 123,
            "detections": []
          }]
        }
      }
    };

    sinon.replace(flt, "requestSystemState", sinon.fake(() => systemState));
    flt.setCollectionName('alertsTest');
    const result = await flt.pullAlerts();
    assert.equal(result['123'].msg, 'no detections in the alert');

  });


  it('pullAlert. Detections array does not have detecteion related to current alert', async () => {
    const systemState = {
      data: {
        currentAlertState: {
          alerts: [{
            "internalId": 123,
            "detections": [{
              detectionId: 321
            }]
          }]
        }
      }
    };

    sinon.replace(flt, "requestSystemState", sinon.fake(() => systemState));
    flt.setCollectionName('alertsTest');
    const result = await flt.pullAlerts();
    assert.equal(result['123'].msg, 'no singleDetection in the detections array');

  });

  it('pullAlert. Detections array does not have detecteion related to current alert', async () => {
    const systemState = {
      data: {
        currentAlertState: {
          alerts: [{
            "internalId": 123,
            "detections": [{
              detectionId: 321
            }]
          }]
        }
      }
    };

    sinon.replace(flt, "requestSystemState", sinon.fake(() => systemState));
    flt.setCollectionName('alertsTest');
    const result = await flt.pullAlerts();
    assert.equal(result['123'].msg, 'no singleDetection in the detections array');

  });

  it('pullAlert. detectionType(remoote/drone) within one singleDetection has not been recognized', async () => {
    const systemState = {
      data: {
        currentAlertState: {
          alerts: [{
            "internalId": 123,
            "detections": [{
              detectionId: 123, 
              "identification": {}
            }]
          }]
        }
      }
    };

    sinon.replace(flt, "requestSystemState", sinon.fake(() => systemState));
    flt.setCollectionName('alertsTest');
    const result = await flt.pullAlerts();
    assert.equal(result['123'].msg, 'device (remote/drone) not recognized');

  });


  it('pullAlert. Positions array within singleDetection object is empty', async () => {
    const systemState = {
      data: {
        currentAlertState: {
          alerts: [{
            "internalId": 123,
            "detections": [{
              detectionId: 123, 
              "identification": {
                'detectionType': 'remote'
              }
            }]
          }]
        }
      }
    };

    sinon.replace(flt, "requestSystemState", sinon.fake(() => systemState));
    flt.setCollectionName('alertsTest');
    const result = await flt.pullAlerts();
    assert.equal(result['123'].msg, 'no positions in singleDetection object');

  });

});

