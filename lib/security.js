'use strict';

function buildContentSecurityPolicy({ httpsEnabled = false } = {}) {
  const directives = [
    "default-src 'self'",
    "base-uri 'self'",
    "object-src 'none'",
    "frame-ancestors 'none'",
    "form-action 'self'",
    "img-src 'self' data:",
    "font-src 'self' data:",
    "style-src 'self' 'unsafe-inline'",
    "script-src 'self' https://cdn.socket.io",
    "connect-src 'self' ws: wss:",
  ];

  if (httpsEnabled) {
    directives.push('upgrade-insecure-requests', 'block-all-mixed-content');
  }

  return directives.join('; ');
}

function applySecurityHeaders(req, res, next, options = {}) {
  res.setHeader('Content-Security-Policy', buildContentSecurityPolicy(options));
  res.setHeader('Referrer-Policy', 'same-origin');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  next();
}

module.exports = {
  buildContentSecurityPolicy,
  applySecurityHeaders,
};
