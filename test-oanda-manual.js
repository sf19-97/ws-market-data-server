import WebSocket from 'ws';

console.log('🔍 Testing OANDA Connection Manually\n');

const ws = new WebSocket('ws://localhost:8080');

ws.on('open', () => {
  console.log('✅ Connected to server');
  
  // Subscribe to EUR_USD
  setTimeout(() => {
    const subscribeMsg = {
      action: 'subscribe',
      broker: 'oanda',
      symbols: ['EUR_USD'],
      types: ['tick']
    };
    
    console.log('📤 Sending subscribe:', JSON.stringify(subscribeMsg));
    ws.send(JSON.stringify(subscribeMsg));
  }, 500);
});

ws.on('message', (data) => {
  const msg = JSON.parse(data);
  console.log('\n📨 Message received:', {
    type: msg.type,
    broker: msg.broker,
    symbol: msg.symbol,
    timestamp: msg.data?.timestamp ? new Date(msg.data.timestamp).toISOString() : undefined,
    rawData: msg
  });
});

ws.on('error', (err) => {
  console.error('❌ WebSocket error:', err.message);
});

ws.on('close', () => {
  console.log('🔌 Disconnected');
});

// Keep running
console.log('👂 Listening for OANDA data... (Press Ctrl+C to stop)\n');