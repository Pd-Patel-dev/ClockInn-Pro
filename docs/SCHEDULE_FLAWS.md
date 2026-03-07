# Schedule Module – Potential Flaws and Issues

This document lists possible flaws, edge cases, and improvements for the schedule/shift functionality in ClockInn-Pro (frontend and backend). It is for review and remediation planning, not an exhaustive security audit.

---

## 1. Backend – API & Endpoints

### 1.1 Create shift does not expose conflicts in response
- **Location:** `server/app/api/v1/endpoints/shifts.py` – `create_shift_endpoint`
- **Issue:** `create_shift()` returns `(shift, conflicts)` but the endpoint only returns `ShiftResponse`. Callers cannot see that the shift was created with overlapping conflicts.
- **Suggestion:** Extend the response (e.g. `ShiftCreateResponse`) to include an optional `conflicts: List[ShiftConflict]` or return `201` with a header/wrapper that includes conflicts.

### 1.2 Update shift same – conflicts not returned
- **Location:** `server/app/api/v1/endpoints/shifts.py` – `update_shift_endpoint`
- **Issue:** `update_shift()` returns `(shift, conflicts)` but the response is only `ShiftResponse`. Frontend cannot warn the user that the updated shift overlaps others.
- **Suggestion:** Return conflicts in the response body or a separate field.

### 1.3 List shifts – no total in response
- **Location:** `server/app/api/v1/endpoints/shifts.py` – `list_shifts_endpoint`
- **Issue:** `list_shifts()` returns `(shifts, total)` but the endpoint returns only the list. Pagination (skip/limit) is used but clients cannot know total count for “Page 1 of N” or “Load more”.
- **Suggestion:** Return `{ "items": [...], "total": N }` or add a response header like `X-Total-Count`.

### 1.4 Send schedule – week bounds assumption
- **Location:** `server/app/api/v1/endpoints/shifts.py` – `send_schedule_endpoint`
- **Issue:** `week_end = data.week_start_date + timedelta(days=6)` assumes `week_start_date` is always Monday. If a client sends a different weekday, the “week” is Mon+6 from that date, not a calendar week.
- **Suggestion:** Validate that `week_start_date` is a Monday, or compute week end from the actual week (e.g. Sunday of the same ISO week).

### 1.5 Generate from template – mutable input
- **Location:** `server/app/api/v1/endpoints/shifts.py` – `generate_shifts_from_template_endpoint`
- **Issue:** `data.template_id = parsed_template_id` mutates the request body. Pydantic models are often treated as immutable; this can surprise callers and break if the schema is frozen.
- **Suggestion:** Build a new struct or pass `template_id` separately instead of mutating `data`.

---

## 2. Backend – Services

### 2.1 Bulk create – Pydantic v2 compatibility
- **Location:** `server/app/services/bulk_shift_service.py` – `create_bulk_week_shifts`
- **Issue:** `c.dict()` is used for conflict detail. In Pydantic v2, `.dict()` is deprecated; use `.model_dump()`.
- **Suggestion:** Replace with `[c.model_dump() for c in conflicts]` (and ensure Pydantic v2 is in use).

### 2.2 Bulk parse_time_string – no validation
- **Location:** `server/app/services/bulk_shift_service.py` – `parse_time_string`
- **Issue:** `time_str.split(":")` and `int(parts[0])`, `int(parts[1])` with no checks. Malformed input (e.g. `"1"`, `"25:00"`, `"11:60"`) can raise or produce invalid time.
- **Suggestion:** Validate format (e.g. `HH:mm`), hour 0–23, minute 0–59; raise a clear error or use a shared 24h parser (e.g. from shift schema).

### 2.3 Overwrite policy – atomicity
- **Location:** `server/app/services/bulk_shift_service.py` – `create_bulk_week_shifts` (overwrite branch)
- **Issue:** Conflicting shifts are deleted with `delete(Shift)...` and new shifts are `db.add(shift)`; a single `db.commit()` runs at the end. If commit fails after some deletes were applied in the same transaction, the transaction rolls back, so DB stays consistent, but if there were multiple commits (there aren’t), partial state could occur.
- **Note:** Currently one commit at end is fine. If the flow is later split (e.g. commit after each delete), consider a single transaction or compensating logic.

### 2.4 Conflict detection – N+1 when building conflict message
- **Location:** `server/app/services/shift_service.py` – `detect_shift_conflicts`
- **Issue:** For each conflicting shift, a separate query loads the employee: `select(User).where(User.id == employee_id)`. For many conflicts this is N+1.
- **Suggestion:** Load all involved employees in one query (e.g. by `employee_id` in the conflicting shifts) and reuse when building `ShiftConflict` messages.

### 2.5 approve_shift uses utcnow()
- **Location:** `server/app/services/shift_service.py` – `approve_shift`
- **Issue:** `approved_at = datetime.utcnow()` is naive UTC. If the DB or other code expects timezone-aware datetimes, this can cause subtle bugs.
- **Suggestion:** Use timezone-aware UTC (e.g. `datetime.now(timezone.utc)` or your app’s standard).

---

## 3. Backend – Schemas & Validation

### 3.1 ShiftUpdate status string not validated
- **Location:** `server/app/schemas/shift.py` – `ShiftUpdate`
- **Issue:** `status: Optional[str]` accepts any string. The service does `ShiftStatus(data.status)`, which can raise for invalid values.
- **Suggestion:** Use `Literal["DRAFT", "PUBLISHED", "APPROVED", "CANCELLED"]` or an enum in the schema so invalid statuses are rejected at validation.

### 3.2 Bulk DayTemplate time pattern
- **Location:** `server/app/schemas/bulk_shift.py` – `DayTemplate`
- **Issue:** `pattern=r"^\d{2}:\d{2}$"` requires two-digit hour. Values like `"9:00"` (single digit) are rejected even though they are valid 24h times.
- **Suggestion:** Allow optional leading zero (e.g. `\d{1,2}:\d{2}`) and/or validate hour 0–23, minute 0–59 in a validator.

### 3.3 Break minutes upper bound
- **Location:** `server/app/schemas/shift.py` – `ShiftBase`; `server/app/schemas/bulk_shift.py` – `BulkWeekShiftTemplate`
- **Issue:** `break_minutes` has `ge=0` but no upper bound. A typo (e.g. 9999) could create a “break” longer than the shift.
- **Suggestion:** Add a reasonable cap (e.g. `le=1440` or `le=480`) and/or validate that break_minutes < shift duration.

---

## 4. Backend – Data & Time

### 4.1 No timezone for shift times
- **Location:** Models store `Time` (no timezone); API uses `date` + `time` (HH:mm).
- **Issue:** All times are effectively “wall clock” in an unspecified timezone. For multi-timezone companies or DST, “11:00” can be ambiguous. Send-schedule and display do not convert to user timezone.
- **Suggestion:** Document that times are in company/default timezone; optionally store timezone per company and convert when sending emails or showing in UI.

**Documented behavior (convention):** Shift times are **wall-clock time in the company default timezone**. The API stores `shift_date` (date) and `start_time` / `end_time` (HH:mm) with no timezone; these are interpreted as local to the company. For single-timezone or same-location teams this is sufficient. Send-schedule emails and the UI currently show these times as-is and do **not** convert to the recipient's or viewer's timezone. **Optional improvement:** Company timezone is already stored in company settings. When sending schedule emails or rendering the schedule in the UI, convert `(shift_date, start_time/end_time)` using the company timezone (and optionally the user's timezone for display) so that "11:00" is unambiguous and correct for the viewer.

### 4.2 List shifts date filter – overnight shifts
- **Location:** `server/app/services/shift_service.py` – `list_shifts`
- **Issue:** Filter uses `shift_date >= extended_start` and `shift_date <= extended_end` with ±1 day extension. A shift that “starts” Monday 11 PM and “ends” Tuesday 7 AM has `shift_date = Monday`; it is included for a Mon–Sun week. Shifts that start Sunday 11 PM (shift_date Sunday) and end Monday 7 AM are included when the range includes Sunday. Logic is consistent but subtle; any change to “in range” semantics could miss overnight shifts.
- **Suggestion:** Document the rule clearly and add a short comment in code. Consider a helper “shift overlaps [start_date, end_date]” used everywhere.

---

## 5. Frontend – Pages & Data

### 5.1 Schedule page – company day start/end not loaded
- **Location:** `client/app/schedules/page.tsx`
- **Issue:** `scheduleDayStartHour` and `scheduleDayEndHour` are defaulted to `7` and never loaded from company settings (if such an API exists). Timeline uses these for the 7 AM–7 AM “day.”
- **Suggestion:** Fetch company/settings and set `scheduleDayStartHour` / `scheduleDayEndHour` from them; keep 7 as fallback.

### 5.2 Create shift – conflicts only client-side
- **Location:** `client/app/schedules/page.tsx` – `handleCreateShift`, `checkForConflicts`
- **Issue:** Conflict check uses in-memory `shifts`. If two users create overlapping shifts, or if the list is paginated/incomplete, the client may not see the conflict; the server still creates the shift and may return conflicts in the future if the API is extended.
- **Suggestion:** Rely on server-side conflict detection; if create response includes conflicts, show a warning and optionally let the user confirm.

### 5.3 Week edit – no refetch after delete
- **Location:** `client/app/schedules/week/edit/page.tsx`
- **Issue:** After deleting a shift, state is updated with `setShifts(prev => prev.filter(...))`. If the delete response is delayed or the list was paginated, local state could get out of sync with the server.
- **Suggestion:** Optionally refetch the week’s shifts after a successful delete so the list always matches the server.

### 5.4 Week edit – missing employee_id/week_start in dependency array
- **Location:** `client/app/schedules/week/edit/page.tsx` – `useEffect` for fetch
- **Issue:** Effect depends on `[employeeId, weekStartStr, router, toast]`. If `employeeId` or `weekStartStr` come from URL and change without remount, the effect reruns, which is correct. `toast` in the dependency array can cause extra fetches if the toast reference changes.
- **Suggestion:** Omit `toast` from the dependency array if it’s stable, or use a ref for toast to avoid unnecessary refetches.

### 5.5 Bulk week – timezone in payload not used for creation
- **Location:** `client/app/schedules/week/page.tsx` – payload includes `timezone`; backend `bulk_shift_service` does not use it when building shift dates/times.
- **Issue:** User can set a timezone in the form but shift dates/times are created in server’s (or a fixed) context. So “timezone” is accepted but has no effect on the created shifts.
- **Suggestion:** Either use the timezone when interpreting “week” and shift times (e.g. week boundaries in that zone) or remove the field / document that it’s for future use.

---

## 6. Frontend – Components & UX

### 6.1 ShiftTimeline – invalid time fallback
- **Location:** `client/components/ShiftTimeline.tsx` – `normalizeShift`
- **Issue:** When `parseTime24` returns null (invalid or missing time), the shift is rendered as midnight to next-day midnight. That can look like a 24-hour block and be misleading.
- **Suggestion:** Optionally hide the block or show a “Invalid time” label when parsing fails.

### 6.2 ShiftTimeline – hover tooltip position
- **Location:** `client/components/ShiftTimeline.tsx` – hover tooltip
- **Issue:** Tooltip uses a fixed `left`/`top` (e.g. `top: 100`). On scroll or small viewports it can sit off-screen or overlap the timeline.
- **Suggestion:** Position relative to the cursor or the shift block (e.g. getBoundingClientRect) and clamp to viewport.

### 6.3 TimeInput12h – no invalid value handling
- **Location:** `client/components/TimeInput12h.tsx`
- **Issue:** If `value` is an invalid string, `toTime12h` returns a default `{ hour12: 12, minute: 0, ampm: 'AM' }`. The user sees 12:00 AM and might not know the value was invalid.
- **Suggestion:** For invalid `value`, either show a neutral placeholder and/or call `onChange("00:00")` once so the parent has a valid value.

### 6.4 Schedule page – console.log in production
- **Location:** `client/app/schedules/page.tsx` – `handleCreateShift`
- **Issue:** There are `console.log` statements for request payload and datetime calculations. They clutter the console and may leak info in production.
- **Suggestion:** Remove or guard with `process.env.NODE_ENV !== 'production'` or a logger that is no-op in production.

---

## 7. Security & Permissions

### 7.1 Employee role check on create
- **Location:** `server/app/services/shift_service.py` – `create_shift`
- **Issue:** Employee is required to be one of `MAINTENANCE`, `FRONTDESK`, `HOUSEKEEPING`. If new roles are added (e.g. “Contractor”), they must be added here or they cannot be assigned shifts.
- **Suggestion:** Consider a single “can be assigned shifts” flag or list of roles in config so new roles don’t require code changes.

### 7.2 Delete shift is hard delete
- **Location:** `server/app/services/shift_service.py` – `delete_shift`
- **Issue:** Shifts are permanently deleted. There is no soft delete or audit trail for who deleted what and when.
- **Suggestion:** If compliance or auditing is needed, consider soft delete (e.g. status CANCELLED or a `deleted_at` column) and restrict hard delete to admins or background jobs.

---

## 8. Consistency & Edge Cases

### 8.1 Same start and end time (non-overnight)
- **Location:** Backend allows `end_time <= start_time` for overnight. No explicit check that when `end_time == start_time` it is intended as “next day.”
- **Issue:** A user could save 09:00–09:00 meaning “9 AM to 9 AM next day” or by mistake “no duration.” Backend treats it as overnight (end next day). No validation that duration is positive after resolving overnight.
- **Suggestion:** Either reject `start_time == end_time` or document that it means “until same time next day” and optionally validate max duration (e.g. &lt; 24 hours) if that’s a business rule.

### 8.2 Break longer than shift duration
- **Location:** No validation in backend or frontend that `break_minutes` is less than the shift duration (in minutes).
- **Issue:** User could set e.g. 8h shift and 10h break; totals and reporting could look wrong.
- **Suggestion:** Validate `break_minutes < (end - start)` in schema or service (with overnight handled).

### 8.3 Generate from template – conflicts not prevented
- **Location:** `server/app/services/shift_service.py` – `generate_shifts_from_template`
- **Issue:** Conflicts are detected and appended to `all_conflicts`, but shifts are still created and committed. Caller gets conflicts in the response but the DB already has overlapping shifts.
- **Suggestion:** Decide policy: either (a) do not create shifts that conflict and return conflicts, or (b) create all and return conflicts as warning (document current behavior).

---

## 9. Summary Table

| #   | Area        | Severity (H/M/L) | One-line summary |
|-----|-------------|------------------|------------------|
| 1.1 | API         | M                | Create shift response does not include conflicts. |
| 1.2 | API         | M                | Update shift response does not include conflicts. |
| 1.3 | API         | M                | List shifts does not return total count for pagination. |
| 1.4 | API         | L                | Send schedule assumes week_start_date is Monday. |
| 1.5 | API         | L                | Generate from template mutates request body. |
| 2.1 | Service     | M                | Pydantic `.dict()` should be `.model_dump()`. |
| 2.2 | Service     | M                | Bulk parse_time_string has no validation. |
| 2.4 | Service     | L                | N+1 queries when building conflict messages. |
| 2.5 | Service     | L                | approve_shift uses naive utcnow(). |
| 3.1 | Schema      | M                | ShiftUpdate status not validated as enum. |
| 3.2 | Schema      | L                | DayTemplate time pattern rejects single-digit hour. |
| 3.3 | Schema      | L                | break_minutes has no upper bound. |
| 4.1 | Data/Time   | M                | No timezone handling for shift times. |
| 5.1 | Frontend    | M                | Schedule day start/end not loaded from settings. |
| 5.2 | Frontend    | M                | Create shift conflicts only client-side. |
| 5.5 | Frontend    | L                | Bulk timezone in payload unused. |
| 6.1 | Component   | L                | Timeline fallback for invalid time can mislead. |
| 6.4 | Frontend    | L                | console.log in production (schedule create). |
| 7.2 | Security    | M                | Shift delete is hard delete; no audit. |
| 8.1 | Edge case   | L                | start_time == end_time semantics. |
| 8.2 | Edge case   | L                | break_minutes can exceed shift duration. |
| 8.3 | Service     | M                | Generate from template creates shifts despite conflicts. |

---

*Document generated for schedule module review. Prioritize by severity and product needs.*
