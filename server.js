'use strict';

const express    = require('express');
const http       = require('http');
const path       = require('path');
const trustProxy = require('./trustProxy');
const db         = require('./db');
const session    = require('./lib/session');
const { createSocketServer, setMsgCache } = require('./socket');
const { applySecurityHeaders } = require('./lib/security');

const app    = express();
const server = http.createServer(app);
const httpsEnabled = String(process.env.HTTPS || '').toLowerCase() === 'true';

trustProxy.configureExpress(app);
app.use((req, res, next) => applySecurityHeaders(req, res, next, { httpsEnabled }));
app.use(express.static(path.join(__dirname, 'public'), { dotfiles: 'deny' }));

async function start() {
  const connected = await db.initDatabase();
  if (connected) {
    const [msgs, banned, shadow, mutes, adminIds] = await Promise.all([
      db.getMessages().catch(() => []),
      db.getBannedUsers().catch(() => []),
      db.getShadowBannedIds().catch(() => []),
      db.getActiveMutes().catch(() => []),
      db.getAdminUserIds().catch(() => []),
    ]);
    setMsgCache(msgs);
    banned.forEach(b  => session.bannedUsers.add(b.userId));
    shadow.forEach(uid => session.shadowBannedUsers.add(uid));
    mutes.forEach(m   => session.mutedUsers.set(m.userId, { until: m.until }));
    adminIds.forEach(uid => session.adminUserIds.add(uid));
  }

  createSocketServer(server, db);

  const port = process.env.PORT || 3000;
  server.listen(port, () => console.log(`[Server] 起動完了 port:${port}`));
}

async function shutdown() {
  await new Promise(res => server.close(res));
  await db.closeDatabase();
  process.exit(0);
}

process.on('SIGTERM', shutdown);
process.on('SIGINT',  shutdown);

start().catch(err => { console.error('[Server] 起動失敗:', err); process.exit(1); });
