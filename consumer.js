const amqp = require("amqplib/callback_api");
const axios = require("axios");
var FormData = require("form-data");
const fs = require("fs");
const { WebSocket, WebSocketServer } = require("ws");

const wss = new WebSocketServer({
  host: "localhost",
  port: 8080,
});
let rooms = {};
wss.on("connection", function connection(ws) {
  ws.on("error", console.error);

  ws.on("message", function incoming(data) {
    const obj = JSON.parse(data);
    const type = obj.type;
    const params = obj.params;
    switch (type) {
      case "create":
        create(params);
        break;
      case "response":
        response(params);
        break;
      default:
        console.warn(`Type: ${type} unknown`);
        break;
    }
  });
  function create(params) {
    const room = params.room;
    rooms[room] = [ws];
    ws["room"] = room;
  }
  function response(params) {
    const room = params.room;
    const data = params;
    console.log(params);
    rooms[room].forEach((cl) => cl.send(JSON.stringify(data)));
  }
});

const ws = new WebSocket("ws://localhost:8080");

amqp.connect("amqp://localhost", (error0, connection) => {
  if (error0) {
    throw error0;
  }
  connection.createChannel((error1, channel) => {
    if (error1) {
      throw error1;
    }
    const queue = "rpc_queue";

    channel.assertQueue(queue, { durable: false });

    channel.prefetch(1);

    console.log(" [x] Awaiting RPC requests");

    channel.consume(queue, function reply(msg) {
      const encodedImage = JSON.parse(msg.content.toString());

      const formData = new FormData();
      formData.append("", fs.createReadStream(encodedImage.path));

      const config = {
        method: "post",
        maxBodyLength: Infinity,
        url: "http://localhost:32168/v1/vision/detection",
        headers: {
          "content-type": "multipart/form-data",
        },
        data: formData,
      };

      const describeImage = async () => {
        const response = await axios(config);
        const { data } = response;

        let labelStats = {};
        for (let prediction of data.predictions) {
          if (prediction.label in labelStats) {
            labelStats[prediction.label].sumConfidence += prediction.confidence;
            labelStats[prediction.label].count++;
            labelStats[prediction.label].averageConfidence =
              labelStats[prediction.label].sumConfidence /
              labelStats[prediction.label].count;
          } else {
            labelStats[prediction.label] = {
              sumConfidence: prediction.confidence,
              count: 1,
              averageConfidence: prediction.confidence,
            };
          }
        }

        // Créer l'objet final avec une clé "result" pour les résultats
        let finalObj = {
          type: "response",
          params: {
            room: encodedImage.wsRoom,
            result: labelStats,
            fileId: encodedImage.fileId,
            path: encodedImage.imagePath,
          },
        };

        // Afficher les résultats
        const resp = JSON.stringify(finalObj);

        ws.send(resp);
      };
      describeImage();

      channel.ack(msg);
    });
  });
});
