const amqp = require("amqplib/callback_api");
const axios = require("axios");
var FormData = require("form-data");
const fs = require("fs");
const { WebSocket, WebSocketServer } = require("ws");

const wss = new WebSocketServer({
  host: "localhost",
  port: 8080,
});

wss.broadcast = function broadcast(data) {
  wss.clients.forEach(function each(client) {
    if (client.readyState == WebSocket.OPEN && data != undefined)
      client.send(data);
  });
};

wss.on("connection", function connection(ws) {
  ws.on("error", console.error);

  ws.on("message", function incoming(data) {
    // Broadcast to everyone else.
    wss.broadcast(data);
  });
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
        console.log(data);
        // Initialiser l'objet pour stocker la somme et le nombre d'occurrences de chaque label
        let labelStats = {};

        // Boucle pour parcourir chaque élément du tableau
        for (let prediction of data.predictions) {
          // Vérifier si le label est déjà présent dans l'objet
          if (prediction.label in labelStats) {
            // Ajouter la confiance à la somme existante
            labelStats[prediction.label].sumConfidence += prediction.confidence;
            // Incrémenter le nombre d'occurrences existantes
            labelStats[prediction.label].count++;
          } else {
            // Ajouter le label à l'objet avec une somme et un nombre d'occurrences initial de 1
            labelStats[prediction.label] = {
              sumConfidence: prediction.confidence,
              count: 1,
            };
          }
        }

        // Créer un tableau pour stocker les résultats
        let labelArray = [];

        // Boucle pour parcourir chaque label dans l'objet
        for (let label in labelStats) {
          // Créer un objet pour stocker les informations du label
          let labelObj = {};

          // Ajouter le nom du label
          labelObj.label = label;

          // Ajouter le nombre d'occurrences du label
          labelObj.count = labelStats[label].count;

          // Ajouter la moyenne de confiance du label
          labelObj.averageConfidence =
            labelStats[label].sumConfidence / labelStats[label].count;

          // Ajouter l'objet du label au tableau des résultats
          labelArray.push(labelObj);
        }

        // Créer l'objet final avec une clé "result" pour les résultats
        let finalObj = { result: labelArray, fileId: encodedImage.fileId };

        // Afficher les résultats
        console.log(finalObj);

        const resp = JSON.stringify(finalObj);

        ws.send(resp);
      };
      describeImage();

      channel.ack(msg);
    });
  });
});
