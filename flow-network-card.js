// setzt je Link die Richtung anhand des flow_entity-Wertes
_updateLinkDirections() {
  if (!this._links) return;
  const missing = (this._config.missing_behavior || "stop");

  const readNumber = (id) => {
    const st = this._hass?.states?.[id];
    const num = Number(st?.state);
    return Number.isFinite(num) ? num : NaN;
  };

  for (const l of this._links) {
    // wenn Link keine Geometrie hat, Richtung egal
    l._dir = 0;

    // Quelle für Flusswert: explizit -> flow_entity, sonst entity des FROM-Nodes
    const fromNode = this._nodeMap?.get(l.from);
    const flowId = (l.flow_entity != null && l.flow_entity !== "")
      ? l.flow_entity
      : (fromNode?.entity || null);

    // kein Sensor → ggf. stoppen
    if (!flowId) { if (missing === "stop") l._dir = 0; continue; }

    const v = readNumber(flowId);
    const thr = Number.isFinite(l.zero_threshold) ? Math.max(0, l.zero_threshold) : 0.0001;

    // NaN oder ~0 → keine Animation
    if (!Number.isFinite(v) || Math.abs(v) <= thr) { l._dir = 0; continue; }

    // Vorzeichen bestimmt Richtung
    l._dir = v > 0 ? 1 : -1;
  }
}
