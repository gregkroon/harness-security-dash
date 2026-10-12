/**
 * Custom CSRF protection middleware for API backends.
 *
 * Uses Origin and Referer header validation on state-changing HTTP methods,
 * which is the OWASP-recommended approach for stateless JSON APIs that do
 * not rely on session cookies.
 *
 * @param {object}   options
 * @param {string[]} options.allowedOrigins - Whitelisted origins. When empty,
 *   any non-empty Origin/Referer is accepted (useful for development).
 * @returns {Function} Express middleware
 */
function csrf(options) {
  var opts = options || {};
  var allowedOrigins = opts.allowedOrigins || [];

  return function csrfMiddleware(req, res, next) {
    // Safe HTTP methods do not require CSRF validation
    if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') {
      return next();
    }

    var origin = req.get('origin');
    var referer = req.get('referer');

    // Validate Origin header for state-changing requests
    if (origin) {
      if (allowedOrigins.length > 0 && !allowedOrigins.includes(origin)) {
        return res.status(403).json({ error: 'CSRF validation failed: origin not allowed' });
      }
      return next();
    }

    // Fall back to Referer header validation
    if (referer) {
      try {
        var refererOrigin = new URL(referer).origin;
        if (allowedOrigins.length > 0 && !allowedOrigins.includes(refererOrigin)) {
          return res.status(403).json({ error: 'CSRF validation failed: referer origin not allowed' });
        }
        return next();
      } catch (_err) {
        return res.status(403).json({ error: 'CSRF validation failed: malformed referer' });
      }
    }

    // Reject requests with neither Origin nor Referer header
    return res.status(403).json({ error: 'CSRF validation failed: missing origin or referer header' });
  };
}

module.exports = csrf;
