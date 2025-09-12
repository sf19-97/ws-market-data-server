import WebSocket from 'ws';

console.log('🔐 Testing Authentication Flow\n');

const ws = new WebSocket('ws://localhost:8080');

ws.on('open', () => {
  console.log('✅ Connected to server');
  
  // First authenticate with Oanda
  setTimeout(() => {
    const authMsg = {
      action: 'authenticate',
      broker: 'oanda',
      credentials: {
        apiKey: 'test-api-key-123',
        accountId: 'test-account-456'
      }
    };
    
    console.log('🔑 Sending authentication:', authMsg);
    ws.send(JSON.stringify(authMsg));
  }, 500);
  
  // Then subscribe to EUR/USD
  setTimeout(() => {
    const subscribeMsg = {
      action: 'subscribe',
      broker: 'oanda',
      symbols: ['EUR/USD', 'GBP/USD'],
      types: ['tick']
    };
    
    console.log('📊 Subscribing to forex pairs:', subscribeMsg.symbols);
    ws.send(JSON.stringify(subscribeMsg));
  }, 1500);
});

ws.on('message', (data) => {
  const msg = JSON.parse(data);
  
  if (msg.type === 'status') {
    console.log('📨 Status:', msg.message);
  } else if (msg.type === 'error') {
    console.log('❌ Error:', msg.message);
  } else if (msg.type === 'data') {
    console.log('💹 Market data:', {
      broker: msg.broker,
      symbol: msg.symbol,
      price: msg.data?.data?.price?.toFixed(5),
      volume: msg.data?.data?.volume?.toFixed(2)
    });
  }
});

ws.on('error', (err) => {
  console.error('❌ WebSocket error:', err.message);
});

ws.on('close', () => {
  console.log('🔌 Disconnected');
});

// Run for 10 seconds
setTimeout(() => {
  console.log('\n✅ Test complete');
  ws.close();
  process.exit(0);
}, 10000);