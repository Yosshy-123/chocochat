'use strict';
// Socket.IO の初期化（他のスクリプトより先に読み込むこと）
const socket = io(location.origin, {
  transports: ['websocket', 'polling'],
  reconnection: true,
  reconnectionAttempts: Infinity,
  autoConnect: true,
});
