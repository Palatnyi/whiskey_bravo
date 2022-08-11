import cors from 'cors';
import express from 'express';
import FlightActivityTracker from './dedrone-pull.js';
import pulledAlertsTest from '../pulledAlertsTest.json' assert { type: 'json'};

console.log('ENV', process.env.currentEnv);

const app = express();
const flt = new FlightActivityTracker();

app.use(express.json());
app.use(cors({ origin: true }));

let i = 0;
app.get('/test-pull', async (req, res) => {
  res.send({ currentAlertState: { alerts: pulledAlertsTest[i].alerts } });
  i += 1;
});

app.listen(3000, async () => {
  console.log('Listening on PORT', 3000);
  flt.start();
  flt.runAutoClean();
});