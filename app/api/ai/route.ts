import { createClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
})

const MODEL = 'claude-sonnet-4-20250514'

export async function POST(request: NextRequest) {
  // Authenticate
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { task, payload } = await request.json()

  try {
    switch (task) {

      case 'suggest_benchmarks':
        return NextResponse.json(await suggestBenchmarks(payload))

      case 'estimate_market_share':
        return NextResponse.json(await estimateMarketShare(payload))

      case 'suggest_factors':
        return NextResponse.json(await suggestFactors(payload))

      case 'suggest_levels':
        return NextResponse.json(await suggestLevels(payload))

      case 'suggest_assignments':
        return NextResponse.json(await suggestAssignments(payload))

      case 'explain_diagnostics':
        return NextResponse.json(await explainDiagnostics(payload))

      default:
        return NextResponse.json({ error: `Unknown task: ${task}` }, { status: 400 })
    }
  } catch (err: any) {
    console.error(`AI task ${task} failed:`, err)
    return NextResponse.json({ error: err.message ?? 'AI request failed' }, { status: 500 })
  }
}

// ─── Task: suggest_benchmarks ────────────────────────────────────────────────

async function suggestBenchmarks(payload: {
  category_anchor: string
  geography: string
}) {
  const { category_anchor, geography } = payload

  const response = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 1024,
    tools: [{ type: 'web_search_20250305', name: 'web_search' }] as any,
    system: `You are a market research assistant helping identify competitive products for a pricing analysis.
Return ONLY valid JSON — no markdown, no explanation, no preamble.`,
    messages: [{
      role: 'user',
      content: `Identify 8-12 competitive products for the following category:

Category anchor: "${category_anchor}"
Geography: "${geography}"

Search for real, currently available products that compete in this category. Return a JSON array of objects with this exact structure:
[
  { "name": "Product Name", "description": "Brief one-line description of the product" },
  ...
]

Include a range of products at different price/quality points. Focus on products that are genuinely competitive with the category anchor.`
    }]
  })

  // Web search produces multiple content blocks; the JSON answer is in the last text block
  const textBlocks = response.content.filter((c: any) => c.type === 'text' && c.text?.trim())
  const textContent = textBlocks[textBlocks.length - 1]
  if (!textContent || textContent.type !== 'text') {
    throw new Error('No text response from AI')
  }

  const match = textContent.text.match(/\[[\s\S]*\]/)
  if (!match) throw new Error('No JSON array found in benchmark suggestions response')
  const benchmarks = JSON.parse(match[0])
  return { benchmarks }
}

// ─── Task: estimate_market_share (batched) ───────────────────────────────────

async function estimateMarketShare(payload: {
  benchmark_names: string[]
  category_anchor: string
  geography: string
}) {
  const { benchmark_names, category_anchor, geography } = payload

  const productList = benchmark_names.map((n, i) => (i + 1) + '. ' + n).join('\n')

  const prompt = [
    'Estimate the market share percentage for each of the following products in this category:',
    '',
    'Category: "' + category_anchor + '"',
    'Geography: "' + geography + '"',
    '',
    'Products:',
    productList,
    '',
    'Search for recent market share data from analyst firms (IDC, Gartner, IRI, Nielsen, etc.), public filings, or trade press. A single search covering the category is sufficient.',
    '',
    'Return a JSON array with one object per product in the same order as the input list:',
    '[',
    '  {',
    '    "name": "<product name>",',
    '    "estimate": <number or null>,',
    '    "confidence": "HIGH" | "MODERATE" | "LOW" | "NOT_FOUND",',
    '    "source": "<source name and date, or null>",',
    '    "note": "<brief explanation>"',
    '  },',
    '  ...',
    ']',
    '',
    'Confidence tiers:',
    '- HIGH: cited from a named research firm or public filing within 18 months',
    '- MODERATE: inferred from multiple secondary sources',
    '- LOW: limited public data, rough estimate only',
    '- NOT_FOUND: no reliable public data found',
  ].join('\n')

  const response = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 4096,
    tools: [{ type: 'web_search_20250305', name: 'web_search' }] as any,
    system: 'You are a market research assistant estimating market share for competitive analysis.',
    messages: [{ role: 'user', content: prompt }]
  })

  // Web search produces multiple content blocks; the JSON answer is in the last text block
  const textBlocks = response.content.filter((c: any) => c.type === 'text' && c.text?.trim())
  const textContent = textBlocks[textBlocks.length - 1]
  if (!textContent || textContent.type !== 'text') {
    throw new Error('No text response from AI')
  }

  // Extract JSON array from anywhere in the response
  const raw = textContent.text
  const match = raw.match(/\[[\s\S]*\]/)
  if (!match) throw new Error('No JSON array found in market share response')
  const results = JSON.parse(match[0])
  return { results }
}

// ─── Task: suggest_assignments ───────────────────────────────────────────────

async function suggestAssignments(payload: {
  benchmark_names: string[]
  factors: { name: string; description: string; levels: { name: string; description: string }[] }[]
  category_anchor: string
}) {
  const { benchmark_names, factors, category_anchor } = payload

  const NL = String.fromCharCode(10)

  const productList = benchmark_names.map((n, i) => "  " + (i + 1) + ". " + n).join(NL)

  const factorList = factors.map((f, fi) => {
    const levelList = f.levels.map((l, li) => "      " + li + ": " + l.name + (l.description ? " — " + l.description : "")).join(NL)
    return "  Factor " + fi + ": " + f.name + (f.description ? " (" + f.description + ")" : "") + NL + levelList
  }).join(NL)

  const prompt = [
    'You are helping set up a competitive pricing model for: "' + category_anchor + '"',
    '',
    'Assign each reference product to the most appropriate performance level for each factor.',
    'Use your training knowledge of these products and their typical specifications.',
    '',
    'Reference products:',
    productList,
    '',
    'Factors and levels (use 0-based indexes):',
    factorList,
    '',
    'Return a JSON array — one object per product in input order:',
    '[',
    '  {',
    '    "product": "<product name>",',
    '    "recognized": true | false,',
    '    "assignments": { "0": <level_index>, "1": <level_index>, ... },',
    '    "confidence": "HIGH" | "MODERATE" | "LOW"',
    '  }',
    ']',
    '',
    'recognized: true if you have real knowledge of this product, false if it appears fictional, misspelled, or unknown.',
    'Confidence: HIGH=certain about specs, MODERATE=reasonable assumption, LOW=limited knowledge.',
    'If recognized=false, still include a best-guess assignments object but set confidence="LOW".',
    'Level indexes are 0-based. Level 0 = first/lowest level listed.',
  ].join(NL)

  const response = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 2048,
    system: 'You are a product specification expert. Return ONLY valid JSON — no markdown, no explanation, no preamble.',
    messages: [{ role: 'user', content: prompt }]
  })

  const textContent = response.content.find((c: any) => c.type === 'text')
  if (!textContent || textContent.type !== 'text') {
    throw new Error('No text response from AI')
  }

  const clean = textContent.text.replace(/```json|```/g, '').trim()
  return { assignments: JSON.parse(clean) }
}

// ─── Task: suggest_factors ───────────────────────────────────────────────────

async function suggestFactors(payload: {
  category_anchor: string
  benchmark_names?: string[]
}) {
  const { category_anchor, benchmark_names = [] } = payload

  const benchmarkContext = benchmark_names.length > 0
    ? `

The competitive benchmark set includes: ${benchmark_names.join(', ')}`
    : ''

  const response = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 1024,
    system: `You are a pricing methodology expert helping define purchase-decision factors for a value-based pricing model.
Return ONLY valid JSON — no markdown, no explanation, no preamble.`,
    messages: [{
      role: 'user',
      content: `Suggest 6-10 purchase-decision factors for the following product category:

Category anchor: "${category_anchor}"${benchmarkContext}

Each factor must be:
- Discriminating: meaningfully different across competitive products
- Measurable: assessable for any product in the competitive set
- Independent: not redundant with another factor

Always include "Brand" as one of the factors. Brand is a nominal factor — its levels are simply the brand names of the competitive products.

Classify each factor as ordinal (levels have a natural value direction, e.g. Performance: Basic/Standard/Advanced) or nominal (levels are categorical with no inherent order, e.g. Brand).

Return a JSON array with this exact structure:
[
  {
    "name": "Factor name",
    "description": "Brief definition for survey respondents",
    "classification": "ORDINAL" | "NOMINAL"
  },
  ...
]

The Brand factor should appear last in the array.`
    }]
  })

  const textContent = response.content.find((c: any) => c.type === 'text')
  if (!textContent || textContent.type !== 'text') {
    throw new Error('No text response from AI')
  }

  const clean = textContent.text.replace(/```json|```/g, '').trim()
  const factors = JSON.parse(clean)
  return { factors }
}

// ─── Task: suggest_levels ────────────────────────────────────────────────────

async function suggestLevels(payload: {
  factor_name: string
  factor_description: string
  classification: string
  category_anchor: string
  benchmark_names?: string[]
}) {
  const { factor_name, factor_description, classification, category_anchor, benchmark_names = [] } = payload

  // Brand factor: levels are simply the brand names from the benchmark set
  const isBrand = factor_name.toLowerCase().trim() === 'brand'
  if (isBrand && benchmark_names.length > 0) {
    // Extract unique brand names from benchmark product names
    const response = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 512,
      system: `You are a pricing methodology expert. Return ONLY valid JSON — no markdown, no explanation, no preamble.`,
      messages: [{
        role: 'user',
        content: `Extract the unique brand names from this list of competitive products: ${benchmark_names.join(', ')}

Return a JSON array of brand name objects. Each brand should appear exactly once. Use the short brand name (e.g. "Thermo Fisher" not "Thermo Fisher Scientific HERAcell VIOS 160i").

[
  { "name": "Brand name", "description": "" },
  ...
]`
      }]
    })
    const textContent = response.content.find((c: any) => c.type === 'text')
    if (!textContent || textContent.type !== 'text') throw new Error('No text response from AI')
    const clean = textContent.text.replace(/```json|```/g, '').trim()
    return { levels: JSON.parse(clean) }
  }

  const response = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 512,
    system: `You are a pricing methodology expert helping define performance levels for survey-based value analysis.
Return ONLY valid JSON — no markdown, no explanation, no preamble.`,
    messages: [{
      role: 'user',
      content: `Suggest 3-5 performance levels for the following factor:

Factor: "${factor_name}"
Description: "${factor_description}"
Classification: ${classification} (${classification === 'ORDINAL' ? 'levels have a natural value direction' : 'levels are categorical'})
Category context: "${category_anchor}"

Levels must be:
- Exhaustive: every competitive product maps to exactly one level
- Mutually exclusive: no product should map to two levels
${classification === 'ORDINAL' ? '- Listed from lowest to highest value' : '- Listed in any logical order'}

Return a JSON array with this exact structure:
[
  { "name": "Level name", "description": "Brief description" },
  ...
]`
    }]
  })

  const textContent = response.content.find((c: any) => c.type === 'text')
  if (!textContent || textContent.type !== 'text') {
    throw new Error('No text response from AI')
  }

  const clean = textContent.text.replace(/```json|```/g, '').trim()
  const levels = JSON.parse(clean)
  return { levels }
}

// ─── Task: explain_diagnostics ───────────────────────────────────────────────

async function explainDiagnostics(payload: {
  category_anchor: string
  r_squared: number
  nrmse_pct: number
  n_benchmarks: number
  factors: { name: string; weight_pct: number }[]
  targets: { name: string; point_estimate: number; range_low: number; range_high: number }[]
  outlier_names: string[]
  sensitivity_signals: { factor: string; signal: 'amber' | 'blue' | 'gray' }[]
  value_scale_spread: number
  top_benchmark_share_pct: number | null
  top_benchmark_name: string | null
  equal_share_pct: number
}) {
  const {
    category_anchor, r_squared, nrmse_pct, n_benchmarks,
    factors, targets, outlier_names, sensitivity_signals,
    value_scale_spread, top_benchmark_share_pct, top_benchmark_name, equal_share_pct,
  } = payload

  const factorList = factors
    .sort((a, b) => b.weight_pct - a.weight_pct)
    .map(f => `  - ${f.name}: ${f.weight_pct.toFixed(1)}%`)
    .join('\n')

  const targetList = targets.map(t =>
    `  - ${t.name}: $${Math.round(t.point_estimate).toLocaleString()} (range $${Math.round(t.range_low).toLocaleString()} – $${Math.round(t.range_high).toLocaleString()})`
  ).join('\n')

  const signalLines = sensitivity_signals.length > 0
    ? sensitivity_signals.map(s => {
        const label = s.signal === 'amber'
          ? 'worth reviewing — market may not price this factor as respondents indicated'
          : s.signal === 'blue'
          ? 'load-bearing — strongly influences the recommendation'
          : 'low influence — candidate for exclusion'
        return `  - ${s.factor}: ${label}`
      }).join('\n')
    : '  (no notable signals)'

  const outlierLine = outlier_names.length > 0
    ? `Outlier reference products: ${outlier_names.join(', ')}`
    : 'No outlier reference products flagged.'

  const shareNote = top_benchmark_share_pct != null && top_benchmark_name
    ? `The dominant reference product by market share is ${top_benchmark_name} at ${top_benchmark_share_pct.toFixed(0)}% (equal share would be ${equal_share_pct.toFixed(0)}%).`
    : 'Market share data not available.'

  const prompt = `You are interpreting the results of a value-based pricing model for: "${category_anchor}".

Model fit:
- Weighted R²: ${(r_squared * 100).toFixed(1)}%
- NRMSE: ${nrmse_pct.toFixed(1)}% of average price
- Reference products used: ${n_benchmarks}
- Value scale spread: ${(value_scale_spread * 100).toFixed(0)} points (out of 100)

Factor importance weights:
${factorList}

Sensitivity signals:
${signalLines}

${outlierLine}
${shareNote}

Price recommendations:
${targetList}

Write a concise 3–5 sentence plain-language interpretation of these results for a pricing team. Cover: (1) whether the model fit is strong or weak and what that means, (2) which factors are driving the recommendation and whether any are worth scrutinizing, (3) any risks or caveats (outliers, concentrated weights, narrow value scale, dominant benchmark). Be direct and specific — use product names and dollar figures where relevant. Do not explain what the methodology is. Do not use jargon like R², NRMSE, or weighted SSE.`

  const response = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 512,
    system: 'You are a pricing strategy expert writing a concise model interpretation for a professional audience.',
    messages: [{ role: 'user', content: prompt }],
  })

  const textContent = response.content.find((c: any) => c.type === 'text')
  if (!textContent || textContent.type !== 'text') throw new Error('No text response')
  return { interpretation: textContent.text.trim() }
}
