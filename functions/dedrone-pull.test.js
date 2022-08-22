import mocha from 'mocha';
import sinon from 'sinon';
import assert from 'node:assert';
import FlightActivityTracker from './dedrone-pull.js';

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

  it('pullAlerts. No alerts in the systemState response', async () => {
    const systemState = { data: { currentAlertState: { alerts: [] } } }

    sinon.replace(flt, "requestSystemState", sinon.fake(() => systemState));

    const result = await flt.pullAlerts();
    assert.equal(flt.isPulling, false);
    assert.equal(result.msg, 'No alerts in systemState response');

  });

  it('pullAlert. Detections array is empty within requestSystemState response', async () => {
    const systemState = {
      currentAlertState: {
        alerts: [{
          "internalId": 123,
          "detections": []
        }]
      }
    };

    sinon.replace(flt, "requestSystemState", sinon.fake(() => systemState));
    const result = await flt.pullAlerts();
    console.log(result)

    assert.equal(result['123'].msg, 'no detections in the alert');

  });


  it('pullAlert. Detections array does not have detecteion related to current alert', async () => {
    const systemState = {
      currentAlertState: {
        alerts: [{
          "internalId": 123,
          "detections": [{
            detectionId: 321
          }]
        }]
      }
    };

    sinon.replace(flt, "requestSystemState", sinon.fake(() => systemState));
    const result = await flt.pullAlerts();
    assert.equal(result['123'].msg, 'no singleDetection in the detections array');

  });

  it('pullAlert. Detections array does not have detecteion related to current alert', async () => {
    const systemState = {
      currentAlertState: {
        alerts: [{
          "internalId": 123,
          "detections": [{
            detectionId: 321
          }]
        }]
      }
    };

    sinon.replace(flt, "requestSystemState", sinon.fake(() => systemState));
    const result = await flt.pullAlerts();
    assert.equal(result['123'].msg, 'no singleDetection in the detections array');

  });

  it('pullAlert. detectionType(remoote/drone) within one singleDetection has not been recognized', async () => {
    const systemState = {
      currentAlertState: {
        alerts: [{
          "internalId": 123,
          "detections": [{
            detectionId: 123,
            "identification": {}
          }]
        }]
      }
    };

    sinon.replace(flt, "requestSystemState", sinon.fake(() => systemState));
    flt.setCollectionName('alertsTest');
    const result = await flt.pullAlerts();
    assert.equal(result['123'].msg, 'device not recognized');

  });


  it('pullAlert. Positions array within singleDetection object is empty', async () => {
    const systemState = {
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
    };

    sinon.replace(flt, "requestSystemState", sinon.fake(() => systemState));
    const result = await flt.pullAlerts();
    assert.equal(result['123'].msg, 'no positions in singleDetection object');

  });

  it('getExtendedSearchQuery. Should FIND drone that is IN coverage area and valid timeStampWindow', async () => {
    const detectionType = 'drone'
    const timestamp1 = Date.now() - 1000;
    const timestampWindow1 = timestamp1 + 180000;

    const currentDrone = {
      detectionType,
      detectionId: 123,
      timestamp: timestamp1,
      timestampWindow: timestampWindow1,
      identification: {
        detectionType: 'drone',
        model: 'ololo',
        manufacturer: 'ololo2'
      },
      position: {
        type: 'Point',
        coordinates: [50.427697259464914, 30.526436929567698]
      }
    }

    const identification = {
      model: 'ololo',
      manufacturer: 'ololo2',
      detectionType: 'drone',
    }

    const testPosition = {
      type: 'Point',
      'coordinates': [50.42760035064982, 30.526688298227718]
    }

    const query = flt.getExtendedSearchQuery({ detectionType, identification, position: testPosition, maxDistance: 100 });

    const { client } = await flt.connectToMongo();

    await flt.updateCurrentAlert({ client, query, doc: { $set: currentDrone } });
    const currentDroneDoc = await flt.getCurrentAlert({ client, query });
    assert.equal(currentDroneDoc.detectionId, 123)

    const deleteCount = await flt.deleteMany({ client });
    assert.equal(deleteCount, 1);

    await flt.closeConnection();
  });

  it('getExtendedSearchQuery. Should NOT FIND drone that is not in coverage area and valid timeStampWindow', async () => {
    const detectionType = 'drone'
    const timestamp2 = Date.now();
    const timestampWindow2 = timestamp2 + 180000;

    const newDrone = {
      detectionType,
      detectionId: 321,
      timestamp: timestamp2,
      timestampWindow: timestampWindow2,
      identification: {
        detectionType: 'drone',
        model: 'ololo',
        manufacturer: 'ololo2'
      },
      position: {
        type: 'Point',
        coordinates: [50.42887243134674, 30.52845753933213]
      }
    }

    const identification = {
      model: 'ololo',
      manufacturer: 'ololo2',
      detectionType: 'drone',
    }

    const testPosition = {
      type: 'Point',
      'coordinates': [50.42760035064982, 30.526688298227718]
    }

    const query = flt.getExtendedSearchQuery({ detectionType, identification, position: testPosition, maxDistance: 100 });

    const { client } = await flt.connectToMongo();

    await flt.updateCurrentAlert({ client, query, doc: { $set: newDrone } });
    const newDroneDoc = await flt.getCurrentAlert({ client, query });
    assert.equal(newDroneDoc, undefined);

    const deleteCount = await flt.deleteMany({ client });
    assert.equal(deleteCount, 1);

    await flt.closeConnection();

  })

  it('getExtendedSearchQuery. Should NOT GET any document due to invalid timeStampWindow', async () => {
    const detectionType = 'drone'
    const timestamp1 = Date.now() - 1000;
    const timestampWindow1 = timestamp1 - 180000;

    const currentDrone = {
      detectionType,
      detectionId: 123,
      timestamp: timestamp1,
      timestampWindow: timestampWindow1,
      identification: {
        detectionType: 'drone',
        model: 'ololo',
        manufacturer: 'ololo2'
      },
      position: {
        type: 'Point',
        coordinates: [50.427697259464914, 30.526436929567698]
      }
    }

    const identification = {
      model: 'ololo',
      manufacturer: 'ololo2',
      detectionType: 'drone',
    }

    const testPosition = {
      type: 'Point',
      'coordinates': [50.42760035064982, 30.526688298227718]
    }

    const query = flt.getExtendedSearchQuery({ detectionType, identification, position: testPosition, maxDistance: 100 });

    const { client } = await flt.connectToMongo();

    await flt.updateCurrentAlert({ client, query, doc: { $set: currentDrone } });
    const currentDroneDoc = await flt.getCurrentAlert({ client, query });
    assert.equal(currentDroneDoc, undefined);

    const deleteCount = await flt.deleteMany({ client });
    assert.equal(deleteCount, 1);
    await flt.closeConnection();
  });


  it('getExtendedSearchQuery. Should  GET alert with empty identificaction prop  and valid timeStampWindow and valid coverage area', async () => {
    const detectionType = 'drone';
    const timestamp1 = Date.now() - 1000;
    const timestampWindow1 = timestamp1 + 180000;

    const currentDrone = {
      detectionType,
      detectionId: 123,
      timestamp: timestamp1,
      timestampWindow: timestampWindow1,
      position: {
        type: 'Point',
        coordinates: [50.427697259464914, 30.526436929567698]
      }
    }

    const identification = {
      model: 'ololo',
      manufacturer: 'ololo2',
      detectionType: 'drone',
    }

    const testPosition = {
      type: 'Point',
      'coordinates': [50.42760035064982, 30.526688298227718]
    }

    const query = flt.getExtendedSearchQuery({ detectionType, identification, position: testPosition, maxDistance: 100 });

    const { client } = await flt.connectToMongo();

    await flt.updateCurrentAlert({ client, query, doc: { $set: currentDrone } });
    const currentDroneDoc = await flt.getCurrentAlert({ client, query });
    assert.equal(currentDroneDoc.detectionId, 123)

    const deleteCount = await flt.deleteMany({ client });

    assert.equal(deleteCount, 1);

    await flt.closeConnection();
  });


  it('getExtendedSearchQuery. Should NOT GET alert with different identificaction prop(manufacturer) and valid timeStampWindow and valid coverage area', async () => {
    const detectionType = 'drone'
    const timestamp1 = Date.now() - 1000;
    const timestampWindow1 = timestamp1 + 180000;

    const currentDrone = {
      detectionType,
      detectionId: 123,
      timestamp: timestamp1,
      timestampWindow: timestampWindow1,
      identification: {
        detectionType: 'drone',
        model: 'ololo',
        manufacturer: 'ololo2'
      },
      position: {
        type: 'Point',
        coordinates: [50.427697259464914, 30.526436929567698]
      }
    }

    const identification = {
      model: 'ololo',
      manufacturer: 'ololo111lolol11',
      detectionType: 'drone',
    }

    const testPosition = {
      type: 'Point',
      'coordinates': [50.42760035064982, 30.526688298227718]
    }

    const query = flt.getExtendedSearchQuery({ detectionType, identification, position: testPosition, maxDistance: 100 });

    const { client } = await flt.connectToMongo();

    await flt.updateCurrentAlert({ client, query, doc: { $set: currentDrone } });
    const currentDroneDoc = await flt.getCurrentAlert({ client, query });
    assert.equal(currentDroneDoc, undefined)

    const deleteCount = await flt.deleteMany({ client });

    assert.equal(deleteCount, 1);

    await flt.closeConnection();
  });

  it('mergeAlertsHistory. Should transfer data to the history collection', async () => {
    const oneHour5min = (1000 * 60 * 60) + (1000 * 60 * 5);
    const timestamp1 = Date.now() - oneHour5min;
    const timestampWindow1 = timestamp1 + 180000;

    const outdatedDoc1 = {
      detectionType: 'remote',
      detectionId: 333,
      timestamp: timestamp1,
      timestampWindow: timestampWindow1,
      identification: {
        detectionType: 'drone',
        model: 'ololo',
        manufacturer: 'ololo2'
      },
      position: {
        type: 'Point',
        coordinates: [50.427697259464914, 30.526436929567698]
      }
    }

    const oneHour5seconds = (1000 * 60 * 60) + 5000
    const timestamp2 = Date.now() - oneHour5seconds;
    const timestampWindow2 = timestamp1 + 190000;
    const outdatedDoc2 = {
      detectionType: 'drone',
      detectionId: 123,
      timestamp: timestamp2,
      timestampWindow: timestampWindow2,
      identification: {
        detectionType: 'drone',
        model: 'ololo',
        manufacturer: 'ololo2'
      },
      position: {
        type: 'Point',
        coordinates: [50.427697259464914, 30.526436929567698]
      }
    }

    const timestamp3 = Date.now();
    const timestampWindow3 = timestamp3 + 190000;
    const validDoc = {
      detectionType: 'drone',
      detectionId: 1243,
      timestamp: timestamp3,
      timestampWindow: timestampWindow3,
      identification: {
        detectionType: 'drone',
        model: 'ololo',
        manufacturer: 'ololo2'
      },
      position: {
        type: 'Point',
        coordinates: [50.427697259464914, 30.526436929567698]
      }
    }

    const { client } = await flt.connectToMongo();
    await flt.deleteMany({ client });

    await flt.updateCurrentAlert({ client, query: { detectionId: outdatedDoc1.detectionId }, doc: { $set: outdatedDoc1, $addToSet: { detectionIds: outdatedDoc1.detectionId } } });
    await flt.updateCurrentAlert({ client, query: { detectionId: outdatedDoc2.detectionId }, doc: { $set: outdatedDoc2, $addToSet: { detectionIds: outdatedDoc2.detectionId } } });
    await flt.updateCurrentAlert({ client, query: { detectionId: validDoc.detectionId }, doc: { $set: validDoc, $addToSet: { detectionIds: validDoc.detectionId } } });

    await flt.mergeAlertsHistory({ client });
    
    const result = await flt.getAlertsHistory({ client });
    assert.equal(result.length, 3);
    
    const dropResult = await flt.dropHistoryCollection({ client });
    assert.equal(dropResult, true);

    await flt.deleteMany({ client });

  });
});



