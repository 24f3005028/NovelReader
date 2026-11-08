import { openDatabase, Store } from './db.js';
import { seed } from './seed.js';
import { createApp } from './app.js';
import { Worker } from './worker.js';
import { sources } from './sources.js';
const store = new Store(openDatabase());
seed(store);
const worker = new Worker(store);
const app = createApp(store);
if (process.env.AUTO_INDEX_CATALOG !== 'false') {
  for (const source of sources()) {
    if (source.id === 'demo' || !source.enabled) continue;
    const count = Number(
      store.db
        .prepare("SELECT COUNT(*) AS n FROM novels WHERE json_extract(data,'$.source')=?")
        .get(source.id)!.n,
    );
    if (count === 0) app.locals.catalog.start(source.id);
  }
}
const timer = setInterval(() => {
  void worker.tick();
  void app.locals.catalog.tick();
}, 1000);
const communityTimer = setInterval(() => void app.locals.reddit.tick(), 60000);
const host = process.env.HOST || '0.0.0.0';
const port = Number(process.env.PORT) || 4000;
const server = app.listen(port, host, () => console.log(`NovelReader API: http://${host}:${port}`));
function shutdown() {
  clearInterval(timer);
  clearInterval(communityTimer);
  server.close(() => {
    store.db.close();
    process.exit(0);
  });
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
