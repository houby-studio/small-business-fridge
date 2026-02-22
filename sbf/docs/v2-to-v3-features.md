Critical / High Priority

Gap: Restock notifications not triggered  
 Details: Email template exists (restock.edge), but DeliveryService never calls it when a favorite product is restocked
────────────────────────────────────────  
 Gap: ESL Integration (AIMS/JAMES)  
 Details: Env var ESL_AIMS_ENABLED referenced but no scheduled sync tasks or actual integration logic; /admin/esl-mapping route is a
stub
────────────────────────────────────────
Gap: Scanner hardware APIs
Details: Old /api/scannerAuthUser, /api/scannerProduct, /api/scannerOrder, /api/scannerValidate are gone — embedded device firmware
needs updating
────────────────────────────────────────
Gap: Customer Insights API
Details: CustomersController.show() and .insights() are stubs returning null (was used for voice bot)
────────────────────────────────────────
Gap: Database backups
Details: Old codebase had a daily-backup.js scheduled task; NEW has no PostgreSQL backup task (needs external setup)

Medium Priority

┌──────────────────────────┬─────────────────────────────────────────────────────────────────────────────────────────────┐
│ Gap │ Details │
├──────────────────────────┼─────────────────────────────────────────────────────────────────────────────────────────────┤
│ GPT product descriptions │ POST /api/promptGpt existed for AI-generated product slogans — not implemented in new stack │
├──────────────────────────┼─────────────────────────────────────────────────────────────────────────────────────────────┤
│ productList API │ Old /api/productList returned all products for voice bot — no equivalent │
├──────────────────────────┼─────────────────────────────────────────────────────────────────────────────────────────────┤
│ System alert emails │ No mechanism to email admin on critical errors │
├──────────────────────────┼─────────────────────────────────────────────────────────────────────────────────────────────┤
│ About/Docs pages │ Old had /docs, /about routes — new has neither │
├──────────────────────────┼─────────────────────────────────────────────────────────────────────────────────────────────┤
│ Daily phone sync task │ daily-user-phones.js scheduled task had an unknown purpose (possibly webhook sync) │
└──────────────────────────┴─────────────────────────────────────────────────────────────────────────────────────────────┘

Low Priority

┌─────────────────┬─────────────────────────────────────────────────────────────────────────────────────────────┐
│ Gap │ Details │
├─────────────────┼─────────────────────────────────────────────────────────────────────────────────────────────┤
│ Theme selection │ Old had theme enum (happy/angry/shocked) on User model; new only has colorMode (light/dark) │
└─────────────────┴─────────────────────────────────────────────────────────────────────────────────────────────┘

---

New Enhancements (not in old)

The rewrite also added things the old didn't have: TypeScript, 184 tests, RecommendationService with daily ML-based suggestions,
personal API tokens, structured AuditLog model, PageView tracking, ImpersonationMiddleware, and proper kiosk session model.

---

Most impactful items to implement next would be: restock notification trigger in DeliveryService, ESL integration, and the customer
insights API stub completion — in that order.
