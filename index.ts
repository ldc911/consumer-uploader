import amqp from "amqplib/callback_api";
import axios from "axios";
import FormData from "form-data";
import fs, { PathLike } from "fs";
import { WebSocket, WebSocketServer } from "ws";

const wss = new WebSocketServer({ host: "localhost", port: 8080 });

let rooms = {};

interface WSMessage {
  type: string;
  params: Params;
}

interface Params {
  room: string;
  result?: any;
  fileId?: string;
  path?: string;
}

interface RBMessage {
  fileId?: string;
  wsRoom: string;
  imagePath?: string;
  path: PathLike;
}

interface Config {
  method: string;
  maxBodyLength: number;
  url: string;
  headers: any;
  data: any;
}

wss.on("connection", function connection(ws) {
  ws.on("error", console.error);

  ws.on("message", function incoming(data) {
    const obj: WSMessage = JSON.parse(data);
    const type: string = obj.type;
    const params: Params = obj.params;

    switch (type) {
      case "create":
        create(params);
        break;
      case "response":
        response(params);
        break;
      default:
        console.warn(`Unknown type ${type}`);
        break;
    }
  });

  function create(params: Params) {
    const room: string = params.room;
    rooms[room] = [ws];
    ws["room"] = room;
  }

  function response(params: Params) {
    const room: string = params.room;
    const data: Params = params;
    rooms[room].forEach((cl) => cl.send(JSON.stringify(data)));
  }
});

const ws = new WebSocket("ws://localhost:8050");

amqp.connect("amqp://localhost", (error0, connection) => {
  if (error0) {
    throw error0;
  }
  connection.createChannel((error1, channel) => {
    if (error1) {
      throw error1;
    }
    const queue: string = "rpc_queue";

    channel.assertQueue(queue, { durable: false });

    channel.prefetch(1);

    console.log(" [x] Awaiting RPC requests");

    channel.consume(queue, function reply(msg) {
      const encodedImage: RBMessage = JSON.parse(msg.content.toString());
      const formData = new FormData();
      formData.append("", fs.createReadStream(encodedImage.path));

      const config: Config = {
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

        let finalObj: WSMessage = {
          type: "repsonse",
          params: {
            room: encodedImage.wsRoom,
            result: labelStats,
            fileId: encodedImage.fileId,
            path: encodedImage.imagePath,
          },
        };

        const resp = JSON.stringify(finalObj);

        ws.send(resp);
      };

      describeImage();

      channel.ack(msg);
    });
  });
});
