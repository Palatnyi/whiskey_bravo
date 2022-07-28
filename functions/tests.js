const axios = require('axios');
const updateJson = require('../testPositionsUpdate_4.json');

let index = 2700;
updateJson[2700].data.alertState = 'start';
const intervalId = setInterval(() => {
  if (index === updateJson.length) {
    clearInterval(intervalId);
  } else {
    // axios.post('http://localhost:5001/whiskeybravo-9aa4d/us-central1/app/dedrone', updateJson[index]);
    axios.post('http://localhost:5001/dedrone', updateJson[index]);
    console.log(index)
    
    index += 1;

  }
}, 100);
