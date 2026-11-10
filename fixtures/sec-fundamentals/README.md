# SEC fundamentals regression fixtures

These public SEC observations and statement tables were retrieved on 10 November
2026. `manifest.json` records the original SEC URLs, filing provenance and expected
financial figures for the historical cutoff of 13 January 2026.

Company Facts fixtures retain the supported US-GAAP/IFRS concepts and observations
from 2022 onward, including later disclosures that historical mode must exclude.
HTML fixtures retain original table structure, date headings, units and values;
decorative attributes, scripts and images have been removed. They are data
fixtures, not copies of the companies' complete annual reports.

TSEM, MNDY, STM, WPM, SAP and TSM exercise the shared filing reader. AAPL and BE
are Company Facts controls. TSM's latest quarter is established by subtracting
compatible six-month results from nine-month results. Tests also relabel source
accessions to ensure extraction does not depend on issuer identity.
