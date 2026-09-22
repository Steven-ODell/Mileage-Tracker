# Plans

Ideas Sao asked to keep on the list. Not built yet.

## Fuel cost estimate (requested 2026-09-21)

**Goal:** see what the driving actually cost in gas, not just miles.

**How:**
- Settings: average MPG for his truck (city driving), plus a gas price per gallon. Price can be typed in, or the latest fill-up price if fill-ups get logged later.
- Cost per leg = miles ÷ MPG × price. Show it on each leg, per day, and year-to-date next to the business miles.
- Keep the price that was in effect when the leg was driven (store price with the leg or keep a dated price history), so changing today's price doesn't rewrite last month.
- Optional later: log fill-ups (gallons + total $) to compute real MPG instead of the typed average.

**Test plan:**
- Unit test the math: 100 mi at 20 MPG and $3.50/gal = $17.50. Zero or missing MPG gives no cost rather than a crash or infinity.
- Change the price, confirm old legs keep their old cost.
- Compare a week's estimate against real fill-up receipts.
- Add a CSV column (`fuel_cost`) only if he wants it in the export. The current column list is fixed by the spec.

**Tax note (said once, his call):** with the IRS standard mileage rate, gas is not deducted on top of it; the rate covers gas. This estimate is for knowing real spend. It matters for the tax return only if he uses the actual-expense method instead.
