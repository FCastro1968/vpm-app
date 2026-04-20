'use client'

import { useState, useEffect, useRef } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useRouter, useParams } from 'next/navigation'
import {
  ScatterChart, Scatter, XAxis, YAxis, ZAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Label, Cell,
  BarChart, Bar, LabelList, Legend,
} from 'recharts'
import { HelpTip } from '@/app/components/HelpTip'

// ─── Types ────────────────────────────────────────────────────────────────────

interface Factor {
  id: string
  name: string
  weight: number
}

interface Level {
  id: string
  attribute_id: string
  name: string
  utility: number
}

interface Benchmark {
  id: string
  name: string
  market_price: number
  market_share_pct: number
  included_in_regression: boolean
  value_index: number
  model_price: number
  residual: number
  factor_contributions: { factor_id: string; name: string; contribution: number }[]
}

interface TargetResult {
  id: string
  name: string
  use_case_type: string
  current_price: number | null
  value_index: number
  point_estimate: number
  range_low: number
  range_high: number
  factor_contributions: { factor_id: string; name: string; contribution: number }[]
}

interface ModelParams {
  b: number
  m: number
  r_squared: number
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatCurrency(val: number) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency', currency: 'USD', minimumFractionDigits: 0, maximumFractionDigits: 0
  }).format(val)
}

// Option 2 VI — fallback when stored solver VIs are not yet populated
function computeVIOption2(
  assignments: Record<string, string>,
  factors: Factor[],
  levels: Level[]
): number {
  return factors.reduce((sum, f) => {
    const levelId = assignments[f.id]
    const level = levels.find(l => l.id === levelId)
    const factorLevels = levels.filter(l => l.attribute_id === f.id)
    const minUtil = factorLevels.length ? Math.min(...factorLevels.map(l => l.utility)) : 0
    const maxUtil = factorLevels.length ? Math.max(...factorLevels.map(l => l.utility)) : 1
    const utilRange = maxUtil - minUtil
    const scaledUtil = utilRange > 0 ? ((level?.utility ?? 0) - minUtil) / utilRange : 0
    return sum + f.weight * scaledUtil
  }, 0)
}

// ─── Custom tooltip for scatter chart ────────────────────────────────────────

function ValueMapTooltip({ active, payload }: any) {
  if (!active || !payload?.length) return null
  const d = payload[0].payload
  return (
    <div className="bg-white border border-gray-200 rounded-md shadow px-3 py-2 text-xs">
      <p className="font-medium text-gray-800 mb-1">{d.name}</p>
      <p className="text-gray-500">Model price: {new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 0 }).format(d.x)}</p>
      {!d.isTarget && <p className="text-gray-500">Market price: {new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 0 }).format(d.y)}</p>}
      {!d.isTarget && <p className="text-gray-500">Market share: {d.z?.toFixed(1)}%</p>}
      {!d.isTarget && <p className={d.y > d.x ? 'text-blue-600' : 'text-red-500'}>{d.y > d.x ? '▲ Priced above model value' : '▼ Priced below model value'}</p>}
      {d.isTarget && <p className="text-amber-600 font-medium">★ Target product — recommended price</p>}
    </div>
  )
}

// ─── Component ────────────────────────────────────────────────────────────────

// ─── Factor Lollipop Component ───────────────────────────────────────────────

function FactorLollipop({ allProducts, factorsOrdered, factorsBase, priceRange, b, sortProductName, valueMode, totals }: {
  allProducts: any[]
  factorsOrdered: any[]
  factorsBase: any[]
  priceRange: number
  b: number
  sortProductName: string | null
  valueMode: 'model' | 'diff'
  totals: number[]
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const ttRef = useRef<HTMLDivElement>(null)

  const TARGET_COLORS = ['#f59e0b', '#b45309', '#fcd34d'] // amber family: mid, dark, light
  const PRODUCT_COLORS = ['#3b82f6','#10b981','#8b5cf6','#ef4444','#06b6d4','#f97316','#ec4899','#94a3b8']

  // Get color for any product — targets use amber family by target index, refs use cool palette
  const targetProducts = allProducts.filter((p: any) => p.isTarget)
  const getColor = (prod: any, pi: number) => {
    if (prod.isTarget) {
      const ti = targetProducts.indexOf(prod)
      return TARGET_COLORS[ti % TARGET_COLORS.length]
    }
    // ref products: index within reference products only
    const refIdx = allProducts.filter((p: any) => !p.isTarget).indexOf(prod)
    return PRODUCT_COLORS[refIdx % PRODUCT_COLORS.length]
  }

  const getSortedFactors = () => {
    if (!sortProductName) {
      return [...factorsOrdered].sort((a, bItem) => bItem.maxContrib - a.maxContrib)
    }
    const prod = allProducts.find(p => p.fullName === sortProductName)
    if (!prod) return [...factorsOrdered].sort((a, bItem) => bItem.maxContrib - a.maxContrib)
    const avgs = factorsOrdered.map(f => {
      const vals = allProducts.map(p => (p.contributions.find((c: any) => c.factor_id === f.id)?.contribution ?? 0) * priceRange)
      return vals.reduce((a: number, b: number) => a + b, 0) / vals.length
    })
    return [...factorsOrdered].sort((a, bItem) => {
      const ai = factorsOrdered.indexOf(a)
      const bi = factorsOrdered.indexOf(bItem)
      const valA = (prod.contributions.find((c: any) => c.factor_id === a.id)?.contribution ?? 0) * priceRange
      const valB = (prod.contributions.find((c: any) => c.factor_id === bItem.id)?.contribution ?? 0) * priceRange
      return (valB - avgs[bi]) - (valA - avgs[ai])
    })
  }

  const drawSplitDot = (ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number, colors: string[], hollow: boolean) => {
    if (hollow) {
      ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2)
      ctx.strokeStyle = colors[0]; ctx.lineWidth = 1.5; ctx.stroke()
      return
    }
    if (colors.length === 1) {
      ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2)
      ctx.fillStyle = colors[0]; ctx.fill()
    } else if (colors.length === 2) {
      ctx.save()
      ctx.beginPath(); ctx.moveTo(cx, cy); ctx.arc(cx, cy, r, -Math.PI/2, Math.PI/2); ctx.closePath()
      ctx.fillStyle = colors[0]; ctx.fill()
      ctx.beginPath(); ctx.moveTo(cx, cy); ctx.arc(cx, cy, r, Math.PI/2, -Math.PI/2); ctx.closePath()
      ctx.fillStyle = colors[1]; ctx.fill()
      ctx.restore()
    } else {
      const boundaries = [cx - r, cx - r/3, cx + r/3, cx + r]
      colors.slice(0, 3).forEach((c, i) => {
        ctx.save()
        ctx.beginPath(); ctx.rect(boundaries[i], cy - r - 1, boundaries[i+1] - boundaries[i] + 1, r * 2 + 2)
        ctx.clip()
        ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2)
        ctx.fillStyle = c; ctx.fill()
        ctx.restore()
      })
    }
  }

  const draw = () => {
    const canvas = canvasRef.current
    const container = containerRef.current
    if (!canvas || !container) return
    const sortedFactors = getSortedFactors()
    const LABEL_W = 185, PAD_R = 24, PAD_L = 12
    const ROW_H = 44, TOTAL_ROW_H = 52, HEADER_H = 26, DIVIDER_H = 28
    const allVals = sortedFactors.flatMap(f =>
      allProducts.map(p => (p.contributions.find((c: any) => c.factor_id === f.id)?.contribution ?? 0) * priceRange)
    )
    const maxFactor = Math.max(...allVals, 1)
    const W = container.offsetWidth || 700
    const TRACK_W = W - LABEL_W - PAD_L - PAD_R
    const H = HEADER_H + sortedFactors.length * ROW_H + DIVIDER_H + TOTAL_ROW_H + 16
    canvas.width = W * 2; canvas.height = H * 2
    canvas.style.width = W + 'px'; canvas.style.height = H + 'px'
    const ctx = canvas.getContext('2d')!
    ctx.scale(2, 2)
    const toX = (v: number) => LABEL_W + PAD_L + (v / maxFactor) * TRACK_W
    const labelC = '#6b7280', gridC = 'rgba(0,0,0,0.06)', tickC = 'rgba(0,0,0,0.22)', rangeC = 'rgba(0,0,0,0.09)'
    ctx.clearRect(0, 0, W, H)

    // Axis
    ctx.strokeStyle = 'rgba(0,0,0,0.18)'; ctx.lineWidth = 0.5; ctx.setLineDash([])
    ctx.beginPath(); ctx.moveTo(LABEL_W + PAD_L, HEADER_H - 4); ctx.lineTo(LABEL_W + PAD_L, HEADER_H + sortedFactors.length * ROW_H + 4); ctx.stroke()

    // Grid ticks
    ;[0.25, 0.5, 0.75, 1].forEach(t => {
      const x = toX(maxFactor * t)
      ctx.strokeStyle = gridC; ctx.lineWidth = 0.5; ctx.setLineDash([3, 3])
      ctx.beginPath(); ctx.moveTo(x, HEADER_H - 4); ctx.lineTo(x, HEADER_H + sortedFactors.length * ROW_H); ctx.stroke()
      ctx.setLineDash([])
      ctx.fillStyle = labelC; ctx.font = '9px sans-serif'; ctx.textAlign = 'center'
      ctx.fillText('$' + (Math.round(maxFactor * t / 100) * 100).toLocaleString(), x, HEADER_H - 7)
    })

    sortedFactors.forEach((factor, fi) => {
      const cy = HEADER_H + fi * ROW_H + ROW_H / 2
      const vals = allProducts.map(p => (p.contributions.find((c: any) => c.factor_id === factor.id)?.contribution ?? 0) * priceRange)
      const minV = Math.min(...vals), maxV = Math.max(...vals)
      const avg = vals.reduce((a: number, b: number) => a + b, 0) / vals.length

      if (fi % 2 === 0) {
        ctx.fillStyle = 'rgba(0,0,0,0.012)'
        ctx.beginPath(); ctx.roundRect(0, HEADER_H + fi * ROW_H + 1, W, ROW_H - 2, 3); ctx.fill()
      }
      ctx.fillStyle = labelC; ctx.font = '12px sans-serif'; ctx.textAlign = 'right'
      ctx.fillText(factor.name, LABEL_W - 8, cy + 4)

      ctx.strokeStyle = rangeC; ctx.lineWidth = 3
      ctx.beginPath(); ctx.moveTo(toX(minV), cy); ctx.lineTo(toX(maxV), cy); ctx.stroke()

      const avgX = toX(avg)
      ctx.strokeStyle = tickC; ctx.lineWidth = 1.5
      ctx.beginPath(); ctx.moveTo(avgX, cy - 7); ctx.lineTo(avgX, cy + 7); ctx.stroke()

      // Aggregate overlapping dots
      const dotPositions: Array<{cx:number, cy:number, r:number, pi:number, pis:number[]}> = []
      const xGroups: Map<number, number[]> = new Map()
      allProducts.forEach((prod, pi) => {
        const val = vals[pi]
        const cx = Math.round(toX(val))
        if (!xGroups.has(cx)) xGroups.set(cx, [])
        xGroups.get(cx)!.push(pi)
      })
      xGroups.forEach((pis, cx) => {
        if (pis.length === 1) {
          const pi = pis[0]; const prod = allProducts[pi]
          const r = prod.isTarget ? 6 : 4.5
          dotPositions.push({ cx, cy, r, pi, pis })
          const color = getColor(prod, pi)
          ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2)
          if (prod.isTarget) { ctx.fillStyle = color; ctx.fill() }
          else { ctx.strokeStyle = color; ctx.lineWidth = 1.5; ctx.stroke() }
        } else {
          const targetPis = pis.filter((pi: number) => allProducts[pi].isTarget)
          const r = 7
          let splitColors: string[] = []
          let isHollow = false
          if (sortProductName) {
            const sortPi = allProducts.findIndex((p: any) => p.fullName === sortProductName)
            if (sortPi >= 0 && pis.includes(sortPi)) splitColors = [getColor(allProducts[sortPi], sortPi)]
          }
          if (splitColors.length === 0 && targetPis.length >= 1) {
            splitColors = targetPis.slice(0, 3).map((pi: number) => getColor(allProducts[pi], pi))
          }
          if (splitColors.length === 0) { splitColors = ['#9ca3af']; isHollow = true }
          drawSplitDot(ctx, cx, cy, r, splitColors, isHollow)
          ctx.fillStyle = isHollow ? '#9ca3af' : 'white'
          ctx.font = 'bold 8px sans-serif'; ctx.textAlign = 'center'
          ctx.fillText(String(pis.length), cx, cy + 3)
          dotPositions.push({ cx, cy, r, pi: pis[0], pis })
        }
      })
      ;(factor as any)._dotPositions = dotPositions
    })

    // Divider
    const divY = HEADER_H + sortedFactors.length * ROW_H + DIVIDER_H / 2
    ctx.strokeStyle = 'rgba(0,0,0,0.12)'; ctx.lineWidth = 0.5
    ctx.beginPath(); ctx.moveTo(0, divY); ctx.lineTo(W, divY); ctx.stroke()
    ctx.fillStyle = 'rgba(0,0,0,0.3)'; ctx.font = '10px sans-serif'; ctx.textAlign = 'center'
    ctx.fillText(valueMode === 'model' ? 'Total model-implied price' : 'Total differentiated value', W / 2, divY - 4)

    // Total row — switch between model price (diff + b) and differentiated value only
    const displayTotals = valueMode === 'model' ? totals.map(t => t + b) : totals
    const totalY = HEADER_H + sortedFactors.length * ROW_H + DIVIDER_H + TOTAL_ROW_H / 2
    const tMin = Math.min(...displayTotals) * 0.96, tMax = Math.max(...displayTotals) * 1.04
    const toTX = (v: number) => LABEL_W + PAD_L + ((v - tMin) / (tMax - tMin)) * TRACK_W
    ctx.fillStyle = labelC; ctx.font = '12px sans-serif'; ctx.textAlign = 'right'
    ctx.fillText('Product total', LABEL_W - 8, totalY + 4)
    ;[tMin, (tMin + tMax) / 2, tMax].forEach(v => {
      ctx.fillStyle = labelC; ctx.font = '9px sans-serif'; ctx.textAlign = 'center'
      ctx.fillText('$' + (Math.round(v / 100) * 100).toLocaleString(), toTX(v), totalY - 16)
    })
    ctx.strokeStyle = rangeC; ctx.lineWidth = 3
    ctx.beginPath(); ctx.moveTo(toTX(tMin), totalY); ctx.lineTo(toTX(tMax), totalY); ctx.stroke()
    const tAvg = displayTotals.reduce((a: number, b: number) => a + b, 0) / displayTotals.length
    ctx.strokeStyle = tickC; ctx.lineWidth = 1.5
    ctx.beginPath(); ctx.moveTo(toTX(tAvg), totalY - 8); ctx.lineTo(toTX(tAvg), totalY + 8); ctx.stroke()
    const totalDotPositions: Array<{cx:number, cy:number, r:number, pi:number, pis:number[]}> = []
    const tXGroups: Map<number, number[]> = new Map()
    allProducts.forEach((prod, pi) => {
      const cx = Math.round(toTX(displayTotals[pi]))
      if (!tXGroups.has(cx)) tXGroups.set(cx, [])
      tXGroups.get(cx)!.push(pi)
    })
    tXGroups.forEach((pis, cx) => {
      if (pis.length === 1) {
        const pi = pis[0]; const prod = allProducts[pi]
        const r = prod.isTarget ? 7 : 5
        totalDotPositions.push({ cx, cy: totalY, r, pi, pis })
        const color = getColor(prod, pi)
        ctx.beginPath(); ctx.arc(cx, totalY, r, 0, Math.PI * 2)
        if (prod.isTarget) { ctx.fillStyle = color; ctx.fill() }
        else { ctx.strokeStyle = color; ctx.lineWidth = 1.5; ctx.stroke() }
      } else {
        const targetPis = pis.filter((pi: number) => allProducts[pi].isTarget)
        const r = 8
        let splitColors: string[] = []
        let isTotalHollow = false
        if (sortProductName) {
          const sortPi = allProducts.findIndex((p: any) => p.fullName === sortProductName)
          if (sortPi >= 0 && pis.includes(sortPi)) splitColors = [getColor(allProducts[sortPi], sortPi)]
        }
        if (splitColors.length === 0 && targetPis.length >= 1) {
          splitColors = targetPis.slice(0, 3).map((pi: number) => getColor(allProducts[pi], pi))
        }
        if (splitColors.length === 0) { splitColors = ['#9ca3af']; isTotalHollow = true }
        drawSplitDot(ctx, cx, totalY, r, splitColors, isTotalHollow)
        ctx.fillStyle = isTotalHollow ? '#9ca3af' : 'white'
        ctx.font = 'bold 8px sans-serif'; ctx.textAlign = 'center'
        ctx.fillText(String(pis.length), cx, totalY + 3)
        totalDotPositions.push({ cx, cy: totalY, r, pi: pis[0], pis })
      }
    })

    // Mouse
    const sortedFactorsSnap = sortedFactors
    canvas.onmousemove = (e: MouseEvent) => {
      const rect = canvas.getBoundingClientRect()
      const mx = e.clientX - rect.left, my = e.clientY - rect.top
      const tt = ttRef.current; if (!tt) return
      let found = false
      sortedFactorsSnap.forEach((factor, fi) => {
        const cy = HEADER_H + fi * ROW_H + ROW_H / 2
        if (Math.abs(my - cy) > ROW_H / 2) return
        const vals = allProducts.map(p => (p.contributions.find((c: any) => c.factor_id === factor.id)?.contribution ?? 0) * priceRange)
        const avg = vals.reduce((a: number, b: number) => a + b, 0) / vals.length
        const dotPos = (factor as any)._dotPositions ?? []
        dotPos.forEach(({ cx: dcx, cy: dcy, r, pi, pis }: any) => {
          if (Math.hypot(mx - dcx, my - dcy) < r + 3) {
            if (pis.length === 1) {
              const prod = allProducts[pi]
              const val = vals[pi]
              const dev = val - avg
              const rank = [...vals].sort((a: number, b: number) => b - a).indexOf(val) + 1
              const pct = totals[pi] > 0 ? Math.round(val / totals[pi] * 100) : 0
              tt.innerHTML = `
                <div style="font-weight:500;color:#111;margin-bottom:3px;">${prod.fullName}${prod.isTarget ? ' ★' : ''}</div>
                <div style="color:#6b7280;font-size:11px;margin-bottom:6px;">${factor.name}</div>
                <div style="font-size:14px;font-weight:500;color:#111;">$${Math.round(val).toLocaleString()}</div>
                <div style="color:#9ca3af;font-size:11px;margin-top:3px;">${dev >= 0 ? '+' : '-'}$${Math.round(Math.abs(dev)).toLocaleString()} vs avg · rank #${rank}</div>
                <div style="color:#9ca3af;font-size:11px;">${pct}% of differentiated value</div>
              `
            } else {
              const val = vals[pi]
              const rows = pis.map((p: number) => {
                const prod = allProducts[p]
                const color = getColor(prod, p)
                return `<div style="display:flex;align-items:center;gap:6px;margin-top:3px;">
                  <span style="width:8px;height:8px;border-radius:50%;background:${prod.isTarget ? color : 'transparent'};border:1.5px solid ${color};flex-shrink:0;"></span>
                  <span style="color:#374151;">${prod.fullName}${prod.isTarget ? ' ★' : ''}</span>
                </div>`
              }).join('')
              const dev = val - avg
              const rank = [...vals].sort((a: number, b: number) => b - a).indexOf(val) + 1
              const rowsWithPct = pis.map((p: number) => {
                const prod = allProducts[p]
                const color = getColor(prod, p)
                const pct = totals[p] > 0 ? Math.round(val / totals[p] * 100) : 0
                return `<div style="display:flex;align-items:center;gap:6px;margin-top:4px;">
                  <span style="width:8px;height:8px;border-radius:50%;background:${prod.isTarget ? color : 'transparent'};border:1.5px solid ${color};flex-shrink:0;"></span>
                  <span style="color:#374151;">${prod.fullName}${prod.isTarget ? ' ★' : ''}</span>
                  <span style="margin-left:auto;color:#9ca3af;font-size:10px;">${pct}% of diff. value</span>
                </div>`
              }).join('')
              tt.innerHTML = `
                <div style="color:#6b7280;font-size:11px;margin-bottom:3px;">${factor.name}</div>
                <div style="font-size:14px;font-weight:500;color:#111;">$${Math.round(val).toLocaleString()}</div>
                <div style="color:#9ca3af;font-size:11px;margin-top:1px;margin-bottom:5px;padding-bottom:5px;border-bottom:1px solid #f3f4f6;">${dev >= 0 ? '+' : '-'}$${Math.round(Math.abs(dev)).toLocaleString()} vs avg · rank #${rank} · ${pis.length} products</div>
                ${rowsWithPct}
              `
            }
            tt.style.display = 'block'; tt.style.left = (e.clientX + 14) + 'px'; tt.style.top = (e.clientY - 10) + 'px'
            found = true
          }
        })
      })
      if (!found) {
        totalDotPositions.forEach(({ cx: dcx, cy: dcy, r, pi, pis }: any) => {
          if (Math.hypot(mx - dcx, my - dcy) < r + 3) {
            if (pis.length === 1) {
              const prod = allProducts[pi]
              const factorRows = sortedFactorsSnap
                .map((f: any) => ({
                  name: f.name,
                  val: (prod.contributions.find((c: any) => c.factor_id === f.id)?.contribution ?? 0) * priceRange,
                }))
                .sort((a: any, b: any) => b.val - a.val)
                .map(({ name, val }: any) =>
                  `<div style="display:flex;justify-content:space-between;gap:12px;margin-top:2px;"><span style="color:#6b7280;">${name}</span><span style="color:#111;font-weight:500;">$${Math.round(val).toLocaleString()}</span></div>`
                ).join('')
              tt.innerHTML = `
                <div style="font-weight:500;color:#111;margin-bottom:2px;">${prod.fullName}${prod.isTarget ? ' ★' : ''}</div>
                <div style="font-size:13px;font-weight:500;color:#111;margin-bottom:6px;border-bottom:1px solid #f3f4f6;padding-bottom:4px;">Total: $${Math.round(displayTotals[pi]).toLocaleString()}</div>
                <div style="font-size:11px;">${factorRows}</div>
              `
            } else {
              const rows = pis.map((p: number) => {
                const prod = allProducts[p]
                const color = getColor(prod, p)
                const factorRows = sortedFactorsSnap
                  .map((f: any) => ({
                    name: f.name,
                    val: (prod.contributions.find((c: any) => c.factor_id === f.id)?.contribution ?? 0) * priceRange,
                  }))
                  .sort((a: any, b: any) => b.val - a.val)
                  .map(({ name, val }: any) =>
                    `<div style="display:flex;justify-content:space-between;gap:8px;margin-top:1px;"><span style="color:#9ca3af;font-size:10px;">${name}</span><span style="color:#374151;font-size:10px;">$${Math.round(val).toLocaleString()}</span></div>`
                  ).join('')
                return `
                  <div style="margin-top:8px;padding-top:6px;border-top:1px solid #f3f4f6;">
                    <div style="display:flex;align-items:center;gap:5px;margin-bottom:3px;">
                      <span style="width:8px;height:8px;border-radius:50%;background:${prod.isTarget ? color : 'transparent'};border:1.5px solid ${color};flex-shrink:0;"></span>
                      <span style="font-weight:500;color:#111;font-size:12px;">${prod.fullName}${prod.isTarget ? ' ★' : ''}</span>
                      <span style="margin-left:auto;font-weight:500;color:#111;font-size:12px;">$${Math.round(displayTotals[p]).toLocaleString()}</span>
                    </div>
                    ${factorRows}
                  </div>`
              }).join('')
              tt.innerHTML = `<div style="color:#6b7280;font-size:11px;margin-bottom:2px;">Product total — ${pis.length} products</div>${rows}`
            }
            tt.style.display = 'block'; tt.style.left = (e.clientX + 14) + 'px'; tt.style.top = (e.clientY - 10) + 'px'; found = true
          }
        })
      }
      if (!found) tt.style.display = 'none'
      canvas.style.cursor = found ? 'pointer' : 'default'
    }
    canvas.onmouseleave = () => { if (ttRef.current) ttRef.current.style.display = 'none' }
  }

  useEffect(() => { draw() }, [sortProductName, allProducts, factorsOrdered, priceRange, valueMode])
  useEffect(() => {
    const obs = new ResizeObserver(() => draw())
    if (containerRef.current) obs.observe(containerRef.current)
    return () => obs.disconnect()
  }, [sortProductName, allProducts, factorsOrdered, priceRange, valueMode])

  return (
    <div ref={containerRef} style={{ position: 'relative' }}>
      <canvas ref={canvasRef} />
      <div ref={ttRef} style={{
        position: 'fixed', background: 'white', border: '0.5px solid #e5e7eb',
        borderRadius: 6, padding: '8px 12px', fontSize: 12, pointerEvents: 'none',
        display: 'none', zIndex: 9999, minWidth: 200, boxShadow: '0 2px 8px rgba(0,0,0,0.1)'
      }} />
    </div>
  )
}

export default function Phase6Page() {
  const params    = useParams()
  const projectId = params.id as string
  const router    = useRouter()
  const supabase  = createClient()

  const [factors,       setFactors]       = useState<Factor[]>([])
  const [levels,        setLevels]        = useState<Level[]>([])
  const [benchmarks,    setBenchmarks]    = useState<Benchmark[]>([])
  const [targets,       setTargets]       = useState<TargetResult[]>([])
  const [modelParams,   setModelParams]   = useState<ModelParams | null>(null)
  const [loaded,          setLoaded]          = useState(false)
  const [error,           setError]           = useState('')
  const [priceBasisLabel, setPriceBasisLabel]  = useState('Market Price')
  const [activeTarget,  setActiveTarget]  = useState(0)
  const chartContainerRef = useRef<HTMLDivElement>(null)
  const [chartPlot, setChartPlot] = useState({ l: 120, t: 20, w: 700, h: 250 })
  const [whiskerTooltip, setWhiskerTooltip] = useState<{ x: number, y: number, centerY: number, target: any } | null>(null)
  const [factorChartView, setFactorChartView] = useState<'lollipop' | 'stacked'>('lollipop')
  const [factorSortProduct, setFactorSortProduct] = useState<string | null>(null)
  const [valueMode, setValueMode] = useState<'model' | 'diff'>('model')
  const [showLabels, setShowLabels] = useState(false)
const [categoryAnchor,     setCategoryAnchor]     = useState('')
  const [aiNarrative,        setAiNarrative]        = useState('')
  const [aiNarrativeLoading, setAiNarrativeLoading] = useState(false)
  const [aiNarrativeError,   setAiNarrativeError]   = useState('')
  const [narrativeCopied,    setNarrativeCopied]    = useState(false)

  // ── Load ──────────────────────────────────────────────────────────────────

  useEffect(() => {
    async function load() {
      // Load price basis label from project
      const { data: projectData } = await supabase
        .from('project')
        .select('benchmark_price_basis, benchmark_price_basis_custom_description, category_anchor')
        .eq('id', projectId)
        .single()
      if (projectData) {
        const basis = projectData.benchmark_price_basis
        const customDesc = projectData.benchmark_price_basis_custom_description
        setPriceBasisLabel(
          basis === 'LIST_PRICE' ? 'List Price' :
          basis === 'AVERAGE_MARKET_PRICE' ? 'Avg Market Price' :
          basis === 'CUSTOM' && customDesc ? customDesc :
          'Market Price'
        )
        setCategoryAnchor(projectData.category_anchor ?? '')
      }

      // Regression result
      const { data: regRows } = await supabase
        .from('regression_result')
        .select('b_value, m_value, r_squared_weighted, benchmark_value_indices')
        .eq('project_id', projectId)
        .is('scenario_id', null)
        .order('created_at', { ascending: false })
        .limit(1)

      const regData = regRows?.[0] ?? null

      if (!regData) {
        setError('No model results found. Please complete Phase 5 first.')
        setLoaded(true)
        return
      }

      const b = regData.b_value
      const m = regData.m_value
      const storedBenchmarkVIs = (regData.benchmark_value_indices ?? {}) as Record<string, number>
      setModelParams({ b, m, r_squared: regData.r_squared_weighted })

      // Factors + weights
      const { data: factorData } = await supabase
        .from('attribute')
        .select('id, name, display_order')
        .eq('project_id', projectId)
        .order('display_order')

      const { data: weightData } = await supabase
        .from('attribute_weight')
        .select('attribute_id, weight')
        .eq('project_id', projectId)

      const factorsWithWeights: Factor[] = (factorData ?? []).map(f => ({
        id: f.id,
        name: f.name,
        weight: weightData?.find(w => w.attribute_id === f.id)?.weight ?? 0,
      }))
      setFactors(factorsWithWeights)

      // Levels + utilities
      const { data: levelData } = await supabase
        .from('level')
        .select('id, attribute_id, name, display_order')
        .in('attribute_id', (factorData ?? []).map(f => f.id))

      const { data: utilityData } = await supabase
        .from('level_utility')
        .select('level_id, utility')
        .eq('project_id', projectId)

      const levelsWithUtilities: Level[] = (levelData ?? []).map(l => ({
        id: l.id,
        attribute_id: l.attribute_id,
        name: l.name,
        utility: utilityData?.find(u => u.level_id === l.id)?.utility ?? 0,
      }))
      setLevels(levelsWithUtilities)

      // Benchmarks
      const { data: benchData } = await supabase
        .from('benchmark')
        .select('id, name, market_price, market_share_pct, included_in_regression')
        .eq('project_id', projectId)
        .order('name')

      const { data: benchAssignData } = await supabase
        .from('benchmark_level_assignment')
        .select('benchmark_id, attribute_id, level_id')
        .in('benchmark_id', (benchData ?? []).map(bm => bm.id))

      const benchmarksWithVI: Benchmark[] = (benchData ?? []).map(bm => {
        // Assignments needed for both VI fallback and factor contributions
        const assigns: Record<string, string> = {}
        for (const a of benchAssignData ?? []) {
          if (a.benchmark_id === bm.id) assigns[a.attribute_id] = a.level_id
        }
        // Prefer stored solver VI (exact); fall back to Option 2 recompute until Phase 5 is re-run
        const vi = bm.id in storedBenchmarkVIs
          ? storedBenchmarkVIs[bm.id]
          : computeVIOption2(assigns, factorsWithWeights, levelsWithUtilities)
        const modelPrice = b + vi * (m - b)
        const benchContributions = factorsWithWeights.map(f => {
          const levelId = assigns[f.id]
          const level = levelsWithUtilities.find(l => l.id === levelId)
          const factorLevels = levelsWithUtilities.filter(l => l.attribute_id === f.id)
          const minUtil = factorLevels.length ? Math.min(...factorLevels.map(l => l.utility)) : 0
          const maxUtil = factorLevels.length ? Math.max(...factorLevels.map(l => l.utility)) : 1
          const utilRange = maxUtil - minUtil
          const scaledUtil = utilRange > 0 ? ((level?.utility ?? 0) - minUtil) / utilRange : 0
          return { factor_id: f.id, name: f.name, contribution: f.weight * scaledUtil }
        })
        return {
          ...bm,
          value_index: vi,
          model_price: modelPrice,
          residual: bm.market_price - modelPrice,
          factor_contributions: benchContributions,
        }
      })
      setBenchmarks(benchmarksWithVI)

      // Target products
      const { data: targetData } = await supabase
        .from('target_product')
        .select('id, name, use_case_type, current_price')
        .eq('project_id', projectId)
        .order('display_order')

      const { data: targetScoreData } = await supabase
        .from('target_score')
        .select('target_product_id, normalized_score, point_estimate, uncertainty_range_low, uncertainty_range_high, level_assignments_json')
        .eq('project_id', projectId)
        .is('scenario_id', null)
        .in('target_product_id', (targetData ?? []).map(t => t.id))

      const targetsWithContributions: TargetResult[] = (targetData ?? []).map(t => {
        const ts = targetScoreData?.find(ts => ts.target_product_id === t.id)
        const assignments = (ts?.level_assignments_json as Record<string, string>) ?? {}

        // Factor contributions: Option 2 — weight × (utility - minUtil) / (maxUtil - minUtil)
        // Min level → 0, max level → full factor weight, proportional scaling between
        const contributions = factorsWithWeights.map(f => {
          const levelId = assignments[f.id]
          const level = levelsWithUtilities.find(l => l.id === levelId)
          const factorLevels = levelsWithUtilities.filter(l => l.attribute_id === f.id)
          const minUtil = factorLevels.length ? Math.min(...factorLevels.map(l => l.utility)) : 0
          const maxUtil = factorLevels.length ? Math.max(...factorLevels.map(l => l.utility)) : 1
          const utilRange = maxUtil - minUtil
          const scaledUtil = utilRange > 0 ? ((level?.utility ?? 0) - minUtil) / utilRange : 0
          return { factor_id: f.id, name: f.name, contribution: f.weight * scaledUtil }
        })

        return {
          id: t.id,
          name: t.name,
          use_case_type: t.use_case_type,
          current_price: t.current_price,
          value_index: ts?.normalized_score ?? 0,
          point_estimate: ts?.point_estimate ?? 0,
          range_low: ts?.uncertainty_range_low ?? 0,
          range_high: ts?.uncertainty_range_high ?? 0,
          factor_contributions: contributions,
        }
      })
      setTargets(targetsWithContributions)

      setLoaded(true)

      // Ensure the layout re-renders with the latest project status.
      // router.refresh() from the previous page may race with router.push(),
      // so we call it here from the destination to guarantee the nav is in sync.
      router.refresh()
    }
    load()
  }, [projectId])

  // ── AI Narrative ──────────────────────────────────────────────────────────

  async function runNarrative() {
    setAiNarrativeLoading(true)
    setAiNarrativeError('')
    try {
      const res = await fetch('/api/ai', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          task: 'generate_narrative',
          payload: {
            category_anchor: categoryAnchor,
            price_basis_label: priceBasisLabel,
            targets: targets.filter(t => t.point_estimate > 0).map(t => ({
              name: t.name,
              point_estimate: t.point_estimate,
              value_index: t.value_index,
              use_case_type: t.use_case_type,
            })),
            top_factors: factors
              .map(f => ({ name: f.name, weight_pct: f.weight * 100 }))
              .sort((a, b) => b.weight_pct - a.weight_pct)
              .slice(0, 5),
            benchmarks: benchmarks.filter(b => b.included_in_regression).map(b => ({
              name: b.name,
              market_price: b.market_price,
              value_index: b.value_index,
            })),
            r_squared: modelParams?.r_squared ?? 0,
          },
        }),
      })
      if (!res.ok) throw new Error(`AI request failed: ${res.status}`)
      const data = await res.json()
      setAiNarrative(data.narrative ?? '')
    } catch (err: any) {
      setAiNarrativeError(err.message ?? 'AI request failed')
    } finally {
      setAiNarrativeLoading(false)
    }
  }

  async function copyNarrative() {
    await navigator.clipboard.writeText(aiNarrative)
    setNarrativeCopied(true)
    setTimeout(() => setNarrativeCopied(false), 2000)
  }

  // ── Measure Recharts plot area after chart renders ────────────────────────

  useEffect(() => {
    if (!loaded) return
    const measure = () => {
      const clipRect = chartContainerRef.current?.querySelector('defs clipPath rect')
      if (!clipRect) return
      const l = parseFloat(clipRect.getAttribute('x') || '0')
      const t = parseFloat(clipRect.getAttribute('y') || '0')
      const w = parseFloat(clipRect.getAttribute('width') || '0')
      const h = parseFloat(clipRect.getAttribute('height') || '0')
      if (w > 0 && h > 0) setChartPlot({ l, t, w, h })
    }
    const id = setTimeout(measure, 50)
    return () => clearTimeout(id)
  }, [loaded, targets])

  // ── Guards ────────────────────────────────────────────────────────────────

  if (!loaded) return <div className="text-gray-400 text-sm">Loading...</div>

  if (error || !modelParams) {
    return (
      <div className="w-full max-w-4xl mx-auto">
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-gray-900">Analysis & Output</h1>
        </div>
        <div className="bg-red-50 border border-red-200 rounded-md px-4 py-3 text-sm text-red-700">
          {error || 'No model results found. Please complete Phase 5 first.'}
        </div>
        <button
          onClick={() => router.push(`/dashboard/projects/${projectId}/phase-5`)}
          className="mt-4 px-4 py-2 border border-gray-300 text-sm font-medium rounded-md text-gray-700 hover:bg-gray-50"
        >
          ← Back to Value Pricing Model
        </button>
      </div>
    )
  }

  const { b, m } = modelParams
  const activeTargetData = targets[activeTarget]
  const includedBenchmarks = benchmarks.filter(bm => bm.included_in_regression)

  // Value map data
  // Convert value index to model-implied price for X axis
  // X = model implied price = B + VI × (M - B)
  // Y = market price
  // Regression line becomes the y=x diagonal (model price == market price)

  const scatterBenchmarks = includedBenchmarks.map(bm => ({
    x: b + bm.value_index * (m - b),
    y: bm.market_price,
    z: bm.market_share_pct ?? 1,
    name: bm.name,
    isTarget: false,
  }))

  const scatterTargets = targets.map(t => ({
    x: t.point_estimate,
    y: t.point_estimate,
    z: 5, // fixed size for target products
    name: t.name,
    isTarget: true,
  }))

  // Regression line is now y=x (model price == market price diagonal)
  const allModelPrices = [
    ...includedBenchmarks.map(bm => b + bm.value_index * (m - b)),
    ...targets.map(t => t.point_estimate),
  ]
  const allMarketPrices = includedBenchmarks.map(bm => bm.market_price)
  // Include range indicator values in axis domain so no indicator is clipped
  const benchResiduals = includedBenchmarks.map(bm => bm.residual)
  const maxRes = benchResiduals.length ? Math.max(...benchResiduals) : 0
  const minRes = benchResiduals.length ? Math.min(...benchResiduals) : 0
  // Filter out targets with zero point_estimate (not yet solved) from domain
  const solvedTargets = targets.filter(t => t.point_estimate > 0)
  const allRangeValues = solvedTargets.flatMap(t => [
    t.range_low, t.range_high,
    t.point_estimate + maxRes, t.point_estimate + minRes,
  ])
  const allPrices = [...allModelPrices, ...allMarketPrices, ...allRangeValues]
  const priceMin = Math.min(...allPrices)
  const priceMax = Math.max(...allPrices)
  const pricePadding = (priceMax - priceMin) * 0.12
  // Dynamic tick interval — targets ~6 ticks regardless of price scale
  const rawRange = (priceMax + pricePadding) - Math.max(0, priceMin - pricePadding)
  const rawInterval = rawRange / 6
  const magnitude = Math.pow(10, Math.floor(Math.log10(rawInterval)))
  const normalised = rawInterval / magnitude
  const tickUnit = normalised < 1.5 ? magnitude
                 : normalised < 3.5 ? 2 * magnitude
                 : normalised < 7.5 ? 5 * magnitude
                 : 10 * magnitude
  const axisMin = Math.max(0, Math.floor((priceMin - pricePadding) / tickUnit) * tickUnit)
  const axisMax = Math.ceil((priceMax + pricePadding) / tickUnit) * tickUnit
  const regressionLine = [
    { x: axisMin, y: axisMin },
    { x: axisMax, y: axisMax },
  ]

  // Stacked bar chart data — dollar values per factor + base value
  // Model price = B + sum(factor contributions × (M - B))
  const priceRange = m - b

  const allProductsForChart = [
    ...includedBenchmarks.map(bm => ({
      name: bm.name.length > 18 ? bm.name.slice(0, 16) + '…' : bm.name,
      fullName: bm.name,
      value_index: bm.value_index,
      isTarget: false,
      contributions: bm.factor_contributions,
    })),
    ...targets.map(t => ({
      name: (t.name.length > 18 ? t.name.slice(0, 16) + '…' : t.name) + ' ★',
      fullName: t.name,
      value_index: t.value_index,
      isTarget: true,
      contributions: t.factor_contributions,
    })),
  ].sort((a, bItem) => bItem.value_index - a.value_index)

  // Order factors by max dollar contribution across all products — highest first (bottom of stack)
  const factorMaxContributions = factors.map(f => {
    const maxContrib = Math.max(
      ...allProductsForChart.map(p => {
        const fc = p.contributions.find(c => c.factor_id === f.id)
        return fc ? fc.contribution * priceRange : 0
      })
    )
    return { id: f.id, name: f.name, maxContrib }
  }).sort((a, bItem) => bItem.maxContrib - a.maxContrib)

  const factorNames = factorMaxContributions.map(f => f.name)

  // Build chart rows: Base Value (B) + each factor dollar contribution
  const stackedBarData = allProductsForChart.map(product => {
    const row: Record<string, any> = {
      name: product.name,
      fullName: product.fullName,
      isTarget: product.isTarget,
      'Base Value': valueMode === 'model' ? Math.round(b) : 0,
    }
    for (const fc of product.contributions) {
      row[fc.name] = Math.round(fc.contribution * priceRange)
    }
    return row
  })

  // Color palette — Base Value gets neutral gray, factors get distinct colors
  const FACTOR_COLORS = [
    '#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6',
    '#06b6d4', '#84cc16', '#f97316', '#ec4899', '#6366f1',
    '#14b8a6', '#eab308',
  ]


  // Positioning table — benchmarks + targets sorted by value index
  const positioningRows = [
    ...includedBenchmarks.map(bm => ({
      id: bm.id,
      name: bm.name,
      value_index: bm.value_index,
      market_price: bm.market_price,
      model_price: bm.model_price,
      price_to_value: bm.market_price / (bm.model_price || 1),
      isTarget: false,
    })),
    ...targets.map(t => ({
      id: t.id,
      name: t.name + ' ★',
      value_index: t.value_index,
      market_price: t.point_estimate,
      model_price: t.point_estimate,
      price_to_value: 1.0,
      isTarget: true,
    })),
  ].sort((a, b) => b.value_index - a.value_index)

  return (
    <div className="w-full max-w-5xl mx-auto">

      <div className="mb-6 flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Analysis & Output</h1>
          <p className="text-gray-500 mt-1 text-sm">
            Model results, competitive positioning, and price recommendations.
          </p>
        </div>
      </div>

      <div className="space-y-8">

        {/* ── AI Positioning Narrative ───────────────────────────────────── */}
        <section className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
          <div className="flex items-center justify-between mb-3">
            <div>
              <h2 className="text-base font-semibold text-gray-900">Positioning Narrative</h2>
              <p className="text-xs text-gray-500 mt-0.5">AI-drafted executive summary of the model results. Review and edit before sharing.</p>
            </div>
            {!aiNarrative && (
              <button
                onClick={runNarrative}
                disabled={aiNarrativeLoading}
                className="flex items-center gap-2 px-3 py-1.5 text-xs font-medium text-blue-700 bg-blue-50 border border-blue-200 rounded-md hover:bg-blue-100 disabled:opacity-50 flex-shrink-0"
              >
                {aiNarrativeLoading ? (
                  <>
                    <span className="inline-block w-3 h-3 border-2 border-blue-400 border-t-transparent rounded-full animate-spin" />
                    Generating…
                  </>
                ) : '✦ Generate Narrative'}
              </button>
            )}
          </div>

          {aiNarrativeError && (
            <p className="text-xs text-red-600 mt-1">{aiNarrativeError}</p>
          )}

          {!aiNarrative && !aiNarrativeLoading && (
            <p className="text-sm text-gray-400 italic">Click "Generate Narrative" to produce a plain-language positioning summary of the model results.</p>
          )}

          {aiNarrativeLoading && (
            <div className="flex items-center gap-2 text-sm text-gray-400">
              <span className="inline-block w-4 h-4 border-2 border-gray-300 border-t-blue-400 rounded-full animate-spin" />
              Drafting narrative…
            </div>
          )}

          {aiNarrative && (
            <div>
              <p className="text-sm text-gray-700 leading-relaxed whitespace-pre-wrap">{aiNarrative}</p>
              <div className="flex items-center gap-3 mt-3 pt-3 border-t border-gray-100">
                <button
                  onClick={copyNarrative}
                  className="text-xs text-gray-500 hover:text-gray-700"
                >
                  {narrativeCopied ? '✓ Copied' : 'Copy to clipboard'}
                </button>
                <button
                  onClick={() => { setAiNarrative(''); setAiNarrativeError('') }}
                  className="text-xs text-blue-500 hover:text-blue-700"
                >
                  ✦ Regenerate
                </button>
              </div>
            </div>
          )}
        </section>

        {/* ── Value Map ─────────────────────────────────────────────────── */}
        <section className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
          <h2 className="text-base font-semibold text-gray-900 mb-1 flex items-center gap-1.5">Value Map
            <HelpTip width="w-96" content="The diagonal line represents fair value — products priced exactly at their model-implied value sit on it. Products above the line are priced higher than their value score suggests (overpriced); below the line are underpriced. Target product(s) appear as a 5-dot strip at their model-implied price: the large center dot is the point estimate, solid medium dots define the statistical range (±1 std dev of benchmark residuals), and hollow dots show the market envelope (the observed high and low residuals from the reference set). Hover the strip for exact values." />
          </h2>
          <p className="text-xs text-gray-500 mb-4">
            X axis = model-implied price. Y axis = actual market price. Products above the diagonal line are priced above their model value; below are underpriced. Target product(s) sit on the line at their recommended price.
          </p>
          <div ref={chartContainerRef} style={{ position: "relative" }}>
          <ResponsiveContainer width="100%" height={340}>
            <ScatterChart margin={{ top: 20, right: 30, bottom: 40, left: 60 }}>
              <ZAxis type="number" dataKey="z" range={[40, 600]} />
              <CartesianGrid strokeDasharray="3 3" stroke="#d1d5db" horizontal={true} vertical={true} />
              <XAxis
                type="number"
                dataKey="x"
                domain={[axisMin, axisMax]}
                tickFormatter={v => `$${Math.round(v).toLocaleString()}`}
                tick={{ fontSize: 11 }}
                padding={{ left: 0, right: 0 }}
              >
                <Label value="Model-Implied Price" position="insideBottom" offset={-25} style={{ fontSize: 12, fill: '#6b7280' }} />
              </XAxis>
              <YAxis
                type="number"
                dataKey="y"
                domain={[axisMin, axisMax]}
                tickFormatter={v => `$${Math.round(v).toLocaleString()}`}
                tick={{ fontSize: 11 }}
                padding={{ top: 0, bottom: 0 }}
              >
                <Label value={priceBasisLabel} angle={-90} position="insideLeft" offset={10} style={{ fontSize: 12, fill: '#6b7280' }} />
              </YAxis>
              <Tooltip content={<ValueMapTooltip />} />

              {/* Regression line */}
              <Scatter
                data={regressionLine}
                line={{ stroke: '#94a3b8', strokeWidth: 1.5, strokeDasharray: '5 5' }}
                shape={() => null as any}
                legendType="none"
              />

              {/* Benchmarks */}
              <Scatter data={scatterBenchmarks}>
                {scatterBenchmarks.map((_, i) => (
                  <Cell key={i} fill="#3b82f6" opacity={0.85} />
                ))}
              </Scatter>

{/* Target products rendered in SVG overlay as 5-dot strips */}


            </ScatterChart>
          </ResponsiveContainer>
          {/* Whisker + label overlay */}
          {(() => {
            const container = chartContainerRef.current
            if (!container || !targets.length) return null
            const W = container.offsetWidth
            const H = 340
            const { l: plotL, t: plotT, w: plotW, h: plotH } = chartPlot
            if (plotW <= 0 || plotH <= 0) return null
            const toPixX = (v: number) => plotL + ((v - axisMin) / (axisMax - axisMin)) * plotW
            const toPixY = (v: number) => plotT + (1 - (v - axisMin) / (axisMax - axisMin)) * plotH
            const colors = ['#f59e0b', '#b45309', '#fcd34d']

            // ── Smart label placement ─────────────────────────────────────────
            const CHAR_W = 5.8, LABEL_H = 13, PAD = 5
            const truncate = (s: string) => s.length > 18 ? s.slice(0, 16) + '…' : s
            const labelW = (s: string) => s.length * CHAR_W + 6

            const rawItems = [
              ...scatterBenchmarks.map(bm => ({
                dotX: toPixX(bm.x), dotY: toPixY(bm.y),
                label: truncate(bm.name), color: '#374151', dotR: 7,
              })),
              ...solvedTargets.map((t, ti) => ({
                dotX: toPixX(t.point_estimate), dotY: toPixY(t.point_estimate),
                label: truncate(t.name), color: colors[ti % colors.length], dotR: 9,
              })),
            ]

            // Place label right of dot (or left if near right edge).
            const placed = rawItems.map(item => {
              const lw = labelW(item.label)
              const rightX = item.dotX + item.dotR + 6
              const fitsRight = rightX + lw < plotL + plotW + 10
              const anchor = fitsRight ? 'right' : 'left'
              return {
                ...item,
                lx: anchor === 'right' ? rightX : item.dotX - item.dotR - 6 - lw,
                ly: item.dotY + 4,
                lw,
                anchor: anchor as 'right' | 'left',
                naturalLy: item.dotY + 4,
              }
            })

            // Compute connector line endpoints for current label position
            function connectorFor(item: typeof placed[0]): { x1:number,y1:number,x2:number,y2:number } | null {
              const displaced = Math.abs(item.ly - item.naturalLy) > 8
              if (!displaced) return null
              const lineX = item.anchor === 'right' ? item.lx - 2 : item.lx + item.lw + 2
              const lineY = item.ly - 3
              const angle = Math.atan2(lineY - item.dotY, lineX - item.dotX)
              return {
                x1: item.dotX + Math.cos(angle) * (item.dotR + 2),
                y1: item.dotY + Math.sin(angle) * (item.dotR + 2),
                x2: lineX, y2: lineY,
              }
            }

            // Iterative nudge — resolves label-label and label-dot overlaps.
            const yMin = plotT + LABEL_H + 2
            const yMax = plotT + plotH - 2
            for (let iter = 0; iter < 80; iter++) {
              let changed = false

              // Label vs label
              for (let i = 0; i < placed.length; i++) {
                for (let j = i + 1; j < placed.length; j++) {
                  const hOv = Math.abs(placed[i].lx - placed[j].lx) < (placed[i].lw + placed[j].lw) / 2 + PAD
                  if (!hOv) continue
                  const dy = placed[j].ly - placed[i].ly
                  const ov = LABEL_H + PAD - Math.abs(dy)
                  if (ov > 0) {
                    const push = ov / 2 + 0.5
                    placed[i].ly -= push
                    placed[j].ly += push
                    changed = true
                  }
                }
              }

              // Label vs every dot (dots are fixed obstacles)
              for (let i = 0; i < placed.length; i++) {
                for (const dot of rawItems) {
                  const lLeft = placed[i].lx, lRight = placed[i].lx + placed[i].lw
                  const lTop = placed[i].ly - LABEL_H, lBot = placed[i].ly
                  const dPad = 3
                  const dLeft = dot.dotX - dot.dotR - dPad, dRight = dot.dotX + dot.dotR + dPad
                  const dTop  = dot.dotY - dot.dotR - dPad, dBot  = dot.dotY + dot.dotR + dPad
                  const hOv = Math.min(lRight, dRight) - Math.max(lLeft, dLeft)
                  const vOv = Math.min(lBot,   dBot)   - Math.max(lTop,  dTop)
                  if (hOv > 0 && vOv > 0) {
                    const labelCY = (lTop + lBot) / 2
                    placed[i].ly += labelCY <= dot.dotY ? -(vOv + 1) : (vOv + 1)
                    changed = true
                  }
                }
              }

              // Clamp within plot bounds
              for (let i = 0; i < placed.length; i++) {
                const clamped = Math.max(yMin, Math.min(yMax, placed[i].ly))
                if (clamped !== placed[i].ly) { placed[i].ly = clamped; changed = true }
              }

              if (!changed) break
            }

            return (
              <>
              <svg style={{ position: 'absolute', top: 0, left: 0, width: W, height: H, pointerEvents: 'none' }}>
                {/* Quadrant shading */}
                {(() => {
                  const x0 = plotL, y0 = plotT, x1 = plotL + plotW, y1 = plotT + plotH
                  return (
                    <>
                      <polygon points={`${x0},${y0} ${x1},${y0} ${x0},${y1}`} fill="#ef4444" opacity={0.04} />
                      <polygon points={`${x1},${y0} ${x1},${y1} ${x0},${y1}`} fill="#3b82f6" opacity={0.04} />
                      <text x={x0 + 8} y={y0 + 14} fontSize={9} fill="#ef4444" opacity={0.5} fontFamily="sans-serif">overpriced</text>
                      <text x={x1 - 8} y={y1 - 6} fontSize={9} fill="#3b82f6" opacity={0.5} fontFamily="sans-serif" textAnchor="end">underpriced</text>
                    </>
                  )
                })()}

                {/* Whisker strips */}
                {solvedTargets.map((t, ti) => {
                  const envCeiling = t.point_estimate + maxRes
                  const envFloor   = t.point_estimate + minRes
                  const c = colors[ti % colors.length]
                  const cx = toPixX(t.point_estimate)
                  const yEnvFloor    = toPixY(envFloor)
                  const yStatFloor   = toPixY(t.range_low)
                  const yCenter      = toPixY(t.point_estimate)
                  const yStatCeiling = toPixY(t.range_high)
                  const yEnvCeiling  = toPixY(envCeiling)
                  const yBottom = Math.max(yEnvFloor, yStatFloor, yCenter, yStatCeiling, yEnvCeiling)
                  const yTop2   = Math.min(yEnvFloor, yStatFloor, yCenter, yStatCeiling, yEnvCeiling)
                  return (
                    <g key={t.id}>
                      <line x1={cx} y1={yBottom} x2={cx} y2={yTop2} stroke={c} strokeWidth={1} opacity={0.5} />
                      <circle cx={cx} cy={yEnvFloor}    r={4} fill="white" stroke={c} strokeWidth={1.5} opacity={0.75} />
                      <circle cx={cx} cy={yEnvCeiling}  r={4} fill="white" stroke={c} strokeWidth={1.5} opacity={0.75} />
                      <circle cx={cx} cy={yStatFloor}   r={5} fill={c} opacity={0.75} />
                      <circle cx={cx} cy={yStatCeiling} r={5} fill={c} opacity={0.75} />
                      <circle cx={cx} cy={yCenter}      r={8} fill={c} opacity={1} />
                    </g>
                  )
                })}

                {/* Labels with connector lines */}
                {showLabels && placed.map((item, i) => {
                  // Connector line from dot edge to label, only when label was pushed far
                  const displaced = Math.abs(item.ly - item.naturalLy) > 8
                  // Line endpoint: left edge of label if placed right, right edge if placed left
                  const lineX = item.anchor === 'right' ? item.lx - 2 : item.lx + item.lw + 2
                  const lineY = item.ly - 3 // approx text midline
                  // Dot edge toward label
                  const angle = Math.atan2(lineY - item.dotY, lineX - item.dotX)
                  const edgeX = item.dotX + Math.cos(angle) * (item.dotR + 2)
                  const edgeY = item.dotY + Math.sin(angle) * (item.dotR + 2)
                  return (
                    <g key={i}>
                      {displaced && (
                        <line
                          x1={edgeX} y1={edgeY} x2={lineX} y2={lineY}
                          stroke={item.color} strokeWidth={0.75} opacity={0.4}
                          strokeDasharray="2 2"
                        />
                      )}
                      <text
                        x={item.lx}
                        y={item.ly}
                        fontSize={10}
                        fill={item.color}
                        fontFamily="sans-serif"
                        style={{ userSelect: 'none' }}
                      >
                        {item.label}
                      </text>
                    </g>
                  )
                })}
              </svg>

              {/* Hit targets for whisker tooltips */}
              <svg style={{ position: 'absolute', top: 0, left: 0, width: W, height: H, pointerEvents: 'none' }}>
                {solvedTargets.map((t, ti) => {
                  const envCeiling = t.point_estimate + maxRes
                  const envFloor   = t.point_estimate + minRes
                  const cx = toPixX(t.point_estimate)
                  const yAllBot = Math.max(toPixY(envFloor), toPixY(t.range_low))
                  const yAllTop = Math.min(toPixY(envCeiling), toPixY(t.range_high))
                  return (
                    <rect key={t.id}
                      x={cx - 10} y={yAllTop} width={20} height={yAllBot - yAllTop}
                      fill="transparent"
                      onMouseEnter={() => setWhiskerTooltip({ x: cx, y: yAllTop, centerY: (yAllTop + yAllBot) / 2, target: { ...t, envFloor, envCeiling } })}
                      onMouseLeave={() => setWhiskerTooltip(null)}
                      style={{ cursor: 'crosshair', pointerEvents: 'all' }}
                    />
                  )
                })}
              </svg>
              </>
            )
          })()}
          {/* Whisker tooltip */}
          {whiskerTooltip && (() => {
            const t = whiskerTooltip.target
            const fmt = (v: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 0 }).format(v)
            return (
              <div style={{
                position: 'absolute',
                left: whiskerTooltip.x + 14,
                top: whiskerTooltip.centerY - 60,
                pointerEvents: 'none',
                zIndex: 50,
              }}
                className="bg-white border border-gray-200 rounded-md shadow-lg px-3 py-2 text-xs"
              >
                <p className="font-semibold text-gray-900 mb-1.5">{t.name}</p>
                <div className="space-y-0.5">
                  <div className="flex justify-between gap-4">
                    <span className="text-gray-400">▲ Env. ceiling</span>
                    <span className="font-medium text-gray-700">{fmt(t.envCeiling)}</span>
                  </div>
                  <div className="flex justify-between gap-4">
                    <span className="text-gray-500">  Stat. ceiling</span>
                    <span className="font-medium text-gray-700">{fmt(t.range_high)}</span>
                  </div>
                  <div className="flex justify-between gap-4 border-t border-gray-100 pt-0.5 mt-0.5">
                    <span className="text-gray-800 font-medium">★ Model price</span>
                    <span className="font-semibold text-gray-900">{fmt(t.point_estimate)}</span>
                  </div>
                  <div className="flex justify-between gap-4">
                    <span className="text-gray-500">  Stat. floor</span>
                    <span className="font-medium text-gray-700">{fmt(t.range_low)}</span>
                  </div>
                  <div className="flex justify-between gap-4">
                    <span className="text-gray-400">▼ Env. floor</span>
                    <span className="font-medium text-gray-700">{fmt(t.envFloor)}</span>
                  </div>
                </div>
              </div>
            )
          })()}
          </div>
          <div className="flex items-center justify-between mt-2">
            <div className="flex items-center gap-6 text-xs text-gray-500">
            <span className="flex items-center gap-1.5">
              <span className="w-3 h-3 rounded-full bg-blue-500 inline-block" /> Reference products (bubble size = market share)
            </span>
            <span className="flex items-center gap-1.5">
              <span className="w-6 border-t border-dashed border-gray-400 inline-block" /> Fair value line (above = overpriced, below = underpriced)
            </span>
            <span className="flex items-center gap-1.5">
              <span className="inline-flex items-center gap-0.5 mr-1">
                <span style={{ display:'inline-block', width:7, height:7, borderRadius:'50%', border:'1.5px solid #f59e0b', background:'white' }} />
                <span style={{ display:'inline-block', width:9, height:9, borderRadius:'50%', background:'#f59e0b', opacity:0.75 }} />
                <span style={{ display:'inline-block', width:14, height:14, borderRadius:'50%', background:'#f59e0b' }} />
                <span style={{ display:'inline-block', width:9, height:9, borderRadius:'50%', background:'#f59e0b', opacity:0.75 }} />
                <span style={{ display:'inline-block', width:7, height:7, borderRadius:'50%', border:'1.5px solid #f59e0b', background:'white' }} />
              </span>
              Target product(s): model price (large) · stat. range (solid) · envelope (hollow). Hover for values.
            </span>
            </div>
            <button
              onClick={() => setShowLabels(v => !v)}
              className={`text-xs px-2.5 py-1 rounded border transition-colors ${showLabels ? 'bg-gray-100 border-gray-300 text-gray-700 font-medium' : 'border-gray-200 text-gray-400 hover:text-gray-600 hover:bg-gray-50'}`}
            >
              Labels
            </button>
          </div>
        </section>

        {/* ── Factor Contributions ─────────────────────────────────────────── */}
        <section className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
          <div className="flex items-center justify-between mb-1">
            <h2 className="text-base font-semibold text-gray-900 flex items-center gap-1.5">Factor Contributions
              <HelpTip width="w-80" content="Each row shows the dollar value one factor contributes to a product's model-implied price. The gray bar spans the full range across all products (min to max). The short vertical tick marks the average. Filled dots are target products; hollow dots are reference products. Click a product in the legend to re-sort by that product's deviation from average — factors where it stands out appear first." />
            </h2>
            <div className="flex items-center gap-3">
              <div className="flex items-center gap-1 text-xs text-gray-400">
                <button
                  onClick={() => setValueMode('model')}
                  className={`transition-colors ${valueMode === 'model' ? 'text-gray-700 font-medium' : 'hover:text-gray-500'}`}
                >Model price</button>
                <span>·</span>
                <button
                  onClick={() => setValueMode('diff')}
                  className={`transition-colors ${valueMode === 'diff' ? 'text-gray-700 font-medium' : 'hover:text-gray-500'}`}
                >Differentiated value</button>
              </div>
              <div className="flex gap-2">
                <button
                  onClick={() => setFactorChartView('lollipop')}
                  className={`text-xs px-3 py-1 rounded border ${factorChartView === 'lollipop' ? 'bg-gray-100 border-gray-300 font-medium' : 'border-gray-200 text-gray-500 hover:bg-gray-50'}`}
                >Lollipop</button>
                <button
                  onClick={() => setFactorChartView('stacked')}
                  className={`text-xs px-3 py-1 rounded border ${factorChartView === 'stacked' ? 'bg-gray-100 border-gray-300 font-medium' : 'border-gray-200 text-gray-500 hover:bg-gray-50'}`}
                >Stacked bar</button>
              </div>
            </div>
          </div>
          <p className="text-xs text-gray-500 mb-3">
            {factorChartView === 'lollipop'
              ? 'Dollar contribution per factor across all products. Click a product in the legend to sort by its differentiation.'
              : valueMode === 'model' ? 'Full model-implied price by factor. Gray = Base Value (category floor). Target product(s) marked with ★.' : 'Differentiated value only — factor contributions above the category floor. Target product(s) marked with ★.'}
          </p>

          {/* ── Product legend (lollipop view) ── */}
          {factorChartView === 'lollipop' && (
            <div className="mb-2">
              <div className="flex flex-wrap gap-2 mb-1">
                {allProductsForChart.map((prod, pi) => {
                  const targetProds = allProductsForChart.filter(p => p.isTarget)
                  const TARGET_COLORS_LEGEND = ['#f59e0b', '#b45309', '#fcd34d']
                  const PROD_COLORS_LEGEND = ['#3b82f6','#10b981','#8b5cf6','#ef4444','#06b6d4','#f97316','#ec4899','#94a3b8']
                  const color = prod.isTarget
                    ? TARGET_COLORS_LEGEND[targetProds.indexOf(prod) % TARGET_COLORS_LEGEND.length]
                    : PROD_COLORS_LEGEND[allProductsForChart.filter(p => !p.isTarget).indexOf(prod) % PROD_COLORS_LEGEND.length]
                  const isActive = factorSortProduct === prod.fullName
                  return (
                    <button
                      key={prod.fullName}
                      onClick={() => setFactorSortProduct(isActive ? null : prod.fullName)}
                      className="flex items-center gap-1.5 text-xs px-2 py-1 rounded border transition-all"
                      style={{
                        borderColor: isActive ? color : 'transparent',
                        background: isActive ? `${color}15` : 'transparent',
                        opacity: factorSortProduct && !isActive ? 0.45 : 1,
                        color: 'var(--color-text-secondary)',
                      }}
                    >
                      <span style={{
                        width: prod.isTarget ? 10 : 8,
                        height: prod.isTarget ? 10 : 8,
                        borderRadius: '50%',
                        background: prod.isTarget ? color : 'transparent',
                        border: `1.5px solid ${color}`,
                        display: 'inline-block',
                        flexShrink: 0,
                      }} />
                      {prod.fullName}{prod.isTarget ? ' ★' : ''}
                    </button>
                  )
                })}
              </div>
              <div className="flex items-center gap-2 min-h-[16px]">
                <span className="text-xs text-gray-400">
                  {factorSortProduct ? `Sorted by: ${factorSortProduct} deviation` : 'Sorted by: max contribution'}
                </span>
                {factorSortProduct && (
                  <button onClick={() => setFactorSortProduct(null)} className="text-xs text-blue-500 underline">reset</button>
                )}
              </div>
            </div>
          )}

          {/* ── Lollipop canvas ── */}
          {factorChartView === 'lollipop' && (
            <FactorLollipop
              allProducts={allProductsForChart}
              factorsOrdered={factorMaxContributions}
              factorsBase={factorMaxContributions}
              priceRange={priceRange}
              b={b}
              sortProductName={factorSortProduct}
              valueMode={valueMode}
              totals={allProductsForChart.map(p => p.contributions.reduce((s, c) => s + c.contribution * priceRange, 0))}
            />
          )}

          {/* ── Stacked bar ── */}
          {factorChartView === 'stacked' && (
            <ResponsiveContainer width="100%" height={Math.max(280, stackedBarData.length * 42)}>
              <BarChart
                data={stackedBarData}
                layout="vertical"
                margin={{ top: 0, right: 40, bottom: 28, left: 140 }}
                barCategoryGap="20%"
              >
                <CartesianGrid strokeDasharray="3 3" vertical={true} horizontal={false} stroke="#f0f0f0" />
                <XAxis
                  type="number"
                  domain={[0, 'auto']}
                  tickFormatter={v => `$${Math.round(v).toLocaleString()}`}
                  tick={{ fontSize: 10 }}
                  label={{ value: 'Model-implied price', position: 'insideBottom', offset: -2, style: { fontSize: 11, fill: '#6b7280' } }}
                />
                <YAxis
                  type="category"
                  dataKey="name"
                  tick={({ x, y, payload }: any) => (
                    <text x={x - 4} y={y} textAnchor="end" dominantBaseline="middle"
                      fontSize={11} fontWeight={payload.value.includes('★') ? 600 : 400}
                      fill={payload.value.includes('★') ? '#b45309' : '#374151'}>
                      {payload.value}
                    </text>
                  )}
                  width={135}
                />
                <Tooltip
                  content={({ active, payload, label }: any) => {
                    if (!active || !payload?.length) return null
                    const total = payload.reduce((sum: number, p: any) => sum + (Number(p.value) || 0), 0)
                    return (
                      <div style={{ background: 'white', border: '1px solid #e5e7eb', borderRadius: '6px', padding: '8px 12px', fontSize: '11px', maxWidth: '220px' }}>
                        <p style={{ fontWeight: 600, marginBottom: '6px', color: '#111827' }}>{payload[0]?.payload?.fullName ?? label}</p>
                        <p style={{ fontWeight: 600, color: '#1d4ed8', marginBottom: '4px', borderBottom: '1px solid #f3f4f6', paddingBottom: '4px' }}>
                          Total: ${Math.round(total).toLocaleString()}
                        </p>
                        {[...payload].reverse().map((p: any, i: number) => (
                          <div key={i} style={{ display: 'flex', justifyContent: 'space-between', gap: '12px', marginTop: '2px' }}>
                            <span style={{ color: p.fill, display: 'flex', alignItems: 'center', gap: '4px' }}>
                              <span style={{ width: 8, height: 8, borderRadius: 2, background: p.fill, display: 'inline-block', flexShrink: 0 }} />
                              {p.name}
                            </span>
                            <span style={{ color: '#374151', fontWeight: 500 }}>${Math.round(Number(p.value)).toLocaleString()}</span>
                          </div>
                        ))}

                      </div>
                    )
                  }}
                />
                <Bar key="Base Value" dataKey="Base Value" stackId="vi" fill="#d1d5db" opacity={1} />
                {(factorSortProduct
                  ? [...factorMaxContributions].sort((a, bItem) => {
                      const prod = allProductsForChart.find(p => p.fullName === factorSortProduct)
                      if (!prod) return 0
                      const ca = prod.contributions.find(c => c.factor_id === a.id)?.contribution ?? 0
                      const cb = prod.contributions.find(c => c.factor_id === bItem.id)?.contribution ?? 0
                      return ca - cb
                    })
                  : factorMaxContributions
                ).map((f, i) => (
                  <Bar key={f.name} dataKey={f.name} stackId="vi" fill={FACTOR_COLORS[i % FACTOR_COLORS.length]} opacity={0.85} />
                ))}
              </BarChart>
            </ResponsiveContainer>
          )}
          {factorChartView === 'stacked' && (
            <div className="flex flex-wrap gap-3 mt-3">
              {factorMaxContributions.map((f, i) => (
                <span key={f.name} className="flex items-center gap-1 text-xs text-gray-500">
                  <span style={{ width: 10, height: 10, borderRadius: 2, background: FACTOR_COLORS[i % FACTOR_COLORS.length], display: 'inline-block', flexShrink: 0 }} />
                  {f.name}
                </span>
              ))}
              {valueMode === 'model' && <span className="flex items-center gap-1 text-xs text-gray-400"><span style={{ width:10, height:10, borderRadius:2, background:'#d1d5db', display:'inline-block', flexShrink:0 }} /> Base Value (${Math.round(b).toLocaleString()})</span>}
            </div>
          )}
        </section>

        {/* ── Competitive Positioning Table ─────────────────────────────── */}
        <section className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
          <h2 className="text-base font-semibold text-gray-900 mb-1">Competitive Positioning</h2>
          <p className="text-xs text-gray-500 mb-4">
            All products ranked by Value Index. ★ marks target product(s). Price-to-value ratio above 1.0 means priced above model value.
          </p>
          <div className="overflow-x-auto">
            <table className="w-full text-sm border-separate border-spacing-0">
              <thead>
                <tr>
                  <th className="text-left text-xs font-medium text-gray-500 pb-3 pr-4 border-b border-gray-100">Product</th>
                  <th className="text-right text-xs font-medium text-gray-500 pb-3 pr-4 border-b border-gray-100">Value Index</th>
                  <th className="text-right text-xs font-medium text-gray-500 pb-3 pr-4 border-b border-gray-100">Market Price</th>
                  <th className="text-right text-xs font-medium text-gray-500 pb-3 pr-4 border-b border-gray-100">Model Price</th>
                  <th className="text-right text-xs font-medium text-gray-500 pb-3 border-b border-gray-100">Price/Value</th>
                </tr>
              </thead>
              <tbody>
                {positioningRows.map((row, i) => (
                  <tr
                    key={row.id}
                    className={`${i % 2 === 0 ? 'bg-white' : 'bg-gray-50'} ${row.isTarget ? 'font-semibold' : ''}`}
                  >
                    <td className={`py-2 pr-4 ${row.isTarget ? 'text-amber-700' : 'text-gray-800'}`}>
                      {row.name}
                    </td>
                    <td className="py-2 pr-4 text-right text-gray-700">
                      {(row.value_index * 100).toFixed(1)}
                    </td>
                    <td className="py-2 pr-4 text-right text-gray-700">
                      {row.isTarget
                        ? <span className="text-amber-700">{formatCurrency(row.market_price)} est.</span>
                        : formatCurrency(row.market_price)
                      }
                    </td>
                    <td className="py-2 pr-4 text-right text-gray-700">
                      {formatCurrency(row.model_price)}
                    </td>
                    <td className={`py-2 text-right font-medium ${
                      row.isTarget ? 'text-amber-700' :
                      row.price_to_value > 1.05 ? 'text-blue-600' :
                      row.price_to_value < 0.95 ? 'text-red-500' :
                      'text-green-700'
                    }`}>
                      {row.isTarget ? '—' : row.price_to_value.toFixed(2)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        {/* ── Price Recommendations ─────────────────────────────────────── */}
        <section className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
          <h2 className="text-base font-semibold text-gray-900 mb-4 flex items-center gap-1.5">Price Recommendations
            <HelpTip width="w-80" position="above" content="The point estimate is the model-implied price for this product based on its Value Index. The recommended range has two layers: the statistical range (±1 standard deviation of benchmark residuals) reflects normal pricing variability in this market; the wider market envelope spans the full observed high and low residuals. For repositioning products, the gap analysis shows how the current price compares to the recommended range." />
          </h2>
          <div className="space-y-4">
            {targets.map(t => (
              <div key={t.id} className="border border-gray-100 rounded-lg p-5 bg-gray-50">
                <div className="flex items-start justify-between mb-4">
                  <div>
                    <h3 className="text-sm font-semibold text-gray-900">{t.name}</h3>
                    <p className="text-xs text-gray-400 mt-0.5">
                      {t.use_case_type === 'NPI' ? 'New Product Introduction' : 'Price Repositioning'} · Value Index: {(t.value_index * 100).toFixed(1)}
                    </p>
                  </div>
                </div>

                <div className="flex items-end gap-8 mb-4">
                  <div>
                    <div className="text-xs text-gray-500 mb-1">Point Estimate</div>
                    <div className="text-3xl font-bold text-gray-900">{formatCurrency(t.point_estimate)}</div>
                  </div>
                  <div>
                    <div className="text-xs text-gray-500 mb-1">Recommended Range</div>
                    <div className="text-lg font-medium text-gray-700">
                      {formatCurrency(t.range_low)} — {formatCurrency(t.range_high)}
                    </div>
                  </div>
                </div>

                {/* Gap analysis for repositioning */}
                {t.use_case_type === 'REPOSITION' && t.current_price != null && (
                  <div className={`rounded-md px-4 py-3 text-sm ${
                    t.current_price > t.range_high
                      ? 'bg-red-50 border border-red-200 text-red-700'
                      : t.current_price < t.range_low
                      ? 'bg-blue-50 border border-blue-200 text-blue-700'
                      : 'bg-green-50 border border-green-200 text-green-700'
                  }`}>
                    <div className="flex items-center justify-between">
                      <span>
                        Current price: <strong>{formatCurrency(t.current_price)}</strong>
                        {' · '}Gap: <strong>{formatCurrency(t.current_price - t.point_estimate)}</strong>
                        {' '}({(((t.current_price - t.point_estimate) / t.point_estimate) * 100).toFixed(1)}%)
                      </span>
                      <span className="font-medium">
                        {t.current_price > t.range_high ? 'Overpriced relative to model value' :
                         t.current_price < t.range_low  ? 'Underpriced relative to model value' :
                         'Within recommended range'}
                      </span>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        </section>

        {/* ── Navigation ────────────────────────────────────────────────── */}
        <div className="flex justify-between pb-8">
          <button
            onClick={() => router.push(`/dashboard/projects/${projectId}/phase-5`)}
            className="px-4 py-2 border border-gray-300 text-sm font-medium rounded-md text-gray-700 hover:bg-gray-50"
          >
            ← Back to Value Pricing Model
          </button>
          <button
            onClick={() => { router.refresh(); router.push(`/dashboard/projects/${projectId}/phase-7`) }}
            className="px-6 py-2 bg-blue-600 text-white text-sm font-medium rounded-md hover:bg-blue-700"
          >
            Sensitivity Analysis →
          </button>
        </div>

      </div>
    </div>
  )
}
