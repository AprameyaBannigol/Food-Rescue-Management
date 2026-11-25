class AppError extends Error {
  constructor(status, code, message, details) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

const badRequest = (message, details) => new AppError(400, 'bad_request', message, details);
const unauthorized = (message = 'Login required') => new AppError(401, 'unauthorized', message);
const forbidden = (message = 'You are not allowed to do this') => new AppError(403, 'forbidden', message);
const notFound = (what = 'Resource') => new AppError(404, 'not_found', `${what} not found`);
const conflict = (message, details) => new AppError(409, 'conflict', message, details);

module.exports = { AppError, badRequest, unauthorized, forbidden, notFound, conflict };
