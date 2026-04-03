import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import * as XLSX from 'xlsx'
import { CategoryDonut, PriceHistogram, StockHealthGauge } from './AnalyticsCharts.jsx'
import './App.css'

const ACCEPT = '.csv,.xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv'

function normalizeHeaderKey(s) {
  return String(s).toLowerCase().replace(/[\s_]+/g, '')
}

function resolveColumn(candidates, headers) {
  if (!headers.length) return null
  const normalized = headers.map((h) => [h, normalizeHeaderKey(h)])
  for (const cand of candidates) {
    const n = normalizeHeaderKey(cand)
    const hit = normalized.find(([, hn]) => hn === n)
    if (hit) return hit[0]
  }
  return null
}

function formatBytes(n) {
  if (n == null || Number.isNaN(n)) return ''
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / (1024 * 1024)).toFixed(1)} MB`
}

function formatCurrencyCompact(n) {
  if (!Number.isFinite(n)) return '—'
  if (Math.abs(n) >= 1e6) return `$${(n / 1e6).toFixed(1)}M`
  if (Math.abs(n) >= 1e3) return `$${(n / 1e3).toFixed(1)}K`
  return `$${n.toLocaleString(undefined, { maximumFractionDigits: 0 })}`
}

const PRODUCT_ID_CANDS = ['Product_ID', 'ProductID', 'product_id']
const PRODUCT_NAME_CANDS = ['Product_Name', 'ProductName', 'product_name']

const INVENTORY_SEVEN_PRIORITY = [
  PRODUCT_ID_CANDS,
  PRODUCT_NAME_CANDS,
  ['Category'],
  ['Region'],
  ['Price'],
  ['Stock_Level', 'Stock Level'],
  ['Status'],
  ['Last_Updated', 'Last Updated'],
]

function buildSevenColumnKeys(headers, rowFilterId, rowFilterResolved, productIdCol, productNameCol) {
  if (!headers.length) return Array(7).fill(null)
  const priorityCols = [
    ...new Set(INVENTORY_SEVEN_PRIORITY.map((c) => resolveColumn(c, headers)).filter(Boolean)),
  ]
  let cols = []
  if (rowFilterId && rowFilterResolved && productIdCol && productNameCol) {
    cols = [productIdCol, productNameCol, rowFilterResolved]
    for (const c of priorityCols) {
      if (cols.length >= 7) break
      if (!cols.includes(c)) cols.push(c)
    }
  } else {
    cols = priorityCols.slice(0, 7)
  }
  while (cols.length < 7) {
    const next = headers.find((h) => !cols.includes(h))
    if (next) cols.push(next)
    else cols.push(null)
  }
  return cols.slice(0, 7)
}

function MiniSparkline({ n }) {
  const d = useMemo(() => {
    const steps = 7
    const peak = Math.max(n, 1)
    return Array.from({ length: steps }, (_, i) => {
      const t = steps === 1 ? 1 : i / (steps - 1)
      return Math.round(peak * (0.7 + 0.3 * t))
    })
  }, [n])
  const max = Math.max(...d, 1)
  const w = 140
  const h = 44
  const pad = 3
  const pathD = d
    .map((v, i) => {
      const x = pad + (i * (w - 2 * pad)) / Math.max(d.length - 1, 1)
      const y = h - pad - (v / max) * (h - 2 * pad)
      return `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`
    })
    .join(' ')
  return (
    <svg className="kpi-sparkline" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" aria-hidden>
      <defs>
        <linearGradient id="sparkGlow" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#2dd4bf" stopOpacity={0.35} />
          <stop offset="100%" stopColor="#2dd4bf" stopOpacity={0} />
        </linearGradient>
      </defs>
      <path
        d={`${pathD} L${w - pad},${h} L${pad},${h} Z`}
        fill="url(#sparkGlow)"
        stroke="none"
      />
      <path
        d={pathD}
        fill="none"
        stroke="#2dd4bf"
        strokeWidth="2"
        strokeLinecap="round"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  )
}

const ROW_FILTER_OPTIONS = [
  { id: 'category', label: 'Category', match: ['Category'] },
  { id: 'region', label: 'Region', match: ['Region'] },
  { id: 'status', label: 'Status', match: ['Status'] },
  { id: 'lastUpdated', label: 'Last updated', match: ['Last_Updated', 'Last Updated'] },
  { id: 'stockLevel', label: 'Stock level', match: ['Stock_Level', 'Stock Level'] },
  { id: 'price', label: 'Price', match: ['Price'] },
]

const DIM_OPTIONSMeta = [
  { id: 'category', label: 'Category', match: ['Category'] },
  { id: 'region', label: 'Region', match: ['Region'] },
  { id: 'status', label: 'Status', match: ['Status'] },
]

const SLICE_DIM_IDS = new Set(DIM_OPTIONSMeta.map((d) => d.id))

function sliceDimsAllowedForRowView(rowFilterId) {
  if (!rowFilterId) return [...SLICE_DIM_IDS]
  if (SLICE_DIM_IDS.has(rowFilterId)) return [rowFilterId]
  return []
}

async function parseFileToRows(file) {
  const lower = file.name.toLowerCase()
  let workbook
  if (lower.endsWith('.csv')) {
    const text = await file.text()
    workbook = XLSX.read(text, { type: 'string' })
  } else {
    const buf = await file.arrayBuffer()
    workbook = XLSX.read(buf, { type: 'array' })
  }
  const sheetName = workbook.SheetNames[0]
  if (!sheetName) return []
  const sheet = workbook.Sheets[sheetName]
  return XLSX.utils.sheet_to_json(sheet, { defval: '' })
}

const ROW_H = 36

function cellStatusBadge(row, statusCol, stockCol) {
  if (!statusCol) return null
  const text = String(row[statusCol] ?? '')
  const stock = stockCol ? Number(row[stockCol]) : NaN
  if (/in\s*stock/i.test(text)) {
    if (!Number.isNaN(stock) && stock < 25) {
      return <span className="badge badge-warn">Low stock</span>
    }
    return <span className="badge badge-ok">{text}</span>
  }
  if (/back/i.test(text)) return <span className="badge badge-backorder">{text}</span>
  if (/out/i.test(text)) return <span className="badge badge-bad">{text}</span>
  return <span className="badge badge-muted">{text || '—'}</span>
}

export default function App() {
  const [fileName, setFileName] = useState(null)
  const [fileSize, setFileSize] = useState(null)
  const [error, setError] = useState(null)
  const [loading, setLoading] = useState(false)
  const [rows, setRows] = useState([])
  const [rowFilterId, setRowFilterId] = useState(null)
  const [dimFieldId, setDimFieldId] = useState('')
  const [dimValue, setDimValue] = useState('')
  const [globalSearch, setGlobalSearch] = useState('')

  const scrollRef = useRef(null)
  const fileInputRef = useRef(null)

  const headers = useMemo(() => {
    if (!rows.length) return []
    return Object.keys(rows[0])
  }, [rows])

  const allowedSliceDimIds = useMemo(() => sliceDimsAllowedForRowView(rowFilterId), [rowFilterId])

  const productIdCol = useMemo(() => resolveColumn(PRODUCT_ID_CANDS, headers), [headers])
  const productNameCol = useMemo(() => resolveColumn(PRODUCT_NAME_CANDS, headers), [headers])
  const priceCol = useMemo(() => resolveColumn(['Price'], headers), [headers])
  const stockCol = useMemo(() => resolveColumn(['Stock_Level', 'Stock Level'], headers), [headers])
  const statusCol = useMemo(() => resolveColumn(['Status'], headers), [headers])
  const categoryCol = useMemo(() => resolveColumn(['Category'], headers), [headers])

  const rowFilterResolved = useMemo(() => {
    if (!rowFilterId) return null
    const def = ROW_FILTER_OPTIONS.find((o) => o.id === rowFilterId)
    if (!def) return null
    return resolveColumn(def.match, headers)
  }, [headers, rowFilterId])

  const dimCol = useMemo(() => {
    if (!dimFieldId) return null
    const def = DIM_OPTIONSMeta.find((d) => d.id === dimFieldId)
    if (!def) return null
    return resolveColumn(def.match, headers)
  }, [headers, dimFieldId])

  const dimValueOptions = useMemo(() => {
    if (!dimCol || !rows.length) return []
    const set = new Set()
    for (const r of rows) {
      const v = r[dimCol]
      if (v !== '' && v != null) set.add(String(v))
    }
    return [...set].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }))
  }, [rows, dimCol])

  useEffect(() => {
    if (allowedSliceDimIds.length === 0) {
      setDimFieldId('')
      setDimValue('')
      return
    }
    if (allowedSliceDimIds.length === 1) {
      setDimFieldId(allowedSliceDimIds[0])
      return
    }
    setDimFieldId((prev) => {
      if (!prev || allowedSliceDimIds.includes(prev)) return prev
      return ''
    })
  }, [allowedSliceDimIds])

  useEffect(() => {
    setDimValue('')
  }, [dimFieldId, rows])

  useEffect(() => {
    if (dimValue && dimValueOptions.length && !dimValueOptions.includes(dimValue)) {
      setDimValue('')
    }
  }, [dimValue, dimValueOptions])

  const dimFilteredRows = useMemo(() => {
    if (!rows.length) return []
    if (!dimCol || !dimValue) return rows
    return rows.filter((r) => String(r[dimCol]) === dimValue)
  }, [rows, dimCol, dimValue])

  const displayRows = useMemo(() => {
    const q = globalSearch.trim().toLowerCase()
    if (!q) return dimFilteredRows
    return dimFilteredRows.filter((row) =>
      Object.values(row).some((v) => String(v).toLowerCase().includes(q)),
    )
  }, [dimFilteredRows, globalSearch])

  const kpis = useMemo(() => {
    const n = displayRows.length
    let value = 0
    if (priceCol) {
      for (const r of displayRows) {
        const p = Number(r[priceCol])
        if (!Number.isNaN(p)) value += p
      }
    }
    let inStock = 0
    if (statusCol) {
      for (const r of displayRows) {
        if (/in\s*stock/i.test(String(r[statusCol]))) inStock++
      }
    }
    const pctInStock = n ? Math.round((inStock / n) * 100) : 0
    let sliceValue = 0
    if (priceCol) {
      for (const r of dimFilteredRows) {
        const p = Number(r[priceCol])
        if (!Number.isNaN(p)) sliceValue += p
      }
    }
    let activeSkus = 0
    if (productIdCol && n) {
      activeSkus = new Set(displayRows.map((r) => String(r[productIdCol] ?? ''))).size
    }
    let pendingOrders = 0
    if (priceCol && statusCol) {
      for (const r of displayRows) {
        if (/back/i.test(String(r[statusCol] ?? ''))) {
          const p = Number(r[priceCol])
          if (!Number.isNaN(p)) pendingOrders += p
        }
      }
    }
    return { n, value, pctInStock, sliceValue, activeSkus, pendingOrders }
  }, [displayRows, dimFilteredRows, priceCol, statusCol, productIdCol])

  const healthMetrics = useMemo(() => {
    let criticalStockouts = 0
    let overstockSkus = 0
    let reorderAlerts = 0
    if (!displayRows.length) return { criticalStockouts, overstockSkus, reorderAlerts }
    for (const r of displayRows) {
      const st = statusCol ? String(r[statusCol] ?? '') : ''
      const stock = stockCol ? Number(r[stockCol]) : NaN
      if (/out/i.test(st) || (Number.isFinite(stock) && stock === 0)) {
        criticalStockouts++
      } else if (/in\s*stock/i.test(st) && Number.isFinite(stock)) {
        if (stock >= 120) overstockSkus++
        if (stock >= 10 && stock < 25) reorderAlerts++
      }
    }
    return { criticalStockouts, overstockSkus, reorderAlerts }
  }, [displayRows, statusCol, stockCol])

  const displayHeaders = useMemo(
    () =>
      buildSevenColumnKeys(headers, rowFilterId, rowFilterResolved, productIdCol, productNameCol),
    [headers, rowFilterId, rowFilterResolved, productIdCol, productNameCol],
  )

  const gridTemplate = 'repeat(7, minmax(0, 1fr))'

  const inventoryValueDelta = kpis.value - kpis.sliceValue
  const showInventoryDelta =
    priceCol && kpis.sliceValue > 0 && Math.abs(inventoryValueDelta) > 1e-6

  const onFile = useCallback(async (e) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setError(null)
    setLoading(true)
    setFileName(file.name)
    setFileSize(file.size)
    setRowFilterId(null)
    setDimFieldId('')
    setDimValue('')
    setGlobalSearch('')
    try {
      const data = await parseFileToRows(file)
      if (!Array.isArray(data) || data.length === 0) {
        setRows([])
        setError('No rows found (empty sheet or unreadable file).')
        return
      }
      setRows(data)
    } catch (err) {
      console.error(err)
      setRows([])
      setError(err instanceof Error ? err.message : 'Failed to read file.')
    } finally {
      setLoading(false)
    }
  }, [])

  const clearFile = useCallback(() => {
    setRows([])
    setFileName(null)
    setFileSize(null)
    setError(null)
    setRowFilterId(null)
    setDimFieldId('')
    setDimValue('')
    setGlobalSearch('')
    if (fileInputRef.current) fileInputRef.current.value = ''
  }, [])

  const rowVirtualizer = useVirtualizer({
    count: displayRows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_H,
    overscan: 18,
  })

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: 0 })
  }, [displayRows.length, JSON.stringify(displayHeaders), rowFilterId, globalSearch])

  const rowFilterBroken =
    rowFilterId && rowFilterResolved && (!productIdCol || !productNameCol)

  const sliceUnavailable = allowedSliceDimIds.length === 0
  const sliceLockedToOne = allowedSliceDimIds.length === 1
  const lockedDimMeta = sliceLockedToOne
    ? DIM_OPTIONSMeta.find((d) => d.id === allowedSliceDimIds[0])
    : null

  const hasData = rows.length > 0
  const showFileStrip = Boolean(fileName && (hasData || error))

  return (
    <div className="dv">
      <input
        ref={fileInputRef}
        type="file"
        className="sr-only"
        accept={ACCEPT}
        onChange={onFile}
        disabled={loading}
        aria-label="Import CSV or Excel"
      />

      {showFileStrip && (
        <div className="file-strip">
          <div className="file-strip__info">
            <span className="file-strip__icon" aria-hidden>
              📄
            </span>
            <span>
              Loaded: <strong>{fileName}</strong>
              {fileSize != null && (
                <>
                  {' '}
                  ({formatBytes(fileSize)}
                  {hasData ? `, ${rows.length.toLocaleString()} rows` : ''})
                </>
              )}
            </span>
          </div>
          <button type="button" className="btn btn--outline" onClick={clearFile}>
            Remove file
          </button>
        </div>
      )}

      <header className="nav-bar">
        <div className="nav-bar__brand">
          <span className="nav-bar__logo">D</span>
          <div>
            <div className="nav-bar__title">DataView Pro</div>
            <div className="nav-bar__subtitle">Inventory Analysis</div>
          </div>
        </div>
        <div className="nav-bar__user">
          <button type="button" className="icon-circle icon-circle--ghost" aria-label="Voice" title="Voice">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
              <path d="M12 14a3 3 0 0 0 3-3V6a3 3 0 1 0-6 0v5a3 3 0 0 0 3 3z" />
              <path d="M19 11a7 7 0 0 1-14 0M12 18v3" />
            </svg>
          </button>
          <button type="button" className="icon-circle icon-circle--ghost" aria-label="Settings" title="Settings">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
              <circle cx="12" cy="12" r="3" />
              <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" />
            </svg>
          </button>
          <div className="nav-bar__profile">
            <div className="avatar-sm" aria-hidden>
              <span />
            </div>
            <div className="nav-bar__name">
              <span className="nav-bar__name-main">Alex R.</span>
              <span className="nav-bar__name-role">Analyst</span>
            </div>
          </div>
        </div>
      </header>

      <main className="main">
        {!fileName && (
          <div className="empty-hero">
            <div className="empty-hero__card">
              <h1 className="empty-hero__h">Open your inventory file</h1>
              <p className="empty-hero__p">
                CSV or Excel. You will get breakdowns, a price histogram, and a fast virtualized table
                that stays smooth on tens of thousands of rows.
              </p>
              <button
                type="button"
                className="btn btn--primary"
                onClick={() => fileInputRef.current?.click()}
                disabled={loading}
              >
                {loading ? 'Reading…' : 'Choose file'}
              </button>
            </div>
          </div>
        )}

        {fileName && !hasData && error && (
          <div className="empty-hero">
            <div className="empty-hero__card">
              <h1 className="empty-hero__h">Could not read that file</h1>
              <p className="empty-hero__p">{error}</p>
              <button type="button" className="btn btn--primary" onClick={clearFile}>
                Start over
              </button>
            </div>
          </div>
        )}

        {hasData ? (
          <>

            <section className="kpi-row" aria-label="Summary">
              <article className="kpi kpi--spark">
                <p className="kpi__label">Total rows</p>
                <div className="kpi__value-row">
                  <span className="kpi__value">{kpis.n.toLocaleString()}</span>
                  <span className="kpi__trend kpi__trend--up" title="Visible after filters">
                    ↑
                  </span>
                </div>
                <div className="kpi__spark-wrap">
                  <MiniSparkline n={kpis.n} />
                </div>
                <p className="kpi__footer-metric">
                  Active SKUs: <strong>{kpis.activeSkus.toLocaleString()}</strong>
                </p>
              </article>
              <article className="kpi">
                <p className="kpi__label">Inventory value</p>
                <div className="kpi__value-row">
                  <span className="kpi__value kpi__value--blue">{formatCurrencyCompact(kpis.value)}</span>
                </div>
                {showInventoryDelta ? (
                  <p className="kpi__compare">
                    {inventoryValueDelta >= 0 ? '+' : '−'}
                    {formatCurrencyCompact(Math.abs(inventoryValueDelta))}
                    <span className="kpi__compare-sep">|</span>
                    <span className={inventoryValueDelta >= 0 ? 'kpi__trend--up' : 'kpi__trend--down'}>
                      {inventoryValueDelta >= 0 ? '↑' : '↓'}{' '}
                      {((kpis.value / kpis.sliceValue - 1) * 100).toFixed(1)}%
                    </span>
                    <span className="kpi__compare-hint"> vs slice (search)</span>
                  </p>
                ) : (
                  <p className="kpi__hint">Sum of unit prices · visible rows</p>
                )}
                <p className="kpi__footer-metric">
                  Pending orders: <strong>{formatCurrencyCompact(kpis.pendingOrders)}</strong>
                </p>
              </article>
              <article className="kpi kpi--gauge">
                <p className="kpi__label">Stock health overall</p>
                <StockHealthGauge pct={kpis.pctInStock} />
                <div className="kpi-health-grid" aria-label="Stock health breakdown">
                  <div>
                    <span className="kpi-health-grid__n">{healthMetrics.criticalStockouts}</span>
                    <span className="kpi-health-grid__l">Critical stockouts</span>
                  </div>
                  <div>
                    <span className="kpi-health-grid__n">{healthMetrics.overstockSkus}</span>
                    <span className="kpi-health-grid__l">Overstock SKUs</span>
                  </div>
                  <div>
                    <span className="kpi-health-grid__n">{healthMetrics.reorderAlerts}</span>
                    <span className="kpi-health-grid__l">Reorder alerts</span>
                  </div>
                </div>
              </article>
            </section>

            <section className="charts-row" aria-label="Charts">
              <article className="panel panel--chart panel--wide">
                <h2 className="panel__title">Price frequency by range (ALL ITEMS)</h2>
                <div className="panel__chart">
                  <PriceHistogram rows={displayRows} priceCol={priceCol} />
                </div>
              </article>
              <article className="panel panel--chart">
                <h2 className="panel__title">Inventory value by category</h2>
                <div className="panel__chart panel__chart--donut">
                  <CategoryDonut rows={displayRows} categoryCol={categoryCol} priceCol={priceCol} />
                </div>
              </article>
            </section>

            <section className="panel panel--filters" aria-label="Filters">
              <div className="filter-toolbar">
                <div className="filter-search-block">
                  <label className="filter-field__label" htmlFor="global-search">
                    Global search
                  </label>
                  <div className="filter-search-row">
                    <div className="input-icon-wrap input-icon-wrap--flex">
                      <span className="input-icon" aria-hidden>
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <circle cx="11" cy="11" r="7" />
                          <path d="M21 21l-4.3-4.3" />
                        </svg>
                      </span>
                      <input
                        id="global-search"
                        type="search"
                        className="input input--search"
                        placeholder="Search this table…"
                        value={globalSearch}
                        onChange={(e) => setGlobalSearch(e.target.value)}
                        autoComplete="off"
                      />
                    </div>
                    <div className="filter-icon-actions">
                      <button type="button" className="icon-circle icon-circle--ghost" aria-label="Filter" title="Filter">
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <path d="M4 6h16M8 12h8M10 18h4" />
                        </svg>
                      </button>
                      <button type="button" className="icon-circle icon-circle--ghost" aria-label="Sort columns" title="Sort columns">
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <path d="M4 6h16M4 12h10M4 18h6" />
                        </svg>
                      </button>
                    </div>
                  </div>
                </div>
                <div className="filter-controls-grid">
                  <div className="filter-field">
                    <span className="filter-field__label">Dimension</span>
                    {sliceUnavailable && (
                      <p className="filter-muted">Use “All columns” or a Category / Region / Status table view.</p>
                    )}
                    {!sliceUnavailable && sliceLockedToOne && lockedDimMeta && (
                      <div className="dim-row">
                        <span className="pill pill--static">{lockedDimMeta.label}</span>
                      </div>
                    )}
                    {!sliceUnavailable && !sliceLockedToOne && (
                      <div className="dim-tags" role="group" aria-label="Choose dimension">
                        <button
                          type="button"
                          className={`dim-tag ${dimFieldId === '' ? 'dim-tag--active' : ''}`}
                          onClick={() => setDimFieldId('')}
                        >
                          All
                        </button>
                        {DIM_OPTIONSMeta.map((opt) => {
                          const col = resolveColumn(opt.match, headers)
                          const ok = allowedSliceDimIds.includes(opt.id)
                          if (!col || !ok) return null
                          return (
                            <button
                              key={opt.id}
                              type="button"
                              className={`dim-tag ${dimFieldId === opt.id ? 'dim-tag--active' : ''}`}
                              onClick={() => setDimFieldId(opt.id)}
                            >
                              {opt.label}
                            </button>
                          )
                        })}
                      </div>
                    )}
                  </div>
                  <div className="filter-field">
                    <label className="filter-field__label" htmlFor="dim-value">
                      Value
                    </label>
                    <select
                      id="dim-value"
                      className="select"
                      value={dimValue}
                      onChange={(e) => setDimValue(e.target.value)}
                      disabled={!dimCol || sliceUnavailable}
                    >
                      <option value="">All values</option>
                      {dimValueOptions.map((v) => (
                        <option key={v} value={v}>
                          {v}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="filter-field">
                    <label className="filter-field__label" htmlFor="row-view">
                      Table column
                    </label>
                    <select
                      id="row-view"
                      className="select"
                      value={rowFilterId ?? ''}
                      onChange={(e) => setRowFilterId(e.target.value || null)}
                    >
                      <option value="">All columns</option>
                      {ROW_FILTER_OPTIONS.map((opt) => {
                        const col = resolveColumn(opt.match, headers)
                        return (
                          <option key={opt.id} value={opt.id} disabled={!col}>
                            {opt.label}
                          </option>
                        )
                      })}
                    </select>
                    {rowFilterBroken && (
                      <p className="form-warn">Needs Product_ID and Product_Name for focused columns.</p>
                    )}
                  </div>
                </div>
              </div>
            </section>

            <section className="panel panel--table" aria-label="Data table">
              <div className="table-head">
                <h2 className="panel__title panel__title--sm">Inventory detail</h2>
                <span className="virt-pill">Virtualized rows</span>
              </div>
              <div className="table-scroll">
                <div
                  className="table-grid table-grid__header"
                  style={{ gridTemplateColumns: gridTemplate }}
                  role="row"
                >
                  {displayHeaders.map((h, i) => (
                    <div key={h ?? `empty-${i}`} className="th" role="columnheader">
                      {h ?? '—'}
                    </div>
                  ))}
                </div>
                <div className="table-body-wrap" ref={scrollRef}>
                  <div
                    className="table-body-inner"
                    style={{ height: `${rowVirtualizer.getTotalSize()}px` }}
                  >
                    {rowVirtualizer.getVirtualItems().map((vi) => (
                      <div
                        key={vi.key}
                        className={`table-grid table-row ${vi.index % 2 ? 'table-row--alt' : ''}`}
                        style={{
                          transform: `translateY(${vi.start}px)`,
                          height: `${vi.size}px`,
                          gridTemplateColumns: gridTemplate,
                        }}
                        role="row"
                      >
                        {displayHeaders.map((h, hi) => {
                          if (!h) {
                            return (
                              <div key={`e-${hi}`} className="td td--empty" role="cell">
                                —
                              </div>
                            )
                          }
                          const raw = displayRows[vi.index][h]
                          const isStatus = statusCol && h === statusCol
                          return (
                            <div key={h} className="td" role="cell">
                              {isStatus ? (
                                cellStatusBadge(displayRows[vi.index], statusCol, stockCol)
                              ) : h === productIdCol ? (
                                <span className="cell-link">{String(raw ?? '')}</span>
                              ) : (
                                String(raw ?? '')
                              )}
                            </div>
                          )
                        })}
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </section>

            <p className="footer-hint">
              Showing {displayRows.length.toLocaleString()} rows
              {displayRows.length !== rows.length && (
                <>
                  {' '}
                  · {rows.length.toLocaleString()} in file
                </>
              )}
            </p>
          </>
        ) : null}
      </main>
    </div>
  )
}
