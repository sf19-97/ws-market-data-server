/**
 * Jest test setup file
 * Runs before all tests
 */

// Set test environment variables
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = 'postgresql://test:test@localhost:5432/test_db';

// Suppress console logs during tests unless explicitly needed
// Use spyOn instead of replacing the whole console object
jest.spyOn(console, 'log').mockImplementation(() => undefined);
jest.spyOn(console, 'debug').mockImplementation(() => undefined);
jest.spyOn(console, 'info').mockImplementation(() => undefined);
jest.spyOn(console, 'warn').mockImplementation(() => undefined);
jest.spyOn(console, 'error').mockImplementation(() => undefined);

// Prevent TypeScript from treating this as a module
export {};
