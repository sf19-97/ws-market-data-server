import WebSocket from 'ws';
import { spawn } from 'child_process';

describe('WebSocket Market Data Server Integration Test', () => {
  let serverProcess;
  let ws;
  
  beforeAll((done) => {
    // Start the server
    serverProcess = spawn('npm', ['run', 'dev'], {
      env: { ...process.env, NODE_ENV: 'test' },
      detached: false
    });
    
    // Wait for server to start
    setTimeout(() => done(), 3000);
  });
  
  afterAll(() => {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.close();
    }
    if (serverProcess) {
      serverProcess.kill();
    }
  });
  
  test('should connect to WebSocket server', (done) => {
    ws = new WebSocket('ws://localhost:8080');
    
    ws.on('open', () => {
      done();
    });
    
    ws.on('error', (err) => {
      done(err);
    });
  });
  
  test('should receive welcome message on connect', (done) => {
    const ws2 = new WebSocket('ws://localhost:8080');
    
    ws2.on('message', (data) => {
      const msg = JSON.parse(data);
      expect(msg.type).toBe('status');
      expect(msg.message).toBe('Connected to Market Data Server');
      ws2.close();
      done();
    });
  });
  
  test('should receive market data after subscribing', (done) => {
    const ws3 = new WebSocket('ws://localhost:8080');
    const receivedData = [];
    
    ws3.on('open', () => {
      // Subscribe to BTCUSDT
      ws3.send(JSON.stringify({
        action: 'subscribe',
        broker: 'binance',
        symbols: ['BTCUSDT'],
        types: ['tick']
      }));
    });
    
    ws3.on('message', (data) => {
      const msg = JSON.parse(data);
      
      if (msg.type === 'data') {
        receivedData.push(msg);
        
        // After receiving 3 data points, verify and complete
        if (receivedData.length >= 3) {
          expect(receivedData[0].broker).toBe('binance');
          expect(receivedData[0].symbol).toBe('BTCUSDT');
          expect(receivedData[0].data).toHaveProperty('price');
          expect(receivedData[0].data).toHaveProperty('volume');
          expect(receivedData[0].data.price).toBeGreaterThan(0);
          
          ws3.close();
          done();
        }
      }
    });
    
    // Timeout after 10 seconds
    setTimeout(() => {
      ws3.close();
      done(new Error('Timeout waiting for market data'));
    }, 10000);
  });
});