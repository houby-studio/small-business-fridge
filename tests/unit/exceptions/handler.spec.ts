import '#tests/test_context'
import { test } from '@japa/runner'
import { HttpContextFactory } from '@adonisjs/core/factories/http'
import { Exception } from '@adonisjs/core/exceptions'
import HttpExceptionHandler from '#exceptions/handler'

/**
 * Status pages only render when `app.inProduction`, so the functional suite never executes
 * this code — which is how a 404 quietly became a 500 in production while every test stayed
 * green. These tests drive the handler directly with status pages forced on.
 */
class ProductionLikeHandler extends HttpExceptionHandler {
  protected renderStatusPages = true
  protected debug = false
}

test.group('HttpExceptionHandler status pages', () => {
  test('renders the not-found page through inertia when it is available', async ({ assert }) => {
    const ctx = new HttpContextFactory().create()
    const rendered: string[] = []
    // Stand-in for the Inertia middleware's contribution to the context.
    ;(ctx as any).inertia = {
      render: async (component: string) => {
        rendered.push(component)
        return component
      },
    }

    await new ProductionLikeHandler().handle(new Exception('nope', { status: 404 }), ctx)

    assert.deepEqual(rendered, ['errors/not_found'])
  })

  test('answers plainly instead of throwing when inertia is missing', async ({ assert }) => {
    // Reproduces a request that never matched a route: router middleware never ran, so
    // ctx.inertia does not exist. The handler must not raise here.
    const ctx = new HttpContextFactory().create()
    assert.isUndefined((ctx as any).inertia)

    await new ProductionLikeHandler().handle(new Exception('nope', { status: 404 }), ctx)

    assert.equal(ctx.response.getStatus(), 404)
    assert.equal(ctx.response.getBody(), 'Not found')
  })

  test('does the same for server errors', async ({ assert }) => {
    const ctx = new HttpContextFactory().create()

    await new ProductionLikeHandler().handle(new Exception('boom', { status: 500 }), ctx)

    assert.equal(ctx.response.getStatus(), 500)
    assert.equal(ctx.response.getBody(), 'Server error')
  })
})
