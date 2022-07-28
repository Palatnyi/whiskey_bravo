const { MongoClient, ServerApiVersion } = require('mongodb');

module.exports = function connect(callback) {

  const uri = "mongodb+srv://m001-student:m001-mongodb-basics@sandbox.wiznw.mongodb.net/?retryWrites=true&w=majority";
  const client = new MongoClient(uri, { useNewUrlParser: true, useUnifiedTopology: true, serverApi: ServerApiVersion.v1 });
  client.connect(err => {
    if (err) { 
      console.log('ERROR CONNECT To MONGODB');
      return;
    }

    console.log('CONNECTED TO MONGO DB');

    callback && callback(client);
    // const collection = client.db("dedrone").collection('sdf').deleteMany;
    // const changeStream = collection.watch({ fullDocument: "updateLookup" });

// 
    // client.close();
  });

  return {
    client
  }
}

