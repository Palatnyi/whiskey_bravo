import mocha from 'mocha';
import assert from 'node:assert';
import { MongoClient, ServerApiVersion } from 'mongodb';

import dedronePull from './dedrone-pull.js';

const { connectToMongo, mongoUri, getCollection, dedroneToken, pullUrl, requestSystemState, closeConnection, getDBCache,
  setDBCache } = dedronePull;

const dbName = 'dedrone';
const collectionName = 'alertsTest';

describe('dedron-pull.js', async () => {
  it('connectToMongo', async () => {
    let cache = getDBCache()
    assert.equal(cache, undefined);

    const { client } = await connectToMongo(mongoUri);
    assert.equal(client.constructor.name, 'MongoClient');

    cache = getDBCache()
    assert.ok(cache);
    assert.ok(cache.client);
    assert.equal(cache.client.constructor.name, 'MongoClient');

    await closeConnection();
  });

  it('getCollection', async () => {
    const { client } = await connectToMongo(mongoUri);
    assert.equal(client.constructor.name, 'MongoClient');
  
    const collection = await getCollection(client, dbName, collectionName);
    assert.equal(collection.collectionName, collectionName);
  });


  it('requestSystemState. No error', async () => {
    let systemState = await requestSystemState({ url: pullUrl, token: dedroneToken });
    assert.equal(systemState.error, undefined)
  });

  it('requestSystemState. Failed to request DD API', async () => {
    let systemState = await requestSystemState({ url: 'http://localhost:3000/ololo', token: 'ololo' });
    assert.equal(systemState.error, true)
  });












});

