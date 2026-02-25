/**
 * This file is included only by tsconfig.tests.json to trigger AdonisJS module
 * augmentations (like request.validateUsing, vine.file) during test type-checking.
 *
 * These augmentations are normally loaded at runtime by AdonisJS providers
 * registered in adonisrc.ts. Since the test tsconfig can't include adonisrc.ts
 * without also pulling in start/routes.ts (which has CJS-interop types incompatible
 * with moduleResolution:bundler), we import just the augmentation-providing modules here.
 */
import '@adonisjs/core/providers/vinejs_provider'
import '@adonisjs/core/providers/edge_provider'
