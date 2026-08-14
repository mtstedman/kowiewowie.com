# Database seed sources

`chess-openings.tsv` is a broad curated subset of the
[lichess-org/chess-openings](https://github.com/lichess-org/chess-openings)
catalog at commit `4b8622759e7ae6f93f011cc6c83a3823401ab45e`. That catalog is
released under CC0. The two duplicate Queen's Gambit Declined and King's Indian
Normal Variation records add alternate legal move orders to exercise explicit
transposition edges; the opening names and ECO classifications are unchanged.
The catalog is balanced across ECO groups A through E and favors named systems,
defenses, variations, and main lines over exhaustive novelty coverage.

The TSV intentionally stores standard ECO, name, and PGN/SAN interchange data.
`database/seed-chess-openings.php` derives UCI moves and canonical EPD positions
with the application's chess engine rather than trusting duplicated generated
fields.
