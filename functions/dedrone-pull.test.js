import sinon from 'sinon';
import mocha from 'mocha';
import assert, { doesNotReject } from 'node:assert';
import { MongoClient, ServerApiVersion } from 'mongodb';

import dedronePull from './dedrone-pull.js';
import pulledAlertsTest from '../pulledAlertsTest.json' assert { type: 'json'};


const { connectToMongo, mongoUri, getCollection, dedroneToken, pullUrl, requestSystemState, closeConnection, getDBCache,
  setDBCache, pullAlerts } = dedronePull;

const dbName = 'dedrone';
const collectionName = 'alertsTest';

describe('dedron-pull.js', async () => {
  const sandbox = sinon.createSandbox();

  beforeEach(() => { 

  })

  afterEach(() => {
    sandbox.restore();
  });

  it('connectToMongo', async () => {
    let cache = getDBCache();
    assert.equal(cache, undefined);
    const { client } = await connectToMongo(mongoUri);

    assert.equal(client.constructor.name, 'MongoClient');

    cache = getDBCache()
    assert.ok(cache);
    assert.ok(cache.client);
    assert.equal(cache.client.constructor.name, 'MongoClient');

    return await closeConnection();

  });

  it('getCollection', async () => {
    const { client } = await connectToMongo(mongoUri);
    assert.equal(client.constructor.name, 'MongoClient');
  
    const collection = await getCollection(client, dbName, collectionName);
    assert.equal(collection.collectionName, collectionName);
    return await closeConnection();
  });


  it('requestSystemState. Succeded to request DD API', async () => {
    let systemState = await requestSystemState({ url: pullUrl, token: dedroneToken });
    assert.equal(systemState.error, undefined)
  });

  it('requestSystemState. Failed to request DD API', async () => {
    let systemState = await requestSystemState({ url: 'http://localhost:3000/ololo', token: 'ololo' });
    assert.equal(systemState.error, true)
  });

  it('pullAlerts. No alerts in systemState response', async () => {
    const systemState = { data: { currentAlertState: { alerts: [] } } }
    sinon.replace(dedronePull, "requestSystemState", sinon.fake(() => systemState));
    

    const result = await pullAlerts();
    console.log(result);
    assert.equal(result.error, true);
    assert.equal(result.msg, 'No alerts in systemState response');
  });

});

