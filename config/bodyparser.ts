import { defineConfig } from '@adonisjs/core/bodyparser'

const bodyParserConfig = defineConfig({
  /**
   * The bodyparser middleware will parse the request body
   * for the following HTTP methods.
   */
  allowedMethods: ['POST', 'PUT', 'PATCH', 'DELETE'],

  /**
   * Config for the "application/x-www-form-urlencoded"
   * content-type parser
   */
  form: {
    convertEmptyStringsToNull: true,
    types: ['application/x-www-form-urlencoded'],
  },

  /**
   * Config for the JSON parser
   */
  json: {
    convertEmptyStringsToNull: true,
    types: [
      'application/json',
      'application/json-patch+json',
      'application/vnd.api+json',
      'application/csp-report',
    ],
  },

  /**
   * Config for the "multipart/form-data" content-type parser.
   * File uploads are handled by the multipart parser.
   */
  multipart: {
    /**
     * Enabling auto process allows bodyparser middleware to
     * move all uploaded files inside the tmp folder of your
     * operating system
     */
    autoProcess: true,
    convertEmptyStringsToNull: true,
    processManually: [],

    /**
     * Maximum limit of data to parse including all files and fields.
     *
     * Must stay ABOVE the largest per-file validator limit (music uploads allow 20mb, see
     * app/validators/music_track.ts). At an equal limit the bodyparser aborts the request
     * with a bare 413 before validation runs, so the user gets an untranslated error page
     * instead of a field-level message — and the validator's own limit is unreachable.
     */
    limit: '25mb',
    types: ['multipart/form-data'],
  },
})

export default bodyParserConfig
