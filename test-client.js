import WebSocket from 'ws';

const ws = new WebSocket('ws://localhost:8080');

ws.on('open', () => {
  console.log('Connected to server');
  
  // Subscribe to BTC/USDT
  ws.send(JSON.stringify({
    action: 'subscribe',
    broker: 'binance',
    symbols: ['BTCUSDT'],
    types: ['tick']
  }));
});

ws.on('message', (data) => {
  console.log('Received:', JSON.parse(data));
});

ws.on('error', (err) => {
  console.error('WebSocket error:', err);
});

ws.on('close', () => {
  console.log('Disconnected from server');
});