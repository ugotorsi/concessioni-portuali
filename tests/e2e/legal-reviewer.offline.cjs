const fs = require("node:fs");
const net = require("node:net");
const http = require("node:http");
const https = require("node:https");
const { syncBuiltinESMExports } = require("node:module");

function denyNetwork() {
  throw new Error("REVIEWER_OFFLINE_NETWORK_BLOCKED");
}

function protectRead(target, method) {
  const original = target[method];
  target[method] = function (filename, ...args) {
    if (/(^|[\\/])\.env(?:[.\\/]|$)/i.test(String(filename))) {
      throw new Error("REVIEWER_ENV_READ_BLOCKED");
    }
    return original.call(this, filename, ...args);
  };
}

for (const method of ["readFile", "readFileSync", "open", "openSync", "createReadStream"]) protectRead(fs, method);
for (const method of ["readFile", "open"]) protectRead(fs.promises, method);
net.connect = denyNetwork;
net.createConnection = denyNetwork;
net.Socket.prototype.connect = denyNetwork;
http.request = denyNetwork;
http.get = denyNetwork;
https.request = denyNetwork;
https.get = denyNetwork;
globalThis.fetch = async () => denyNetwork();
syncBuiltinESMExports();