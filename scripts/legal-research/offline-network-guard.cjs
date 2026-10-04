const net = require("node:net");
const tls = require("node:tls");
const http = require("node:http");
const https = require("node:https");
const dns = require("node:dns");
const dgram = require("node:dgram");

function denyNetwork() {
  throw new Error("OFFLINE_NETWORK_FORBIDDEN");
}

net.connect = denyNetwork;
net.createConnection = denyNetwork;
net.Socket.prototype.connect = denyNetwork;
tls.connect = denyNetwork;
http.request = denyNetwork;
http.get = denyNetwork;
https.request = denyNetwork;
https.get = denyNetwork;
dgram.Socket.prototype.send = denyNetwork;
for (const method of Object.keys(dns)) {
  if (method === "lookup" || method === "lookupService" || method.startsWith("resolve") || method === "reverse") {
    if (typeof dns[method] === "function") dns[method] = denyNetwork;
    if (typeof dns.promises[method] === "function") dns.promises[method] = async () => denyNetwork();
  }
}
globalThis.fetch = async () => denyNetwork();
require("node:module").syncBuiltinESMExports();