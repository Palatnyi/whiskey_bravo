const axios = require('axios');
const updateJson = require('../testPositionsUpdate_4.json');
const randomAlerts = require('../randomAlerts.json');


let index = 2700;
let j = 0;
// updateJson[index].data.alertState = 'start';
const intervalId = setInterval(() => {
  if (index === updateJson.length || j === randomAlerts.length) {
    clearInterval(intervalId);
  } else {
    //axios.post('https://whiskeybravo.online/dedrone', updateJson[index]);
    // axios.post('http://localhost:3000/dedrone', updateJson[index]);
    axios.post('http://localhost:3000/dedrone', randomAlerts[j]);

    console.log(index)
    j += 1;
    index += 1;

  }
}, 100);


// const geolib = require('geolib');

// console.log(geolib.getDistance({
//   longitude: 22.6965502,
//   latitude: 48.4355967
// }, {
//   "longitude": 22.6929349,
//   "latitude": 48.4339237,
// }));


