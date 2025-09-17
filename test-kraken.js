import WebSocket from 'ws';

console.log('🦑 Testing Kraken Connection\n');

const ws = new WebSocket('ws://localhost:8080');

ws.on('open', () => {
  console.log('✅ Connected to server');
  
  // Subscribe to BTC/USD on Kraken
  setTimeout(() => {
    const subscribeMsg = {
      action: 'subscribe',
      broker: 'kraken',
      symbols: ['BTC_USD', 'ETH_USD'],  // Server will convert to XBT/USD format
      types: ['tick']
    };
    
    console.log('📤 Subscribing to Kraken:', subscribeMsg.symbols);
    ws.send(JSON.stringify(subscribeMsg));
  }, 500);
});

ws.on('message', (data) => {
  const msg = JSON.parse(data);
  
  if (msg.type === 'status') {
    console.log('📨 Status:', msg.message);
  } else if (msg.type === 'error') {
    console.log('❌ Error:', msg.message);
  } else if (msg.type === 'data') {
    console.log('\n💹 Kraken data:', {
      symbol: msg.data.symbol,
      price: msg.data.data.price,
      bid: msg.data.data.bid,
      ask: msg.data.data.ask,
      volume: msg.data.data.volume?.toFixed(2)
    });
  }
});

ws.on('error', (err) => {
  console.error('❌ WebSocket error:', err.message);
});

ws.on('close', () => {
  console.log('🔌 Disconnected');
});

// Keep running
console.log('👂 Listening for Kraken data... (Press Ctrl+C to stop)\n');