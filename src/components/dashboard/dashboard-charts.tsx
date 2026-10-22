import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
  PieChart,
  Pie,
  Cell,
} from "recharts";

const CHART_GRID_STROKE = "var(--border)";
const CHART_COLORS = [
  "oklch(0.62 0.21 260)",
  "oklch(0.7 0.18 180)",
  "oklch(0.72 0.18 60)",
  "oklch(0.68 0.2 340)",
  "oklch(0.75 0.15 140)",
];

const TOOLTIP_STYLE = {
  background: "var(--popover)",
  color: "var(--popover-foreground)",
  border: "1px solid var(--border)",
  borderRadius: 14,
  fontSize: 12,
  boxShadow: "0 10px 30px -10px rgba(0,0,0,0.3)",
} as const;

const TOOLTIP_ITEM_STYLE = { color: "var(--popover-foreground)" } as const;
const TOOLTIP_LABEL_STYLE = { color: "var(--muted-foreground)", marginBottom: 4 } as const;

export interface DashboardChartsProps {
  daily: { day: string; revenue: number; orders: number }[];
  paymentPie: { name: string; value: number }[];
  isAr: boolean;
  lang: string;
  money: (n: number) => string;
  num: (n: number) => string;
  t: (key: string) => string;
}

export function DashboardCharts({
  daily,
  paymentPie,
  isAr,
  lang,
  money,
  num,
  t,
}: DashboardChartsProps) {
  return (
    <div className="mt-6 grid grid-cols-1 gap-3 lg:grid-cols-3">
      <div className="panel-elevated lg:col-span-2 p-5 rounded-3xl border border-border/80 shadow-sm">
        <div className="mb-4 flex items-center justify-between">
          <div>
            <h3 className="text-sm font-semibold">{t("dash.revenue_trend")}</h3>
            <p className="text-xs text-muted-foreground">{t("dash.last_14_days")}</p>
          </div>
          <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
            <span className="h-2 w-2 rounded-full bg-primary" /> {isAr ? "الإيراد" : "Revenue"}
            <span className="ms-2 h-2 w-2 rounded-full bg-chart-2" /> {isAr ? "الطلبات" : "Orders"}
          </div>
        </div>
        <div className="h-64">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={daily}>
              <defs>
                <linearGradient id="g1" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="var(--primary, #3b82f6)" stopOpacity={0.4} />
                  <stop offset="100%" stopColor="var(--primary, #3b82f6)" stopOpacity={0.0} />
                </linearGradient>
                <linearGradient id="g2" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#06b6d4" stopOpacity={0.3} />
                  <stop offset="100%" stopColor="#06b6d4" stopOpacity={0.0} />
                </linearGradient>
              </defs>
              <CartesianGrid stroke={CHART_GRID_STROKE} strokeDasharray="3 3" vertical={false} />
              <XAxis
                dataKey="day"
                stroke="currentColor"
                className="text-muted-foreground opacity-60"
                fontSize={11}
                tickLine={false}
                axisLine={false}
              />
              <YAxis
                yAxisId="rev"
                stroke="currentColor"
                className="text-muted-foreground opacity-60"
                fontSize={11}
                tickLine={false}
                axisLine={false}
                tickFormatter={(v) => (v >= 1000 ? `${(v / 1000).toFixed(0)}k` : `${v}`)}
              />
              <YAxis
                yAxisId="orders"
                orientation="right"
                stroke="currentColor"
                className="text-muted-foreground opacity-40"
                fontSize={10}
                tickLine={false}
                axisLine={false}
                allowDecimals={false}
              />
              <Tooltip
                contentStyle={TOOLTIP_STYLE}
                itemStyle={TOOLTIP_ITEM_STYLE}
                labelStyle={TOOLTIP_LABEL_STYLE}
                formatter={(val: any, name: any) => [
                  name === "revenue"
                    ? money(Number(val))
                    : `${num(Number(val))} ${isAr ? "طلب" : "orders"}`,
                  name === "revenue"
                    ? isAr
                      ? "الإيراد"
                      : "Revenue"
                    : isAr
                      ? "عدد الفواتير"
                      : "Orders",
                ]}
              />
              <Area
                yAxisId="rev"
                type="monotone"
                dataKey="revenue"
                name="revenue"
                stroke="var(--primary, #3b82f6)"
                strokeWidth={2.5}
                fill="url(#g1)"
              />
              <Area
                yAxisId="orders"
                type="monotone"
                dataKey="orders"
                name="orders"
                stroke="#06b6d4"
                strokeWidth={2}
                fill="url(#g2)"
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="panel-elevated p-5 rounded-3xl border border-border/80 shadow-sm">
        <h3 className="text-sm font-semibold">
          {lang === "ar" ? "توزيع طرق الدفع" : "Payment mix"}
        </h3>
        <p className="text-xs text-muted-foreground">{t("dash.last_30_days")}</p>
        <div className="mt-4 h-52">
          {paymentPie.length === 0 ? (
            <div className="grid h-full place-items-center text-xs text-muted-foreground">
              {t("common.no_data")}
            </div>
          ) : (
            <ResponsiveContainer>
              <PieChart>
                <Pie
                  data={paymentPie}
                  dataKey="value"
                  nameKey="name"
                  innerRadius={50}
                  outerRadius={80}
                  strokeWidth={0}
                >
                  {paymentPie.map((_, i) => (
                    <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip
                  contentStyle={TOOLTIP_STYLE}
                  itemStyle={TOOLTIP_ITEM_STYLE}
                  labelStyle={TOOLTIP_LABEL_STYLE}
                  formatter={(val: any, itemName: any) => [
                    money(Number(val)),
                    String(itemName ?? ""),
                  ]}
                />
              </PieChart>
            </ResponsiveContainer>
          )}
        </div>
        <div className="mt-2 space-y-1.5">
          {paymentPie.map((p, i) => (
            <div key={p.name} className="flex items-center justify-between text-xs">
              <span className="flex items-center gap-2 text-muted-foreground">
                <span
                  className="h-2 w-2 rounded-full"
                  style={{ background: CHART_COLORS[i % CHART_COLORS.length] }}
                />
                {p.name}
              </span>
              <span className="font-medium font-mono">{money(p.value)}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export default DashboardCharts;
