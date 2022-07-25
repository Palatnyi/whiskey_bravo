process.env.NTBA_FIX_319 = 1
const axios = require('axios');
const TelegramBot = require('node-telegram-bot-api');


let positionIndex = 0;
const chatId = '-1001678724997';
const botToken = '5401170277:AAGXh_DUBGLqJCJAEVVnHDR9LY2KFrbPXng';
const bot = new TelegramBot(botToken);
const positions = [
  {
    latitude: 51.3102056,
    longitude: 9.5363371
  }, {
    "longitude": 9.5363381,
    "latitude": 51.310305,
  }, {
    "longitude": 9.5363128,
    "latitude": 51.3103118,
  }, {
    "longitude": 9.5363103,
    "latitude": 51.3103125,
  }, {
    "longitude": 9.536245,
    "latitude": 51.3106335,
  }];

function sendLocation() {
  const { latitude, longitude } = positions[positionIndex];
  positionIndex += 1;
  return bot.sendLocation(
    chatId,
    latitude,
    longitude,
    {
      live_period: 4000,
      protect_content: true
    }
  )
  // return axios.post('https://api.telegram.org/bot5401170277:AAGXh_DUBGLqJCJAEVVnHDR9LY2KFrbPXng/sendLocation?chat_id=-1001678724997&latitude=51.3102056&longitude=9.5363371&live_period=86400&protect_content=true');
}

function editLocation(response) {
  if (positionIndex === positions.length) return;

  const { message_id, chat: { id: chat_id } } = response;
  const { latitude, longitude } = positions[positionIndex];
  positionIndex += 1;

  console.log("editLocation", latitude, longitude, message_id, chat_id);

  bot.editMessageLiveLocation(
    latitude,
    longitude,
    {
      chat_id,
      message_id,
      horizontal_accuracy: 0
    }
  );

  setTimeout(() => { 
    editLocation(response);
  }, 5000);

  // return function requestInTurn() {
  //   const { longitude, latitude } = positions[index];
  //   index += 1;
  //   if (positions.length === index) return;
  //   console.log(index, positions[index]);
  //   return axios.post(`https://api.telegram.org/bot5401170277:AAGXh_DUBGLqJCJAEVVnHDR9LY2KFrbPXng/editMessageLiveLocation?chat_id=-1001678724997&message_id=${message_id}&latitude=${latitude}&longitude=${longitude}`)
  //     .then(function () {
  //       setTimeout(() => {
  //         requestInTurn();
  //       }, 4000);
  //     }).catch(function (e) {
  //       console.log(e);
  //     })
  // }
}

sendLocation()
  .then(function (response) {
    // const { data: { result } } = response;
    console.log(response);
    return editLocation(response);
  })