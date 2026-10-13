"use client";

import { useSyncExternalStore } from "react";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

type Point = { key: string; label: string; value: number; text: string };

// SVG presentation attributes can't use CSS var(), so read the theme tokens
// and re-read them when the light/dark class on <html> changes.
function subscribe(onChange: () => void) {
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
  return () => observer.disconnect();
}
const read = (name: string) => () => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
const useToken = (name: string, fallback: string) => useSyncExternalStore(subscribe, read(name), () => fallback);

const compact = new Intl.NumberFormat("en-IN", { notation: "compact", maximumFractionDigits: 1 });

export function TrendChart({ points, title }: { points: Point[]; title: string }) {
  const bar = useToken("--chart-1", "#2a78d6");
  const muted = useToken("--muted", "#5f6368");
  const grid = useToken("--border", "#e4e4e7");
  const many = points.length > 14;

  return (
    <figure className="space-y-2">
      <figcaption className="sr-only">{title}</figcaption>
      <div className="h-56 w-full" aria-hidden>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={points} margin={{ top: 8, right: 4, bottom: 0, left: 0 }} barCategoryGap={many ? 2 : "20%"}>
            <CartesianGrid vertical={false} stroke={grid} />
            <XAxis
              dataKey="label"
              tick={{ fill: muted, fontSize: 11 }}
              tickLine={false}
              axisLine={{ stroke: grid }}
              interval={many ? "preserveStartEnd" : 0}
              minTickGap={8}
            />
            <YAxis
              tick={{ fill: muted, fontSize: 11 }}
              tickLine={false}
              axisLine={false}
              width={44}
              tickFormatter={(v: number) => `₹${compact.format(v)}`}
              allowDecimals={false}
            />
            <Tooltip
              cursor={{ fill: grid, opacity: 0.5 }} // band highlight: hit target wider than the bar
              content={({ active, payload }) => {
                const p = active && payload?.[0]?.payload as Point | undefined;
                if (!p) return null;
                return (
                  <div className="rounded-md border border-border bg-background px-2.5 py-1.5 text-xs shadow">
                    <p className="text-muted">{p.label}</p>
                    <p className="font-mono font-medium text-foreground">{p.text}</p>
                  </div>
                );
              }}
            />
            <Bar dataKey="value" fill={bar} radius={[4, 4, 0, 0]} maxBarSize={28} isAnimationActive={false} />
          </BarChart>
        </ResponsiveContainer>
      </div>
      {/* The same data as text: screen readers and anyone who prefers numbers. */}
      <details className="text-sm">
        <summary className="cursor-pointer text-muted">Show as table</summary>
        <table className="mt-2 w-full text-sm">
          <thead className="text-left text-xs text-muted">
            <tr>
              <th className="py-1">Date</th>
              <th className="py-1 text-right">Spent</th>
            </tr>
          </thead>
          <tbody>
            {points.map((p) => (
              <tr key={p.key} className="border-t border-border">
                <td className="py-1">{p.label}</td>
                <td className="py-1 text-right font-mono">{p.text}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </figure>
  );
}
