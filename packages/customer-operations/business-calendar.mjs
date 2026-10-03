import crypto from 'node:crypto';
import { requireTenantRole } from '../atlas-core/authority.mjs';

const MAX_SLA_MINUTES = 525_600;
const MAX_CALENDAR_DAYS = 3_660;
const MINUTE_MS = 60_000;
const formatters = new Map();
const boundaryCache = new Map();

function requiredText(value, label, max = 180) {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > max || /[\r\n\u0000]/.test(value)) throw new Error(`${label} must be bounded single-line text`);
  return value.trim();
}

function plainObject(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) throw new Error(`${label} must be a plain object`);
  return value;
}

function calendarDate(value, label = 'calendar date') {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error(`${label} must use YYYY-MM-DD`);
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) throw new Error(`${label} is not a real date`);
  return value;
}

function timeMinutes(value, label, allow24 = false) {
  const pattern = allow24 ? /^(?:([01]\d|2[0-3]):([0-5]\d)|24:00)$/ : /^([01]\d|2[0-3]):([0-5]\d)$/;
  if (typeof value !== 'string' || !pattern.test(value)) throw new Error(`${label} must use a 24-hour HH:MM time`);
  if (value === '24:00') return 1_440;
  const [hours, minutes] = value.split(':').map(Number);
  return hours * 60 + minutes;
}

function normalizeWindows(windows, label) {
  if (!Array.isArray(windows) || windows.length > 8) throw new Error(`${label} must contain at most 8 windows`);
  const result = windows.map((window, index) => {
    plainObject(window, `${label}[${index}]`);
    const startMinute = timeMinutes(window.start, `${label}[${index}].start`);
    const endMinute = timeMinutes(window.end, `${label}[${index}].end`, true);
    if (endMinute <= startMinute) throw new Error(`${label} windows must end after they start on the same local day`);
    return { start: window.start, end: window.end, startMinute, endMinute };
  }).sort((a, b) => a.startMinute - b.startMinute || a.endMinute - b.endMinute);
  for (let index = 1; index < result.length; index++) {
    if (result[index].startMinute < result[index - 1].endMinute) throw new Error(`${label} windows cannot overlap`);
  }
  return result.map(({ start, end }) => Object.freeze({ start, end }));
}

function normalizeWeeklyHours(input) {
  const source = input == null ? {} : plainObject(input, 'weeklyHours');
  const result = {};
  for (const [day, windows] of Object.entries(source)) {
    if (!/^[0-6]$/.test(day)) throw new Error('weeklyHours keys must be local weekdays 0 through 6');
    result[day] = normalizeWindows(windows, `weeklyHours.${day}`);
  }
  return Object.freeze(Object.fromEntries(Object.keys(result).sort().map(day => [day, Object.freeze(result[day])])));
}

function normalizeHolidays(input) {
  if (input == null) return Object.freeze([]);
  if (!Array.isArray(input) || input.length > 5_000) throw new Error('holidays must be a list of at most 5000 dates');
  const dates = input.map(date => calendarDate(date, 'holiday date'));
  if (new Set(dates).size !== dates.length) throw new Error('holidays cannot contain duplicates');
  return Object.freeze(dates.sort());
}

function normalizeDateOverrides(input) {
  if (input == null) return Object.freeze({});
  const source = plainObject(input, 'dateOverrides');
  if (Object.keys(source).length > 1_000) throw new Error('dateOverrides must contain at most 1000 dates');
  const result = {};
  for (const [date, windows] of Object.entries(source).sort(([a], [b]) => a.localeCompare(b))) {
    result[calendarDate(date, 'date override')] = normalizeWindows(windows, `dateOverrides.${date}`);
  }
  return Object.freeze(result);
}

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]));
  return value;
}

function checksum(value) {
  return crypto.createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
}

function calendarBody({ tenantId, id, version, timeZone, weeklyHours, holidays, dateOverrides }) {
  return { kind: 'atlas_support_business_calendar', tenantId, id, version, timeZone, weeklyHours, holidays, dateOverrides };
}

function validateTimeZone(timeZone) {
  const zone = requiredText(timeZone, 'timeZone', 100);
  try { new Intl.DateTimeFormat('en-US', { timeZone: zone }).format(0); }
  catch { throw new Error('timeZone must be a valid IANA timezone'); }
  return zone;
}

function makeCalendar(input) {
  const tenantId = requiredText(input.tenantId, 'tenantId');
  const id = requiredText(input.id, 'calendar id');
  if (!Number.isSafeInteger(input.version) || input.version < 1 || input.version > 1_000_000) throw new Error('calendar version must be a positive integer');
  const body = calendarBody({
    tenantId, id, version: input.version, timeZone: validateTimeZone(input.timeZone),
    weeklyHours: normalizeWeeklyHours(input.weeklyHours), holidays: normalizeHolidays(input.holidays),
    dateOverrides: normalizeDateOverrides(input.dateOverrides)
  });
  return Object.freeze({ ...body, checksum: checksum(body) });
}

/** Creates an immutable, tenant-owned calendar revision. Persist revisions under (tenant,id,version). */
export function createSupportBusinessCalendar({ authority, tenantId, id, version = 1, timeZone, weeklyHours, holidays = [], dateOverrides = {} } = {}) {
  requireTenantRole(authority, tenantId, ['owner', 'admin']);
  return makeCalendar({ tenantId, id, version, timeZone, weeklyHours, holidays, dateOverrides });
}

/** Creates a new immutable revision; existing SLA cases keep their original calendar version. */
export function reviseSupportBusinessCalendar({ authority, previousCalendar, weeklyHours = previousCalendar?.weeklyHours, holidays = previousCalendar?.holidays, dateOverrides = previousCalendar?.dateOverrides, timeZone = previousCalendar?.timeZone } = {}) {
  const previous = validateSupportBusinessCalendar(previousCalendar);
  requireTenantRole(authority, previous.tenantId, ['owner', 'admin']);
  if (previous.version >= 1_000_000) throw new Error('calendar revision limit reached');
  return makeCalendar({ ...previous, version: previous.version + 1, timeZone, weeklyHours, holidays, dateOverrides });
}

/** Validates a persisted calendar snapshot, its tenant binding, and its content checksum. */
export function validateSupportBusinessCalendar(value, expectedTenantId = null) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || value.kind !== 'atlas_support_business_calendar') throw new Error('A support business calendar snapshot is required');
  const calendar = makeCalendar(value);
  if (expectedTenantId != null && calendar.tenantId !== expectedTenantId) throw new Error('Business calendar tenant scope mismatch');
  if (typeof value.checksum !== 'string' || value.checksum !== calendar.checksum) throw new Error('Business calendar checksum mismatch');
  return calendar;
}

function formatter(timeZone) {
  let value = formatters.get(timeZone);
  if (!value) {
    value = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' });
    if (formatters.size > 64) formatters.clear();
    formatters.set(timeZone, value);
  }
  return value;
}

function localParts(epochMs, timeZone) {
  const parts = Object.fromEntries(formatter(timeZone).formatToParts(new Date(epochMs)).map(part => [part.type, part.value]));
  return { year: Number(parts.year), month: Number(parts.month), day: Number(parts.day), hour: Number(parts.hour), minute: Number(parts.minute), second: Number(parts.second) };
}

function dateKey(parts) {
  return `${String(parts.year).padStart(4, '0')}-${String(parts.month).padStart(2, '0')}-${String(parts.day).padStart(2, '0')}`;
}

function nextDate(date, amount = 1) {
  const value = new Date(`${date}T00:00:00.000Z`);
  value.setUTCDate(value.getUTCDate() + amount);
  return value.toISOString().slice(0, 10);
}

function localWallEpoch(parts) {
  return Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
}

function windowsForDate(calendar, date) {
  if (Object.hasOwn(calendar.dateOverrides, date)) return calendar.dateOverrides[date];
  if (calendar.holidays.includes(date)) return [];
  const weekday = new Date(`${date}T00:00:00.000Z`).getUTCDay();
  return calendar.weeklyHours[String(weekday)] || [];
}

function localBoundary(calendar, localDate, clock, edge) {
  let targetDate = localDate;
  let targetClock = clock;
  if (clock === '24:00') { targetDate = nextDate(localDate); targetClock = '00:00'; }
  const cacheKey = `${calendar.timeZone}\u0000${targetDate}\u0000${targetClock}\u0000${edge}`;
  if (boundaryCache.has(cacheKey)) return boundaryCache.get(cacheKey);
  const [hour, minute] = targetClock.split(':').map(Number);
  const targetWall = Date.parse(`${targetDate}T${targetClock}:00.000Z`);
  const offsets = new Set();
  for (let offset = -36; offset <= 36; offset += 6) {
    const sample = Math.floor((targetWall + offset * 3_600_000) / 60_000) * 60_000;
    const fields = localParts(sample, calendar.timeZone);
    offsets.add(localWallEpoch(fields) - sample);
  }
  const exact = [];
  for (const utcOffset of offsets) {
    const candidate = targetWall - utcOffset;
    const fields = localParts(candidate, calendar.timeZone);
    if (dateKey(fields) === targetDate && fields.hour === hour && fields.minute === minute) exact.push(candidate);
  }
  let result = null;
  if (exact.length) result = edge === 'start' ? Math.min(...exact) : Math.max(...exact);
  else {
    // A wall time skipped by a DST jump starts at the first real local minute after the gap.
    const candidates = [...offsets].map(utcOffset => targetWall - utcOffset).sort((a, b) => a - b);
    const first = Math.floor((Math.min(...candidates) - 3 * 3_600_000) / MINUTE_MS) * MINUTE_MS;
    const last = Math.ceil((Math.max(...candidates) + 3 * 3_600_000) / MINUTE_MS) * MINUTE_MS;
    for (let instant = first; instant <= last; instant += MINUTE_MS) {
      const fields = localParts(instant, calendar.timeZone);
      if (dateKey(fields) === targetDate && localWallEpoch(fields) >= targetWall) { result = instant; break; }
    }
  }
  if (boundaryCache.size > 50_000) boundaryCache.clear();
  boundaryCache.set(cacheKey, result);
  return result;
}

function intervalsForDate(calendar, date) {
  return windowsForDate(calendar, date).map(window => {
    const start = localBoundary(calendar, date, window.start, 'start');
    const end = localBoundary(calendar, date, window.end, 'end');
    return start == null || end == null || end <= start ? null : [start, end];
  }).filter(Boolean);
}

function normalizeEpoch(value, label) {
  const epoch = typeof value === 'number' ? value : Date.parse(value);
  if (!Number.isFinite(epoch) || epoch < 0 || epoch > 8.64e15) throw new Error(`${label} must be a valid timestamp`);
  return epoch;
}

function normalizePauses(pauses) {
  if (pauses == null) return [];
  if (!Array.isArray(pauses) || pauses.length > 10_000) throw new Error('SLA pause history is invalid or too large');
  const normalized = pauses.map((pause, index) => {
    if (!pause || typeof pause !== 'object') throw new Error(`SLA pause ${index + 1} is invalid`);
    const start = normalizeEpoch(pause.startAt, 'SLA pause start');
    const end = normalizeEpoch(pause.endAt, 'SLA pause end');
    if (end < start) throw new Error('SLA pause end precedes its start');
    return [start, end];
  }).sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  for (let index = 1; index < normalized.length; index++) {
    if (normalized[index][0] < normalized[index - 1][1]) throw new Error('SLA pause intervals overlap');
  }
  return normalized;
}

/** Counts scheduled working minutes in [startAt,endAt), using actual UTC duration through DST changes. */
export function businessMinutesBetween({ calendar: sourceCalendar, startAt, endAt } = {}) {
  const calendar = validateSupportBusinessCalendar(sourceCalendar);
  const start = normalizeEpoch(startAt, 'startAt'), end = normalizeEpoch(endAt, 'endAt');
  if (end < start) throw new Error('endAt must not precede startAt');
  if (end === start) return 0;
  const firstDay = dateKey(localParts(start, calendar.timeZone));
  const lastDay = dateKey(localParts(end - 1, calendar.timeZone));
  let totalMs = 0;
  let day = firstDay;
  for (let count = 0; count < MAX_CALENDAR_DAYS && day <= lastDay; count++, day = nextDate(day)) {
    for (const [windowStart, windowEnd] of intervalsForDate(calendar, day)) {
      totalMs += Math.max(0, Math.min(end, windowEnd) - Math.max(start, windowStart));
    }
  }
  if (day <= lastDay) throw new Error('Business-time range exceeds the supported 10-year window');
  return totalMs / MINUTE_MS;
}

function advanceBusinessTime(calendar, startAt, requestedMs, pauses) {
  const start = normalizeEpoch(startAt, 'startAt');
  if (!Number.isSafeInteger(requestedMs) || requestedMs < 0 || requestedMs > MAX_SLA_MINUTES * MINUTE_MS) throw new Error('Business-time duration is outside the supported range');
  if (requestedMs === 0) return new Date(start).toISOString();
  const firstDay = dateKey(localParts(start, calendar.timeZone));
  let remaining = requestedMs;
  let day = firstDay;
  const normalizedPauses = normalizePauses(pauses);
  let pauseIndex = 0;
  for (let count = 0; count < MAX_CALENDAR_DAYS; count++, day = nextDate(day)) {
    for (const [windowStart, windowEnd] of intervalsForDate(calendar, day)) {
      const left = Math.max(start, windowStart);
      if (windowEnd <= left) continue;
      while (pauseIndex < normalizedPauses.length && normalizedPauses[pauseIndex][1] <= left) pauseIndex++;
      let cursor = left;
      for (let index = pauseIndex; index < normalizedPauses.length && normalizedPauses[index][0] < windowEnd; index++) {
        const [pauseStart, pauseEnd] = normalizedPauses[index];
        if (pauseEnd <= cursor) continue;
        const usableEnd = Math.min(windowEnd, pauseStart);
        if (usableEnd > cursor) {
          const available = usableEnd - cursor;
          if (remaining <= available) return new Date(cursor + remaining).toISOString();
          remaining -= available;
        }
        cursor = Math.max(cursor, Math.min(windowEnd, pauseEnd));
        if (cursor >= windowEnd) break;
      }
      if (cursor < windowEnd) {
        const available = windowEnd - cursor;
        if (remaining <= available) return new Date(cursor + remaining).toISOString();
        remaining -= available;
      }
    }
  }
  throw new Error('SLA deadline exceeds the supported 10-year calendar horizon');
}

/** Adds whole working minutes and returns the resulting UTC timestamp. */
export function addBusinessMinutes({ calendar: sourceCalendar, startAt, minutes } = {}) {
  const calendar = validateSupportBusinessCalendar(sourceCalendar);
  if (!Number.isSafeInteger(minutes) || minutes < 1 || minutes > MAX_SLA_MINUTES) throw new Error(`minutes must be an integer from 1 to ${MAX_SLA_MINUTES}`);
  return advanceBusinessTime(calendar, startAt, minutes * MINUTE_MS, []);
}

/** Adds working SLA time while excluding customer-wait pauses reconstructed from the case event log. */
export function addBusinessMinutesExcludingPauses({ calendar: sourceCalendar, startAt, minutes, pauses = [] } = {}) {
  const calendar = validateSupportBusinessCalendar(sourceCalendar);
  if (!Number.isSafeInteger(minutes) || minutes < 1 || minutes > MAX_SLA_MINUTES) throw new Error(`minutes must be an integer from 1 to ${MAX_SLA_MINUTES}`);
  return advanceBusinessTime(calendar, startAt, minutes * MINUTE_MS, pauses);
}

export const SUPPORT_BUSINESS_CALENDAR_LIMITS = Object.freeze({ maxSlaMinutes: MAX_SLA_MINUTES, maxCalendarDays: MAX_CALENDAR_DAYS, maxWeeklyWindowsPerDay: 8, maxHolidayDates: 5_000, maxDateOverrides: 1_000 });
