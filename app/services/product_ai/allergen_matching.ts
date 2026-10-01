/**
 * Open Food Facts allergen tags (the EU-14 list in English) → words that name the same
 * allergen in Czech. Lets the form pre-select allergens without any AI: the instance's
 * own allergen names are matched against these words.
 */
const OFF_ALLERGEN_WORDS: Record<string, string[]> = {
  'gluten': ['lepek', 'obilovin', 'gluten'],
  'crustaceans': ['korys', 'crustacean'],
  'eggs': ['vejce', 'vajec', 'egg'],
  'fish': ['ryb', 'fish'],
  'peanuts': ['arasid', 'podzemnic', 'peanut'],
  'soybeans': ['soj', 'soy'],
  'milk': ['mlek', 'mlec', 'laktoz', 'milk'],
  'nuts': ['skorapk', 'orech', 'nut'],
  'celery': ['celer', 'celery'],
  'mustard': ['horcic', 'mustard'],
  'sesame-seeds': ['sezam', 'sesame'],
  'sulphur-dioxide-and-sulphites': ['siric', 'sulph', 'sulfit'],
  'lupin': ['vlci bob', 'lupin'],
  'molluscs': ['mekkys', 'mollusc'],
}

function normalize(text: string): string {
  return text
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
}

export function matchAllergens(
  offTags: string[],
  allergens: { id: number; name: string }[]
): number[] {
  const ids = new Set<number>()
  for (const tag of offTags) {
    const words = OFF_ALLERGEN_WORDS[tag]
    if (!words) continue
    for (const allergen of allergens) {
      const name = normalize(allergen.name)
      // "nuts" must not match "peanuts": OFF lists peanuts separately.
      if (tag === 'nuts' && (name.includes('arasid') || name.includes('peanut'))) continue
      if (words.some((w) => name.includes(w))) ids.add(allergen.id)
    }
  }
  return [...ids].sort((a, b) => a - b)
}
