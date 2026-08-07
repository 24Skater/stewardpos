import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import path from 'path';
import fs from 'fs';

const getUserByEmail = vi.fn();

vi.mock('../../../services/database', () => ({
  default: { getAdapter: () => ({ getUserByEmail }) },
}));

const { default: config } = await import('../../../config');
const { default: app } = await import('../../../app');

const logosDir = path.join(process.cwd(), 'uploads', 'logos');

function token(): string {
  return jwt.sign({ id: 'u1', email: 'admin@example.com', roleIds: ['r1'] }, config.jwt.secret, {
    expiresIn: '1h',
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  getUserByEmail.mockResolvedValue({
    id: 'u1',
    email: 'admin@example.com',
    status: 'active',
    roleIds: ['r1'],
    roles: [{ id: 'r1', name: 'Admin', systemRole: 'admin', permissions: {} }],
  });
});

describe('POST /api/upload/:type', () => {
  it('stores an image under a server-chosen name and extension', async () => {
    const response = await request(app)
      .post('/api/upload/logo')
      .set('Authorization', `Bearer ${token()}`)
      .attach('file', Buffer.from('fake-png-bytes'), {
        filename: 'logo.png',
        contentType: 'image/png',
      });

    expect(response.status).toBe(200);
    expect(response.body.data.filename).toMatch(/^[0-9a-f-]{36}\.png$/);

    fs.rmSync(path.join(logosDir, response.body.data.filename), { force: true });
  });

  it('ignores the extension the caller supplied', async () => {
    // The attack: claim image/png, name the file `.js`. It used to be written as
    // `<uuid>.js` and served as application/javascript from this origin, which a
    // `script-src 'self'` CSP happily executes.
    const response = await request(app)
      .post('/api/upload/logo')
      .set('Authorization', `Bearer ${token()}`)
      .attach('file', Buffer.from('alert(document.domain)'), {
        filename: 'payload.js',
        contentType: 'image/png',
      });

    expect(response.status).toBe(200);
    expect(response.body.data.filename).toMatch(/\.png$/);
    expect(response.body.data.filename).not.toMatch(/\.js$/);

    fs.rmSync(path.join(logosDir, response.body.data.filename), { force: true });
  });

  it('refuses a type that is not an accepted image, as a 400 not a 500', async () => {
    // Sending the wrong kind of file is the caller's mistake. Multer's filter
    // used to throw a bare Error, which reached the handler as a server fault.
    const response = await request(app)
      .post('/api/upload/logo')
      .set('Authorization', `Bearer ${token()}`)
      .attach('file', Buffer.from('<html></html>'), {
        filename: 'evil.html',
        contentType: 'text/html',
      });

    expect(response.status).toBe(400);
  });

  it('refuses SVG, which can carry script', async () => {
    const response = await request(app)
      .post('/api/upload/logo')
      .set('Authorization', `Bearer ${token()}`)
      .attach('file', Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'), {
        filename: 'logo.svg',
        contentType: 'image/svg+xml',
      });

    expect(response.status).toBe(400);
  });
});

describe('DELETE /api/upload/:type/:filename', () => {
  it('refuses a traversal sequence', async () => {
    // Express decodes the parameter, so this arrives as `../../../tmp/probe`.
    const response = await request(app)
      .delete(`/api/upload/logo/${encodeURIComponent('../../../tmp/probe.txt')}`)
      .set('Authorization', `Bearer ${token()}`);

    expect(response.status).toBe(400);
  });

  it('does not act on a bare parent reference', async () => {
    // Express normalises `..` out of the path before routing, so this never
    // reaches the handler and 404s. Asserting "not 2xx" rather than a specific
    // code keeps the test about the outcome that matters - nothing is deleted -
    // rather than about which layer happened to refuse it.
    const response = await request(app)
      .delete(`/api/upload/logo/${encodeURIComponent('..')}`)
      .set('Authorization', `Bearer ${token()}`);

    expect(response.status).toBeGreaterThanOrEqual(400);
  });

  it('refuses an absolute path', async () => {
    const response = await request(app)
      .delete(`/api/upload/logo/${encodeURIComponent('/etc/passwd')}`)
      .set('Authorization', `Bearer ${token()}`);

    expect(response.status).toBe(400);
  });

  it('refuses an unknown upload type instead of falling back to the root', async () => {
    const response = await request(app)
      .delete('/api/upload/anything/some-file.png')
      .set('Authorization', `Bearer ${token()}`);

    expect(response.status).toBe(400);
  });

  it('404s on a plain filename that does not exist', async () => {
    const response = await request(app)
      .delete('/api/upload/logo/does-not-exist.png')
      .set('Authorization', `Bearer ${token()}`);

    expect(response.status).toBe(404);
  });

  it('deletes a real upload', async () => {
    fs.mkdirSync(logosDir, { recursive: true });
    fs.writeFileSync(path.join(logosDir, 'deletable.png'), 'x');

    const response = await request(app)
      .delete('/api/upload/logo/deletable.png')
      .set('Authorization', `Bearer ${token()}`);

    expect(response.status).toBe(200);
    expect(fs.existsSync(path.join(logosDir, 'deletable.png'))).toBe(false);
  });
});
