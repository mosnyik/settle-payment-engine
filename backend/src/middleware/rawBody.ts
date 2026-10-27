/**
 * Raw Body Capture
 *
 * Provider webhook signatures (e.g. Hyparrow) are an HMAC over the exact bytes
 * received. Re-serializing the parsed JSON can change key order or whitespace,
 * so express.json() keeps a copy of the raw buffer on the request.
 */

import { Request } from 'express';
import { IncomingMessage } from 'http';

export type RequestWithRawBody = Request & { rawBody?: Buffer };

export function captureRawBody(req: IncomingMessage, _res: unknown, buf: Buffer): void {
  (req as RequestWithRawBody).rawBody = buf;
}
