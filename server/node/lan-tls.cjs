// HTTPS in front of the Risu server for phones on the LAN.
//
// Safari and Chrome only give a page crypto.subtle on HTTPS (or localhost). Over http://<lan-ip>:6001 the
// phone dies at login with "undefined is not an object (evaluating 'crypto.subtle.generateKey')".
// This listens with TLS and pipes the raw bytes to the plain HTTP server, so http://localhost:6001 on the
// Mac keeps working untouched. It does not read or change the traffic; Risu still checks its own token.
//
//   node server/node/lan-tls.cjs
//   phone: https://<mac-lan-ip>:6443   (accept the certificate warning once)
//
// Certificate: ~/.risu-lan/cert.pem + key.pem (override with RISU_LAN_CERT_DIR). Env: LAN_TLS_PORT, RISU_PORT.

const tls = require('tls');
const net = require('net');
const fs = require('fs');
const os = require('os');
const path = require('path');

const certDir = process.env.RISU_LAN_CERT_DIR || path.join(os.homedir(), '.risu-lan');
const listenPort = Number(process.env.LAN_TLS_PORT) || 6443;
const risuPort = Number(process.env.RISU_PORT) || 6001;

const server = tls.createServer({
    key: fs.readFileSync(path.join(certDir, 'key.pem')),
    cert: fs.readFileSync(path.join(certDir, 'cert.pem')),
}, (client) => {
    const upstream = net.connect(risuPort, '127.0.0.1');
    client.pipe(upstream);
    upstream.pipe(client);
    const close = () => { client.destroy(); upstream.destroy(); };
    client.on('error', close);
    upstream.on('error', close);
    client.on('close', close);
    upstream.on('close', close);
});

const stamp = () => new Date().toISOString();
server.on('secureConnection', (socket) => {
    console.log(`[lan-tls] ${stamp()} TLS ok from ${socket.remoteAddress}`);
});
// A phone that does not trust the certificate (yet) fails here; showing it tells you the phone did try https.
server.on('tlsClientError', (err, socket) => {
    console.log(`[lan-tls] ${stamp()} TLS failed from ${socket.remoteAddress}: ${err.code || err.message}`);
});

server.listen(listenPort, () => {
    const lan = Object.values(os.networkInterfaces()).flat()
        .filter((i) => i && i.family === 'IPv4' && !i.internal).map((i) => `https://${i.address}:${listenPort}`);
    console.log(`[lan-tls] forwarding to http://127.0.0.1:${risuPort}`);
    console.log(`[lan-tls] open on the phone: ${lan.join('  ')}`);
});
