import { useMemo } from 'react'
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  PieChart,
  Pie,
  Cell,
} from 'recharts'

/** Distinct bar colors for price bins (cycles if more bins than colors). */
const HIST_BAR_COLORS = [
  '#5b8fd8',
  '#64b5c9',
  '#81c784',
  '#ffb74d',
  '#ba68c8',
  '#f06292',
  '#4dd0c4',
  '#aed581',
  '#ff8a65',
  '#7986cb',
  '#ffd54f',
  '#4fc3f7',
  '#9575cd',
  '#dce775',
]

const DONUT_COLORS = [
  '#5b8fd8',
  '#7eb8da',
  '#9bc9a8',
  '#c4a574',
  '#b89bc9',
  '#d88b9a',
  '#88c4d8',
  '#a8c990',
  '#e8a088',
  '#9db0e8',
]

/** &lt;25 red, 25–50 yellow, 51+ green */
function gaugeArcColor(pct) {
  if (pct < 25) return '#e85d5d'
  if (pct < 51) return '#e8c940'
  return '#5cbf7a'
}

function gaugeTone(pct) {
  if (pct < 25) return 'danger'
  if (pct < 51) return 'warn'
  return 'ok'
}

/** Lighter than chart panel (#242b3d); accent border uses series color. */
function HistogramTooltip({ active, payload }) {
  if (!active || !payload?.length) return null
  const pl = payload[0]
  const row = pl.payload
  const accent = row.color ?? pl.color ?? HIST_BAR_COLORS[0]
  return (
    <div className="chart-tooltip" style={{ borderLeftColor: accent }}>
      <div className="chart-tooltip__label">{row.fullLabel ? `Range: ${row.fullLabel}` : 'Bin'}</div>
      <div className="chart-tooltip__body">
        Count: <strong>{pl.value?.toLocaleString?.() ?? pl.value}</strong>
      </div>
    </div>
  )
}

function PieCategoryTooltip({ active, payload }) {
  if (!active || !payload?.length) return null
  const pl = payload[0]
  const d = pl.payload
  const accent = d.sliceColor ?? pl.fill ?? DONUT_COLORS[0]
  const val = Number(d.value).toLocaleString(undefined, { maximumFractionDigits: 0 })
  return (
    <div className="chart-tooltip" style={{ borderLeftColor: accent }}>
      <div className="chart-tooltip__label">{d.name}</div>
      <div className="chart-tooltip__body">
        <span className="chart-tooltip__money">${val}</span>
        <span className="chart-tooltip__sep"> · </span>
        <span>{d.pct?.toFixed(1)}% of total</span>
      </div>
    </div>
  )
}

function buildPriceBins(rows, priceCol, maxBins = 14) {
  if (!priceCol || !rows.length) return []
  const prices = rows.map((r) => Number(r[priceCol])).filter((x) => !Number.isNaN(x) && x >= 0)
  if (!prices.length) return []
  const min = Math.min(...prices)
  const max = Math.max(...prices)
  if (min === max) {
    return [
      {
        label: `$${min.toFixed(0)}`,
        count: prices.length,
        fullLabel: `$${min.toFixed(0)}`,
        color: HIST_BAR_COLORS[0],
      },
    ]
  }
  const bins = Math.min(maxBins, Math.max(6, Math.ceil(Math.sqrt(prices.length))))
  const w = (max - min) / bins
  const counts = Array(bins).fill(0)
  for (const p of prices) {
    let i = Math.min(bins - 1, Math.floor((p - min) / w))
    counts[i]++
  }
  return counts.map((count, i) => {
    const lo = min + i * w
    const hi = min + (i + 1) * w
    const label = `$${lo.toFixed(0)}`
    const fullLabel = `$${lo.toFixed(0)}–$${hi.toFixed(0)}`
    return {
      label,
      count,
      fullLabel,
      color: HIST_BAR_COLORS[i % HIST_BAR_COLORS.length],
    }
  })
}

function categoryValues(rows, categoryCol, priceCol) {
  if (!categoryCol) return []
  const map = new Map()
  for (const r of rows) {
    const name = String(r[categoryCol] ?? 'Other')
    const add = priceCol ? Number(r[priceCol]) : 1
    const v = Number.isNaN(add) ? 0 : add
    map.set(name, (map.get(name) || 0) + v)
  }
  const total = [...map.values()].reduce((a, b) => a + b, 0) || 1
  const sorted = [...map.entries()]
    .map(([name, value]) => ({
      name,
      value,
      pct: (value / total) * 100,
    }))
    .sort((a, b) => b.value - a.value)

  return sorted.map((item, rank) => ({
    ...item,
    sliceColor: DONUT_COLORS[rank % DONUT_COLORS.length],
  }))
}

/** Labels: leader line in slice color; text ~1.5× prior sizes. */
function DonutSliceLabel({
  cx,
  cy,
  midAngle,
  outerRadius,
  name,
  value,
  percent,
  fill,
}) {
  const p = (percent ?? 0) * 100
  if (p < 2) return null

  const RADIAN = Math.PI / 180
  const sin = Math.sin(-RADIAN * midAngle)
  const cos = Math.cos(-RADIAN * midAngle)
  const edgeX = cx + outerRadius * cos
  const edgeY = cy + outerRadius * sin
  const elbow = 14
  const mx = cx + (outerRadius + elbow) * cos
  const my = cy + (outerRadius + elbow) * sin
  const hook = 36
  const ex = mx + (cos >= 0 ? hook : -hook)
  const ey = my
  const textX = ex + (cos >= 0 ? 6 : -6)
  const anchor = cos >= 0 ? 'start' : 'end'
  const valFmt = `$${Number(value).toLocaleString(undefined, { maximumFractionDigits: 0 })}`

  return (
    <g className="donut-slice-label">
      <polyline
        points={`${edgeX},${edgeY} ${mx},${my} ${ex},${ey}`}
        stroke={fill}
        strokeWidth={2}
        fill="none"
        opacity={0.95}
      />
      <text x={textX} y={ey - 6} textAnchor={anchor} fill="#f4f6fa" fontSize={17} fontWeight={600}>
        {name}
      </text>
      <text x={textX} y={ey + 18} textAnchor={anchor} fill="#f0d78a" fontSize={15} fontWeight={600}>
        {valFmt}
      </text>
      <text x={textX} y={ey + 39} textAnchor={anchor} fill="#b8c2d4" fontSize={15} fontWeight={500}>
        {p.toFixed(1)}%
      </text>
    </g>
  )
}

export function PriceHistogram({ rows, priceCol }) {
  const data = useMemo(() => buildPriceBins(rows, priceCol), [rows, priceCol])
  if (!data.length) {
    return <div className="chart-placeholder">Add a Price column to see distribution.</div>
  }
  return (
    <div className="chart-panel-inner">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 8, right: 8, left: 4, bottom: 4 }}>
          <defs>
            <linearGradient id="priceBarGrad" x1="0" y1="0" x2="1" y2="0">
              <stop offset="0%" stopColor="#2dd4bf" stopOpacity={0.95} />
              <stop offset="100%" stopColor="#1e4a7a" stopOpacity={1} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="#3d4663" vertical={false} opacity={0.6} />
          <XAxis
            dataKey="label"
            tick={{ fill: '#9aa3b5', fontSize: 11 }}
            tickLine={false}
            axisLine={{ stroke: '#3d4663' }}
            interval="preserveStartEnd"
          />
          <YAxis
            tick={{ fill: '#9aa3b5', fontSize: 11 }}
            tickLine={false}
            axisLine={{ stroke: '#3d4663' }}
            label={{ value: 'Item count', angle: -90, position: 'insideLeft', fill: '#7a8499', fontSize: 11 }}
          />
          <Tooltip content={<HistogramTooltip />} cursor={{ fill: 'rgba(255, 255, 255, 0.07)' }} />
          <Bar dataKey="count" fill="url(#priceBarGrad)" radius={[4, 4, 0, 0]} maxBarSize={44} name="Items" />
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}

export function CategoryDonut({ rows, categoryCol, priceCol }) {
  const data = useMemo(() => categoryValues(rows, categoryCol, priceCol), [rows, categoryCol, priceCol])
  if (!data.length) {
    return <div className="chart-placeholder">Need Category (and Price for value weights).</div>
  }
  return (
    <div className="chart-panel-inner chart-panel-inner--donut chart-donut-standalone">
      <ResponsiveContainer width="100%" height="100%">
        <PieChart margin={{ top: 8, right: 8, left: 8, bottom: 8 }}>
          <Pie
            data={data}
            dataKey="value"
            nameKey="name"
            cx="50%"
            cy="50%"
            innerRadius={0}
            outerRadius="70%"
            paddingAngle={3}
            cornerRadius={2}
            stroke="#1a1f2b"
            strokeWidth={2}
            label={DonutSliceLabel}
            labelLine={false}
          >
            {data.map((entry, i) => (
              <Cell key={i} fill={entry.sliceColor ?? DONUT_COLORS[i % DONUT_COLORS.length]} />
            ))}
          </Pie>
          <Tooltip content={<PieCategoryTooltip />} cursor={false} />
        </PieChart>
      </ResponsiveContainer>
    </div>
  )
}

export function StockHealthGauge({ pct }) {
  const safe = Math.min(100, Math.max(0, pct))
  const rest = 100 - safe
  const arcColor = gaugeArcColor(safe)
  const data = [
    { name: 'in', value: safe, fill: arcColor },
    { name: 'out', value: rest, fill: '#3d4558' },
  ]
  const tone = gaugeTone(safe)
  return (
    <div className="gauge-wrap">
      <div className="gauge-chart-area">
        <ResponsiveContainer width="100%" height={120}>
          <PieChart>
            <Pie
              data={data}
              dataKey="value"
              startAngle={180}
              endAngle={0}
              cx="50%"
              cy="95%"
              innerRadius="72%"
              outerRadius="100%"
              stroke="none"
              isAnimationActive
            >
              {data.map((entry, i) => (
                <Cell key={i} fill={entry.fill} />
              ))}
            </Pie>
          </PieChart>
        </ResponsiveContainer>
        <div className="gauge-label">
          <span className={`gauge-pct gauge-pct--${tone}`}>{safe}%</span>
          <span className="gauge-sub">in stock</span>
        </div>
      </div>
      <ul className="gauge-legend" aria-label="Stock health scale">
        <li>
          <span className="gauge-legend__sw gauge-legend__sw--red" aria-hidden />
          <span>&lt; 25%</span>
        </li>
        <li>
          <span className="gauge-legend__sw gauge-legend__sw--yellow" aria-hidden />
          <span>25–50%</span>
        </li>
        <li>
          <span className="gauge-legend__sw gauge-legend__sw--green" aria-hidden />
          <span>51%+</span>
        </li>
      </ul>
    </div>
  )
}
