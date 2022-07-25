const connect = require('./mongod_connect');
const { get: _get, uniqWith: _uniqWith, isEqual: _isEqual } = require('lodash');

const startJson = require('../testPositionsStart.json');
const updateJson = require('../testPositionsUpdate.json')[0];


const runApp = async (client) => {
  const collection = await client.db("dedrone").collection('incomingPositions');

  watchIncomingPositionsCollection(collection);

  const alertId = _get(startJson, 'data.alertId');
  const alertState = _get(startJson, 'data.alertState');
  const detections = _get(updateJson, 'data.detections', []);
  const uniqPositions = selectUniqPositions(detections);
  const insertDoc = {
    $set: {
      alertId,
      alertState,
      uniqPositions
    }
  };

  try {
    setTimeout( async () => { 
      await collection.updateOne({ alertId }, insertDoc, { upsert: true });
      const updateDoc = {
        $set: {
          alertId,
          alertState,
          uniqPositions: {
            ...uniqPositions,
            'dron': [1,2,3]
          }
        }
      };
      await collection.updateOne({ alertId }, updateDoc, { upsert: true });

    }, 0)
  } catch (err) { 
    console.log(err);
  }

  console.log(uniqPositions);


}

const selectUniqPositions = (detections) => {
  let result = {};

  detections.forEach(({ positions = [], detectionType, positionState }) => {
    let data = _uniqWith(positions, (arg1, arg2) => {

      const pos1 = {
        latitude: arg1.latitude.toFixed(4),
        longitude: arg1.longitude.toFixed(4)
      };
      const pos2 = {
        latitude: arg2.latitude.toFixed(4),
        longitude: arg2.longitude.toFixed(4)
      }

      return _isEqual(pos1, pos2);
    });


    data = data.map(position => {
      return {
        ...position,
        latitude: parseFloat(position.latitude.toFixed(4)),
        longitude: parseFloat(position.longitude.toFixed(4))
      };
    });

    result[detectionType] = { data, positionState }
  });

  return result;
}


const watchIncomingPositionsCollection = (collection) => {
  const changeStream = collection.watch();
  changeStream.on('change', async (next) => {
    if (next.operationType === 'delete') return; 
    console.log("CHANGE STREAM", next);
    console.log(next);
  });
}

connect(runApp);
