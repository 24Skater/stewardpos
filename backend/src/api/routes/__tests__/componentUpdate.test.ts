import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import jwt from 'jsonwebtoken';

const getUserByEmail = vi.fn();
const execFile = vi.fn();

// Stubbed so no test ever actually shells out. The assertions are about *how*
// the child process is invoked, which is the whole point of the fix.
vi.mock('child_process', () => ({
  execFile: (
    file: string,
    args: string[],
    options: unknown,
    cb: (err: unknown, stdout: string, stderr: string) => void
  ) => {
    execFile(file, args, options);
    cb(null, 'ok', '');
  },
}));

vi.mock('../../../services/database', () => ({
  default: { getAdapter: () => ({ getUserByEmail }) },
}));

const { default: config } = await import('../../../config');
const { default: app } = await import('../../../app');

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

describe('POST /api/admin/components/update', () => {
  it('passes packages as arguments, never as a shell string', async () => {
    await request(app)
      .post('/api/admin/components/update')
      .set('Authorization', `Bearer ${token()}`)
      .send({ type: 'backend', packages: ['express', '@types/node'] });

    const [file, args] = execFile.mock.calls[0];
    expect(file).toBe('npm');
    expect(args).toEqual(['update', 'express', '@types/node']);
  });

  it('refuses a package name carrying shell metacharacters', async () => {
    // The confirmed RCE: this used to be interpolated into `npm update ...` and
    // run through a shell, executing as the server user.
    const response = await request(app)
      .post('/api/admin/components/update')
      .set('Authorization', `Bearer ${token()}`)
      .send({ type: 'backend', packages: ['; echo pwned > /tmp/x; echo '] });

    expect(response.status).toBe(400);
    expect(execFile).not.toHaveBeenCalled();
  });

  it.each([
    ['backtick substitution', '`whoami`'],
    ['dollar substitution', '$(id)'],
    ['pipe', 'express | sh'],
    ['ampersand', 'express && rm -rf /'],
    ['newline', 'express\nrm -rf /'],
    ['a leading dash, which npm would read as a flag', '--registry=http://evil'],
    ['a path traversal', '../../etc/passwd'],
  ])('refuses %s', async (_label, name) => {
    const response = await request(app)
      .post('/api/admin/components/update')
      .set('Authorization', `Bearer ${token()}`)
      .send({ type: 'backend', packages: [name] });

    expect(response.status).toBe(400);
    expect(execFile).not.toHaveBeenCalled();
  });

  it('refuses a non-string entry', async () => {
    const response = await request(app)
      .post('/api/admin/components/update')
      .set('Authorization', `Bearer ${token()}`)
      .send({ type: 'backend', packages: [{ toString: 'nope' }] });

    expect(response.status).toBe(400);
    expect(execFile).not.toHaveBeenCalled();
  });

  it('rejects one bad name even alongside good ones', async () => {
    const response = await request(app)
      .post('/api/admin/components/update')
      .set('Authorization', `Bearer ${token()}`)
      .send({ type: 'backend', packages: ['express', '; id'] });

    expect(response.status).toBe(400);
    expect(execFile).not.toHaveBeenCalled();
  });

  it('still requires an admin', async () => {
    getUserByEmail.mockResolvedValue({
      id: 'u1',
      email: 'admin@example.com',
      status: 'active',
      roleIds: ['r1'],
      roles: [
        { id: 'r1', name: 'Supervisor', systemRole: 'supervisor', permissions: { settings: { write: true } } },
      ],
    });

    const response = await request(app)
      .post('/api/admin/components/update')
      .set('Authorization', `Bearer ${token()}`)
      .send({ type: 'backend', packages: ['express'] });

    expect(response.status).toBe(403);
    expect(execFile).not.toHaveBeenCalled();
  });
});

describe('POST /api/admin/components/update-all', () => {
  it('invokes npm with no interpolated input at all', async () => {
    await request(app)
      .post('/api/admin/components/update-all')
      .set('Authorization', `Bearer ${token()}`)
      .send({ type: 'backend' });

    expect(execFile.mock.calls[0][0]).toBe('npm');
    expect(execFile.mock.calls[0][1]).toEqual(['update']);
  });
});
