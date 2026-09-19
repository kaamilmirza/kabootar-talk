/**
 * A no-op stand-in for `server-only`.
 *
 * That package exists to make a build fail if server code is pulled into a
 * client bundle, which it does by throwing on import outside a server
 * component. Useful in the app, unhelpful under a test runner — without this
 * alias the server modules simply cannot be imported, and the SQL, the limits
 * and the validation schemas would all go untested.
 */
export {};
