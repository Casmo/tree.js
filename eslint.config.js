import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['dist', 'editor/dist', 'node_modules', 'playwright-report', 'test-results'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      // Determinism contract: all randomness goes through src/random.
      'no-restricted-properties': [
        'error',
        { object: 'Math', property: 'random', message: 'Use createRandom() from src/random (seeded).' },
      ],
    },
  },
);
