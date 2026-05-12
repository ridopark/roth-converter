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
  postOptimize,
  type StateOption,
  type OptimizePlan,
  type Bracket,
  type IRMAATier,
  type MatrixResponse,
  type FilingStatus,
  type Scenario,
  type StockLot,
} from "@/lib/api";

type Mode = "matrix" | "plan";

interface FormState {
  age: number;
  traditional_balance: number;
  roth_balance: number;
  filing_status: FilingStatus;
  annual_other_income: number;
  annual_ss_benefit: number;
  taxable_div_ltcg: number;
  aca_household_size: number;
  aca_annual_premium: number;
  horizon_years: number;
  rates_str: string;
  conversion_cases_str: string;
  include_rmd: boolean;
  tax_year: number;
  state: string;
  rate_of_return: number;
  target_bracket_rate: number;
  respect_irmaa: boolean;
  strategy: "bracket_fill" | "dp";
  tax_funding_source: "external" | "traditional";
  stock_lots: StockLot[];
  per_year_advanced: boolean;
  other_income_per_year: number[];
  ss_benefit_per_year: number[];
  rates_per_year: number[];
}

const DEFAULT_FORM: FormState = {
  age: 60,
  traditional_balance: 700_000,
  roth_balance: 300_000,
  filing_status: "mfj",
  annual_other_income: 50_000,
  annual_ss_benefit: 0,
  taxable_div_ltcg: 0,
  aca_household_size: 0,
  aca_annual_premium: 0,
  horizon_years: 10,
  rates_str: "5, 7, 9, 11",
  conversion_cases_str: "0, 25000, 50000, 100000, 200000",
  include_rmd: true,
  tax_year: 2026,
  state: "",
  rate_of_return: 0.07,
  target_bracket_rate: 0.22,
  respect_irmaa: true,
  strategy: "bracket_fill",
  tax_funding_source: "external",
  stock_lots: [],
  per_year_advanced: false,
  other_income_per_year: [],
  ss_benefit_per_year: [],
  rates_per_year: [],
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
  const [mode, setMode] = useState<Mode>("matrix");
  const [resp, setResp] = useState<MatrixResponse | null>(null);
  const [plan, setPlan] = useState<OptimizePlan | null>(null);
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
    const headroom = b.max - Math.max(0, form.annual_other_income - bracketsInfo.standard_deduction);
    // When income already fills this bracket, still let the user add the bracket-top
    // amount as a conversion case so they can see what full-bracket conversion looks like.
    const amount = headroom > 0 ? headroom : b.max;
    const rounded = Math.round(amount / 100) * 100;
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
    const total = form.traditional_balance + form.roth_balance;
    const tradPct = total > 0 ? form.traditional_balance / total : 0;
    const rothPct = total > 0 ? form.roth_balance / total : 0;
    try {
      if (mode === "matrix") {
        const rates = parseRateList(form.rates_str);
        const cases = withBaselineCase(parseAmountList(form.conversion_cases_str));
        if (rates.length === 0) throw new Error("Need at least one rate of return");
        if (cases.length === 0) throw new Error("Need at least one conversion case");
        const r = await postMatrix({
          age: form.age,
          birth_year: form.tax_year - form.age,
          total_401k: total,
          traditional_pct: tradPct,
          roth_pct: rothPct,
          filing_status: form.filing_status,
          annual_other_income: form.annual_other_income,
          annual_ss_benefit: form.annual_ss_benefit,
          taxable_div_ltcg: form.taxable_div_ltcg,
          aca_household_size: form.aca_household_size,
          aca_annual_premium: form.aca_annual_premium,
          horizon_years: form.horizon_years,
          rates_of_return: rates,
          conversion_cases: cases,
          include_rmd: form.include_rmd,
          tax_year: form.tax_year,
          state: form.state,
          tax_funding_source: form.tax_funding_source,
          ...(form.tax_funding_source === "external" && form.stock_lots.length > 0
            ? { stock_lots: form.stock_lots.filter((l) => l.current_value > 0) }
            : {}),
          ...(form.per_year_advanced && form.other_income_per_year.length > 0
            ? { other_income_per_year: form.other_income_per_year.slice(0, form.horizon_years) }
            : {}),
          ...(form.per_year_advanced && form.ss_benefit_per_year.length > 0
            ? { ss_benefit_per_year: form.ss_benefit_per_year.slice(0, form.horizon_years) }
            : {}),
        });
        setResp(r);
        setPlan(null);
        setDialogs([]);
      } else {
        const p = await postOptimize({
          age: form.age,
          birth_year: form.tax_year - form.age,
          total_401k: total,
          traditional_pct: tradPct,
          roth_pct: rothPct,
          filing_status: form.filing_status,
          annual_other_income: form.annual_other_income,
          annual_ss_benefit: form.annual_ss_benefit,
          taxable_div_ltcg: form.taxable_div_ltcg,
          aca_household_size: form.aca_household_size,
          aca_annual_premium: form.aca_annual_premium,
          horizon_years: form.horizon_years,
          rate_of_return: form.rate_of_return,
          target_bracket_rate: form.target_bracket_rate,
          include_rmd: form.include_rmd,
          tax_year: form.tax_year,
          state: form.state,
          respect_irmaa: form.respect_irmaa,
          strategy: form.strategy,
          tax_funding_source: form.tax_funding_source,
          ...(form.tax_funding_source === "external" && form.stock_lots.length > 0
            ? { stock_lots: form.stock_lots.filter((l) => l.current_value > 0) }
            : {}),
          ...(form.per_year_advanced && form.other_income_per_year.length > 0
            ? { other_income_per_year: form.other_income_per_year.slice(0, form.horizon_years) }
            : {}),
          ...(form.per_year_advanced && form.ss_benefit_per_year.length > 0
            ? { ss_benefit_per_year: form.ss_benefit_per_year.slice(0, form.horizon_years) }
            : {}),
          ...(form.per_year_advanced && form.rates_per_year.length > 0
            ? { rates_per_year: form.rates_per_year.slice(0, form.horizon_years) }
            : {}),
        });
        setPlan(p);
        setResp(null);
        setDialogs([]);
      }
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
      <p className="text-gray-600 dark:text-gray-300 mb-3 text-sm">
        {mode === "matrix"
          ? "Pick a few annual conversion amounts. See the tax cost and 401(k) balance over the next 10 years across multiple rate-of-return scenarios."
          : "Pick a target federal bracket. The optimizer fills it each year (capped by your Traditional balance after RMD) and returns one deterministic plan."}
      </p>
      <div className="inline-flex rounded-md border border-gray-300 dark:border-gray-600 mb-6 overflow-hidden">
        {(["matrix", "plan"] as const).map((m) => (
          <button
            key={m}
            type="button"
            onClick={() => setMode(m)}
            className={`px-3 py-1.5 text-sm ${
              mode === m
                ? "bg-amber-500 text-white"
                : "bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-200 hover:bg-amber-50 dark:hover:bg-gray-700"
            }`}
          >
            {m === "matrix" ? "Sensitivity matrix" : "Bracket-fill plan"}
          </button>
        ))}
      </div>

      <form onSubmit={submit} className="flex flex-col gap-6 mb-8">
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
            label="Annual Social Security benefit ($)"
            hint={
              <>
                Total household Social Security benefit per year (combined for
                MFJ). Held flat across the horizon. Up to 85% can be taxed
                under IRC section 86 once provisional income (other income +
                conversion + RMD + half of SS) crosses the IRS thresholds
                ($32k / $44k MFJ; $25k / $34k Single).
                <span className="mt-1 block">
                  Set to 0 if you are not yet collecting SS.
                </span>
              </>
            }
          >
            <NumberInput
              value={form.annual_ss_benefit}
              onChange={(v) => setForm({ ...form, annual_ss_benefit: v })}
            />
          </Field>
          <Field
            label="Investment income (LTCG + qualified div, $/yr)"
            hint={
              <>
                Annual long-term capital gains and qualified dividends from
                taxable accounts. Held flat unless you enable per-year overrides.
                v1 includes this in MAGI (so it gates IRMAA, NIIT, and ACA cliff)
                but does not separately compute LTCG bracket tax. Set to 0 if
                investment income is held in tax-deferred accounts.
              </>
            }
          >
            <NumberInput
              value={form.taxable_div_ltcg}
              onChange={(v) => setForm({ ...form, taxable_div_ltcg: v })}
            />
          </Field>
          {form.age < 65 && (
            <>
              <Field
                label="Pre-Medicare ACA household size"
                hint={
                  <>
                    If you (or anyone in your household) buys ACA marketplace
                    health insurance, set this to your household size. v1 models
                    the 400%-FPL cliff: crossing it forfeits the full premium tax
                    credit. Leave at 0 to skip ACA modeling entirely.
                  </>
                }
              >
                <NumberInput
                  value={form.aca_household_size}
                  onChange={(v) => setForm({ ...form, aca_household_size: v })}
                />
              </Field>
              {form.aca_household_size > 0 && (
                <Field
                  label="ACA estimated annual premium ($)"
                  hint={
                    <>
                      Estimated full-price annual ACA premium for your household
                      (no subsidy). National averages run roughly $7,200/single
                      and $14,400/household. Used as the cliff penalty if MAGI
                      crosses 400% FPL.
                    </>
                  }
                >
                  <NumberInput
                    value={form.aca_annual_premium}
                    onChange={(v) => setForm({ ...form, aca_annual_premium: v })}
                  />
                </Field>
              )}
            </>
          )}
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
          <Field
            label="Conversion tax funded from"
            hint={
              <>
                Where does the federal + state income tax on each Roth
                conversion come from?
                <ul className="list-disc pl-4 mt-1">
                  <li>
                    <strong>Outside the 401(k)</strong> (default): you pay
                    the tax with cash from a taxable account or savings.
                    The full conversion amount lands in Roth.
                  </li>
                  <li>
                    <strong>Traditional 401(k)</strong>: the tax is withheld
                    from the conversion proceeds before they reach Roth.
                    The Traditional withdrawal still equals the conversion
                    amount, but only <code>conversion - federal tax - state tax</code>
                    actually lands in Roth. IRMAA / NIIT / ACA penalties are
                    separate ongoing costs and are not deducted here.
                  </li>
                </ul>
              </>
            }
          >
            <div className="flex gap-1">
              {(["external", "traditional"] as const).map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => setForm({ ...form, tax_funding_source: s })}
                  className={`px-2 py-0.5 text-xs rounded border ${
                    form.tax_funding_source === s
                      ? "bg-amber-500 text-white border-amber-600"
                      : "bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-200 border-gray-300 dark:border-gray-600 hover:bg-amber-50 dark:hover:bg-gray-700"
                  }`}
                >
                  {s === "external" ? "Outside 401(k)" : "Traditional 401(k)"}
                </button>
              ))}
            </div>
            {form.tax_funding_source === "external" && (
              <div className="mt-3 border border-amber-200 dark:border-amber-800/40 rounded p-3 bg-amber-50/50 dark:bg-amber-900/10">
                <div className="flex items-center gap-1 text-xs font-medium mb-2 text-gray-700 dark:text-gray-300">
                  Stock lots to sell for taxes (optional)
                  <Hint>
                    If you&apos;d need to sell appreciated stock to raise the tax cash, enter each
                    lot&apos;s cost basis, current value, and gain type. The calculator estimates the
                    additional capital-gains tax triggered by the sale and shows it as &ldquo;stock
                    sale tax&rdquo; in the results — a hidden cost the base projection ignores.
                    Long-term gains (held &gt;1 yr) use the 0/15/20% LTCG brackets plus NIIT if
                    your MAGI is high enough. Short-term gains are taxed at your ordinary marginal
                    rate. Leave empty if you have cash available with no embedded gain.
                  </Hint>
                </div>
                {form.stock_lots.map((lot, i) => (
                  <div key={i} className="flex flex-wrap gap-2 items-center mb-2 text-xs">
                    <span className="text-gray-400 w-4">{i + 1}.</span>
                    <div className="flex flex-col gap-0.5">
                      <span className="text-gray-500 dark:text-gray-400">Cost basis</span>
                      <input
                        type="number"
                        className="border border-gray-300 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100 rounded p-1 w-28"
                        value={lot.cost_basis}
                        onChange={(e) => {
                          const next = [...form.stock_lots];
                          next[i] = { ...next[i], cost_basis: Number(e.target.value) };
                          setForm({ ...form, stock_lots: next });
                        }}
                      />
                    </div>
                    <div className="flex flex-col gap-0.5">
                      <span className="text-gray-500 dark:text-gray-400">Current value</span>
                      <input
                        type="number"
                        className="border border-gray-300 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100 rounded p-1 w-28"
                        value={lot.current_value}
                        onChange={(e) => {
                          const next = [...form.stock_lots];
                          next[i] = { ...next[i], current_value: Number(e.target.value) };
                          setForm({ ...form, stock_lots: next });
                        }}
                      />
                    </div>
                    <div className="flex flex-col gap-0.5">
                      <span className="text-gray-500 dark:text-gray-400">Gain type</span>
                      <div className="flex gap-0.5">
                        {(["lt", "st"] as const).map((g) => (
                          <button
                            key={g}
                            type="button"
                            onClick={() => {
                              const next = [...form.stock_lots];
                              next[i] = { ...next[i], gain_type: g };
                              setForm({ ...form, stock_lots: next });
                            }}
                            className={`px-2 py-0.5 rounded border ${
                              lot.gain_type === g
                                ? "bg-amber-500 text-white border-amber-600"
                                : "bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-200 border-gray-300 dark:border-gray-600 hover:bg-amber-50 dark:hover:bg-gray-700"
                            }`}
                          >
                            {g === "lt" ? "Long-term" : "Short-term"}
                          </button>
                        ))}
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => setForm({ ...form, stock_lots: form.stock_lots.filter((_, j) => j !== i) })}
                      className="text-red-400 hover:text-red-600 px-1 self-end pb-1"
                      aria-label="Remove lot"
                    >
                      ×
                    </button>
                  </div>
                ))}
                <button
                  type="button"
                  onClick={() => setForm({ ...form, stock_lots: [...form.stock_lots, { cost_basis: 0, current_value: 0, gain_type: "lt" }] })}
                  className="text-xs text-amber-600 dark:text-amber-400 hover:underline"
                >
                  + Add lot
                </button>
              </div>
            )}
          </Field>
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
          {mode === "matrix" && (
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
          )}
          {mode === "matrix" && (
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
                  .filter((b) => b.max > 0)
                  .map((b) => {
                    const headroom = b.max - Math.max(0, form.annual_other_income - bracketsInfo.standard_deduction);
                    const amount = Math.round(Math.max(headroom, b.max) / 100) * 100;
                    return (
                      <button
                        key={b.rate}
                        type="button"
                        onClick={() => fillBracket(b.rate)}
                        title={
                          headroom > 0
                            ? `Add ${fmtMoney(Math.round(headroom / 100) * 100)}/yr — fills the ${(b.rate * 100).toFixed(0)}% bracket`
                            : `Add ${fmtMoney(amount)}/yr — ${(b.rate * 100).toFixed(0)}% bracket top (income already exceeds headroom)`
                        }
                        className="px-1.5 py-0.5 text-[11px] rounded border border-amber-300 dark:border-amber-700 text-amber-900 dark:text-amber-200 hover:bg-amber-50 dark:hover:bg-amber-900/30"
                      >
                        Fill {(b.rate * 100).toFixed(0)}%
                      </button>
                    );
                  })}
              </div>
            )}
          </Field>
          )}
          {mode === "plan" && (
            <>
              <Field
                label="Strategy"
                hint={
                  <>
                    <strong>Bracket fill</strong> is the v1 myopic optimizer:
                    every year, fill the target federal bracket subject to the
                    IRMAA cap. <strong>Multi-year DP</strong> (v2) searches the
                    space of conversion paths and minimizes total federal tax +
                    state tax + IRMAA + NIIT + ACA penalty over the horizon, plus
                    a terminal cost on the remaining Traditional balance. DP
                    typically wins when there are cliffs (IRMAA tier crossings,
                    pre-RMD low-income years).
                  </>
                }
              >
                <div className="flex gap-1">
                  {(["bracket_fill", "dp"] as const).map((s) => (
                    <button
                      key={s}
                      type="button"
                      onClick={() => setForm({ ...form, strategy: s })}
                      className={`px-2 py-0.5 text-xs rounded border ${
                        form.strategy === s
                          ? "bg-amber-500 text-white border-amber-600"
                          : "bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-200 border-gray-300 dark:border-gray-600 hover:bg-amber-50 dark:hover:bg-gray-700"
                      }`}
                    >
                      {s === "bracket_fill" ? "Bracket fill (greedy)" : "Multi-year DP"}
                    </button>
                  ))}
                </div>
              </Field>
              <label className="flex items-start gap-2 text-sm mb-3">
                <input
                  type="checkbox"
                  className="mt-0.5"
                  checked={form.respect_irmaa}
                  onChange={(e) => setForm({ ...form, respect_irmaa: e.target.checked })}
                />
                <span>
                  <span>Respect IRMAA tier (cap at $218k MFJ / $109k Single)</span>
                  <Hint>
                    When you are 63+ each conversion year, hold MAGI under the IRMAA
                    standard tier so the 2-year-lookback Medicare surcharge stays at
                    $0. Crossing tier 1 costs roughly $1,147/yr per spouse. Disable
                    to fill the federal bracket regardless of IRMAA.
                  </Hint>
                </span>
              </label>
              <Field
                label="Rate of return (%)"
                hint={
                  <>
                    Single annual compound rate applied to both Traditional and Roth across the horizon.
                    Same convention as matrix mode (5-9% is realistic; pick one for the plan).
                  </>
                }
              >
                <input
                  type="number"
                  step={0.1}
                  className="border border-gray-300 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100 rounded p-1 w-full"
                  value={(form.rate_of_return * 100).toFixed(1)}
                  onChange={(e) =>
                    setForm({ ...form, rate_of_return: Number(e.target.value) / 100 })
                  }
                />
              </Field>
              <Field
                label="Target bracket"
                hint={
                  <>
                    Each year the optimizer converts as much as fits below the top of this federal bracket
                    (after standard deduction and any RMD), capped by what remains in Traditional.
                  </>
                }
              >
                {bracketsInfo ? (
                  <div className="flex flex-wrap gap-1">
                    {bracketsInfo.brackets
                      .filter((b) => b.max > 0)
                      .map((b) => {
                        const selected = Math.abs(form.target_bracket_rate - b.rate) < 1e-9;
                        return (
                          <button
                            key={b.rate}
                            type="button"
                            onClick={() => setForm({ ...form, target_bracket_rate: b.rate })}
                            className={`px-2 py-0.5 text-xs rounded border ${
                              selected
                                ? "bg-amber-500 text-white border-amber-600"
                                : "bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-200 border-gray-300 dark:border-gray-600 hover:bg-amber-50 dark:hover:bg-gray-700"
                            }`}
                          >
                            Fill {(b.rate * 100).toFixed(0)}% (top ${(b.max / 1000).toFixed(0)}k)
                          </button>
                        );
                      })}
                  </div>
                ) : (
                  <div className="text-xs text-gray-500 dark:text-gray-400">Loading brackets...</div>
                )}
              </Field>
            </>
          )}
          <PerYearAdvanced form={form} setForm={setForm} mode={mode} />
          <button
            type="submit"
            disabled={loading}
            className="mt-2 w-full rounded bg-amber-500 text-white px-4 py-2 font-semibold hover:bg-amber-600 disabled:opacity-50"
          >
            {loading ? "Computing..." : mode === "matrix" ? "Compute matrix" : "Find plan"}
          </button>
        </fieldset>
      </form>

      {err && <div className="rounded bg-red-100 dark:bg-red-900/40 text-red-800 dark:text-red-200 p-3 mb-4">{err}</div>}

      {resp && mode === "matrix" && (
        <Results
          resp={resp}
          dialogs={dialogs}
          onToggle={toggleDialog}
          onFocus={focusDialog}
          onMove={moveDialog}
          onClose={closeDialog}
        />
      )}
      {plan && mode === "plan" && <PlanView plan={plan} />}
    </main>
  );
}

function PlanView({ plan }: { plan: OptimizePlan }) {
  const scenario = plan.plan;
  const bracketLabel = `${(plan.target_bracket_rate * 100).toFixed(0)}%`;
  const irmaaApplied = plan.respect_irmaa && (plan.irmaa_tiers ?? []).length > 0;
  return (
    <div>
      <h2 className="text-xl font-semibold mb-3">
        Bracket-fill plan: fill the {bracketLabel} bracket each year (top ${plan.target_bracket_top.toLocaleString()})
      </h2>
      <p className="text-xs text-gray-500 dark:text-gray-400 mb-3">
        Single deterministic plan at {fmtPct(scenario.rate_of_return)} rate of return.
        Each year converts as much as fits below the {bracketLabel} bracket top (post-deduction, after any RMD),
        capped by what remains in Traditional.
        {irmaaApplied && (
          <>
            {" "}With <strong>respect IRMAA</strong> on, conversions at age 63+ are
            additionally capped to keep MAGI below the standard tier (zero
            Medicare surcharge two years later).
          </>
        )}
        {" "}Total converted: <strong>{fmtMoney(scenario.summary.total_converted)}</strong>.
        {(scenario.summary.total_irmaa_surcharge ?? 0) > 0 && (
          <>
            {" "}Total IRMAA surcharge: <strong>{fmtMoney(scenario.summary.total_irmaa_surcharge ?? 0)}</strong>.
          </>
        )}
      </p>
      <BracketChart
        baseline={scenario}
        selected={null}
        brackets={plan.brackets}
        stdDeduction={plan.standard_deduction}
        irmaaTiers={plan.irmaa_tiers}
      />
      <YearTable scenario={scenario} />
    </div>
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

function MatrixCellRow({ label, value, first }: { label: string; value: number; first?: boolean }) {
  return (
    <>
      <div className={`text-xs text-gray-500 dark:text-gray-400${first ? "" : " mt-1"}`}>{label}</div>
      <div className="font-semibold">{fmtMoney(value)}</div>
    </>
  );
}

function PerYearAdvanced({
  form,
  setForm,
  mode,
}: {
  form: FormState;
  setForm: (f: FormState) => void;
  mode: Mode;
}) {
  function ensureLength(arr: number[], scalar: number): number[] {
    const out = arr.slice(0, form.horizon_years);
    while (out.length < form.horizon_years) out.push(scalar);
    return out;
  }

  function toggle(checked: boolean) {
    if (checked) {
      setForm({
        ...form,
        per_year_advanced: true,
        other_income_per_year: ensureLength(form.other_income_per_year, form.annual_other_income),
        ss_benefit_per_year: ensureLength(form.ss_benefit_per_year, form.annual_ss_benefit),
        rates_per_year: ensureLength(form.rates_per_year, form.rate_of_return),
      });
    } else {
      setForm({ ...form, per_year_advanced: false });
    }
  }

  function setAt(arr: number[], i: number, v: number): number[] {
    const out = ensureLength(arr, 0);
    out[i] = v;
    return out;
  }

  return (
    <div className="mt-3 mb-3">
      <label className="flex items-start gap-2 text-sm">
        <input
          type="checkbox"
          className="mt-0.5"
          checked={form.per_year_advanced}
          onChange={(e) => toggle(e.target.checked)}
        />
        <span>
          <span>Advanced: edit per-year inputs</span>
          <Hint>
            Override the scalar Other income / SS benefit{mode === "plan" ? " / Rate of return" : ""}
            {" "}with one value per horizon year. Defaults populate from the
            scalar values above. Useful when pension or SS starts mid-horizon, or
            for sequence-of-returns scenarios.
          </Hint>
        </span>
      </label>
      {form.per_year_advanced && (
        <div className="overflow-x-auto mt-2 border border-gray-200 dark:border-gray-700 rounded p-2">
          <table className="text-xs">
            <thead>
              <tr className="text-left text-gray-500 dark:text-gray-400">
                <th className="pr-2">Year</th>
                <th className="pr-2">Other income</th>
                <th className="pr-2">SS benefit</th>
                {mode === "plan" && <th className="pr-2">Rate of return (%)</th>}
              </tr>
            </thead>
            <tbody>
              {Array.from({ length: form.horizon_years }, (_, i) => i).map((i) => (
                <tr key={i}>
                  <td className="pr-2 align-middle">{form.tax_year + i}</td>
                  <td className="pr-2">
                    <input
                      type="number"
                      className="border border-gray-300 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100 rounded p-1 w-24"
                      value={form.other_income_per_year[i] ?? form.annual_other_income}
                      onChange={(e) =>
                        setForm({
                          ...form,
                          other_income_per_year: setAt(form.other_income_per_year, i, Number(e.target.value)),
                        })
                      }
                    />
                  </td>
                  <td className="pr-2">
                    <input
                      type="number"
                      className="border border-gray-300 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100 rounded p-1 w-24"
                      value={form.ss_benefit_per_year[i] ?? form.annual_ss_benefit}
                      onChange={(e) =>
                        setForm({
                          ...form,
                          ss_benefit_per_year: setAt(form.ss_benefit_per_year, i, Number(e.target.value)),
                        })
                      }
                    />
                  </td>
                  {mode === "plan" && (
                    <td className="pr-2">
                      <input
                        type="number"
                        step={0.1}
                        className="border border-gray-300 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100 rounded p-1 w-20"
                        value={(((form.rates_per_year[i] ?? form.rate_of_return) * 100)).toFixed(1)}
                        onChange={(e) =>
                          setForm({
                            ...form,
                            rates_per_year: setAt(form.rates_per_year, i, Number(e.target.value) / 100),
                          })
                        }
                      />
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
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
  const hasIRMAA = resp.scenarios.some(
    (s) => (s.summary.total_irmaa_surcharge ?? 0) > 0,
  );
  const hasTaxableSS = resp.scenarios.some(
    (s) => (s.summary.total_taxable_ss ?? 0) > 0,
  );
  const hasNIIT = resp.scenarios.some(
    (s) => (s.summary.total_niit ?? 0) > 0,
  );
  const hasACA = resp.scenarios.some(
    (s) => (s.summary.total_aca_penalty ?? 0) > 0,
  );
  const hasStockSaleTax = resp.scenarios.some(
    (s) => (s.summary.total_stock_sale_tax ?? 0) > 0,
  );

  const headingRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    headingRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [resp]);

  return (
    <div>
      <h2 ref={headingRef} className="text-xl font-semibold mb-3 scroll-mt-4">Comparison: total tax paid and ending balance after horizon</h2>
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
                        <MatrixCellRow label={hasStateTax || hasIRMAA ? "fed tax" : "tax"} value={s.summary.total_federal_tax} first />
                        {hasStateTax && <MatrixCellRow label="state tax" value={s.summary.total_state_tax} />}
                        {hasIRMAA && <MatrixCellRow label="IRMAA" value={s.summary.total_irmaa_surcharge ?? 0} />}
                        {hasNIIT && <MatrixCellRow label="NIIT" value={s.summary.total_niit ?? 0} />}
                        {hasACA && <MatrixCellRow label="ACA penalty" value={s.summary.total_aca_penalty ?? 0} />}
                        {hasStockSaleTax && <MatrixCellRow label="stock sale tax" value={s.summary.total_stock_sale_tax ?? 0} />}
                        {hasTaxableSS && <MatrixCellRow label="taxable SS" value={s.summary.total_taxable_ss ?? 0} />}
                        <MatrixCellRow label="end total" value={s.summary.ending_total} />
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
            irmaaTiers={resp.irmaa_tiers}
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

function OrderedLegend({ seriesKeys }: { seriesKeys: string[] }) {
  return (
    <ul className="flex flex-wrap justify-center gap-x-3 gap-y-1 text-[11px] mt-1 px-2">
      {seriesKeys.map((k, i) => (
        <li key={k} className="flex items-center gap-1">
          <span
            className="inline-block w-3 h-3 rounded-sm"
            style={{ backgroundColor: SERIES_COLORS[i % SERIES_COLORS.length] }}
          />
          <span>{k}</span>
        </li>
      ))}
    </ul>
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
          <Legend
            wrapperStyle={{ fontSize: 11 }}
            content={() => <OrderedLegend seriesKeys={seriesKeys} />}
          />
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
  irmaaTiers,
  onFocus,
  onMove,
  onClose,
}: {
  dialog: DialogState;
  scenario: Scenario;
  baseline: Scenario | null;
  brackets: Bracket[];
  stdDeduction: number;
  irmaaTiers?: IRMAATier[];
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
            irmaaTiers={irmaaTiers}
          />
        )}
        <YearTable scenario={scenario} />
      </div>
    </div>
  );
}

interface ChartRow {
  year: number;
  age: number;
  baseline: number;
  selected: number | null;
  baseline_irmaa_tier?: string;
  selected_irmaa_tier?: string;
}

function BracketChart({
  baseline,
  selected,
  brackets,
  stdDeduction,
  irmaaTiers,
}: {
  baseline: Scenario;
  selected: Scenario | null;
  brackets: Bracket[];
  stdDeduction: number;
  irmaaTiers?: IRMAATier[];
}) {
  const data: ChartRow[] = useMemo(() => {
    return baseline.years.map((y, i) => {
      const sy = selected?.years[i];
      return {
        year: y.calendar_year,
        age: y.age,
        baseline: Math.max(0, y.taxable_income - stdDeduction),
        selected: sy ? Math.max(0, sy.taxable_income - stdDeduction) : null,
        baseline_irmaa_tier: y.irmaa_tier_label,
        selected_irmaa_tier: sy?.irmaa_tier_label,
      };
    });
  }, [baseline, selected, stdDeduction]);

  const refLines = useMemo(() => brackets.filter((b) => b.max > 0), [brackets]);
  // IRMAA tier tops shifted to post-std-deduction so they share the chart's
  // Y-axis with the federal bracket lines (MAGI ~= taxable_income pre-deduction
  // for our model; subtracting stdDeduction puts them on the same scale).
  const irmaaRefLines = useMemo(
    () =>
      (irmaaTiers ?? [])
        .filter((t) => t.max_magi > 0)
        .map((t) => ({ ...t, plotY: Math.max(0, t.max_magi - stdDeduction) })),
    [irmaaTiers, stdDeduction],
  );

  const yMax = useMemo(() => {
    let v = 0;
    for (const row of data) {
      if (row.baseline > v) v = row.baseline;
      if (row.selected !== null && row.selected > v) v = row.selected;
    }
    for (const b of refLines) {
      if (b.max > v) v = b.max;
    }
    for (const t of irmaaRefLines) {
      if (t.plotY > v) v = t.plotY;
    }
    return v * 1.1;
  }, [data, refLines, irmaaRefLines]);

  return (
    <div className="border border-amber-200 dark:border-amber-800 rounded p-3 mb-6 bg-white dark:bg-gray-900">
      <ResponsiveContainer width="100%" height={320}>
        <LineChart data={data} margin={{ top: 12, right: 56, left: 16, bottom: 8 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#eee" />
          <XAxis dataKey="year" tick={{ fontSize: 12 }} />
          <YAxis
            tick={{ fontSize: 12 }}
            tickFormatter={(v: number) => fmtMoney(v)}
            domain={[0, yMax]}
          />
          <Tooltip
            content={(props) => <BracketTooltip {...(props as TooltipPayload)} selected={selected} />}
          />
          <Legend wrapperStyle={{ fontSize: 12 }} />
          {refLines.map((b) => (
            <ReferenceLine
              key={`fed-${b.rate}`}
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
          {irmaaRefLines.map((t) => (
            <ReferenceLine
              key={`irmaa-${t.label}`}
              y={t.plotY}
              stroke="#a855f7"
              strokeDasharray="2 4"
              label={{
                value: `IRMAA ${t.label}`,
                position: "left",
                fontSize: 10,
                fill: "#a855f7",
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
        Gray dashed lines show federal bracket tops; purple dashed lines show IRMAA tier tops
        (MAGI threshold minus standard deduction, since MAGI ~= taxable income pre-deduction
        in this calculator). Tooltip shows the IRMAA tier the user is in for years 65+.
      </p>
    </div>
  );
}

interface TooltipPayload {
  active?: boolean;
  label?: string | number;
  payload?: ReadonlyArray<{ name?: string; value?: number; color?: string; dataKey?: string | number; payload?: ChartRow }>;
}

function BracketTooltip({
  active,
  label,
  payload,
  selected,
}: TooltipPayload & { selected: Scenario | null }) {
  if (!active || !payload || payload.length === 0) return null;
  const row = payload[0].payload;
  if (!row) return null;
  return (
    <div className="rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 p-2 text-xs shadow">
      <div className="font-semibold mb-1">Year {String(label)} (age {row.age})</div>
      {payload.map((p, i) => (
        <div key={`${p.dataKey ?? i}`} style={{ color: p.color }}>
          {p.name ?? p.dataKey}: {p.value === null || p.value === undefined ? "-" : fmtMoney(Number(p.value))}
        </div>
      ))}
      {row.baseline_irmaa_tier && (
        <div className="mt-1 text-[#a855f7]">
          IRMAA (baseline): {row.baseline_irmaa_tier}
        </div>
      )}
      {selected && row.selected_irmaa_tier && (
        <div className="text-[#a855f7]">
          IRMAA (selected): {row.selected_irmaa_tier}
        </div>
      )}
    </div>
  );
}

function YearTable({ scenario }: { scenario: Scenario }) {
  const hasTaxableSS = scenario.years.some((y) => (y.taxable_ss ?? 0) > 0);
  const hasIRMAA = scenario.years.some((y) => (y.irmaa_surcharge ?? 0) > 0);
  const hasNIIT = scenario.years.some((y) => (y.niit ?? 0) > 0);
  const hasACA = scenario.years.some((y) => (y.aca_penalty ?? 0) > 0);
  const hasStockSaleTax = scenario.years.some((y) => (y.stock_sale_tax ?? 0) > 0);
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
        {(scenario.summary.total_irmaa_surcharge ?? 0) > 0 && (
          <>
            {" "}
            + IRMAA <strong>{fmtMoney(scenario.summary.total_irmaa_surcharge ?? 0)}</strong>
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
              {hasTaxableSS && <th className="p-2 text-left font-semibold">Taxable SS</th>}
              <th className="p-2 text-left font-semibold">Taxable</th>
              <th className="p-2 text-left font-semibold">Federal tax</th>
              <th className="p-2 text-left font-semibold">State tax</th>
              {hasIRMAA && <th className="p-2 text-left font-semibold">IRMAA</th>}
              {hasNIIT && <th className="p-2 text-left font-semibold">NIIT</th>}
              {hasACA && <th className="p-2 text-left font-semibold">ACA penalty</th>}
              {hasStockSaleTax && <th className="p-2 text-left font-semibold">Stock sale tax</th>}
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
                {hasTaxableSS && (
                  <td className="p-2 border-b border-amber-100 dark:border-amber-800/40">{(y.taxable_ss ?? 0) > 0 ? fmtMoney(y.taxable_ss ?? 0) : "-"}</td>
                )}
                <td className="p-2 border-b border-amber-100 dark:border-amber-800/40">{fmtMoney(y.taxable_income)}</td>
                <td className="p-2 border-b border-amber-100 dark:border-amber-800/40">{fmtMoney(y.federal_tax)}</td>
                <td className="p-2 border-b border-amber-100 dark:border-amber-800/40">{y.state_tax > 0 ? fmtMoney(y.state_tax) : "-"}</td>
                {hasIRMAA && (
                  <td className="p-2 border-b border-amber-100 dark:border-amber-800/40 text-purple-600 dark:text-purple-400">{(y.irmaa_surcharge ?? 0) > 0 ? fmtMoney(y.irmaa_surcharge ?? 0) : "-"}</td>
                )}
                {hasNIIT && (
                  <td className="p-2 border-b border-amber-100 dark:border-amber-800/40">{(y.niit ?? 0) > 0 ? fmtMoney(y.niit ?? 0) : "-"}</td>
                )}
                {hasACA && (
                  <td className="p-2 border-b border-amber-100 dark:border-amber-800/40 text-red-600 dark:text-red-400">{(y.aca_penalty ?? 0) > 0 ? fmtMoney(y.aca_penalty ?? 0) : "-"}</td>
                )}
                {hasStockSaleTax && (
                  <td className="p-2 border-b border-amber-100 dark:border-amber-800/40 text-orange-600 dark:text-orange-400">{(y.stock_sale_tax ?? 0) > 0 ? fmtMoney(y.stock_sale_tax ?? 0) : "-"}</td>
                )}
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
