const js = require('@eslint/js');
const globals = require('globals');
const prettierRecommended = require('eslint-plugin-prettier/recommended');

module.exports = [
  {
    ignores: [
      'node_modules/**',
      'backups/**',
      'pacotes_enviados/**',
      'public/**',
      '.kilo/**',
      'docs/**',
      '**/*.db',
      '**/*.db-shm',
      '**/*.db-wal',
      '**/*.log',
    ],
  },
  js.configs.recommended,
  prettierRecommended,
  {
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'commonjs',
      globals: {
        ...globals.browser,
        ...globals.node,
      },
    },
    rules: {
      'prettier/prettier': 'warn',
      'no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
      'no-console': 'off',
      eqeqeq: ['warn', 'always'],
      curly: ['warn', 'multi-line'],
      'no-var': 'warn',
      'prefer-const': 'warn',
      'object-shorthand': 'warn',
      'prefer-arrow-callback': 'warn',
      'no-empty': 'warn',
      'no-useless-escape': 'warn',
    },
  },
];
