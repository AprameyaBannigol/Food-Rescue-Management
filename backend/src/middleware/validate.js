const { badRequest } = require('../lib/errors');

// validate({ body: zodSchema, query: zodSchema, params: zodSchema })
// Parsed values replace the raw ones on req.valid.
const validate = (schemas) => (req, _res, next) => {
  req.valid = {};
  for (const part of ['params', 'query', 'body']) {
    if (!schemas[part]) continue;
    const result = schemas[part].safeParse(req[part] ?? {});
    if (!result.success) throw badRequest('Invalid request', result.error.flatten());
    req.valid[part] = result.data;
  }
  next();
};

module.exports = validate;
