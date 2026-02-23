import AutoSwagger from 'adonis-autoswagger'
import { BaseCommand } from '@adonisjs/core/ace'
import router from '@adonisjs/core/services/router'
import swagger from '#config/swagger'
import { writeFile } from 'node:fs/promises'

export default class DocsGenerate extends BaseCommand {
  static commandName = 'docs:generate'
  static description = 'Generate swagger.yml and swagger.json for production'
  static options = {
    startApp: true,
  }

  async run() {
    await import('#start/routes')

    const runtimeRouter = router as any
    if (!runtimeRouter.commited) {
      runtimeRouter.commit()
    }

    const routes = runtimeRouter.toJSON() as any
    const flattenedRoutes = Array.isArray(routes)
      ? routes
      : Object.values(routes).flatMap((domainRoutes: any) =>
          Array.isArray(domainRoutes) ? domainRoutes : []
        )
    const normalizedRoutes = { root: flattenedRoutes }

    const runtimeSwagger = AutoSwagger.default as any
    const generatedSpec = await runtimeSwagger.generate(normalizedRoutes, swagger)
    generatedSpec.paths = Object.fromEntries(
      Object.entries(generatedSpec.paths ?? {}).filter(([path]) => path.startsWith('/api/v1'))
    )

    await writeFile('swagger.json', JSON.stringify(generatedSpec, null, 2))
    await writeFile('swagger.yml', runtimeSwagger.jsonToYaml(generatedSpec))
    this.logger.success('Swagger docs generated')
  }
}
