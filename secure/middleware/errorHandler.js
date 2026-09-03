'use strict';

// Terminal error middleware. The full stack is logged server-side; the client
// receives a generic JSON message with NO stack, SQL text, hash, or salt. Expected client errors
// (validation, auth) are answered directly by their route with their own status/message and never
// reach here — so anything that lands here is unexpected and is reported as a generic 500.
//
// Express identifies error middleware by its four-argument arity, so `next` must stay in the
// signature even though it is only used to hand off after headers are already sent.
// eslint-disable-next-line no-unused-vars
module.exports = function errorHandler(err, req, res, next) {
  console.error(err && err.stack ? err.stack : err);
  if (res.headersSent) return next(err);
  const status = Number.isInteger(err && err.status) ? err.status : 500;
  res.status(status).json({ error: 'An unexpected error occurred.' });
};
