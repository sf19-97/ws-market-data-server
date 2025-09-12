import WebSocket from 'ws';

const ws = new WebSocket('ws://localhost:8080');
let messageCount = 0;

ws.on('open', () => {
  console.log('✅ Connected to server');
  
  // Subscribe to BTC/USDT
  const subscribeMsg = {
    action: 'subscribe',
    broker: 'binance',
    symbols: ['BTCUSDT'],
    types: ['tick']
  };
  
  console.log('📤 Sending subscribe:', subscribeMsg);
  ws.send(JSON.stringify(subscribeMsg));
});

ws.on('message', (data) => {
  messageCount++;
  const msg = JSON.parse(data);
  
  if (msg.type === 'data') {
    console.log(`📊 Market data #${messageCount}:`, {
      broker: msg.broker,
      symbol: msg.symbol,
      price: msg.data?.price,
      volume: msg.data?.volume,
      timestamp: new Date(msg.data?.timestamp).toISOString()
    });
  } else {
    console.log(`📨 Server message #${messageCount}:`, msg);
  }
});

ws.on('error', (err) => {
  console.error('❌ WebSocket error:', err.message);
});

ws.on('close', () => {
  console.log(`🔌 Disconnected. Total messages received: ${messageCount}`);
});

// Close after 10 seconds
setTimeout(() => {
  console.log('⏰ Test complete, closing connection...');
  ws.close();
}, 10000);