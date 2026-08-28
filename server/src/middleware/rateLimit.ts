import rateLimit from 'express-rate-limit';

/** Auth endpoints: 20 requests per 15 minutes per IP */
export const authRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: {
      code: 'rate_limit_exceeded',
      message: 'Too many authentication attempts. Please try again later.',
      retryable: true,
    },
  },
});

/** General API rate limit: 300 requests per minute per IP */
export const apiRateLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 300,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: {
      code: 'rate_limit_exceeded',
      message: 'Too many requests. Please slow down.',
      retryable: true,
    },
  },
});
