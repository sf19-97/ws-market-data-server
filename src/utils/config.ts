import { readFileSync, existsSync } from "fs";
import { parse } from "yaml";
import { join } from "path";

export async function loadConfig(): Promise<any> {
  const configPath = join(process.cwd(), "config", "config.yaml");
  
  if (!existsSync(configPath)) {
    console.log("No config.yaml found, using default configuration");
    return getDefaultConfig();
  }

  try {
    const configFile = readFileSync(configPath, "utf8");
    const config = parse(configFile);
    return config;
  } catch (err) {
    console.error("Failed to load config:", err);
    return getDefaultConfig();
  }
}

function getDefaultConfig(): any {
  return {
    server: {
      port: 8080,
      maxConnections: 10000,
      heartbeatInterval: "30s"
    },
    brokers: [
      {
        name: "binance",
        type: "websocket",
        url: "wss://stream.binance.com:9443",
        auth: "none",
        enabled: true
      },
      {
        name: "oanda",
        type: "http-stream",
        url: "https://stream-fxpractice.oanda.com",
        auth: "bearer",
        enabled: false // Disabled by default, needs API key
      }
    ],
    clients: {
      authRequired: false,
      rateLimit: "100/s",
      maxSubscriptions: 50
    }
  };
}
