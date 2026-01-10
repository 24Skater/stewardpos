#!/usr/bin/env ts-node

/**
 * Database Setup Script
 * 
 * This script sets up the database by:
 * 1. Running migrations
 * 2. Seeding initial data
 * 
 * Usage:
 *   npm run setup-db
 *   npm run setup-db -- --skip-seed
 */

import { Migrator } from '../src/services/migrator';
import { Seeder } from '../src/services/seeder';
import config from '../src/config';
import logger from '../src/utils/logger';

async function setupDatabase() {
  const skipSeed = process.argv.includes('--skip-seed');

  try {
    logger.info('='.repeat(60));
    logger.info('DATABASE SETUP');
    logger.info('='.repeat(60));
    logger.info(`Database Adapter: ${config.database.adapter}`);
    logger.info('');

    // Step 1: Run migrations
    logger.info('Step 1: Running database migrations...');
    const migrator = new Migrator();
    await migrator.runMigrations();
    logger.info('✅ Migrations completed successfully');
    logger.info('');

    // Step 2: Seed data (optional)
    if (!skipSeed) {
      logger.info('Step 2: Seeding initial data...');
      const seeder = new Seeder();
      await seeder.seed();
      logger.info('✅ Seeding completed successfully');
      logger.info('');
    } else {
      logger.info('Step 2: Skipping seed data (--skip-seed flag provided)');
      logger.info('');
    }

    logger.info('='.repeat(60));
    logger.info('✅ DATABASE SETUP COMPLETE');
    logger.info('='.repeat(60));
    logger.info('');
    logger.info('Default admin credentials:');
    logger.info('  Email: admin@demo.local');
    logger.info('  Password: DemoPass!1');
    logger.info('');
    logger.info('⚠️  IMPORTANT: Change the admin password after first login!');
    logger.info('');

    process.exit(0);
  } catch (error) {
    logger.error('❌ Database setup failed:', error);
    process.exit(1);
  }
}

setupDatabase();
