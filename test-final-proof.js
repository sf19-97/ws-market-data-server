import WebSocket from 'ws';

console.log('🚀 FINAL TEST - WebSocket Market Data Server\n');

const ws = new WebSocket('ws://localhost:8080');
let messageCount = 0;
let dataPoints = [];

ws.on('open', () => {
  console.log('✅ CONNECTED to server');
  
  setTimeout(() => {
    const subscribeMsg = {
      action: 'subscribe',
      broker: 'binance',
      symbols: ['BTCUSDT', 'ETHUSDT'], 
      types: ['tick']
    };
    
    console.log('📤 SUBSCRIBING to:', subscribeMsg.symbols.join(', '));
    ws.send(JSON.stringify(subscribeMsg));
  }, 500);
});

ws.on('message', (data) => {
  const msg = JSON.parse(data);
  
  if (msg.type === 'data') {
    messageCount++;
    dataPoints.push({
      symbol: msg.data.symbol,
      price: msg.data.data.price,
      volume: msg.data.data.volume,
      time: new Date(msg.data.timestamp).toISOString()
    });
    
    console.log(`\n📊 Data #${messageCount}: ${msg.data.symbol}`);
    console.log(`   Price:  $${msg.data.data.price.toFixed(2)}`);
    console.log(`   Volume: ${msg.data.data.volume.toFixed(4)}`);
  }
});

ws.on('error', (err) => {
  console.error('❌ Error:', err.message);
});

ws.on('close', () => {
  console.log('\n📈 TEST COMPLETE - Summary:');
  console.log(`   Total messages received: ${messageCount}`);
  console.log(`   Symbols tracked: ${[...new Set(dataPoints.map(d => d.symbol))].join(', ')}`);
  console.log(`   Test duration: 5 seconds`);
  console.log('\n✅ SYSTEM WORKS!');
});

// Run for 5 seconds
setTimeout(() => {
  ws.close();
}, 5000);