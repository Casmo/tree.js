import js from '@eslint/js';
import tseslint from 'typescript-eslint';

const mathRandom = { object: 'Math', property: 'random', message: 'Use createRandom() from src/random (seeded).' };

// ECMAScript lets engines approximate these differently (last-bit differences between machines).
const APPROXIMATED_MATH = [
  'sin', 'cos', 'tan', 'asin', 'acos', 'atan', 'atan2', 'sinh', 'cosh', 'tanh', 'asinh', 'acosh', 'atanh',
  'exp', 'expm1', 'log', 'log1p', 'log2', 'log10', 'pow', 'cbrt', 'hypot',
];

export default tseslint.config(
  { ignores: ['dist', 'editor/dist', 'examples/dist', 'node_modules', 'playwright-report', 'test-results'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      // Determinism contract: all randomness goes through src/random.
      'no-restricted-properties': ['error', mathRandom],
    },
  },
  {
    // Determinism contract (same tree on every machine): code whose results feed generated
    // geometry, Seed hashes or baked output uses src/math, never the engine's approximations.
    files: [
      'src/generator/**',
      'src/random/**',
      'src/math/**',
      'src/forest/placement.ts',
      'src/season/profile.ts',
      'src/growth/evaluate.ts',
      'src/bake/**',
    ],
    ignores: ['**/*.test.ts'],
    rules: {
      'no-restricted-properties': [
        'error',
        mathRandom,
        ...APPROXIMATED_MATH.map((property) => ({
          object: 'Math',
          property,
          message: `Math.${property} may differ between engines; use the deterministic version in src/math.`,
        })),
      ],
      'no-restricted-syntax': [
        'error',
        {
          selector: "BinaryExpression[operator='**'], AssignmentExpression[operator='**=']",
          message: '`**` may differ between engines; use pow() from src/math.',
        },
      ],
    },
  },
);
