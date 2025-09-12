import WebSocket from 'ws';

console.log('🔐 Testing Real OANDA Connection\n');

const ws = new WebSocket('ws://localhost:8080');

ws.on('open', () => {
  console.log('✅ Connected to server');
  
  // The server will use the credentials from .env file
  // Just subscribe to forex pairs
  setTimeout(() => {
    const subscribeMsg = {
      action: 'subscribe',
      broker: 'oanda',
      symbols: ['EUR_USD', 'GBP_USD'], // Note: OANDA uses underscore format
      types: ['tick']
    };
    
    console.log('📊 Subscribing to:', subscribeMsg.symbols);
    ws.send(JSON.stringify(subscribeMsg));
  }, 1000);
});

ws.on('message', (data) => {
  const msg = JSON.parse(data);
  
  if (msg.type === 'status') {
    console.log('📨 Status:', msg.message);
  } else if (msg.type === 'error') {
    console.log('❌ Error:', msg.message);
  } else if (msg.type === 'data') {
    console.log('💹 Real OANDA data:', {
      broker: msg.broker,
      symbol: msg.symbol,
      price: msg.data?.data?.price?.toFixed(5),
      volume: msg.data?.data?.volume,
      timestamp: new Date(msg.data?.timestamp).toISOString()
    });
  }
});

ws.on('error', (err) => {
  console.error('❌ WebSocket error:', err.message);
});

ws.on('close', () => {
  console.log('🔌 Disconnected');
});

// Run for 30 seconds to see real data
setTimeout(() => {
  console.log('\n✅ Test complete');
  ws.close();
  process.exit(0);
}, 30000);