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
const productsDir = path.join(process.cwd(), 'uploads', 'products');

function actor(permissions: Record<string, unknown>) {
  return {
    id: 'u1',
    email: 'stock@example.com',
    status: 'active',
    roleIds: ['r1'],
    roles: [{ id: 'r1', name: 'Stock', systemRole: 'standard', permissions }],
  };
}

/**
 * A real PNG, not a string that says "png".
 *
 * The route verifies the magic number now (`imageSignature.ts`), so bytes that
 * merely claim `image/png` are refused - which is the point of that change, and
 * which every test here would otherwise trip over. Signature plus a truncated
 * IHDR is enough: the check reads the first twelve bytes and does not decode.
 */
const png = () =>
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d]);
const attachment = { filename: 'x.png', contentType: 'image/png' };

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
      .attach('file', png(), {
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
      .attach('file', png(), {
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

  it('refuses script bytes wearing an image/png label', async () => {
    // The gap the signature check closes. `fileFilter` only ever saw the
    // caller's own Content-Type, so these bytes used to be stored as
    // `<uuid>.png` and served back with `Content-Type: image/png`. nosniff
    // stopped a browser executing them; nothing stopped them being stored, or
    // being handed to the next decoder that reads the bucket.
    const response = await request(app)
      .post('/api/upload/logo')
      .set('Authorization', `Bearer ${token()}`)
      .attach('file', Buffer.from('alert(document.domain)'), {
        filename: 'logo.png',
        contentType: 'image/png',
      });

    expect(response.status).toBe(400);
    expect(response.body.error ?? response.body.message).toMatch(/not a valid image/i);
  });

  it('accepts each image type it advertises', async () => {
    // Guards against the signature table and the accepted-type table drifting:
    // a type the route allows but cannot verify would be refused on every
    // upload, which is a broken feature rather than a tightened one.
    const samples: Array<[string, string, Buffer]> = [
      ['image/png', 'a.png', png()],
      ['image/jpeg', 'a.jpg', Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10])],
      ['image/gif', 'a.gif', Buffer.from('GIF89a', 'latin1')],
      [
        'image/webp',
        'a.webp',
        Buffer.concat([
          Buffer.from('RIFF', 'latin1'),
          Buffer.from([0x00, 0x00, 0x00, 0x00]),
          Buffer.from('WEBP', 'latin1'),
        ]),
      ],
      ['image/x-icon', 'a.ico', Buffer.from([0x00, 0x00, 0x01, 0x00, 0x01, 0x00])],
    ];

    for (const [contentType, filename, bytes] of samples) {
      const response = await request(app)
        .post('/api/upload/logo')
        .set('Authorization', `Bearer ${token()}`)
        .attach('file', bytes, { filename, contentType });

      expect(response.status, `${contentType} should be accepted`).toBe(200);
      fs.rmSync(path.join(logosDir, response.body.data.filename), { force: true });
    }
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

describe('product images', () => {
  it('accepts one and serves it from the products directory', async () => {
    const response = await request(app)
      .post('/api/upload/product')
      .set('Authorization', `Bearer ${token()}`)
      .attach('file', png(), attachment);

    expect(response.status).toBe(200);
    // The subdirectory comes from the same table multer wrote to. Re-deriving it
    // from the type sent a product image to the icons path.
    expect(response.body.data.url).toMatch(/^\/uploads\/products\//);
    fs.unlinkSync(path.join(productsDir, response.body.data.filename));
  });

  it('needs inventory.write, not settings.write', async () => {
    // A product photo is catalog work. Requiring settings.write would mean
    // nobody could add one without also being able to change the store's
    // payment credentials.
    getUserByEmail.mockResolvedValue(actor({ inventory: { write: true }, settings: { write: false } }));

    const response = await request(app)
      .post('/api/upload/product')
      .set('Authorization', `Bearer ${token()}`)
      .attach('file', png(), attachment);

    expect(response.status).toBe(200);
    fs.unlinkSync(path.join(productsDir, response.body.data.filename));
  });

  it('refuses someone who can change settings but not the catalog', async () => {
    getUserByEmail.mockResolvedValue(actor({ inventory: { write: false }, settings: { write: true } }));

    expect(
      (await request(app)
        .post('/api/upload/product')
        .set('Authorization', `Bearer ${token()}`)
        .attach('file', png(), attachment)).status
    ).toBe(403);
  });

  it('still guards the logo behind settings.write', async () => {
    getUserByEmail.mockResolvedValue(actor({ inventory: { write: true }, settings: { write: false } }));

    expect(
      (await request(app)
        .post('/api/upload/logo')
        .set('Authorization', `Bearer ${token()}`)
        .attach('file', png(), attachment)).status
    ).toBe(403);
  });

  it('refuses an unknown upload type without writing anything', async () => {
    const response = await request(app)
      .post('/api/upload/whatever')
      .set('Authorization', `Bearer ${token()}`)
      .attach('file', png(), attachment);

    expect(response.status).toBe(400);
  });
});
