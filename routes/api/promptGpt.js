import { Router } from 'express'
import { ensureAuthenticated } from '../../functions/ensureAuthenticated.js'
import logger from '../../functions/logger.js'
import OpenAI from 'openai'

const openai = new OpenAI()
const router = Router()

// GET /api/promptGpt - Prompts GPT for specific
router.post('/', ensureAuthenticated, async function (req, res) {
  if (!process.env.OPENAI_API_KEY) {
    // Check if request header contains API secret key
    logger.warn(
      'server.routes.api.promptgpt.post__Blocked OpenAI API request, because OpenAI API is disabled, no OpenAI API key is set.'
    )
    res.status(409).send()
    return
  }
  if (!req.body.product_name) {
    res.status(400).send('PROVIDE_PRODUCT_NAME')
  }
  const completion = await openai.chat.completions.create({
    messages: [
      {
        role: 'system',
        content:
          'Vymysli krátký reklamní slogan, který nebude obsahovat název produktu a bude zákazníky lákat ke koupi produktu.'
      },
      { role: 'user', content: req.body.product_name }
    ],
    model: 'gpt-3.5-turbo'
  })
  if (completion.choices) {
    console.log(completion.choices)
    res.status(200).send(completion.choices)
  } else {
    res.status(500).send('NO_ANSWER')
  }
})

export default router
