const { PeerServer } = require('peer');
const express = require('express');

const app = express();
const PORT = process.env.PORT || 9000;

// Health check endpoint for Render.com
app.get('/', (req, res) => {
  res.json({ status: 'ok', service: 'Nattice PeerJS Server', uptime: process.uptime() });
});

// Mount PeerJS server at /myapp
const peerServer = PeerServer({
  port: PORT,
  path: '/myapp',
  allow_discovery: false,
  proxied: true,
});

peerServer.on('connection', (client) => {
  console.log(`[PeerJS] Client connected: ${client.getId()}`);
});

peerServer.on('disconnect', (client) => {
  console.log(`[PeerJS] Client disconnected: ${client.getId()}`);
});

console.log(`Nattice PeerJS server running on port ${PORT}`);
