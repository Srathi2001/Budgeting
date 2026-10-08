// Scripts only (import first): lets a script load server modules. "server-only" throws outside the Next
// server; here it resolves to the package's empty module. Never imported by the app.
import Module from 'node:module';
import { join } from 'node:path';

const empty = join(__dirname, '..', 'node_modules', 'server-only', 'empty.js');
const M = Module as unknown as { _resolveFilename: (request: string, ...rest: unknown[]) => string };
const resolve = M._resolveFilename;
M._resolveFilename = function (this: unknown, request: string, ...rest: unknown[]) {
  return request === 'server-only' ? empty : resolve.call(this, request, ...rest);
};
