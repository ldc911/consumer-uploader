import amqp from "amqplib/callback_api";
import axios from "axios";
import FormData from "form-data";
import fs from "fs";
import { WebSocket, WebSocketServer } from "ws";

const wss = new WebSocketServer({ host: "localhost", port: 8080 });
