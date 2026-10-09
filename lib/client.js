/**
 * dsh-token-stats — client half.
 *
 * Registered as a lazy CJS module for the browser module loader. Renders a
 * zcode-style usage dashboard inside Settings → Token 统计: stat cards, a
 * 53-week activity heatmap, a 7/30-day per-model trend chart and a model
 * share donut. All charts are hand-rolled SVG — no chart library.
 */
window.__ModuleLoader__.load({
	id: "dsh-usage-dashboard",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		let { createElement: h, useMemo, useState } = require("react");

		var CSS = [
			".dts-section{font-size:13px;line-height:1.5;max-width:920px;}",
			".dts-head{display:flex;align-items:baseline;justify-content:space-between;gap:12px;margin-bottom:14px;}",
			".dts-title{margin:0;font-size:18px;font-weight:600;}",
			".dts-intro{margin:2px 0 0;opacity:.65;}",
			".dts-cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:10px;margin-bottom:18px;}",
			".dts-card{border:1px solid rgba(128,128,128,.35);border-radius:10px;padding:10px 12px;}",
			".dts-card-label{font-size:12px;opacity:.6;}",
			".dts-card-value{font-size:20px;font-weight:650;margin-top:2px;font-variant-numeric:tabular-nums;}",
			".dts-group{border:1px solid rgba(128,128,128,.35);border-radius:10px;padding:12px 14px;margin-bottom:16px;}",
			".dts-group-title{margin:0 0 10px;font-size:14px;font-weight:600;}",
			".dts-row{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:8px;flex-wrap:wrap;}",
			".dts-seg{display:inline-flex;border:1px solid rgba(128,128,128,.35);border-radius:8px;overflow:hidden;}",
			".dts-seg button{border:0;background:transparent;color:inherit;padding:3px 10px;cursor:pointer;font-size:12px;opacity:.65;}",
			".dts-seg button.on{opacity:1;background:rgba(59,130,246,.18);font-weight:600;}",
			".dts-refresh{border:1px solid rgba(128,128,128,.35);background:transparent;color:inherit;border-radius:8px;padding:3px 12px;cursor:pointer;font-size:12px;}",
			".dts-heat-wrap{overflow-x:auto;padding-bottom:4px;}",
			".dts-heat-cell{shape-rendering:geometricPrecision;}",
			".dts-legend{display:flex;align-items:center;gap:4px;font-size:11px;opacity:.7;margin-top:6px;justify-content:flex-end;}",
			".dts-models{display:flex;gap:20px;flex-wrap:wrap;align-items:center;}",
			".dts-model-list{list-style:none;margin:0;padding:0;min-width:220px;flex:1;}",
			".dts-model-row{display:flex;align-items:center;gap:8px;padding:5px 0;}",
			".dts-dot{width:9px;height:9px;border-radius:50%;flex:none;}",
			".dts-model-name{flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}",
			".dts-pct{opacity:.6;font-size:12px;width:44px;text-align:right;}",
			".dts-num{font-variant-numeric:tabular-nums;}",
			".dts-empty{opacity:.6;padding:24px 0;text-align:center;}"
		].join("");

		var PALETTE = ["#3b82f6", "#22c55e", "#f59e0b", "#ef4444", "#8b5cf6", "#06b6d4", "#ec4899", "#84cc16"];
		var DAY_MS = 86400000;

		function fmtTokens(n) {
			if (n >= 1e8) return (n / 1e8).toFixed(n >= 1e9 ? 0 : 1) + " 亿";
			if (n >= 1e4) return (n / 1e4).toFixed(n >= 1e6 ? 0 : 1) + " 万";
			return String(n);
		}
		function fmtDuration(ms) {
			if (!(ms > 0)) return "—";
			var min = Math.round(ms / 60000);
			var d = Math.floor(min / 1440), hh = Math.floor((min % 1440) / 60), mm = min % 60;
			if (d > 0) return d + " 天 " + hh + " 小时";
			if (hh > 0) return hh + " 小时 " + mm + " 分钟";
			return mm + " 分钟";
		}
		function dayKey(date) {
			var y = date.getFullYear(), m = String(date.getMonth() + 1).padStart(2, "0"), d = String(date.getDate()).padStart(2, "0");
			return y + "-" + m + "-" + d;
		}
		function parseModel(key) {
			try { var p = JSON.parse(key); return { provider: p[0], model: p[1] }; }
			catch { return { provider: "", model: key }; }
		}

		/** Fold every session's tokenStats view into one dashboard aggregate. */
		function aggregate(sessions) {
			var byDay = {}, byModel = {}, dayModels = {}, total = 0, requests = 0, longest = 0, sessionCount = 0;
			var ids = sessions.ids || [];
			for (var i = 0; i < ids.length; i++) {
				var stats = sessions.byId?.[ids[i]]?.projectionValues?.tokenStats;
				if (stats === undefined) continue;
				if ((stats.totalTokens | 0) === 0 && (stats.requests | 0) === 0) continue;
				sessionCount++;
				total += stats.totalTokens | 0;
				requests += stats.requests | 0;
				if (stats.firstTime && stats.lastTime) longest = Math.max(longest, stats.lastTime - stats.firstTime);
				var days = Object.keys(stats.byDay || {});
				for (var j = 0; j < days.length; j++) {
					var day = days[j], d = stats.byDay[day];
					byDay[day] = (byDay[day] || 0) + (d.tokens | 0);
					var dm = dayModels[day] || (dayModels[day] = {});
					var models = Object.keys(d.byModel || {});
					for (var k = 0; k < models.length; k++) {
						byModel[models[k]] = (byModel[models[k]] || 0) + d.byModel[models[k]];
						dm[models[k]] = (dm[models[k]] || 0) + d.byModel[models[k]];
					}
				}
			}
			var dayKeys = Object.keys(byDay).sort();
			var peak = 0;
			for (var p = 0; p < dayKeys.length; p++) peak = Math.max(peak, byDay[dayKeys[p]]);
			// streaks
			var longestStreak = 0, run = 0;
			for (var s = 0; s < dayKeys.length; s++) {
				if (s > 0) {
					var gap = (new Date(dayKeys[s]) - new Date(dayKeys[s - 1])) / DAY_MS;
					run = gap === 1 ? run + 1 : 1;
				} else run = 1;
				longestStreak = Math.max(longestStreak, run);
			}
			var currentStreak = 0;
			if (dayKeys.length > 0) {
				var today = new Date(); today.setHours(0, 0, 0, 0);
				var last = new Date(dayKeys[dayKeys.length - 1]); last.setHours(0, 0, 0, 0);
				var diff = Math.round((today - last) / DAY_MS);
				if (diff <= 1) {
					currentStreak = 1;
					for (var q = dayKeys.length - 1; q > 0; q--) {
						if ((new Date(dayKeys[q]) - new Date(dayKeys[q - 1])) / DAY_MS === 1) currentStreak++;
						else break;
					}
				}
			}
			var models = Object.keys(byModel).map(function (key) {
				return { key: key, model: parseModel(key).model, provider: parseModel(key).provider, tokens: byModel[key] };
			}).sort(function (a, b) { return b.tokens - a.tokens; });
			return { total: total, requests: requests, peak: peak, longest: longest, sessionCount: sessionCount,
				byDay: byDay, dayKeys: dayKeys, models: models, dayModels: dayModels,
				currentStreak: currentStreak, longestStreak: longestStreak };
		}

		function heatColor(level) {
			if (level === 0) return "rgba(128,128,128,.14)";
			var colors = ["#cfe3ff", "#9cc7ff", "#6aa7f8", "#3b82f6", "#1d5fd0"];
			return colors[Math.min(4, level - 1)];
		}

		/** GitHub-style 53-week heatmap. mode: 'daily' | 'cumulative' */
		function Heatmap(_a) {
			var agg = _a.agg, mode = _a.mode;
			var today = new Date(); today.setHours(0, 0, 0, 0);
			var end = today.getTime() + DAY_MS; // exclusive
			// week starts on Monday
			var dow = (today.getDay() + 6) % 7;
			var start = today.getTime() - dow * DAY_MS - 52 * 7 * DAY_MS;
			var weeks = 53, cell = 11, gap = 3, pad = 26, top = 16;
			var width = pad + weeks * (cell + gap), height = top + 7 * (cell + gap) + 2;
			var values = [], max = 0, cum = 0;
			for (var w = 0; w < weeks; w++) {
				var col = [];
				for (var r = 0; r < 7; r++) {
					var t = start + (w * 7 + r) * DAY_MS;
					var key = dayKey(new Date(t));
					var v = agg.byDay[key] | 0;
					if (mode === "cumulative") { cum += v; col.push({ key: key, v: t < end ? cum : -1 }); }
					else col.push({ key: key, v: t < end ? v : -1 });
					if (t < end) max = Math.max(max, mode === "cumulative" ? cum : v);
				}
				values.push(col);
			}
			var rects = [];
			for (var w2 = 0; w2 < weeks; w2++) {
				for (var r2 = 0; r2 < 7; r2++) {
					var c = values[w2][r2];
					if (c.v < 0) continue;
					var level = c.v === 0 ? 0 : Math.min(5, Math.ceil((c.v / (max || 1)) * 4)) || 1;
					rects.push(h("rect", {
						key: c.key, className: "dts-heat-cell",
						x: pad + w2 * (cell + gap), y: top + r2 * (cell + gap),
						width: cell, height: cell, rx: 2.5, fill: heatColor(level)
					}, h("title", null, c.key + " · " + fmtTokens(c.v) + " tokens")));
				}
			}
			var monthLabels = [], lastMonth = -1;
			for (var w3 = 0; w3 < weeks; w3++) {
				var d = new Date(start + w3 * 7 * DAY_MS);
				if (d.getMonth() !== lastMonth && d.getDate() <= 13) {
					lastMonth = d.getMonth();
					monthLabels.push(h("text", { key: "m" + w3, x: pad + w3 * (cell + gap), y: 10, fontSize: 10, fill: "currentColor", opacity: .55 }, (d.getMonth() + 1) + "月"));
				}
			}
			var weekdayLabels = [1, 3, 5].map(function (r3) {
				var names = ["一", "二", "三", "四", "五", "六", "日"];
				return h("text", { key: "wd" + r3, x: 0, y: top + r3 * (cell + gap) + 9, fontSize: 10, fill: "currentColor", opacity: .55 }, names[r3]);
			});
			return h("div", { className: "dts-heat-wrap" },
				h("svg", { width: width, height: height, role: "img", "aria-label": "Token 活动热力图" },
					monthLabels, weekdayLabels, rects),
				h("div", { className: "dts-legend" }, "少",
					[0, 1, 2, 3, 4, 5].map(function (l) { return h("span", { key: "l" + l, style: { display: "inline-block", width: "10px", height: "10px", borderRadius: "2px", background: heatColor(l), margin: "0 1px" } }); }),
					"多"));
		}

		/** Multi-series daily trend line chart over the last `range` days. */
		function Trend(_a) {
			var agg = _a.agg, range = _a.range;
			var models = agg.models.slice(0, 5);
			var days = [];
			var today = new Date(); today.setHours(0, 0, 0, 0);
			for (var i = range - 1; i >= 0; i--) days.push(dayKey(new Date(today.getTime() - i * DAY_MS)));
			var series = models.map(function (m, idx) {
				return { model: m, color: PALETTE[idx % PALETTE.length], points: days.map(function (d) {
					return (agg.dayModels?.[d]?.[m.key] | 0) || 0;
				}) };
			});
			var max = 1;
			series.forEach(function (s) { s.points.forEach(function (p) { max = Math.max(max, p); }); });
			var W = 840, H = 200, L = 56, R = 12, T = 10, B = 26;
			var x = function (i) { return L + (days.length === 1 ? (W - L - R) / 2 : i * (W - L - R) / (days.length - 1)); };
			var y = function (v) { return T + (H - T - B) * (1 - v / max); };
			var gridY = [0, .25, .5, .75, 1];
			var step = Math.max(1, Math.ceil(days.length / 8));
			return h("div", null,
				h("svg", { width: "100%", viewBox: "0 0 " + W + " " + H, role: "img", "aria-label": "每日 Token 趋势" },
					gridY.map(function (g) {
						return h("g", { key: "g" + g },
							h("line", { x1: L, x2: W - R, y1: y(g * max), y2: y(g * max), stroke: "currentColor", strokeOpacity: .12, strokeWidth: 1 }),
							h("text", { x: L - 6, y: y(g * max) + 3, fontSize: 10, textAnchor: "end", fill: "currentColor", opacity: .5 }, fmtTokens(Math.round(g * max))));
					}),
					days.map(function (d, i) {
						if (i % step !== 0 && i !== days.length - 1) return null;
						return h("text", { key: "x" + d, x: x(i), y: H - 8, fontSize: 10, textAnchor: "middle", fill: "currentColor", opacity: .5 },
							d.slice(5).replace("-", "/"));
					}),
					series.map(function (s) {
						var pts = s.points.map(function (p, i) { return x(i).toFixed(1) + "," + y(p).toFixed(1); }).join(" ");
						return h("polyline", { key: s.model.key, points: pts, fill: "none", stroke: s.color, strokeWidth: 2, strokeLinejoin: "round", strokeLinecap: "round" });
					})),
				h("div", { className: "dts-legend", style: { justifyContent: "center" } },
					models.map(function (m, idx) {
						return h("span", { key: m.key, style: { display: "inline-flex", alignItems: "center", gap: "4px", margin: "0 8px" } },
							h("span", { className: "dts-dot", style: { background: PALETTE[idx % PALETTE.length] } }), m.model);
					})));
		}

		/** Donut chart of per-model totals. */
		function Donut(_a) {
			var models = _a.models, total = _a.total;
			if (total <= 0 || models.length === 0) return h("div", { className: "dts-empty" }, "暂无数据");
			var size = 170, r = 64, cx = size / 2, cy = size / 2, sw = 22;
			var C = 2 * Math.PI * r, acc = 0;
			var arcs = models.map(function (m, idx) {
				var frac = m.tokens / total, dash = (frac * C).toFixed(2);
				var seg = h("circle", { key: m.key, cx: cx, cy: cy, r: r, fill: "none",
					stroke: PALETTE[idx % PALETTE.length], strokeWidth: sw,
					strokeDasharray: dash + " " + (C - dash).toFixed(2),
					strokeDashoffset: (-acc * C).toFixed(2), transform: "rotate(-90 " + cx + " " + cy + ")" },
					h("title", null, m.model + " · " + fmtTokens(m.tokens) + " (" + (frac * 100).toFixed(1) + "%)"));
				acc += frac;
				return seg;
			});
			return h("div", { className: "dts-models" },
				h("svg", { width: size, height: size, role: "img", "aria-label": "模型用量占比", style: { flex: "none" } },
					arcs,
					h("text", { x: cx, y: cy - 6, textAnchor: "middle", fontSize: 20, fontWeight: 650, fill: "currentColor" }, fmtTokens(total)),
					h("text", { x: cx, y: cy + 14, textAnchor: "middle", fontSize: 11, fill: "currentColor", opacity: .55 }, "tokens")),
				h("ul", { className: "dts-model-list" },
					models.map(function (m, idx) {
						return h("li", { key: m.key, className: "dts-model-row" },
							h("span", { className: "dts-dot", style: { background: PALETTE[idx % PALETTE.length] } }),
							h("span", { className: "dts-model-name", title: m.provider + " · " + m.model }, m.model),
							h("span", { className: "dts-num", title: m.tokens.toLocaleString() + " tokens" }, fmtTokens(m.tokens)),
							h("span", { className: "dts-pct" }, (m.tokens / total * 100).toFixed(1) + "%"));
					})));
		}

		/** Settings page component. */
		function TokenStatsSection(props) {
			var useSessions = props.useSessions;
			var sessions = useSessions(function (s) { return s; });
			var _u = useState(0), nonce = _u[0], setNonce = _u[1];
			var _v = useState(30), range = _v[0], setRange = _v[1];
			var _w = useState("daily"), heatMode = _w[0], setHeatMode = _w[1];
			var agg = useMemo(function () { return aggregate(sessions); }, [sessions, nonce]);
			var empty = agg.sessionCount === 0 && agg.total === 0;
			return h("div", { className: "dts-section", "data-dsh-token-stats": "" },
				h("div", { className: "dts-head" },
					h("div", null,
						h("h2", { className: "dts-title" }, "Token 统计"),
						h("p", { className: "dts-intro" }, "基于全部会话历史的 Token 用量统计 · " + agg.sessionCount + " 个会话 · " + agg.requests.toLocaleString() + " 次模型调用")),
					h("button", { className: "dts-refresh", onClick: function () { setNonce(nonce + 1); } }, "刷新")),
				empty ? h("p", { className: "dts-empty" }, "完成一次模型调用后，这里会出现统计数据。") : h("div", null,
					h("div", { className: "dts-cards" }, [
						["累计 Token 数", fmtTokens(agg.total)],
						["峰值 Token 数", agg.peak > 0 ? fmtTokens(agg.peak) + " / 日" : "—"],
						["最长会话时长", fmtDuration(agg.longest)],
						["当前连续天数", agg.currentStreak > 0 ? agg.currentStreak + " 天" : "—"],
						["最长连续天数", agg.longestStreak > 0 ? agg.longestStreak + " 天" : "—"]
					].map(function (card) {
						return h("div", { key: card[0], className: "dts-card" },
							h("div", { className: "dts-card-label" }, card[0]),
							h("div", { className: "dts-card-value" }, card[1]));
					})),
					h("section", { className: "dts-group" },
						h("div", { className: "dts-row" },
							h("h3", { className: "dts-group-title", style: { margin: 0 } }, "Token 活动"),
							h("div", { className: "dts-seg" },
								h("button", { className: heatMode === "daily" ? "on" : "", onClick: function () { setHeatMode("daily"); } }, "每日"),
								h("button", { className: heatMode === "cumulative" ? "on" : "", onClick: function () { setHeatMode("cumulative"); } }, "累计"))),
						h(Heatmap, { agg: agg, mode: heatMode })),
					h("section", { className: "dts-group" },
						h("div", { className: "dts-row" },
							h("h3", { className: "dts-group-title", style: { margin: 0 } }, "每日 Token 趋势"),
							h("div", { className: "dts-seg" },
								h("button", { className: range === 7 ? "on" : "", onClick: function () { setRange(7); } }, "近 7 日"),
								h("button", { className: range === 30 ? "on" : "", onClick: function () { setRange(30); } }, "近 30 日"))),
						h(Trend, { agg: agg, range: range })),
					h("section", { className: "dts-group" },
						h("h3", { className: "dts-group-title" }, "模型用量"),
						h(Donut, { models: agg.models, total: agg.total }))));
		}
		TokenStatsSection.displayName = "TokenStatsSection";

		exports.TokenStatsSection = TokenStatsSection;
		exports.aggregate = aggregate;
		exports.inject = ["slots"];
		exports.apply = function apply(ctx) {
			var style = document.createElement("style");
			style.textContent = CSS;
			style.setAttribute("data-dsh-token-stats", "");
			document.head.appendChild(style);
			ctx.effect(function () { return function () { style.remove(); }; }, "dsh-token-stats.style");
			ctx.slots.inject("settings.section", function () {
				return ctx.slots.register({
					name: "settings.section",
					id: "token-stats",
					order: 25,
					label: "Token 统计"
				}, TokenStatsSection);
			});
		};
		return module.exports;
	}
});
