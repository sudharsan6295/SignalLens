# Fix flaky checkout test
_Exported on 8/10/2026 at 14:03:22 GMT+5:30 from Cursor (1.5.11)_

---

**User**

The checkout test fails randomly on CI. Can you find why?

---

**Cursor**

The test reads `Date.now()` directly, so it depends on the machine clock. Freeze time in the test:

```ts
vi.useFakeTimers();
vi.setSystemTime(new Date("2026-01-01"));
```

---

**User**

still failing, same error

---

**Cursor**

My mistake — the timers are never restored, so the next test inherits the fake clock. Add `afterEach(() => vi.useRealTimers())`.

---

**User**

Perfect, thanks!

---

**Cursor**

Glad it's fixed.
