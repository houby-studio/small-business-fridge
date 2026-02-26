import { configApp } from '@adonisjs/eslint-config'

export default [
  ...configApp(),
  {
    files: ['database/schema.ts'],
    rules: {
      'prettier/prettier': 'off',
    },
  },
]
