"use client";

import { useMemo, useState } from "react";
import {
  postMatrix,
  fmtMoney,
  fmtPct,
  parseAmountList,
  parseRateList,
  type MatrixResponse,
  type FilingStatus,
  type Scenario,
} from "@/lib/api";

interface FormState {
  age: number;
  total_401k: number;
  traditional_pct: number;
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
  total_401k: 1_000_000,
  traditional_pct: 70,
  filing_status: "mfj",
  annual_other_income: 50_000,
  horizon_years: 10,
  rates_str: "10, 15, 20, 25",
  conversion_cases_str: "0, 25000, 50000, 100000, 200000",
  include_rmd: true,
  tax_year: 2026,
};

export default function Home() {
  const [form, setForm] = useState<FormState>(DEFAULT_FORM);
  const [resp, setResp] = useState<MatrixResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [activeRate, setActiveRate] = useState<number | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setErr(null);
    try {
      const rates = parseRateList(form.rates_str);
      const cases = parseAmountList(form.conversion_cases_str);
      if (rates.length === 0) throw new Error("Need at least one rate of return");
      if (cases.length === 0) throw new Error("Need at least one conversion case");
      const tradPct = form.traditional_pct / 100;
      const r = await postMatrix({
        age: form.age,
        birth_year: form.tax_year - form.age,
        total_401k: form.total_401k,
        traditional_pct: tradPct,
        roth_pct: 1 - tradPct,
        filing_status: form.filing_status,
        annual_other_income: form.annual_other_income,
        horizon_years: form.horizon_years,
        rates_of_return: rates,
        conversion_cases: cases,
        include_rmd: form.include_rmd,
        tax_year: form.tax_year,
      });
      setResp(r);
      if (r.scenarios.length > 0) setActiveRate(r.scenarios[0].rate_of_return);
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
            hint="Wages, pension, taxable interest, or anything else taxable before the conversion. Held flat across the horizon (v1)."
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
            label="Total 401(k) balance"
            hint="Combined Traditional + Roth 401(k) today. Split by the next field."
          >
            <NumberInput value={form.total_401k} onChange={(v) => setForm({ ...form, total_401k: v })} />
          </Field>
          <Field
            label="Traditional %"
            hint="Share of the balance in pre-tax (Traditional). The remainder is Roth."
          >
            <input
              type="number"
              min={0}
              max={100}
              className="border rounded p-1 w-full"
              value={form.traditional_pct}
              onChange={(e) => setForm({ ...form, traditional_pct: Number(e.target.value) })}
            />
          </Field>
          <div className="text-xs text-gray-500 -mt-1 mb-2">
            Roth %: {(100 - form.traditional_pct).toFixed(0)}%
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
            hint="Comma-separated annual rates to sweep. Same nominal rate applied to Traditional and Roth."
          >
            <input
              type="text"
              className="border rounded p-1 w-full"
              value={form.rates_str}
              onChange={(e) => setForm({ ...form, rates_str: e.target.value })}
              placeholder="10, 15, 20, 25"
            />
          </Field>
          <Field
            label="Annual conversion cases ($)"
            hint="Comma-separated annual conversion amounts to sweep. Held constant each year, capped by Traditional balance after RMD. Tax is paid from outside the 401(k), so 100% of the conversion lands in Roth."
          >
            <input
              type="text"
              className="border rounded p-1 w-full"
              value={form.conversion_cases_str}
              onChange={(e) => setForm({ ...form, conversion_cases_str: e.target.value })}
              placeholder="0, 25000, 50000, 100000"
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

      {resp && <Results resp={resp} activeRate={activeRate} setActiveRate={setActiveRate} />}
    </main>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
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
  activeRate,
  setActiveRate,
}: {
  resp: MatrixResponse;
  activeRate: number | null;
  setActiveRate: (r: number) => void;
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

  return (
    <div>
      <h2 className="text-xl font-semibold mb-3">Comparison: total tax paid and ending balance after horizon</h2>
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
                  return (
                    <td key={r} className="p-2 border">
                      <div className="text-xs text-gray-500">tax</div>
                      <div className="font-semibold">{fmtMoney(s.summary.total_federal_tax)}</div>
                      <div className="text-xs text-gray-500 mt-1">end total</div>
                      <div className="font-semibold">{fmtMoney(s.summary.ending_total)}</div>
                      <div className="text-xs text-gray-500 mt-1">
                        T {fmtMoney(s.summary.ending_traditional)} / R {fmtMoney(s.summary.ending_roth)}
                      </div>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h2 className="text-xl font-semibold mb-3">Year-by-year detail</h2>
      <div className="flex gap-2 mb-3 flex-wrap">
        {rates.map((r) => (
          <button
            key={r}
            onClick={() => setActiveRate(r)}
            className={`px-3 py-1 rounded text-sm border ${
              activeRate === r ? "bg-amber-500 text-white border-amber-500" : "bg-white"
            }`}
          >
            Rate {fmtPct(r)}
          </button>
        ))}
      </div>

      {activeRate !== null && (
        <div className="space-y-6">
          {cases.map((c) => {
            const s = find(activeRate, c);
            if (!s) return null;
            return <YearTable key={c} scenario={s} />;
          })}
        </div>
      )}
    </div>
  );
}

function YearTable({ scenario }: { scenario: Scenario }) {
  return (
    <div>
      <h3 className="font-semibold mb-2">
        {fmtMoney(scenario.conversion_amount)}/yr conversion at {fmtPct(scenario.rate_of_return)} rate
        <span className="ml-3 text-sm text-gray-600 font-normal">
          (total tax {fmtMoney(scenario.summary.total_federal_tax)}, end balance {fmtMoney(scenario.summary.ending_total)})
        </span>
      </h3>
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
