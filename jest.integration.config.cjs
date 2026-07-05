/** @type {import('jest').Config} */
// Integration suite: drives the compiled CLI against real Docker containers.
// Kept out of the default `jest` run (see testPathIgnorePatterns in
// jest.config.cjs) because it needs Docker and pulls images; run it with
// `npm run test:integration`.
module.exports = {
  preset: 'ts-jest/presets/default-esm',
  testEnvironment: 'node',

  testMatch: ['**/src/tests/integration/**/*.test.ts'],

  transform: {
    '^.+\\.ts$': ['ts-jest', {
      useESM: true,
    }],
  },

  extensionsToTreatAsEsm: ['.ts'],
  moduleNameMapper: {
    '^(\\.{1,2}/.*)\\.js$': '$1',
  },

  collectCoverage: false,

  // Container startup and image pulls dominate; suites run serially because
  // they share the host Docker daemon and the OS port range.
  testTimeout: 300000,
  maxWorkers: 1,
  clearMocks: true,
  forceExit: true,
};
