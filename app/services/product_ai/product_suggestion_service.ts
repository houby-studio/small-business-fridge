import Category from '#models/category'
import Allergen from '#models/allergen'
import Product from '#models/product'
import { lookupOpenFoodFacts, type ProductFacts } from '#services/product_images/open_food_facts'
import { matchAllergens } from '#services/product_ai/allergen_matching'
import { chatJson, isProductAiConfigured } from '#services/product_ai/azure_openai_client'

export interface SuggestionInput {
  name: string
  barcode?: string | null
  /** The description the supplier has now — asking again should give a different one. */
  currentDescription?: string | null
}

export interface ClassificationSuggestion {
  categoryId: number | null
  allergenIds: number[]
  /** Where the allergens came from — they are only ever taken from Open Food Facts. */
  allergensFrom: 'openfoodfacts' | null
}

const STYLE_EXAMPLES = 20
const MAX_INGREDIENTS = 500

async function factsFor(barcode?: string | null): Promise<ProductFacts | null> {
  if (!barcode) return null
  const lookup = await lookupOpenFoodFacts(barcode)
  return lookup.facts
}

function describeFacts(facts: ProductFacts | null): string {
  if (!facts) return 'Open Food Facts o produktu nic neví.'
  const lines = [
    facts.name && `Název v Open Food Facts: ${facts.name}`,
    facts.categories && `Kategorie v Open Food Facts: ${facts.categories}`,
    facts.ingredients && `Složení: ${facts.ingredients.slice(0, MAX_INGREDIENTS)}`,
  ].filter(Boolean)
  return lines.length ? lines.join('\n') : 'Open Food Facts o produktu nic neví.'
}

export default class ProductSuggestionService {
  static isAiAvailable(): boolean {
    return isProductAiConfigured()
  }

  /**
   * Category (AI, when configured) and allergens (Open Food Facts only — allergens are a
   * safety matter, so they are never guessed by a model from the name).
   */
  async suggestClassification(input: SuggestionInput): Promise<ClassificationSuggestion> {
    const [facts, categories, allergens] = await Promise.all([
      factsFor(input.barcode),
      Category.query().where('isDisabled', false).orderBy('name', 'asc'),
      Allergen.query().where('isDisabled', false).orderBy('name', 'asc'),
    ])

    const allergenIds = facts ? matchAllergens(facts.allergens, allergens) : []
    const result: ClassificationSuggestion = {
      categoryId: null,
      allergenIds,
      allergensFrom: facts && facts.allergens.length ? 'openfoodfacts' : null,
    }
    if (!isProductAiConfigured() || categories.length === 0) return result

    const answer = await chatJson<{ categoryId: number | null }>(
      [
        {
          role: 'system',
          content:
            'Zařazuješ produkty firemní lednice (svačiny a pití) do kategorií. ' +
            'Vyber jednu kategorii ze seznamu podle názvu a údajů o produktu. ' +
            'Když žádná nesedí, vrať null.',
        },
        {
          role: 'user',
          content:
            `Kategorie:\n${categories.map((c) => `${c.id}: ${c.name}`).join('\n')}\n\n` +
            `Produkt: ${input.name}\n${describeFacts(facts)}`,
        },
      ],
      {
        name: 'category',
        schema: {
          type: 'object',
          properties: { categoryId: { type: ['integer', 'null'] } },
          required: ['categoryId'],
          additionalProperties: false,
        },
      }
    )
    const known = categories.some((c) => c.id === answer.categoryId)
    return { ...result, categoryId: known ? answer.categoryId : null }
  }

  /** A description in the catalogue's own (playful) tone, learnt from existing products. */
  async suggestDescription(input: SuggestionInput): Promise<string> {
    const [facts, examples] = await Promise.all([
      factsFor(input.barcode),
      Product.query()
        .whereNot('description', '')
        .whereRaw('length(description) between 20 and 220')
        .orderByRaw('random()')
        .limit(STYLE_EXAMPLES),
    ])

    const answer = await chatJson<{ description: string }>(
      [
        {
          role: 'system',
          content:
            'Píšeš krátké popisky produktů pro firemní lednici — interní e-shop se ' +
            'svačinami a pitím, kde si kolegové kupují dobroty. Piš česky jednu vtipnou ' +
            'větu, nejvýš 120 znaků, se stejnou nadsázkou a drzostí jako příklady. ' +
            'Neuváděj žádná čísla, procenta, gramáže ani technické údaje a nevymýšlej ' +
            'zdravotní tvrzení. Nezačínej názvem produktu a nepoužívej uvozovky.',
        },
        {
          role: 'user',
          content:
            (examples.length
              ? `Příklady z katalogu:\n${examples
                  .map((p) => `- ${p.displayName}: ${p.description}`)
                  .join('\n')}\n\n`
              : '') +
            `Produkt: ${input.name}\n${describeFacts(facts)}` +
            (input.currentDescription?.trim()
              ? `\n\nSoučasný popis (napiš jiný): ${input.currentDescription.trim()}`
              : ''),
        },
      ],
      {
        name: 'description',
        schema: {
          type: 'object',
          properties: { description: { type: 'string' } },
          required: ['description'],
          additionalProperties: false,
        },
      }
    )
    return answer.description.trim().slice(0, 1000)
  }
}
