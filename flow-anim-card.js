_metrics(pxW, pxH) {
  const cfg = this._config.layout || {};
  const padX = Number.isFinite(cfg.padding_x) ? cfg.padding_x : 16;
  const padY = Number.isFinite(cfg.padding_y) ? cfg.padding_y : 16;
  const gapX = Number.isFinite(cfg.gap_x) ? cfg.gap_x : 20;
  const gapY = Number.isFinite(cfg.gap_y) ? cfg.gap_y : 20;
  const prefW = Math.max(80, Number(cfg.preferred_col_width || 0)); // Wunschbreite  (weich)
  const targetCols = Math.max(1, Math.floor(cfg.columns || 3));
  const anyPinned = this._nodes.some(n => n.row != null || n.col != null);

  // Wie viele Reihen brauchen wir mindestens?
  const rowsAuto = Math.ceil(this._nodes.length / targetCols);
  const maxPinnedRow = this._nodes.reduce(
    (m, n) => Math.max(m, n.row != null ? Math.ceil(Number(n.row)) : 0),
    0
  );
  const baseRows = anyPinned ? Math.max(maxPinnedRow, rowsAuto) : rowsAuto;

  // Verfügbarer Platz
  const availW = Math.max(1, pxW - padX*2);
  const responsive = !!cfg.responsive;

  // Spaltenanzahl ggf. responsiv reduzieren, bis es passt
  let cols = targetCols;
  if (responsive) {
    while (cols > 1) {
      const gridWidthIfPref =
        cols * prefW + (cols - 1) * gapX;
      if (gridWidthIfPref <= availW) break;
      cols--; // eine Spalte weniger probieren
    }
  }

  // Endgültige Zellbreite: so groß wie möglich, aber nie größer als der verfügbare Platz
  const cwFit = (availW - (cols - 1) * gapX) / cols;
  const cw = Math.max(60, Math.min(cwFit, prefW)); // nie > cwFit, nie < 60px
  const ch = cw; // quadratisch

  // Gesamtbreite/Höhe des Grids
  const gridW = cols * cw + (cols - 1) * gapX;
  const leftOffset = (pxW - gridW) / 2;

  // Zeilenanzahl (bei festen/pinned Reihen kann das weiter unten noch steigen)
  let rows = baseRows;
  // Falls wir viele Knoten haben und mit weniger Spalten arbeiten, kann baseRows steigen:
  if (!anyPinned) rows = Math.ceil(this._nodes.length / cols);

  const totalH = padY*2 + rows*ch + (rows-1)*gapY;
  const topOffset = padY;

  return { cols, rows, gapX, gapY, padX, padY, cw, ch, leftOffset, topOffset, totalH };
}
