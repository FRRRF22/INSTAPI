import config from './config.js';
import { createApp } from './app.js';
import { createDownloadStore } from './download-store.js';
import { createProvider } from './provider.js';

const downloadStore = createDownloadStore({
  ttlSeconds: config.downloadLinkTtlSeconds,
  allowedHosts: config.allowedMediaHosts,
});
const provider = createProvider(config, downloadStore);
const app = createApp({ config, provider, downloadStore });
const server = app.listen(config.port, '0.0.0.0', () => {
  process.stdout.write(`${JSON.stringify({ level: 'info', message: 'InstaDownload API started', port: config.port, providerConfigured: provider.configured })}\n`);
});

function shutdown(signal) {
  process.stdout.write(`${JSON.stringify({ level: 'info', message: 'Shutdown requested', signal })}\n`);
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 10000).unref();
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
