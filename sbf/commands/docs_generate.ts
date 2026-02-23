import AutoSwagger from 'adonis-autoswagger'
import { BaseCommand } from '@adonisjs/core/ace'
import router from '@adonisjs/core/services/router'
import swagger from '#config/swagger'

export default class DocsGenerate extends BaseCommand {
  static commandName = 'docs:generate'
  static description = 'Generate swagger.yml and swagger.json for production'
  static options = {
    startApp: true,
  }

  async run() {
    await import('#start/routes')

    const routes = router.toJSON() as any
    const rootRoutes = Array.isArray(routes) ? routes : (routes.root ?? [])
    const apiRoutes = { root: rootRoutes.filter((r: any) => r.pattern?.startsWith('/api/v1')) }
    await AutoSwagger.default.writeFile(apiRoutes, swagger)
    this.logger.success('Swagger docs generated')
  }
}
