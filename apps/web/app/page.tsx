"use client";

import { useMemo, useRef, useState } from "react";
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  postMatrix,
  fmtMoney,
  fmtPct,
  parseAmountList,
  parseRateList,
  withBaselineCase,
  type Bracket,
  type MatrixResponse,
  type FilingStatus,
  type Scenario,
} from "@/lib/api";

interface FormState {
  age: number;
  traditional_balance: number;
  roth_balance: number;
  filing_status: FilingStatus;
  annual_other_income: number;
  horizon_years: number;
  rates_str: string;
  conversion_cases_str: string;
  include_rmd: boolean;
  tax_year: number;
}

const DEFAULT_FORM: FormState = {
  age: 60,
  traditional_balance: 700_000,
  roth_balance: 300_000,
  filing_status: "mfj",
  annual_other_income: 50_000,
  horizon_years: 10,
  rates_str: "5, 7, 9, 11",
  conversion_cases_str: "0, 25000, 50000, 100000, 200000",
  include_rmd: true,
  tax_year: 2026,
};

interface DialogState {
  rate: number;
  conversion: number;
  x: number;
  y: number;
  z: number;
}

export default function Home() {
  const [form, setForm] = useState<FormState>(DEFAULT_FORM);
  const [resp, setResp] = useState<MatrixResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [dialogs, setDialogs] = useState<DialogState[]>([]);
  const zCounterRef = useRef(1000);

  function nextZ() {
    zCounterRef.current += 1;
    return zCounterRef.current;
  }

  function toggleDialog(rate: number, conversion: number) {
    setDialogs((prev) => {
      const idx = prev.findIndex((d) => d.rate === rate && d.conversion === conversion);
      if (idx >= 0) return prev.filter((_, i) => i !== idx);
      const offset = prev.length * 30;
      return [
        ...prev,
        { rate, conversion, x: 100 + offset, y: 120 + offset, z: nextZ() },
      ];
    });
  }

  function focusDialog(rate: number, conversion: number) {
    const z = nextZ();
    setDialogs((prev) =>
      prev.map((d) => (d.rate === rate && d.conversion === conversion ? { ...d, z } : d))
    );
  }

  function moveDialog(rate: number, conversion: number, x: number, y: number) {
    setDialogs((prev) =>
      prev.map((d) => (d.rate === rate && d.conversion === conversion ? { ...d, x, y } : d))
    );
  }

  function closeDialog(rate: number, conversion: number) {
    setDialogs((prev) => prev.filter((d) => !(d.rate === rate && d.conversion === conversion)));
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setErr(null);
    try {
      const rates = parseRateList(form.rates_str);
      const cases = withBaselineCase(parseAmountList(form.conversion_cases_str));
      if (rates.length === 0) throw new Error("Need at least one rate of return");
      if (cases.length === 0) throw new Error("Need at least one conversion case");
      const total = form.traditional_balance + form.roth_balance;
      const tradPct = total > 0 ? form.traditional_balance / total : 0;
      const r = await postMatrix({
        age: form.age,
        birth_year: form.tax_year - form.age,
        total_401k: total,
        traditional_pct: tradPct,
        roth_pct: total > 0 ? form.roth_balance / total : 0,
        filing_status: form.filing_status,
        annual_other_income: form.annual_other_income,
        horizon_years: form.horizon_years,
        rates_of_return: rates,
        conversion_cases: cases,
        include_rmd: form.include_rmd,
        tax_year: form.tax_year,
      });
      setResp(r);
      setDialogs([]);
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="mx-auto max-w-7xl p-6">
      <h1 className="text-3xl font-bold mb-2">Roth Converter</h1>
      <p className="text-gray-600 mb-6 text-sm">
        Pick a few annual conversion amounts. See the tax cost and 401(k) balance over the next 10 years across multiple rate-of-return scenarios.
      </p>

      <form onSubmit={submit} className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
        <fieldset className="border rounded p-4">
          <legend className="font-semibold px-2">You</legend>
          <Field
            label="Age"
            hint="Your age today. Drives the per-year age series and RMD eligibility."
          >
            <NumberInput value={form.age} onChange={(v) => setForm({ ...form, age: v })} />
          </Field>
          <Field
            label="Filing status"
            hint="Federal filing status. Sets bracket widths and the standard deduction."
          >
            <select
              className="border rounded p-1 w-full"
              value={form.filing_status}
              onChange={(e) => setForm({ ...form, filing_status: e.target.value as FilingStatus })}
            >
              <option value="single">Single</option>
              <option value="mfj">Married filing jointly</option>
              <option value="hoh">Head of household</option>
              <option value="mfs">Married filing separately</option>
            </select>
          </Field>
          <Field
            label="Annual other taxable income"
            hint={
              <>
                Anything taxed at ordinary-income rates that you receive each
                year, separate from the 401(k) being converted. Held flat
                across the horizon (v1).
                <span className="mt-1 block">Include:</span>
                <ul className="list-disc pl-4">
                  <li>W-2 wages, self-employment / consulting income</li>
                  <li>Pension, annuity, Traditional IRA withdrawals</li>
                  <li>Taxable interest (savings, CDs, bonds), ordinary dividends</li>
                  <li>Rental income, K-1 pass-through, royalties</li>
                </ul>
                <span className="mt-1 block">Do NOT include:</span>
                <ul className="list-disc pl-4">
                  <li>Roth / HSA qualified withdrawals (tax-free)</li>
                  <li>Long-term capital gains, qualified dividends (different rates)</li>
                  <li>Social Security (v1 does not model the taxable-portion rules)</li>
                  <li>The Roth conversion itself (calculator adds it on top)</li>
                </ul>
              </>
            }
          >
            <NumberInput
              value={form.annual_other_income}
              onChange={(v) => setForm({ ...form, annual_other_income: v })}
            />
          </Field>
          <Field
            label="Tax year (for brackets)"
            hint="Year of the tax tables to use (default 2026). v1 applies the same brackets every projected year."
          >
            <NumberInput value={form.tax_year} onChange={(v) => setForm({ ...form, tax_year: v })} />
          </Field>
        </fieldset>

        <fieldset className="border rounded p-4">
          <legend className="font-semibold px-2">401(k)</legend>
          <Field
            label="Traditional 401(k) balance"
            hint="Pre-tax 401(k) today. Conversions are pulled from this bucket and taxed as ordinary income the year they happen."
          >
            <NumberInput
              value={form.traditional_balance}
              onChange={(v) => setForm({ ...form, traditional_balance: v })}
            />
          </Field>
          <Field
            label="Roth 401(k) balance"
            hint="Already-taxed Roth 401(k) today. Grows tax-free; converted dollars land here."
          >
            <NumberInput
              value={form.roth_balance}
              onChange={(v) => setForm({ ...form, roth_balance: v })}
            />
          </Field>
          <div className="rounded bg-amber-50 border border-amber-200 px-3 py-2 mb-3">
            <div className="text-[11px] uppercase tracking-wide text-amber-900/70">
              Total 401(k)
            </div>
            <div className="text-lg font-bold text-amber-900">
              {fmtMoney(form.traditional_balance + form.roth_balance)}
            </div>
            {form.traditional_balance + form.roth_balance > 0 && (
              <div className="text-xs text-amber-900/80 mt-0.5">
                Traditional{" "}
                {(
                  (form.traditional_balance /
                    (form.traditional_balance + form.roth_balance)) *
                  100
                ).toFixed(0)}
                % / Roth{" "}
                {(
                  (form.roth_balance /
                    (form.traditional_balance + form.roth_balance)) *
                  100
                ).toFixed(0)}
                %
              </div>
            )}
          </div>
          <label className="flex items-start gap-2 text-sm">
            <input
              type="checkbox"
              className="mt-0.5"
              checked={form.include_rmd}
              onChange={(e) => setForm({ ...form, include_rmd: e.target.checked })}
            />
            <span>
              <span>Include RMDs at age 73/75 (SECURE Act 2.0)</span>
              <Hint>
                Forces Required Minimum Distributions once you hit RMD age (73 if born 1951-1959,
                75 if born 1960+). RMDs leave the system and reduce ending balance.
              </Hint>
            </span>
          </label>
        </fieldset>

        <fieldset className="border rounded p-4">
          <legend className="font-semibold px-2">Scenarios</legend>
          <Field
            label="Horizon (years)"
            hint="Years to project starting this year (default 10)."
          >
            <NumberInput
              value={form.horizon_years}
              onChange={(v) => setForm({ ...form, horizon_years: v })}
            />
          </Field>
          <Field
            label="Rates of return (%)"
            hint={
              <>
                Comma-separated annual rates to sweep. Same nominal rate applied
                to Traditional and Roth. Each rate runs as a separate scenario
                so you can see how sensitive the outcome is to the assumption
                you can&apos;t pin down.
                <span className="mt-1 block">Realistic bounds:</span>
                <ul className="list-disc pl-4">
                  <li>5% - conservative / bond-heavy / pessimistic decade</li>
                  <li>7% - long-term real S&amp;P 500 average</li>
                  <li>9% - close to long-term nominal S&amp;P average</li>
                  <li>11% - optimistic upside</li>
                </ul>
                <span className="mt-1 block">
                  Rule of 72: years to double a balance is roughly 72 / rate.
                  At 5% it doubles in ~14 years; at 7%, ~10 years; at 10%, ~7 years.
                </span>
              </>
            }
          >
            <input
              type="text"
              className="border rounded p-1 w-full"
              value={form.rates_str}
              onChange={(e) => setForm({ ...form, rates_str: e.target.value })}
              placeholder="5, 7, 9, 11"
            />
          </Field>
          <Field
            label="Annual conversion cases ($)"
            hint={
              <>
                Each number is a separate strategy, not a per-year amount.
                The strategy converts that same dollar amount every year of
                the horizon. So <code>50000</code> means &quot;convert $50k
                each year for {form.horizon_years} years&quot;, totaling up to
                ${form.horizon_years * 50}k converted (capped by your
                Traditional balance once it runs out).
                <span className="mt-1 block">Other rules:</span>
                <ul className="list-disc pl-4">
                  <li>$0 baseline is always added so every other row reads as a delta from doing nothing.</li>
                  <li>Each year&apos;s conversion is capped by Traditional balance after RMD; once Traditional is empty, conversion drops to $0 for remaining years.</li>
                  <li>Tax is paid from outside the 401(k), so 100% of the conversion lands in Roth.</li>
                </ul>
                <span className="mt-1 block">
                  v1 does not optimize the path year-by-year (e.g., &quot;$100k in years 1-3, then $50k&quot;) - that is a v2 feature.
                </span>
              </>
            }
          >
            <input
              type="text"
              className="border rounded p-1 w-full"
              value={form.conversion_cases_str}
              onChange={(e) => setForm({ ...form, conversion_cases_str: e.target.value })}
              placeholder="25000, 50000, 100000"
            />
          </Field>
          <button
            type="submit"
            disabled={loading}
            className="mt-2 w-full rounded bg-amber-500 text-white px-4 py-2 font-semibold hover:bg-amber-600 disabled:opacity-50"
          >
            {loading ? "Computing..." : "Compute matrix"}
          </button>
        </fieldset>
      </form>

      {err && <div className="rounded bg-red-100 text-red-800 p-3 mb-4">{err}</div>}

      {resp && (
        <Results
          resp={resp}
          dialogs={dialogs}
          onToggle={toggleDialog}
          onFocus={focusDialog}
          onMove={moveDialog}
          onClose={closeDialog}
        />
      )}
    </main>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <label className="block mb-3">
      <span className="block text-xs font-medium text-gray-700 mb-1">{label}</span>
      {children}
      {hint && <Hint>{hint}</Hint>}
    </label>
  );
}

function Hint({ children }: { children: React.ReactNode }) {
  return <span className="mt-1 block text-[11px] leading-snug text-gray-500">{children}</span>;
}

function NumberInput({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  return (
    <input
      type="number"
      className="border rounded p-1 w-full"
      value={value}
      onChange={(e) => onChange(Number(e.target.value))}
    />
  );
}

function Results({
  resp,
  dialogs,
  onToggle,
  onFocus,
  onMove,
  onClose,
}: {
  resp: MatrixResponse;
  dialogs: DialogState[];
  onToggle: (rate: number, conversion: number) => void;
  onFocus: (rate: number, conversion: number) => void;
  onMove: (rate: number, conversion: number, x: number, y: number) => void;
  onClose: (rate: number, conversion: number) => void;
}) {
  const rates = useMemo(
    () => Array.from(new Set(resp.scenarios.map((s) => s.rate_of_return))).sort((a, b) => a - b),
    [resp]
  );
  const cases = useMemo(
    () => Array.from(new Set(resp.scenarios.map((s) => s.conversion_amount))).sort((a, b) => a - b),
    [resp]
  );

  function find(r: number, c: number): Scenario | undefined {
    return resp.scenarios.find((s) => s.rate_of_return === r && s.conversion_amount === c);
  }

  function isOpen(r: number, c: number): boolean {
    return dialogs.some((d) => d.rate === r && d.conversion === c);
  }

  return (
    <div>
      <h2 className="text-xl font-semibold mb-3">Comparison: total tax paid and ending balance after horizon</h2>
      <p className="text-xs text-gray-500 mb-2">
        Each row is an annual conversion strategy (the same dollar amount converted every year of the horizon).
        Each column is a rate-of-return assumption: <strong>Rate X%</strong> means both Traditional and Roth balances
        grow X% per year, compounded annually, for the whole horizon. The cell shows the strategy&apos;s outcome at that rate.
      </p>
      <p className="text-xs text-gray-500 mb-2">
        Click cells to open draggable drill-in dialogs. Click again to close. Open multiple to compare side-by-side.
      </p>
      <div className="overflow-x-auto mb-6">
        <table className="min-w-full text-sm border">
          <thead className="bg-gray-100">
            <tr>
              <th className="p-2 border text-left">Annual conversion</th>
              {rates.map((r) => (
                <th key={r} className="p-2 border text-left">Rate {fmtPct(r)}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {cases.map((c) => (
              <tr key={c}>
                <td className="p-2 border font-semibold">{fmtMoney(c)}/yr</td>
                {rates.map((r) => {
                  const s = find(r, c);
                  if (!s) return <td key={r} className="p-2 border">-</td>;
                  const open = isOpen(r, c);
                  return (
                    <td
                      key={r}
                      className={`p-0 border ${open ? "ring-2 ring-amber-500 ring-inset" : ""}`}
                    >
                      <button
                        type="button"
                        onClick={() => onToggle(r, c)}
                        aria-pressed={open}
                        aria-label={`Open drill-in for ${fmtMoney(c)} per year at ${fmtPct(r)}`}
                        className={`w-full text-left p-2 cursor-pointer focus:outline-none focus-visible:bg-amber-50 hover:bg-amber-50 ${
                          open ? "bg-amber-50" : ""
                        }`}
                      >
                        <div className="text-xs text-gray-500">tax</div>
                        <div className="font-semibold">{fmtMoney(s.summary.total_federal_tax)}</div>
                        <div className="text-xs text-gray-500 mt-1">end total</div>
                        <div className="font-semibold">{fmtMoney(s.summary.ending_total)}</div>
                        <div className="text-xs text-gray-500 mt-1">
                          T {fmtMoney(s.summary.ending_traditional)} / R {fmtMoney(s.summary.ending_roth)}
                        </div>
                      </button>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {dialogs.map((d) => {
        const scenario = find(d.rate, d.conversion);
        const baseline = find(d.rate, 0) ?? null;
        if (!scenario) return null;
        return (
          <DrillDialog
            key={`${d.rate}-${d.conversion}`}
            dialog={d}
            scenario={scenario}
            baseline={baseline}
            brackets={resp.brackets}
            stdDeduction={resp.standard_deduction}
            onFocus={() => onFocus(d.rate, d.conversion)}
            onMove={(x, y) => onMove(d.rate, d.conversion, x, y)}
            onClose={() => onClose(d.rate, d.conversion)}
          />
        );
      })}
    </div>
  );
}

function DrillDialog({
  dialog,
  scenario,
  baseline,
  brackets,
  stdDeduction,
  onFocus,
  onMove,
  onClose,
}: {
  dialog: DialogState;
  scenario: Scenario;
  baseline: Scenario | null;
  brackets: Bracket[];
  stdDeduction: number;
  onFocus: () => void;
  onMove: (x: number, y: number) => void;
  onClose: () => void;
}) {
  function onTitleMouseDown(e: React.MouseEvent) {
    if ((e.target as HTMLElement).closest("button")) return;
    e.preventDefault();
    onFocus();
    const startX = e.clientX;
    const startY = e.clientY;
    const origX = dialog.x;
    const origY = dialog.y;
    function onMouseMove(ev: MouseEvent) {
      onMove(origX + ev.clientX - startX, origY + ev.clientY - startY);
    }
    function onMouseUp() {
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
    }
    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
  }

  return (
    <div
      className="fixed bg-white border-2 border-amber-300 rounded shadow-2xl flex flex-col"
      style={{
        top: dialog.y,
        left: dialog.x,
        zIndex: dialog.z,
        width: "min(90vw, 800px)",
        maxHeight: "80vh",
      }}
      onMouseDown={onFocus}
    >
      <div
        className="cursor-move bg-amber-500 text-white px-3 py-2 flex items-center justify-between rounded-t select-none"
        onMouseDown={onTitleMouseDown}
      >
        <h3 className="font-semibold text-sm">
          Year-by-year for {fmtMoney(dialog.conversion)}/yr conversion at {fmtPct(dialog.rate)} rate
        </h3>
        <button
          type="button"
          onClick={onClose}
          className="text-white hover:text-amber-100 text-xl leading-none px-2"
          aria-label="Close dialog"
        >
          &times;
        </button>
      </div>
      <div className="p-4 overflow-y-auto">
        {baseline && (
          <BracketChart
            baseline={baseline}
            selected={scenario}
            brackets={brackets}
            stdDeduction={stdDeduction}
          />
        )}
        <YearTable scenario={scenario} />
      </div>
    </div>
  );
}

interface ChartRow {
  year: number;
  baseline: number;
  selected: number | null;
}

function BracketChart({
  baseline,
  selected,
  brackets,
  stdDeduction,
}: {
  baseline: Scenario;
  selected: Scenario | null;
  brackets: Bracket[];
  stdDeduction: number;
}) {
  const data: ChartRow[] = useMemo(() => {
    return baseline.years.map((y, i) => {
      const sy = selected?.years[i];
      return {
        year: y.calendar_year,
        baseline: Math.max(0, y.taxable_income - stdDeduction),
        selected: sy ? Math.max(0, sy.taxable_income - stdDeduction) : null,
      };
    });
  }, [baseline, selected, stdDeduction]);

  const refLines = useMemo(() => brackets.filter((b) => b.max > 0), [brackets]);

  const yMax = useMemo(() => {
    let v = 0;
    for (const row of data) {
      if (row.baseline > v) v = row.baseline;
      if (row.selected !== null && row.selected > v) v = row.selected;
    }
    for (const b of refLines) {
      if (b.max > v) v = b.max;
    }
    return v * 1.1;
  }, [data, refLines]);

  return (
    <div className="border rounded p-3 mb-6 bg-white">
      <ResponsiveContainer width="100%" height={320}>
        <LineChart data={data} margin={{ top: 12, right: 32, left: 16, bottom: 8 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#eee" />
          <XAxis dataKey="year" tick={{ fontSize: 12 }} />
          <YAxis
            tick={{ fontSize: 12 }}
            tickFormatter={(v: number) => fmtMoney(v)}
            domain={[0, yMax]}
          />
          <Tooltip
            formatter={(value, name) => {
              if (value === null || value === undefined) return ["-", name as string];
              return [fmtMoney(Number(value)), name as string];
            }}
            labelFormatter={(label) => `Year ${String(label)}`}
          />
          <Legend wrapperStyle={{ fontSize: 12 }} />
          {refLines.map((b) => (
            <ReferenceLine
              key={b.rate}
              y={b.max}
              stroke="#9ca3af"
              strokeDasharray="4 4"
              label={{
                value: `${(b.rate * 100).toFixed(0)}%`,
                position: "right",
                fontSize: 11,
                fill: "#6b7280",
              }}
            />
          ))}
          <Line
            type="monotone"
            dataKey="baseline"
            name="Baseline (no conversion)"
            stroke="#6b7280"
            strokeWidth={2}
            dot={false}
            isAnimationActive={false}
          />
          {selected && (
            <Line
              type="monotone"
              dataKey="selected"
              name={`Selected: ${fmtMoney(selected.conversion_amount)}/yr @ ${fmtPct(selected.rate_of_return)}`}
              stroke="#f59e0b"
              strokeWidth={2}
              dot={false}
              isAnimationActive={false}
            />
          )}
        </LineChart>
      </ResponsiveContainer>
      <p className="text-[11px] text-gray-500 mt-2">
        Y-axis: post-deduction taxable income (taxable_income minus standard deduction, floored at 0).
        Dashed lines show federal bracket tops for the chosen filing status.
      </p>
    </div>
  );
}

function YearTable({ scenario }: { scenario: Scenario }) {
  return (
    <div>
      <p className="text-sm text-gray-600 mb-2">
        Total tax {fmtMoney(scenario.summary.total_federal_tax)}, end balance{" "}
        {fmtMoney(scenario.summary.ending_total)}
      </p>
      <div className="overflow-x-auto">
        <table className="min-w-full text-sm border">
          <thead className="bg-gray-50">
            <tr>
              <th className="p-2 border-b text-left">Year</th>
              <th className="p-2 border-b text-left">Age</th>
              <th className="p-2 border-b text-left">RMD</th>
              <th className="p-2 border-b text-left">Conversion</th>
              <th className="p-2 border-b text-left">Taxable</th>
              <th className="p-2 border-b text-left">Federal tax</th>
              <th className="p-2 border-b text-left">End traditional</th>
              <th className="p-2 border-b text-left">End Roth</th>
              <th className="p-2 border-b text-left">End total</th>
            </tr>
          </thead>
          <tbody>
            {scenario.years.map((y) => (
              <tr key={y.year_index}>
                <td className="p-2 border-b">{y.calendar_year}</td>
                <td className="p-2 border-b">{y.age}</td>
                <td className="p-2 border-b">{y.rmd > 0 ? fmtMoney(y.rmd) : "-"}</td>
                <td className="p-2 border-b">{y.conversion > 0 ? fmtMoney(y.conversion) : "-"}</td>
                <td className="p-2 border-b">{fmtMoney(y.taxable_income)}</td>
                <td className="p-2 border-b">{fmtMoney(y.federal_tax)}</td>
                <td className="p-2 border-b">{fmtMoney(y.ending_traditional)}</td>
                <td className="p-2 border-b">{fmtMoney(y.ending_roth)}</td>
                <td className="p-2 border-b font-semibold">{fmtMoney(y.ending_total)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
