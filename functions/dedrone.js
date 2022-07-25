const connect = require('./mongod_connect');
const { get: _get, uniqWith: _uniqWith, isEqual: _isEqual } = require('lodash');

const startJson = require('../testPositionsStart.json');
const updateJson = require('../testPositionsUpdate.json')[0];


const runApp = async (client) => {
  const incomingPositionsCollection = await client.db("dedrone").collection('incomingPositions');
  const detectionsStatesCollection = await client.db("dedrone").collection('detectionsStatesCollection');

  watchIncomingPositionsCollection(incomingPositionsCollection, detectionsStatesCollection);

  const alertId = _get(startJson, 'data.alertId');
  const alertState = _get(startJson, 'data.alertState');
  const detections = _get(updateJson, 'data.detections', []);
  const uniqPositions = selectUniqPositions(detections, alertState);
  const insertDoc = {
    $set: {
      alertId,
      alertState,
      uniqPositions
    }
  };

  try {
    setTimeout(async () => {
      await incomingPositionsCollection.updateOne({ alertId }, insertDoc, { upsert: true });
      const updateDoc = {
        $set: {
          alertId,
          alertState,
          uniqPositions: {
            ...uniqPositions,
            'dron': [1, 2, 3]
          }
        }
      };
      await incomingPositionsCollection.updateOne({ alertId }, updateDoc, { upsert: true });

    }, 0)
  } catch (err) {
    console.log(err);
  }

  console.log(uniqPositions);


}

const selectUniqPositions = (detections, alertState) => {
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
        longitude: parseFloat(position.longitude.toFixed(4)),
        operation: 'update'
      };
    });

    if (alertState === 'start') {
      data[0].operation = 'start';
    }

    result[detectionType] = { data, positionState }
  });

  return result;
}


const watchIncomingPositionsCollection = (incomingPositionsCollection, detectionsStatesCollection) => {
  const changeStream = incomingPositionsCollection.watch({ fullDocument: "updateLookup" });
  changeStream.on('change', async (changes) => {
    if (changes.operationType === 'delete') return;



    // if (changes.operationType === 'insert') {
    //   const { alertId } = changes.fullDocument;
    //   const result = await detectionsStatesCollection.find({ alertId });
    //   if (!result) { 
    //     await detectionsStatesCollection.find({ alertId });
    //   }

    // }



    console.log("CHANGE STREAM", changes);

  });
}

connect(runApp);
