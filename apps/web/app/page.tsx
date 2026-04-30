"use client";

import { useEffect, useMemo, useRef, useState } from "react";
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
  pingVisit,
  withBaselineCase,
  getBrackets,
  getStates,
  buildStateOptions,
  type StateOption,
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
  state: string;
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
  state: "",
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
  const [bracketsInfo, setBracketsInfo] = useState<{ brackets: Bracket[]; standard_deduction: number } | null>(null);
  const [stateOptions, setStateOptions] = useState<StateOption[]>([{ code: "", name: "None / not listed (0%)" }]);
  const zCounterRef = useRef(1000);

  useEffect(() => {
    pingVisit();
  }, []);

  useEffect(() => {
    let cancelled = false;
    getBrackets(form.filing_status, form.tax_year)
      .then((b) => {
        if (!cancelled) setBracketsInfo(b);
      })
      .catch(() => {
        if (!cancelled) setBracketsInfo(null);
      });
    return () => {
      cancelled = true;
    };
  }, [form.filing_status, form.tax_year]);

  useEffect(() => {
    let cancelled = false;
    getStates(form.tax_year)
      .then((s) => {
        if (!cancelled) setStateOptions(buildStateOptions(s));
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [form.tax_year]);

  function fillBracket(targetRate: number) {
    if (!bracketsInfo) return;
    const b = bracketsInfo.brackets.find((br) => br.rate === targetRate);
    if (!b || b.max <= 0) return;
    const headroom = Math.max(0, b.max - Math.max(0, form.annual_other_income - bracketsInfo.standard_deduction));
    if (headroom <= 0) return;
    const rounded = Math.round(headroom / 100) * 100;
    const existing = parseAmountList(form.conversion_cases_str);
    if (existing.includes(rounded)) return;
    const merged = withBaselineCase([...existing, rounded]);
    setForm({ ...form, conversion_cases_str: merged.join(", ") });
  }

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
        state: form.state,
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
      <div className="flex items-start justify-between mb-2">
        <h1 className="text-3xl font-bold">Roth Converter</h1>
        <ThemeToggle />
      </div>
      <p className="text-gray-600 dark:text-gray-300 mb-6 text-sm">
        Pick a few annual conversion amounts. See the tax cost and 401(k) balance over the next 10 years across multiple rate-of-return scenarios.
      </p>

      <form onSubmit={submit} className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
        <fieldset className="border border-gray-200 dark:border-gray-700 rounded p-4">
          <legend className="font-semibold px-2">You</legend>
          <Field
            label="Age"
            hint="Your age today. Drives the per-year age series and RMD eligibility."
          >
            <NumberInput value={form.age} onChange={(v) => setForm({ ...form, age: v })} />
          </Field>
          <Field
            label="Filing status"
            hint={
              <>
                Federal filing status. The IRS defines income-tax brackets and
                the standard deduction <em>per status</em>, so this single
                choice changes nearly all the per-year tax math.
                <span className="mt-1 block">In 2026 (MFJ vs Single):</span>
                <ul className="list-disc pl-4">
                  <li>Standard deduction: <code>$32,200</code> MFJ vs <code>$16,100</code> Single.</li>
                  <li>Top of the 12% bracket: <code>$100,800</code> MFJ vs <code>$50,400</code> Single. MFJ brackets are roughly double-width at low-mid incomes.</li>
                  <li>Same conversion + same other income can land in different brackets depending on the status, so this directly drives tax cost.</li>
                </ul>
                <span className="mt-1 block">Pick:</span>
                <ul className="list-disc pl-4">
                  <li><strong>Single</strong> - unmarried at year-end.</li>
                  <li><strong>Married filing jointly</strong> - married, filing one combined return (the common case).</li>
                  <li><strong>Head of household</strong> - unmarried with a qualifying dependent; brackets and deduction sit between Single and MFJ.</li>
                  <li><strong>Married filing separately</strong> - rare; usually only when one spouse has IDR student loans, large medical deductions, or wants to isolate liability.</li>
                </ul>
              </>
            }
          >
            <select
              className="border border-gray-300 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100 rounded p-1 w-full"
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
          <Field
            label="State (for income tax)"
            hint={
              <>
                State income tax is applied as a flat top-marginal rate to the same
                post-deduction taxable income that federal tax uses (an approximation;
                most states have their own brackets and deductions). Pick &ldquo;None&rdquo;
                to skip state tax entirely. Nine states have no state income tax. The
                rates shown are 2026 top-marginal estimates.
              </>
            }
          >
            <select
              className="border border-gray-300 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100 rounded p-1 w-full"
              value={form.state}
              onChange={(e) => setForm({ ...form, state: e.target.value })}
            >
              {stateOptions.map((s) => {
                const label =
                  s.code === ""
                    ? s.name
                    : s.noTax
                      ? `${s.name} - no state income tax`
                      : `${s.name} - ${((s.rate ?? 0) * 100).toFixed(2).replace(/\.?0+$/, "")}%`;
                return (
                  <option key={s.code} value={s.code}>
                    {label}
                  </option>
                );
              })}
            </select>
          </Field>
        </fieldset>

        <fieldset className="border border-gray-200 dark:border-gray-700 rounded p-4">
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
          <div className="rounded bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-700 px-3 py-2 mb-3">
            <div className="text-[11px] uppercase tracking-wide text-amber-900/70 dark:text-amber-200/80">
              Total 401(k)
            </div>
            <div className="text-lg font-bold text-amber-900 dark:text-amber-100">
              {fmtMoney(form.traditional_balance + form.roth_balance)}
            </div>
            {form.traditional_balance + form.roth_balance > 0 && (
              <div className="text-xs text-amber-900/80 dark:text-amber-200/80 mt-0.5">
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

        <fieldset className="border border-gray-200 dark:border-gray-700 rounded p-4">
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
              className="border border-gray-300 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100 rounded p-1 w-full"
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
              className="border border-gray-300 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100 rounded p-1 w-full"
              value={form.conversion_cases_str}
              onChange={(e) => setForm({ ...form, conversion_cases_str: e.target.value })}
              placeholder="25000, 50000, 100000"
            />
            {bracketsInfo && (
              <div className="flex items-center gap-1 mt-1 flex-wrap">
                <span className="text-[11px] text-gray-500 dark:text-gray-400">Add bracket-fill:</span>
                {bracketsInfo.brackets
                  .filter((b) => b.max > 0 && b.rate < 0.32)
                  .map((b) => {
                    const headroom = Math.max(
                      0,
                      b.max - Math.max(0, form.annual_other_income - bracketsInfo.standard_deduction)
                    );
                    const disabled = headroom <= 0;
                    return (
                      <button
                        key={b.rate}
                        type="button"
                        disabled={disabled}
                        onClick={() => fillBracket(b.rate)}
                        title={
                          disabled
                            ? `Other income already exceeds top of ${(b.rate * 100).toFixed(0)}%`
                            : `Add ${fmtMoney(Math.round(headroom / 100) * 100)}/yr to fill the ${(b.rate * 100).toFixed(0)}% bracket`
                        }
                        className="px-1.5 py-0.5 text-[11px] rounded border border-amber-300 dark:border-amber-700 text-amber-900 dark:text-amber-200 hover:bg-amber-50 dark:hover:bg-amber-900/30 disabled:opacity-40 disabled:cursor-not-allowed"
                      >
                        Fill {(b.rate * 100).toFixed(0)}%
                      </button>
                    );
                  })}
              </div>
            )}
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

      {err && <div className="rounded bg-red-100 dark:bg-red-900/40 text-red-800 dark:text-red-200 p-3 mb-4">{err}</div>}

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

function ThemeToggle() {
  const [dark, setDark] = useState(false);

  useEffect(() => {
    setDark(document.documentElement.classList.contains("dark"));
  }, []);

  function toggle() {
    const next = !dark;
    setDark(next);
    document.documentElement.classList.toggle("dark", next);
    try {
      localStorage.setItem("theme", next ? "dark" : "light");
    } catch {}
  }

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={dark ? "Switch to light mode" : "Switch to dark mode"}
      className="px-3 py-1.5 rounded border border-gray-300 dark:border-gray-600 text-sm bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-200 hover:bg-amber-50 dark:hover:bg-gray-700"
    >
      {dark ? "Light mode" : "Dark mode"}
    </button>
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
      <span className="block text-xs font-medium text-gray-700 dark:text-gray-200 mb-1">{label}</span>
      {children}
      {hint && <Hint>{hint}</Hint>}
    </label>
  );
}

function Hint({ children }: { children: React.ReactNode }) {
  return <span className="mt-1 block text-[11px] leading-snug text-gray-500 dark:text-gray-400">{children}</span>;
}

function NumberInput({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  return (
    <input
      type="number"
      className="border border-gray-300 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100 rounded p-1 w-full"
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

  const hasStateTax = resp.state_tax_rate > 0;

  return (
    <div>
      <h2 className="text-xl font-semibold mb-3">Comparison: total tax paid and ending balance after horizon</h2>
      <p className="text-xs text-gray-500 dark:text-gray-400 mb-2">
        Each row is an annual conversion strategy (the same dollar amount converted every year of the horizon).
        Each column is a rate-of-return assumption: <strong>Rate X%</strong> means both Traditional and Roth balances
        grow X% per year, compounded annually, for the whole horizon. The cell shows the strategy&apos;s outcome at that rate.
      </p>
      <p className="text-xs text-gray-500 dark:text-gray-400 mb-2">
        Inside each cell: <strong>tax</strong> is the total federal tax paid across the horizon (sum of every
        year&apos;s federal tax). <strong>end total</strong> is the combined 401(k) balance at the end of the horizon.
        The bottom line splits that ending balance into <strong>T</strong> (Traditional, still pre-tax) and{" "}
        <strong>R</strong> (Roth, already taxed - withdrawals are tax-free). A successful Roth-conversion strategy
        moves money from T to R while keeping the total competitive with the baseline.
      </p>
      <p className="text-xs text-gray-500 dark:text-gray-400 mb-2">
        Click cells to open draggable drill-in dialogs. Click again to close. Open multiple to compare side-by-side.
      </p>

      <OverviewCharts resp={resp} rates={rates} cases={cases} find={find} />

      <div className="overflow-x-auto mb-6">
        <table className="min-w-full text-sm border border-gray-200 dark:border-gray-700">
          <thead className="bg-amber-500 text-white">
            <tr>
              <th className="p-2 border border-amber-600 text-left font-semibold">Annual conversion</th>
              {rates.map((r) => (
                <th key={r} className="p-2 border border-amber-600 text-left font-semibold">
                  Rate {fmtPct(r)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {cases.map((c) => (
              <tr key={c}>
                <td className="p-2 border border-gray-200 dark:border-gray-700 font-semibold dark:text-gray-100">{fmtMoney(c)}/yr</td>
                {rates.map((r) => {
                  const s = find(r, c);
                  if (!s) return <td key={r} className="p-2 border border-gray-200 dark:border-gray-700 dark:text-gray-100">-</td>;
                  const open = isOpen(r, c);
                  return (
                    <td
                      key={r}
                      className={`p-0 border border-gray-200 dark:border-gray-700 ${open ? "ring-2 ring-amber-500 ring-inset" : ""}`}
                    >
                      <button
                        type="button"
                        onClick={() => onToggle(r, c)}
                        aria-pressed={open}
                        aria-label={`Open drill-in for ${fmtMoney(c)} per year at ${fmtPct(r)}`}
                        className={`w-full text-left p-2 cursor-pointer focus:outline-none focus-visible:bg-amber-50 dark:focus-visible:bg-amber-900/30 hover:bg-amber-50 dark:hover:bg-amber-900/30 dark:text-gray-100 ${
                          open ? "bg-amber-50 dark:bg-amber-900/30" : ""
                        }`}
                      >
                        <div className="text-xs text-gray-500 dark:text-gray-400">
                          {hasStateTax ? "fed tax" : "tax"}
                        </div>
                        <div className="font-semibold">{fmtMoney(s.summary.total_federal_tax)}</div>
                        {hasStateTax && (
                          <>
                            <div className="text-xs text-gray-500 dark:text-gray-400 mt-1">state tax</div>
                            <div className="font-semibold">{fmtMoney(s.summary.total_state_tax)}</div>
                          </>
                        )}
                        <div className="text-xs text-gray-500 dark:text-gray-400 mt-1">end total</div>
                        <div className="font-semibold">{fmtMoney(s.summary.ending_total)}</div>
                        <div className="text-xs text-gray-500 dark:text-gray-400 mt-1">
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

const SERIES_COLORS = ["#6b7280", "#f59e0b", "#10b981", "#0ea5e9", "#8b5cf6", "#ec4899", "#14b8a6"];

function OverviewCharts({
  resp,
  rates,
  cases,
  find,
}: {
  resp: MatrixResponse;
  rates: number[];
  cases: number[];
  find: (r: number, c: number) => Scenario | undefined;
}) {
  const [chartRate, setChartRate] = useState<number>(rates[0]);

  useEffect(() => {
    if (!rates.includes(chartRate)) setChartRate(rates[0]);
  }, [rates, chartRate]);

  const seriesKeys = useMemo(() => cases.map((c) => `${fmtMoney(c)}/yr`), [cases]);

  const data = useMemo(() => {
    const baselineScenario = find(chartRate, cases[0]);
    if (!baselineScenario) return [];
    const cumByCase: Record<string, number[]> = {};
    cases.forEach((c, idx) => {
      const s = find(chartRate, c);
      if (!s) return;
      const key = seriesKeys[idx];
      const series: number[] = [];
      let running = 0;
      for (const y of s.years) {
        running += y.federal_tax + y.state_tax;
        series.push(running);
      }
      cumByCase[key] = series;
    });
    return baselineScenario.years.map((_, i) => {
      const cum: Record<string, number> = {};
      const trad: Record<string, number> = {};
      const roth: Record<string, number> = {};
      cases.forEach((c, idx) => {
        const s = find(chartRate, c);
        if (!s) return;
        const key = seriesKeys[idx];
        cum[key] = cumByCase[key][i];
        trad[key] = s.years[i].ending_traditional;
        roth[key] = s.years[i].ending_roth;
      });
      return { year: baselineScenario.years[i].calendar_year, cum, trad, roth };
    });
  }, [chartRate, cases, find, seriesKeys, resp]);

  const cumData = data.map((d) => ({ year: d.year, ...d.cum }));
  const tradData = data.map((d) => ({ year: d.year, ...d.trad }));
  const rothData = data.map((d) => ({ year: d.year, ...d.roth }));

  return (
    <div className="mb-6">
      <div className="flex items-center gap-2 mb-2 flex-wrap">
        <span className="text-xs text-gray-600 dark:text-gray-300">Compare strategies at rate:</span>
        {rates.map((r) => (
          <button
            key={r}
            type="button"
            onClick={() => setChartRate(r)}
            className={`px-2 py-0.5 text-xs rounded border ${
              chartRate === r
                ? "bg-amber-500 text-white border-amber-600"
                : "bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-200 border-gray-300 dark:border-gray-600 hover:bg-amber-50 dark:hover:bg-gray-700"
            }`}
          >
            {fmtPct(r)}
          </button>
        ))}
      </div>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <SeriesChart title="Cumulative tax paid (federal + state)" data={cumData} seriesKeys={seriesKeys} />
        <SeriesChart title="Traditional 401(k) balance" data={tradData} seriesKeys={seriesKeys} />
        <SeriesChart title="Roth 401(k) balance" data={rothData} seriesKeys={seriesKeys} />
      </div>
    </div>
  );
}

function SeriesChart({
  title,
  data,
  seriesKeys,
}: {
  title: string;
  data: Array<Record<string, number>>;
  seriesKeys: string[];
}) {
  return (
    <div className="border border-amber-200 dark:border-amber-800 rounded p-2 bg-white dark:bg-gray-900">
      <h3 className="text-xs font-semibold text-amber-900 dark:text-amber-200 mb-1">{title}</h3>
      <ResponsiveContainer width="100%" height={220}>
        <LineChart data={data} margin={{ top: 8, right: 12, left: 4, bottom: 4 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#eee" />
          <XAxis dataKey="year" tick={{ fontSize: 11 }} />
          <YAxis tick={{ fontSize: 11 }} tickFormatter={(v: number) => fmtMoney(v)} />
          <Tooltip
            formatter={(value, name) => [fmtMoney(Number(value)), name as string]}
            labelFormatter={(label) => `Year ${String(label)}`}
          />
          <Legend wrapperStyle={{ fontSize: 11 }} />
          {seriesKeys.map((k, i) => (
            <Line
              key={k}
              type="monotone"
              dataKey={k}
              stroke={SERIES_COLORS[i % SERIES_COLORS.length]}
              strokeWidth={2}
              dot={false}
              isAnimationActive={false}
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
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
      className="fixed bg-white dark:bg-gray-900 border-2 border-amber-300 dark:border-amber-700 rounded shadow-2xl flex flex-col"
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
    <div className="border border-amber-200 dark:border-amber-800 rounded p-3 mb-6 bg-white dark:bg-gray-900">
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
      <p className="text-[11px] text-gray-500 dark:text-gray-400 mt-2">
        Y-axis: post-deduction taxable income (taxable_income minus standard deduction, floored at 0).
        Dashed lines show federal bracket tops for the chosen filing status.
      </p>
    </div>
  );
}

function YearTable({ scenario }: { scenario: Scenario }) {
  return (
    <div>
      <p className="text-sm text-gray-700 dark:text-gray-200 mb-2">
        Total federal tax <strong>{fmtMoney(scenario.summary.total_federal_tax)}</strong>
        {scenario.summary.total_state_tax > 0 && (
          <>
            {" "}
            + state tax <strong>{fmtMoney(scenario.summary.total_state_tax)}</strong>
          </>
        )}
        , end balance <strong>{fmtMoney(scenario.summary.ending_total)}</strong>
      </p>
      <div className="overflow-x-auto">
        <table className="min-w-full text-sm border border-amber-200 dark:border-amber-800">
          <thead className="bg-amber-500 text-white">
            <tr>
              <th className="p-2 text-left font-semibold">Year</th>
              <th className="p-2 text-left font-semibold">Age</th>
              <th className="p-2 text-left font-semibold">RMD</th>
              <th className="p-2 text-left font-semibold">Conversion</th>
              <th className="p-2 text-left font-semibold">Taxable</th>
              <th className="p-2 text-left font-semibold">Federal tax</th>
              <th className="p-2 text-left font-semibold">State tax</th>
              <th className="p-2 text-left font-semibold">End traditional</th>
              <th className="p-2 text-left font-semibold">End Roth</th>
              <th className="p-2 text-left font-semibold">End total</th>
            </tr>
          </thead>
          <tbody>
            {scenario.years.map((y) => (
              <tr key={y.year_index} className="odd:bg-white dark:odd:bg-gray-900 even:bg-amber-50/40 dark:even:bg-amber-900/20 hover:bg-amber-50 dark:hover:bg-amber-900/30 dark:text-gray-100">
                <td className="p-2 border-b border-amber-100 dark:border-amber-800/40">{y.calendar_year}</td>
                <td className="p-2 border-b border-amber-100 dark:border-amber-800/40">{y.age}</td>
                <td className="p-2 border-b border-amber-100 dark:border-amber-800/40">{y.rmd > 0 ? fmtMoney(y.rmd) : "-"}</td>
                <td className="p-2 border-b border-amber-100 dark:border-amber-800/40">{y.conversion > 0 ? fmtMoney(y.conversion) : "-"}</td>
                <td className="p-2 border-b border-amber-100 dark:border-amber-800/40">{fmtMoney(y.taxable_income)}</td>
                <td className="p-2 border-b border-amber-100 dark:border-amber-800/40">{fmtMoney(y.federal_tax)}</td>
                <td className="p-2 border-b border-amber-100 dark:border-amber-800/40">{y.state_tax > 0 ? fmtMoney(y.state_tax) : "-"}</td>
                <td className="p-2 border-b border-amber-100 dark:border-amber-800/40">{fmtMoney(y.ending_traditional)}</td>
                <td className="p-2 border-b border-amber-100 dark:border-amber-800/40">{fmtMoney(y.ending_roth)}</td>
                <td className="p-2 border-b border-amber-100 dark:border-amber-800/40 font-semibold">{fmtMoney(y.ending_total)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
