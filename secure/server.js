'use strict';

// Express application. Serves public/ statically and mounts a JSON API under
// /api/*. There is no server-side templating — output encoding is entirely the client's job, which
// is what the XSS demo turns on (see public/js/system.js). Exposed as a factory so tests mount the
// app with supertest without opening a port.

require('dotenv').config();
const path = require('path');
const express = require('express');
const session = require('express-session');
const errorHandler = require('./middleware/errorHandler');

// Session cookie policy (SPEC §14): httpOnly blunts XSS cookie theft, sameSite:'lax' blunts
// cross-site POSTs, secure is set behind TLS. Exported so tests assert the shipped config directly.
function sessionOptions() {
  const secure = process.env.NODE_ENV === 'production' || process.env.COOKIE_SECURE === 'true';
  return {
    secret: process.env.SESSION_SECRET || 'dev-only-insecure-change-me',
    resave: false,
    saveUninitialized: false,
    cookie: { httpOnly: true, sameSite: 'lax', secure },
  };
}

function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json());
  app.use(session(sessionOptions()));

  // API router — feature routes attach here.
  const api = express.Router();
  api.use('/', require('./routes/auth'));           // register/login/logout (T6/T7/T8)
  api.use('/', require('./routes/customers'));      // customers (T9)
  api.use('/', require('./routes/password'));       // change/forgot/reset (T10/T11/T12)
  app.use('/api', api);

  // Unknown /api/* paths return JSON, never the static 404 HTML.
  app.use('/api', (req, res) => {
    res.status(404).json({ error: 'Not found.' });
  });

  // Static assets (login page, client JS, CSS).
  app.use(express.static(path.join(__dirname, 'public')));

  app.use(errorHandler);
  return app;
}

module.exports = { createApp, sessionOptions };

if (require.main === module) {
  const app = createApp();
  const port = Number(process.env.PORT) || 3000;
  app.listen(port, () => {
    // eslint-disable-next-line no-console
    console.log(`Comunication_LTD (secure) listening on :${port}`);
  });
}
