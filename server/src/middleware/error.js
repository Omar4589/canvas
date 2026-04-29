export function notFound(req, res) {
  res.status(404).json({ error: 'Not found' });
}

export function errorHandler(err, req, res, next) {
  if (res.headersSent) return next(err);
  const status = err.status || err.statusCode || 500;
  const body = { error: err.message || 'Server error' };
  if (err.issues) body.issues = err.issues;
  if (process.env.NODE_ENV !== 'production') body.stack = err.stack;
  res.status(status).json(body);
}
