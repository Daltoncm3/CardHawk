# Runtime-to-Canonical Signal Conformance Checklist

This checklist defines the approval requirements for any future Runtime-to-Canonical Signal Compatibility Adapter.

The checklist is documentation-only. It does not implement an adapter and does not modify runtime behavior.

## Required Checklist Items

1. The adapter is offline-only.
2. The adapter has no `server.js` import.
3. The adapter does not execute scanner flow.
4. The adapter does not execute Deal Gate.
5. The adapter does not execute valuation engines.
6. The adapter does not execute Signal migrations as production work.
7. The adapter consumes already-produced runtime source data only.
8. The adapter preserves runtime raw input exactly.
9. The adapter preserves runtime signal ID.
10. The adapter preserves runtime owner metadata.
11. The adapter preserves runtime schema version separately from canonical schema version.
12. The adapter preserves source provenance.
13. The adapter preserves listing references when supplied.
14. The adapter preserves Deal Gate references when supplied.
15. The adapter preserves every warning-like source field.
16. The adapter preserves unknown warning codes.
17. The adapter preserves warning order or documents deterministic ordering.
18. The adapter preserves caution signals.
19. The adapter preserves blockers.
20. The adapter preserves conflicts.
21. The adapter preserves failed reasons.
22. The adapter preserves rule-level reasons.
23. The adapter preserves readiness values as contextual readiness only.
24. The adapter prevents readiness upgrades.
25. The adapter preserves missing readiness as `unknown`.
26. The adapter preserves confidence values with source-specific meaning.
27. The adapter prevents missing confidence from becoming zero.
28. The adapter prevents confidence from becoming valuation confidence unless source-specific.
29. The adapter prevents high confidence from becoming approval.
30. The adapter preserves `null` source values.
31. The adapter distinguishes `null`, missing, empty string, zero, and false.
32. The adapter preserves unknown values.
33. The adapter prevents unknown values from becoming positive evidence.
34. The adapter prevents active listings from becoming true sold evidence.
35. The adapter prevents fallback permission from becoming fallback usage.
36. The adapter preserves native output parity.
37. The adapter computes deterministic source fingerprints.
38. The adapter computes deterministic compatibility fingerprints.
39. The adapter produces deterministic validation results.
40. The adapter is idempotent for identical inputs.
41. The adapter returns immutable outputs.
42. The adapter classifies every mapping using Phase 18.1B classifications.
43. The adapter rejects incompatible mappings.
44. The adapter preserves intentionally unmapped fields as metadata or raw input only.
45. The adapter preserves legacy aliases.
46. The adapter validates schema compatibility.
47. The adapter reports unknown source versions.
48. The adapter reports missing registry definitions.
49. The adapter fails closed on validation errors.
50. The adapter emits structured reason codes.
51. The adapter emits structured authority violations.
52. The adapter preserves `productionImpact: none`.
53. The adapter preserves `decisionImpact: none`.
54. The adapter preserves `executionAuthority: none`.
55. The adapter cannot create BUY_NOW.
56. The adapter cannot override Deal Gate.
57. The adapter cannot suppress Deal Gate rejection reasons.
58. The adapter cannot create alerts.
59. The adapter cannot send notifications.
60. The adapter cannot persist production state.
61. The adapter passes every Phase 18.1C fixture scenario.
62. The adapter has field-preservation tests.
63. The adapter has warning-preservation tests.
64. The adapter has readiness-preservation tests.
65. The adapter has authority-preservation tests.
66. The adapter has deterministic-output tests.
67. The adapter has unknown-value tests.
68. The adapter has null-handling tests.
69. The adapter has schema-compatibility tests.
70. The adapter has failure-handling tests.
71. The adapter has replay consistency tests.
72. The adapter has backward-compatibility tests proving runtime output is unchanged.

## Approval Rule

All checklist items must pass before an adapter can be considered ready for offline approval.

Passing this checklist does not authorize runtime integration, shadow integration, production promotion, Deal Gate changes, BUY_NOW changes, alerts, notifications, or persistence changes. Any later integration requires a separate governed phase.
