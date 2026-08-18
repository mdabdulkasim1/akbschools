/* Minimal dependency-free SVG charts for the dashboard. */
window.Charts = (function () {
  "use strict";
  var PALETTE = ["#1f4e79", "#2e8b57", "#c0762a", "#7d3c98", "#b02a2a", "#117a8b"];
  var NS = "http://www.w3.org/2000/svg";

  function s(tag, attrs, children) {
    var n = document.createElementNS(NS, tag);
    if (attrs) Object.keys(attrs).forEach(function (k) { n.setAttribute(k, attrs[k]); });
    (children || []).forEach(function (c) { n.appendChild(typeof c === "string" ? document.createTextNode(c) : c); });
    return n;
  }
  function fmtMonth(m) {
    if (!m || m.length < 7) return m || "";
    var names = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    var parts = m.split("-");
    return names[parseInt(parts[1], 10) - 1] + " " + parts[0].slice(2);
  }

  /** Line chart: series = [{name, points:[{month, value}]}], months = [..] */
  function line(container, series, months) {
    container.innerHTML = "";
    var W = 620, H = 240, padL = 40, padR = 12, padT = 14, padB = 34;
    if (!months.length) { container.appendChild(empty()); return; }
    var all = [];
    series.forEach(function (se) { se.points.forEach(function (p) { if (p.value != null) all.push(p.value); }); });
    var min = Math.max(0, Math.floor((all.length ? Math.min.apply(null, all) : 0) / 10) * 10 - 5);
    var max = Math.min(100, Math.ceil((all.length ? Math.max.apply(null, all) : 100) / 10) * 10 + 5);
    if (max <= min) max = min + 10;
    var innerW = W - padL - padR, innerH = H - padT - padB;
    var x = function (i) { return padL + (months.length === 1 ? innerW / 2 : (i / (months.length - 1)) * innerW); };
    var y = function (v) { return padT + innerH - ((v - min) / (max - min)) * innerH; };

    var svg = s("svg", { viewBox: "0 0 " + W + " " + H, class: "chart", preserveAspectRatio: "xMidYMid meet" });
    // gridlines + y labels
    for (var g = 0; g <= 4; g++) {
      var gv = min + ((max - min) * g) / 4;
      var gy = y(gv);
      svg.appendChild(s("line", { x1: padL, y1: gy, x2: W - padR, y2: gy, class: "grid" }));
      svg.appendChild(s("text", { x: padL - 6, y: gy + 3, class: "axis y" }, [String(Math.round(gv))]));
    }
    // x labels
    months.forEach(function (m, i) {
      svg.appendChild(s("text", { x: x(i), y: H - 12, class: "axis x" }, [fmtMonth(m)]));
    });
    // series
    series.forEach(function (se, si) {
      var color = PALETTE[si % PALETTE.length];
      var d = "";
      se.points.forEach(function (p, i) {
        if (p.value == null) return;
        d += (d ? " L" : "M") + x(i) + " " + y(p.value);
      });
      if (d) svg.appendChild(s("path", { d: d, fill: "none", stroke: color, "stroke-width": "2.5" }));
      se.points.forEach(function (p, i) {
        if (p.value == null) return;
        svg.appendChild(s("circle", { cx: x(i), cy: y(p.value), r: "3.5", fill: color }));
      });
    });
    container.appendChild(svg);
    container.appendChild(legend(series));
  }

  /** Bar chart: items = [{label, value, color?}] */
  function bar(container, items, opts) {
    opts = opts || {};
    container.innerHTML = "";
    if (!items.length) { container.appendChild(empty()); return; }
    var W = 620, H = 240, padL = 40, padR = 12, padT = 14, padB = 40;
    var max = opts.max || Math.max.apply(null, items.map(function (i) { return i.value || 0; })) || 100;
    max = Math.ceil(max / 10) * 10 || 10;
    var innerW = W - padL - padR, innerH = H - padT - padB;
    var bw = innerW / items.length;
    var svg = s("svg", { viewBox: "0 0 " + W + " " + H, class: "chart", preserveAspectRatio: "xMidYMid meet" });
    for (var g = 0; g <= 4; g++) {
      var gv = (max * g) / 4, gy = padT + innerH - (gv / max) * innerH;
      svg.appendChild(s("line", { x1: padL, y1: gy, x2: W - padR, y2: gy, class: "grid" }));
      svg.appendChild(s("text", { x: padL - 6, y: gy + 3, class: "axis y" }, [String(Math.round(gv))]));
    }
    items.forEach(function (it, i) {
      var v = it.value || 0;
      var h = (v / max) * innerH;
      var bx = padL + i * bw + bw * 0.2;
      var by = padT + innerH - h;
      var w = bw * 0.6;
      svg.appendChild(s("rect", { x: bx, y: by, width: w, height: h, rx: "3", fill: it.color || PALETTE[i % PALETTE.length] }));
      svg.appendChild(s("text", { x: bx + w / 2, y: by - 5, class: "barval" }, [it.value == null ? "" : String(it.value)]));
      svg.appendChild(s("text", { x: bx + w / 2, y: H - 22, class: "axis x" }, [it.label]));
    });
    container.appendChild(svg);
  }

  function legend(series) {
    var d = document.createElement("div");
    d.className = "chart-legend";
    series.forEach(function (se, i) {
      var item = document.createElement("span");
      item.className = "leg";
      var sw = document.createElement("i");
      sw.style.background = PALETTE[i % PALETTE.length];
      item.appendChild(sw);
      item.appendChild(document.createTextNode(se.name));
      d.appendChild(item);
    });
    return d;
  }
  function empty() {
    var d = document.createElement("div");
    d.className = "chart-empty";
    d.textContent = "No submitted data yet.";
    return d;
  }

  return { line: line, bar: bar, fmtMonth: fmtMonth };
})();
