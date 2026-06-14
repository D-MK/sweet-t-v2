import {
  TARGET,
  TARGET_LOW,
  TARGET_HIGH,
  LO_THRESHOLD,
  HI_THRESHOLD,
} from "./config.js";
import { isMgdl, MMOL_TO_MGDL, fmtThreshold } from "./prefs.js";

const SVG_NS = "http://www.w3.org/2000/svg";

// Format a glucose y-axis value (held internally in mmol/L) for the active unit.
function fmtAxis(mmol) {
  return isMgdl() ? String(Math.round(mmol * MMOL_TO_MGDL)) : mmol.toFixed(1);
}

const PAD = { top: 14, right: 30, bottom: 22, left: 30 };
const W = 520;
const H = 190;

// Theme-aware — track the --humalog/--lantus vars so the bars + legend follow
// light/dark themes instead of staying locked to the dark palette.
const HUMALOG = "var(--humalog)";
const LANTUS = "var(--lantus)";

function el(name, attrs = {}, text) {
  const node = document.createElementNS(SVG_NS, name);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  if (text != null) node.textContent = text;
  return node;
}

export function renderChart(
  container,
  readings,
  { days = 7, mode = "both" } = {},
) {
  container.innerHTML = "";

  const showGlucose = mode === "both" || mode === "glucose";
  const showInsulin = mode === "both" || mode === "insulin";
  // In glucose-only mode the right axis is unused, so reclaim its padding.
  const padRight = mode === "glucose" ? 12 : PAD.right;

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

  const emptyState = (msg) => {
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
        msg,
      ),
    );
  };

  const haveGlucose = showGlucose && points.length > 0;
  const haveInsulin = showInsulin && doses.length > 0;
  if (!haveGlucose && !haveInsulin) {
    if (mode === "insulin") emptyState("No insulin in the selected range");
    else emptyState("No readings in the selected range");
    return;
  }

  // Full plot height — insulin no longer steals a fixed band at the bottom.
  const plotBottom = H - PAD.bottom;
  const x = (t) =>
    PAD.left + ((t - start) / (now - start)) * (W - PAD.left - padRight);

  // x-axis day labels — adaptive density so long windows don't crowd.
  const drawDayLabels = () => {
    const targetLabels = days <= 14 ? Math.ceil(days / 2) : 6;
    const labelStep = Math.max(1, Math.ceil(days / targetLabels));
    for (let i = 0; i <= days; i += labelStep) {
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
  };

  // ---- glucose plot (left axis, mmol/L) ----
  if (haveGlucose) {
    const yMin = Math.min(2, ...points.map((p) => p.glucose_mmol)) - 0.5;
    const yMax = Math.max(12, ...points.map((p) => p.glucose_mmol)) + 0.5;
    const y = (v) =>
      PAD.top + (1 - (v - yMin) / (yMax - yMin)) * (plotBottom - PAD.top);

    // target band — translucent rect behind the grid/line
    if (TARGET_HIGH >= yMin && TARGET_LOW <= yMax) {
      const yTop = y(Math.min(TARGET_HIGH, yMax));
      const yBot = y(Math.max(TARGET_LOW, yMin));
      svg.appendChild(
        el("rect", {
          x: PAD.left,
          y: yTop.toFixed(1),
          width: (W - PAD.left - padRight).toFixed(1),
          height: (yBot - yTop).toFixed(1),
          fill: "var(--good)",
          opacity: 0.1,
        }),
      );
    }

    // y-axis grid + labels (3 lines)
    const yTicks = [yMin, (yMin + yMax) / 2, yMax];
    for (const v of yTicks) {
      svg.appendChild(
        el("line", {
          x1: PAD.left,
          x2: W - padRight,
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
          fmtAxis(v),
        ),
      );
    }

    // dashed target line at TARGET (6)
    if (TARGET >= yMin && TARGET <= yMax) {
      svg.appendChild(
        el("line", {
          x1: PAD.left,
          x2: W - padRight,
          y1: y(TARGET),
          y2: y(TARGET),
          stroke: "var(--good)",
          "stroke-width": 1,
          "stroke-dasharray": "4 4",
          opacity: 0.6,
        }),
      );
      svg.appendChild(
        el(
          "text",
          {
            x: PAD.left + 3,
            y: y(TARGET) - 3,
            fill: "var(--good)",
            "font-size": 9,
            opacity: 0.8,
          },
          fmtThreshold(TARGET),
        ),
      );
    }

    // threshold lines
    if (LO_THRESHOLD >= yMin && LO_THRESHOLD <= yMax) {
      svg.appendChild(
        el("line", {
          x1: PAD.left,
          x2: W - padRight,
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
          x2: W - padRight,
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
  }

  // ---- insulin bars ----
  if (haveInsulin) {
    const maxUnits = Math.max(
      1,
      ...doses.map((r) => Math.max(r.humalog_units || 0, r.lantus_units || 0)),
    );
    const baseline = plotBottom;

    if (mode === "insulin") {
      // Bars own the full plot height, scaled against a LEFT units axis.
      const plotH = plotBottom - PAD.top;
      const uy = (u) => PAD.top + (1 - u / maxUnits) * plotH;

      // 3 left-axis tick labels in units (0 … maxUnits)
      const uTicks = [0, maxUnits / 2, maxUnits];
      for (const u of uTicks) {
        svg.appendChild(
          el("line", {
            x1: PAD.left,
            x2: W - padRight,
            y1: uy(u),
            y2: uy(u),
            stroke: "var(--border)",
            "stroke-width": 1,
          }),
        );
        svg.appendChild(
          el(
            "text",
            {
              x: PAD.left - 6,
              y: uy(u) + 3,
              "text-anchor": "end",
              fill: "var(--muted)",
              "font-size": 10,
            },
            u.toFixed(u % 1 === 0 ? 0 : 1),
          ),
        );
      }

      const bar = (t, units, colour, offset) => {
        const h = Math.max(2, (units / maxUnits) * plotH);
        svg.appendChild(
          el("rect", {
            x: (x(t) + offset).toFixed(1),
            y: (baseline - h).toFixed(1),
            width: 3,
            height: h.toFixed(1),
            rx: 1,
            fill: colour,
          }),
        );
      };
      for (const r of doses) {
        if (r.humalog_units > 0)
          bar(r.timestamp, r.humalog_units, HUMALOG, -2.5);
        if (r.lantus_units > 0)
          bar(
            r.timestamp,
            r.lantus_units,
            LANTUS,
            r.humalog_units > 0 ? 1.5 : -1.5,
          );
      }
    } else {
      // "both" — insulin on a dedicated RIGHT units axis, kept subordinate
      // to the glucose line (bars cap at ~55% of the plot height).
      const plotH = plotBottom - PAD.top;
      const barCap = plotH * 0.55;

      // right axis line + 2-3 unit tick labels
      svg.appendChild(
        el("line", {
          x1: W - padRight,
          x2: W - padRight,
          y1: PAD.top,
          y2: baseline,
          stroke: "var(--border)",
          "stroke-width": 1,
        }),
      );
      const uTicks = [0, maxUnits / 2, maxUnits];
      for (const u of uTicks) {
        const ty = baseline - (u / maxUnits) * barCap;
        svg.appendChild(
          el(
            "text",
            {
              x: W - padRight + 4,
              y: ty + 3,
              "text-anchor": "start",
              fill: "var(--muted)",
              "font-size": 10,
            },
            u.toFixed(u % 1 === 0 ? 0 : 1),
          ),
        );
      }

      const bar = (t, units, colour, offset) => {
        const h = Math.max(2, (units / maxUnits) * barCap);
        svg.appendChild(
          el("rect", {
            x: (x(t) + offset).toFixed(1),
            y: (baseline - h).toFixed(1),
            width: 3,
            height: h.toFixed(1),
            rx: 1,
            fill: colour,
            opacity: 0.85,
          }),
        );
      };
      for (const r of doses) {
        if (r.humalog_units > 0)
          bar(r.timestamp, r.humalog_units, HUMALOG, -2.5);
        if (r.lantus_units > 0)
          bar(
            r.timestamp,
            r.lantus_units,
            LANTUS,
            r.humalog_units > 0 ? 1.5 : -1.5,
          );
      }
    }

    // insulin legend (top-right)
    [
      ["H", HUMALOG],
      ["L", LANTUS],
    ].forEach(([label, colour], i) => {
      const lx = W - padRight - 56 + i * 28;
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

  drawDayLabels();
}
