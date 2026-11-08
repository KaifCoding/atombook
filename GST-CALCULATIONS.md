# GST Calculation Notes

GST calculations are implemented in `lib/gst.ts`; document payload construction is in `lib/build.ts`; return aggregation is in `lib/returns.ts`. Changes to rounding, inclusive/exclusive pricing, discount order, tax splitting, round-off or credit/debit note treatment require regression tests.

Historical documents must retain their saved values. A calculation improvement applies to newly created or explicitly edited documents only; never silently rewrite issued records. Validate output against applicable GST rules and professional tax advice before filing.
