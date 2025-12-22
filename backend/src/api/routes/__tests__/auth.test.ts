import { describe, it, expect } from 'vitest';
import request from 'supertest';
import app from '../../../server';

describe('POST /api/auth/login', () => {

  it('should return 400 for invalid email', async () => {
    const response = await request(app)
      .post('/api/auth/login')
      .send({ email: 'invalid', password: 'password' });

    expect(response.status).toBe(400);
  });

  it('should return 400 for missing password', async () => {
    const response = await request(app)
      .post('/api/auth/login')
      .send({ email: 'test@example.com' });

    expect(response.status).toBe(400);
  });

  it('should return 401 for invalid credentials', async () => {
    const response = await request(app)
      .post('/api/auth/login')
      .send({ email: 'test@example.com', password: 'wrong' });

    expect(response.status).toBe(401);
  });

  // Note: Add more tests after seeding test data
});

describe('GET /api/auth/session', () => {

  it('should return 401 without token', async () => {
    const response = await request(app)
      .get('/api/auth/session');

    expect(response.status).toBe(401);
  });

  it('should return 401 with invalid token', async () => {
    const response = await request(app)
      .get('/api/auth/session')
      .set('Authorization', 'Bearer invalid-token');

    expect(response.status).toBe(401);
  });
});

