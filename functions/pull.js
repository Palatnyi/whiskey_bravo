import FlightActivityTracker from './dedrone-pull.js';

console.log('ENV:', process.env.currentEnv);

const app = new FlightActivityTracker();

app.start();
app.runAutoClean();
