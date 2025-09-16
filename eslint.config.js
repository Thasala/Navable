import js from '@eslint/js';

export default [
  // Base (recommended) rules
  js.configs.recommended,

  // Default for all source files
  {
    files: ['src/**/*.js'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      // Common browser globals used across your extension
      globals: {
        window: 'readonly',
        document: 'readonly',
        console: 'readonly',
        setTimeout: 'readonly',
        clearTimeout: 'readonly',
        crypto: 'readonly',
        location: 'readonly'
      }
    },
    rules: {
      'no-unused-vars': ['warn', { argsIgnorePattern: '^_' }]
    }
  },

  // Background service worker (MV3)
  {
    files: ['src/background.js'],
    languageOptions: {
      globals: {
        chrome: 'readonly',
        self: 'readonly',
        console: 'readonly',
        setTimeout: 'readonly',
        clearTimeout: 'readonly'
      }
    }
  },

  // Content script + popup + shared utilities
  {
    files: ['src/content.js', 'src/popup/**/*.js', 'src/common/**/*.js'],
    languageOptions: {
      globals: {
        chrome: 'readonly',
        window: 'readonly',
        document: 'readonly',
        console: 'readonly',
        setTimeout: 'readonly',
        clearTimeout: 'readonly',
        crypto: 'readonly',
        location: 'readonly'
      }
    }
  },

  // (Optional) ignore built or vendor dirs if you add them later
  {
    ignores: ['dist/**', 'node_modules/**']
  }
];
