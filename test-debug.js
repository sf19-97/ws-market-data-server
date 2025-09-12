import WebSocket from 'ws';

const ws = new WebSocket('ws://localhost:8080');
let messageCount = 0;

ws.on('open', () => {
  console.log('✅ Connected to server');
  
  // First connect message
  ws.on('message', (data) => {
    console.log('📨 First message:', data.toString());
  });
  
  // Subscribe to BTC/USDT with correct format
  setTimeout(() => {
    const subscribeMsg = {
      action: 'subscribe',
      broker: 'binance',
      symbols: ['BTCUSDT'],
      types: ['tick', 'candle']
    };
    
    console.log('📤 Sending subscribe:', JSON.stringify(subscribeMsg));
    ws.send(JSON.stringify(subscribeMsg));
  }, 1000);
});

ws.on('message', (data) => {
  messageCount++;
  try {
    const msg = JSON.parse(data);
    
    if (msg.type === 'data') {
      console.log(`📊 Market data #${messageCount}:`, {
        broker: msg.broker,
        symbol: msg.symbol,
        dataType: msg.data?.type,
        price: msg.data?.close || msg.data?.price,
        timestamp: new Date(msg.data?.timestamp || 0).toISOString()
      });
    } else {
      console.log(`📨 Server message #${messageCount}:`, msg);
    }
  } catch (e) {
    console.log(`📨 Raw message #${messageCount}:`, data.toString());
  }
});

ws.on('error', (err) => {
  console.error('❌ WebSocket error:', err.message);
});

ws.on('close', () => {
  console.log(`🔌 Disconnected. Total messages received: ${messageCount}`);
});

// Close after 20 seconds
setTimeout(() => {
  console.log('⏰ Test complete, closing connection...');
  ws.close();
  process.exit(0);
}, 20000);

console.log('🚀 Starting test client...');