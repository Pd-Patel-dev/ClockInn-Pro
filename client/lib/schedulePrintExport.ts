/**
 * Browser print / Save-as-PDF HTML for the admin schedule grid (landscape).
 * Design: simple professional slate + blue palette (Helvetica via system stack).
 */
import { format } from 'date-fns'
import { parseTime24, toTime12h } from '@/lib/time'

const COLORS = {
  primary: '#1E293B',
  accent: '#3B82F6',
  bg: '#FFFFFF',
  rowAlt: '#F8FAFC',
  border: '#E2E8F0',
  text: '#0F172A',
  muted: '#64748B',
  off: '#94A3B8',
} as const

export interface SchedulePrintShift {
  employee_id: string
  shift_date: string
  start_time: string
  end_time: string
  break_minutes: number
}

export interface SchedulePrintEmployee {
  id: string
  name: string
  role?: string
}

function escapeHtml(text: string): string {
  const div = document.createElement('div')
  div.textContent = text
  return div.innerHTML
}

export interface BuildSchedulePrintHtmlParams {
  companyName: string
  weekStart: Date
  weekEnd: Date
  weekDays: Date[]
  employees: SchedulePrintEmployee[]
  shifts: SchedulePrintShift[]
}

export function buildSchedulePrintHtml(params: BuildSchedulePrintHtmlParams): string {
  const { companyName, weekStart, weekEnd, weekDays, employees, shifts } = params
  const dayLabels = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

  const sortedEmployees = [...employees]
    .map((emp) => ({ id: emp.id, name: emp.name || 'Unknown' }))
    .sort((a, b) => a.name.localeCompare(b.name))

  const shiftsByEmployeeAndDay = new Map<string, Map<string, SchedulePrintShift[]>>()
  shifts.forEach((shift) => {
    if (!shiftsByEmployeeAndDay.has(shift.employee_id)) {
      shiftsByEmployeeAndDay.set(shift.employee_id, new Map())
    }
    const byDay = shiftsByEmployeeAndDay.get(shift.employee_id)!
    const d = shift.shift_date
    if (!byDay.has(d)) byDay.set(d, [])
    byDay.get(d)!.push(shift)
  })

  const formatTime12ForPrint = (t: string) => {
    if (!t || !parseTime24(t)) return ''
    const { hour12, minute, ampm } = toTime12h(t)
    const mm = String(minute).padStart(2, '0')
    return `${hour12}:${mm} ${ampm}`
  }

  const formatCell = (dayShifts: SchedulePrintShift[] | undefined) => {
    if (!dayShifts || dayShifts.length === 0) {
      return '<span class="cell-off">OFF</span>'
    }
    return dayShifts
      .map((s) => {
        const start = formatTime12ForPrint(s.start_time)
        const end = formatTime12ForPrint(s.end_time)
        const br = s.break_minutes ? ` <span class="cell-break">(${s.break_minutes}m)</span>` : ''
        return `<span class="cell-time">${start} – ${end}</span>${br}`
      })
      .join('<br/>')
  }

  const dayHeaders = weekDays
    .map(
      (d, i) =>
        `<th class="day-col"><span class="day-name">${dayLabels[i]}</span><span class="day-num">${format(d, 'd')}</span><span class="day-month">${format(d, 'MMM')}</span></th>`
    )
    .join('')

  const rows = sortedEmployees
    .map(({ id, name }, idx) => {
      const byDay = shiftsByEmployeeAndDay.get(id)
      const cells = weekDays
        .map((day) => {
          const key = format(day, 'yyyy-MM-dd')
          const dayShifts = byDay?.get(key)
          return `<td class="cell">${formatCell(dayShifts)}</td>`
        })
        .join('')
      const rowClass = idx % 2 === 0 ? 'row-even' : 'row-odd'
      return `<tr class="${rowClass}"><td class="cell-employee">${escapeHtml(name)}</td>${cells}</tr>`
    })
    .join('')

  const dateRangeTitle = `Week of ${format(weekStart, 'MMMM d')} – ${format(weekEnd, 'MMMM d, yyyy')}`
  const generated = format(new Date(), "MMM d, yyyy 'at' h:mm a")
  const safeCompany = escapeHtml(companyName)

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Schedule – ${escapeHtml(dateRangeTitle)}</title>
  <style>
    * { box-sizing: border-box; }
    body {
      margin: 0;
      font-family: Helvetica, Arial, sans-serif;
      background: ${COLORS.bg};
      color: ${COLORS.text};
      font-size: 9pt;
      line-height: 1.35;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }
    .sheet { max-width: 100%; margin: 0 auto; background: ${COLORS.bg}; padding: 0 0 20px; }
    .header-row {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      padding: 0 0 12px;
      border-bottom: 2px solid ${COLORS.accent};
    }
    .header-left .company { font-size: 18pt; font-weight: bold; color: ${COLORS.primary}; margin: 0; }
    .header-left .tagline { font-size: 11pt; color: ${COLORS.muted}; margin: 4px 0 0 0; }
    .header-right { text-align: right; }
    .header-right .range { font-size: 11pt; color: ${COLORS.text}; font-weight: normal; margin: 0; }
    .header-right .generated { font-size: 8pt; color: ${COLORS.muted}; margin: 6px 0 0 0; }

    table.schedule-table {
      width: 100%;
      margin-top: 12px;
      border-collapse: collapse;
      table-layout: fixed;
      font-size: 9pt;
    }
    .schedule-table thead th {
      background: ${COLORS.primary};
      color: #FFFFFF;
      font-weight: bold;
      font-size: 9pt;
      padding: 8px 6px;
      border: 0.5pt solid ${COLORS.border};
      text-align: center;
      vertical-align: middle;
    }
    .schedule-table thead th.cell-employee { width: 14%; text-align: left; }
    .schedule-table thead th.day-col { width: auto; }
    th .day-name { display: block; font-size: 7pt; font-weight: bold; opacity: 0.95; }
    th .day-num { display: block; font-size: 10pt; margin-top: 2px; }
    th .day-month { display: block; font-size: 7pt; opacity: 0.9; margin-top: 1px; }

    .schedule-table tbody td {
      padding: 10px 6px;
      border: 0.5pt solid ${COLORS.border};
      vertical-align: top;
      min-height: 20pt;
    }
    .schedule-table tbody td.cell-employee { font-weight: normal; color: ${COLORS.text}; }
    .schedule-table tbody td.cell { text-align: center; color: ${COLORS.text}; font-size: 9pt; }
    tr.row-even td { background: ${COLORS.bg}; }
    tr.row-odd td { background: ${COLORS.rowAlt}; }
    .cell-off { color: ${COLORS.off}; font-size: 9pt; }
    .cell-time { font-weight: normal; color: ${COLORS.text}; }
    .cell-break { font-size: 8pt; color: ${COLORS.muted}; }

    .doc-footer {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-top: 16px;
      padding: 10px 4px 0;
      border-top: 0.5pt solid ${COLORS.border};
      font-size: 8pt;
      color: ${COLORS.muted};
    }
    .doc-footer .left { font-style: italic; max-width: 38%; color: ${COLORS.muted}; }
    .doc-footer .center { text-align: center; flex: 1; color: ${COLORS.muted}; }
    .doc-footer .right { text-align: right; max-width: 35%; color: ${COLORS.muted}; font-style: normal; }

    .no-print { margin: 12px 4px; font-size: 9pt; color: ${COLORS.muted}; }

    /* Page X of Y: margin boxes work in some engines; Chrome often omits them—PDF viewer still shows pages after save. */
    @page {
      size: A4 landscape;
      margin: 30pt;
      @bottom-center {
        content: "Page " counter(page) " of " counter(pages);
        font-size: 8pt;
        color: ${COLORS.muted};
        font-family: Helvetica, Arial, sans-serif;
      }
    }
    @media print {
      body { padding: 0; }
      .sheet { padding-bottom: 24pt; }
      .no-print { display: none !important; }
    }
  </style>
</head>
<body>
  <div class="sheet">
    <header class="header-row">
      <div class="header-left">
        <p class="company">${safeCompany}</p>
        <p class="tagline">Work Schedule</p>
      </div>
      <div class="header-right">
        <p class="range">${escapeHtml(dateRangeTitle)}</p>
        <p class="generated">Generated ${escapeHtml(generated)}</p>
      </div>
    </header>

    <table class="schedule-table">
      <thead>
        <tr>
          <th class="cell-employee">Employee</th>
          ${dayHeaders}
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>

    <footer class="doc-footer">
      <span class="left">Confidential – Internal Use Only</span>
      <span class="center"></span>
      <span class="right">Generated by ClockInn Pro</span>
    </footer>
  </div>
  <p class="no-print">Use your browser&rsquo;s print dialog and choose &ldquo;Save as PDF&rdquo;. Filename: <strong>schedule-${escapeHtml(format(weekStart, 'yyyy-MM-dd'))}.pdf</strong></p>
</body>
</html>`
}

/** Opens print dialog; sets document title so Save as PDF defaults to `filenameBase.pdf` (e.g. Chrome). */
export function printScheduleHtml(html: string, filenameBase: string): boolean {
  const iframe = document.createElement('iframe')
  iframe.setAttribute('style', 'position:absolute;width:0;height:0;border:0;left:-9999px;')
  document.body.appendChild(iframe)
  const win = iframe.contentWindow
  const doc = win?.document
  if (!doc) {
    document.body.removeChild(iframe)
    return false
  }
  doc.open()
  doc.write(html)
  doc.close()
  doc.title = `${filenameBase}.pdf`
  win.focus()
  win.print()
  setTimeout(() => {
    if (iframe.parentNode) document.body.removeChild(iframe)
  }, 1000)
  return true
}
