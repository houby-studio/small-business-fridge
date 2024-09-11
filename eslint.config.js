import globals from 'globals'
import pluginJs from '@eslint/js'

export default [
  { languageOptions: { globals: { ...globals.browser, ...globals.node } } },
  pluginJs.configs.recommended,
  {
    ignores: [
      'public/datatables/',
      'public/javascripts/jquery-*',
      'public/javascripts/chart.*',
      'public/javascripts/bootstrap.*'
    ]
  }
]
