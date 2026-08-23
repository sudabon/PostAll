import js from '@eslint/js'
import tseslint from 'typescript-eslint'
import reactHooks from 'eslint-plugin-react-hooks'

export default tseslint.config(
  { ignores: ['dist', 'src/platform/**', 'src/api/schema.d.ts', 'vitest.config.ts', 'playwright.config.ts', 'e2e/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['src/**/*.{ts,tsx}'],
    plugins: { 'react-hooks': reactHooks },
    rules: {
      ...reactHooks.configs.recommended.rules,
      'no-restricted-properties': [
        'error',
        {
          object: 'window',
          property: 'electron',
          message: 'UI コンポーネントから window.electron を直接参照しない。platform アダプタ経由で呼ぶ。',
        },
        {
          object: 'window',
          property: 'postallPlatform',
          message: 'UI コンポーネントから window.postallPlatform を直接参照しない。platform アダプタ経由で呼ぶ。',
        },
      ],
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: 'electron',
              message: 'UI は Electron を直接 import しない。platform アダプタ経由で呼ぶ。',
            },
          ],
        },
      ],
    },
  },
)
