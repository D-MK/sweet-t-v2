const SVG_NS = "http://www.w3.org/2000/svg";

const PAD = { top: 14, right: 12, bottom: 22, left: 30 };
const W = 520;
const H = 190;
const BAND = 28; // insulin track height at the bottom

const LO_THRESHOLD = 4.0;
const HI_THRESHOLD = 7.8;

const HUMALOG = "#22d3ee";
const LANTUS = "#f472b6";

function el(name, attrs = {}, text) {
  const node = document.createElementNS(SVG_NS, name);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  if (text != null) node.textContent = text;
  return node;
}

export function renderChart(container, readings, { days = 7 } = {}) {
  container.innerHTML = "";

  const now = Date.now();
  const start = now - days * 24 * 60 * 60 * 1000;
  const inWindow = readings.filter((r) => r.timestamp >= start);
  const points = inWindow
    .filter((r) => Number.isFinite(r.glucose_mmol))
    .sort((a, b) => a.timestamp - b.timestamp);
  const doses = inWindow.filter(
    (r) => r.humalog_units > 0 || r.lantus_units > 0,
  );

  const svg = el("svg", {
    viewBox: `0 0 ${W} ${H}`,
    preserveAspectRatio: "none",
  });
  container.appendChild(svg);

  if (points.length === 0 && doses.length === 0) {
    svg.appendChild(
      el(
        "text",
        {
          x: W / 2,
          y: H / 2,
          "text-anchor": "middle",
          fill: "var(--muted)",
          "font-size": 13,
        },
        "No readings in the last 7 days",
      ),
    );
    return;
  }

  const yMin = Math.min(2, ...points.map((p) => p.glucose_mmol)) - 0.5;
  const yMax = Math.max(12, ...points.map((p) => p.glucose_mmol)) + 0.5;

  const plotBottom = H - PAD.bottom - BAND;
  const x = (t) =>
    PAD.left + ((t - start) / (now - start)) * (W - PAD.left - PAD.right);
  const y = (v) =>
    PAD.top + (1 - (v - yMin) / (yMax - yMin)) * (plotBottom - PAD.top);

  // y-axis grid + labels (3 lines)
  const yTicks = [yMin, (yMin + yMax) / 2, yMax];
  for (const v of yTicks) {
    svg.appendChild(
      el("line", {
        x1: PAD.left,
        x2: W - PAD.right,
        y1: y(v),
        y2: y(v),
        stroke: "var(--border)",
        "stroke-width": 1,
      }),
    );
    svg.appendChild(
      el(
        "text",
        {
          x: PAD.left - 6,
          y: y(v) + 3,
          "text-anchor": "end",
          fill: "var(--muted)",
          "font-size": 10,
        },
        v.toFixed(1),
      ),
    );
  }

  // threshold lines
  if (LO_THRESHOLD >= yMin && LO_THRESHOLD <= yMax) {
    svg.appendChild(
      el("line", {
        x1: PAD.left,
        x2: W - PAD.right,
        y1: y(LO_THRESHOLD),
        y2: y(LO_THRESHOLD),
        stroke: "var(--danger)",
        "stroke-width": 1,
        "stroke-dasharray": "4 4",
        opacity: 0.5,
      }),
    );
  }
  if (HI_THRESHOLD >= yMin && HI_THRESHOLD <= yMax) {
    svg.appendChild(
      el("line", {
        x1: PAD.left,
        x2: W - PAD.right,
        y1: y(HI_THRESHOLD),
        y2: y(HI_THRESHOLD),
        stroke: "var(--warn)",
        "stroke-width": 1,
        "stroke-dasharray": "4 4",
        opacity: 0.5,
      }),
    );
  }

  // glucose line path
  if (points.length > 1) {
    const d = points
      .map(
        (p, i) =>
          `${i === 0 ? "M" : "L"}${x(p.timestamp).toFixed(1)},${y(p.glucose_mmol).toFixed(1)}`,
      )
      .join(" ");
    svg.appendChild(
      el("path", {
        d,
        fill: "none",
        stroke: "var(--accent)",
        "stroke-width": 2,
        "stroke-linejoin": "round",
        "stroke-linecap": "round",
      }),
    );
  }

  // glucose dots
  for (const p of points) {
    const colour =
      p.glucose_mmol > HI_THRESHOLD
        ? "var(--warn)"
        : p.glucose_mmol < LO_THRESHOLD
          ? "var(--danger)"
          : "var(--accent-hi)";
    svg.appendChild(
      el("circle", {
        cx: x(p.timestamp),
        cy: y(p.glucose_mmol),
        r: 3.5,
        fill: colour,
        stroke: "var(--bg-card)",
        "stroke-width": 1,
      }),
    );
  }

  // insulin track — color-coded bars grow up from the baseline
  const bandBase = H - PAD.bottom;
  const maxBarH = BAND - 4;
  svg.appendChild(
    el("line", {
      x1: PAD.left,
      x2: W - PAD.right,
      y1: bandBase,
      y2: bandBase,
      stroke: "var(--border)",
      "stroke-width": 1,
    }),
  );
  const maxDose = Math.max(
    1,
    ...doses.map((r) => Math.max(r.humalog_units || 0, r.lantus_units || 0)),
  );
  const bar = (t, units, colour, offset) => {
    const h = Math.max(2, (units / maxDose) * maxBarH);
    svg.appendChild(
      el("rect", {
        x: (x(t) + offset).toFixed(1),
        y: (bandBase - h).toFixed(1),
        width: 3,
        height: h.toFixed(1),
        rx: 1,
        fill: colour,
      }),
    );
  };
  for (const r of doses) {
    if (r.humalog_units > 0) bar(r.timestamp, r.humalog_units, HUMALOG, -2.5);
    if (r.lantus_units > 0)
      bar(
        r.timestamp,
        r.lantus_units,
        LANTUS,
        r.humalog_units > 0 ? 1.5 : -1.5,
      );
  }

  // insulin legend (top-right)
  if (doses.length > 0) {
    [
      ["H", HUMALOG],
      ["L", LANTUS],
    ].forEach(([label, colour], i) => {
      const lx = W - PAD.right - 56 + i * 28;
      svg.appendChild(
        el("rect", {
          x: lx,
          y: PAD.top - 9,
          width: 8,
          height: 8,
          rx: 1,
          fill: colour,
        }),
      );
      svg.appendChild(
        el(
          "text",
          {
            x: lx + 11,
            y: PAD.top - 2,
            fill: "var(--muted)",
            "font-size": 10,
          },
          label,
        ),
      );
    });
  }

  // x-axis day labels (every other day)
  for (let i = 0; i <= days; i += 2) {
    const t = start + (i / days) * (now - start);
    const date = new Date(t);
    const label = `${date.getMonth() + 1}/${date.getDate()}`;
    svg.appendChild(
      el(
        "text",
        {
          x: x(t),
          y: H - 6,
          "text-anchor": "middle",
          fill: "var(--muted)",
          "font-size": 10,
        },
        label,
      ),
    );
  }
}
