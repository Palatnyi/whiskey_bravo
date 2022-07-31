const axios = require('axios');
const updateJson = require('../testPositionsUpdate_4.json');

let index = 2700;
// updateJson[index].data.alertState = 'start';
const intervalId = setInterval(() => {
  if (index === updateJson.length) {
    clearInterval(intervalId);
  } else {
    axios.post('http://localhost:3000/dedrone', updateJson[index]);
    // axios.post('http://localhost:5001/dedrone', updateJson[index]);
    console.log(index)
    
    index += 1;

  }
}, 100);
