import http from 'node:http';
import type { AddressInfo } from 'node:net';

export interface StubOptions {
  status?: number;
  delayMs?: number;
  body?: unknown;
}

export interface RecordedRequest {
  method: string;
  url: string;
  headers: http.IncomingHttpHeaders;
  body: string;
}

export interface StubSibling {
  url: string;
  requests: RecordedRequest[];
  close: () => Promise<void>;
}

// Local HTTP server standing in for a sibling app in tests.
export async function startStub({ status = 200, delayMs = 0, body = {} }: StubOptions = {}): Promise<StubSibling> {
  const requests: RecordedRequest[] = [];
  const timers = new Set<NodeJS.Timeout>();
  const server = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (chunk: Buffer) => { raw += chunk.toString(); });
    req.on('end', () => {
      requests.push({ method: req.method ?? '', url: req.url ?? '', headers: req.headers, body: raw });
      const timer = setTimeout(() => {
        timers.delete(timer);
        res.writeHead(status, { 'content-type': 'application/json' });
        res.end(JSON.stringify(body));
      }, delayMs);
      timers.add(timer);
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}`,
    requests,
    close: () => new Promise<void>((resolve, reject) => {
      timers.forEach(clearTimeout);
      timers.clear();
      server.closeAllConnections();
      server.close((err) => (err ? reject(err) : resolve()));
    }),
  };
}
