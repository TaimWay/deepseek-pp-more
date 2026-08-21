# Issues — external-api-more

Problems and gotchas encountered during work on this plan.

_Auto-scaffolded by /start-work. Append new entries below - never overwrite._

---

## [2026-08-18 20:50] Task 2 notes
- No new issues. Design decision: http(s) image_url and file_id-only parts are treated as unroutable on the official path → multimodal_unavailable (fail-explicit per task); web path behavior unchanged (http image_urls still ignored there — pre-existing web-path behavior preserved, could be a follow-up if web-path silent-skip of http images matters).
- Follow-up candidate (not in scope): file_id-only parts could one day map through DeepSeek web upload route when backend=web AND file_id exists — currently web path already handles file_id via refFileIds; official path errors.
