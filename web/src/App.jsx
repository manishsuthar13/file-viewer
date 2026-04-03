import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import * as XLSX from 'xlsx'
import './App.css'

const ACCEPT = '.csv,.xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv'

function normalizeHeaderKey(s) {
  return String(s).toLowerCase().replace(/[\s_]+/g, '')
}

/** Pick first header in `headers` that matches any candidate (case/space/underscore insensitive). */
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

const PRODUCT_ID_CANDS = ['Product_ID', 'ProductID', 'product_id']
const PRODUCT_NAME_CANDS = ['Product_Name', 'ProductName', 'product_name']

/** Subset columns: category, region, status, last updated, stock level, price */
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

/** Which slice dimensions are allowed for the current row view (empty = slice off). */
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
  if (!sheetName) {
    return []
  }
  const sheet = workbook.Sheets[sheetName]
  return XLSX.utils.sheet_to_json(sheet, { defval: '' })
}

const ROW_H = 36

export default function App() {
  const [fileName, setFileName] = useState(null)
  const [error, setError] = useState(null)
  const [loading, setLoading] = useState(false)
  const [rows, setRows] = useState([])
  /** null = show all columns; else id from ROW_FILTER_OPTIONS */
  const [rowFilterId, setRowFilterId] = useState(null)
  /** '' = no dimension filter */
  const [dimFieldId, setDimFieldId] = useState('')
  const [dimValue, setDimValue] = useState('')

  const scrollRef = useRef(null)
  const fileInputRef = useRef(null)

  const headers = useMemo(() => {
    if (!rows.length) return []
    return Object.keys(rows[0])
  }, [rows])

  const allowedSliceDimIds = useMemo(
    () => sliceDimsAllowedForRowView(rowFilterId),
    [rowFilterId],
  )

  const productIdCol = useMemo(() => resolveColumn(PRODUCT_ID_CANDS, headers), [headers])
  const productNameCol = useMemo(() => resolveColumn(PRODUCT_NAME_CANDS, headers), [headers])

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
      const only = allowedSliceDimIds[0]
      setDimFieldId(only)
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

  const filteredRows = useMemo(() => {
    if (!rows.length) return []
    if (!dimCol || !dimValue) return rows
    return rows.filter((r) => String(r[dimCol]) === dimValue)
  }, [rows, dimCol, dimValue])

  const displayHeaders = useMemo(() => {
    if (!headers.length) return []
    if (!rowFilterId || !rowFilterResolved) return headers
    const cols = []
    if (productIdCol) cols.push(productIdCol)
    if (productNameCol) cols.push(productNameCol)
    cols.push(rowFilterResolved)
    const seen = new Set()
    return cols.filter((c) => {
      if (seen.has(c)) return false
      seen.add(c)
      return true
    })
  }, [headers, rowFilterId, rowFilterResolved, productIdCol, productNameCol])

  const gridTemplate = useMemo(() => {
    if (!displayHeaders.length) return ''
    return displayHeaders.map(() => 'minmax(140px, max-content)').join(' ')
  }, [displayHeaders])

  const onFile = useCallback(async (e) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setError(null)
    setLoading(true)
    setFileName(file.name)
    setRowFilterId(null)
    setDimFieldId('')
    setDimValue('')
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
    setError(null)
    setRowFilterId(null)
    setDimFieldId('')
    setDimValue('')
    if (fileInputRef.current) fileInputRef.current.value = ''
  }, [])

  const rowVirtualizer = useVirtualizer({
    count: filteredRows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_H,
    overscan: 20,
  })

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: 0 })
  }, [filteredRows.length, displayHeaders.join('|'), rowFilterId])

  const rowFilterBroken =
    rowFilterId &&
    rowFilterResolved &&
    (!productIdCol || !productNameCol)

  const sliceUnavailable = allowedSliceDimIds.length === 0
  const sliceLockedToOne = allowedSliceDimIds.length === 1
  const lockedDimMeta = sliceLockedToOne
    ? DIM_OPTIONSMeta.find((d) => d.id === allowedSliceDimIds[0])
    : null

  return (
    <div className="app">
      <header className="top">
        <h1 className="title">Inventory data</h1>
        <p className="subtitle">
          Upload a CSV or Excel file to preview every row (virtualized for large files). Use filters
          alone or together.
        </p>
        <div className="upload-row">
          <label className="upload">
            <input
              ref={fileInputRef}
              type="file"
              accept={ACCEPT}
              onChange={onFile}
              disabled={loading}
            />
            <span className="upload-btn">{loading ? 'Reading…' : 'Choose CSV or XLSX'}</span>
          </label>
          {(rows.length > 0 || fileName) && !loading && (
            <button type="button" className="btn-remove-file" onClick={clearFile}>
              Remove file
            </button>
          )}
        </div>
        {fileName && <p className="meta">Loaded: {fileName}</p>}
        {error && <p className="err">{error}</p>}
        {rows.length > 0 && (
          <p className="meta count">
            Showing {filteredRows.length.toLocaleString()} of {rows.length.toLocaleString()} rows
            {!rowFilterId && ` · ${headers.length} columns`}
            {rowFilterId && displayHeaders.length > 0 && ` · ${displayHeaders.length} columns`}
          </p>
        )}
      </header>

      {rows.length > 0 && (
        <>
          <div className="filters" role="group" aria-label="Data filters">
            <div className="filter-block">
              <span className="filter-label">Row view</span>
              <select
                className="filter-select"
                value={rowFilterId ?? ''}
                onChange={(e) => setRowFilterId(e.target.value || null)}
                aria-label="Row filter: which extra column to show with product id and name"
              >
                <option value="">All columns</option>
                {ROW_FILTER_OPTIONS.map((opt) => {
                  const col = resolveColumn(opt.match, headers)
                  return (
                    <option key={opt.id} value={opt.id} disabled={!col}>
                      {opt.label}
                      {!col ? ' (missing in file)' : ''}
                    </option>
                  )
                })}
              </select>
              {rowFilterBroken && (
                <p className="filter-warn">
                  Need Product_ID and Product_Name in the file for row view.
                </p>
              )}
            </div>
            <div className="filter-block">
              <span className="filter-label">Slice by</span>
              {sliceUnavailable && (
                <p className="filter-hint">
                  Only for <strong>All columns</strong> or row views <strong>Category</strong>,{' '}
                  <strong>Region</strong>, <strong>Status</strong>. Then slice is that field only (or
                  no slice).
                </p>
              )}
              {!sliceUnavailable && sliceLockedToOne && lockedDimMeta && (
                <>
                  <span className="filter-locked-dim" title="Fixed by row view">
                    {lockedDimMeta.label}
                  </span>
                  <select
                    className="filter-select"
                    value={dimValue}
                    onChange={(e) => setDimValue(e.target.value)}
                    disabled={!dimCol}
                    aria-label={`${lockedDimMeta.label} value`}
                  >
                    <option value="">— All values —</option>
                    {dimValueOptions.map((v) => (
                      <option key={v} value={v}>
                        {v}
                      </option>
                    ))}
                  </select>
                </>
              )}
              {!sliceUnavailable && !sliceLockedToOne && (
                <>
                  <select
                    className="filter-select"
                    value={dimFieldId}
                    onChange={(e) => setDimFieldId(e.target.value)}
                    aria-label="Dimension: category, region, or status"
                  >
                    <option value="">— None —</option>
                    {DIM_OPTIONSMeta.map((opt) => {
                      const col = resolveColumn(opt.match, headers)
                      const ok = allowedSliceDimIds.includes(opt.id)
                      return (
                        <option key={opt.id} value={opt.id} disabled={!col || !ok}>
                          {opt.label}
                          {!col ? ' (missing)' : ''}
                        </option>
                      )
                    })}
                  </select>
                  <select
                    className="filter-select"
                    value={dimValue}
                    onChange={(e) => setDimValue(e.target.value)}
                    disabled={!dimCol}
                    aria-label="Value for selected dimension"
                  >
                    <option value="">— All values —</option>
                    {dimValueOptions.map((v) => (
                      <option key={v} value={v}>
                        {v}
                      </option>
                    ))}
                  </select>
                </>
              )}
            </div>
          </div>

          <section className="table-section" aria-label="Data preview">
            <div
              className="table-header"
              style={{ gridTemplateColumns: gridTemplate }}
              role="row"
            >
              {displayHeaders.map((h) => (
                <div key={h} className="th" role="columnheader">
                  {h}
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
                    className={vi.index % 2 ? 'tr alt' : 'tr'}
                    style={{
                      transform: `translateY(${vi.start}px)`,
                      height: `${vi.size}px`,
                      gridTemplateColumns: gridTemplate,
                    }}
                    role="row"
                  >
                    {displayHeaders.map((h) => (
                      <div key={h} className="td" role="cell">
                        {String(filteredRows[vi.index][h] ?? '')}
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            </div>
          </section>
        </>
      )}
    </div>
  )
}
