export type FilingStatus = "single" | "mfj" | "hoh" | "mfs";

export interface StockLot {
  cost_basis: number;
  current_value: number;
  gain_type: "lt" | "st";
}

export interface MatrixRequest {
  age: number;
  birth_year: number;
  total_401k: number;
  traditional_pct: number;
  roth_pct: number;
  filing_status: FilingStatus;
  annual_other_income: number;
  horizon_years: number;
  rates_of_return: number[];
  conversion_cases: number[];
  include_rmd: boolean;
  tax_year: number;
  state: string;
  annual_ss_benefit?: number;
  magi_two_years_ago?: number;
  magi_one_year_ago?: number;
  taxable_div_ltcg?: number;
  aca_household_size?: number;
  aca_annual_premium?: number;
  other_income_per_year?: number[];
  ss_benefit_per_year?: number[];
  taxable_div_ltcg_per_year?: number[];
  tax_funding_source?: "external" | "traditional";
  stock_lots?: StockLot[];
}

export interface ScenarioYear {
  year_index: number;
  calendar_year: number;
  age: number;
  starting_traditional: number;
  starting_roth: number;
  rmd: number;
  conversion: number;
  taxable_income: number;
  federal_tax: number;
  state_tax: number;
  ending_traditional: number;
  ending_roth: number;
  ending_total: number;
  taxable_ss?: number;
  irmaa_surcharge?: number;
  magi?: number;
  irmaa_tier_label?: string;
  niit?: number;
  aca_penalty?: number;
  stock_sale_tax?: number;
}

export interface ScenarioSummary {
  total_federal_tax: number;
  total_state_tax: number;
  total_converted: number;
  total_rmd: number;
  ending_total: number;
  ending_traditional: number;
  ending_roth: number;
  total_taxable_ss?: number;
  total_irmaa_surcharge?: number;
  total_niit?: number;
  total_aca_penalty?: number;
  total_stock_sale_tax?: number;
}

export interface Scenario {
  rate_of_return: number;
  conversion_amount: number;
  years: ScenarioYear[];
  summary: ScenarioSummary;
}

export interface Bracket {
  rate: number;
  max: number;
}

export interface IRMAATier {
  label: string;
  max_magi: number;
  annual_surcharge_per_person: number;
}

export interface MatrixResponse {
  scenarios: Scenario[];
  brackets: Bracket[];
  standard_deduction: number;
  state_tax_rate: number;
  irmaa_tiers?: IRMAATier[];
}

const STATE_NAMES: Record<string, string> = {
  AK: "Alaska", AL: "Alabama", AR: "Arkansas", AZ: "Arizona", CA: "California",
  CO: "Colorado", CT: "Connecticut", DC: "District of Columbia", DE: "Delaware",
  FL: "Florida", GA: "Georgia", HI: "Hawaii", IA: "Iowa", ID: "Idaho",
  IL: "Illinois", IN: "Indiana", KS: "Kansas", KY: "Kentucky", LA: "Louisiana",
  MA: "Massachusetts", MD: "Maryland", ME: "Maine", MI: "Michigan", MN: "Minnesota",
  MO: "Missouri", MS: "Mississippi", MT: "Montana", NC: "North Carolina",
  ND: "North Dakota", NE: "Nebraska", NH: "New Hampshire", NJ: "New Jersey",
  NM: "New Mexico", NV: "Nevada", NY: "New York", OH: "Ohio", OK: "Oklahoma",
  OR: "Oregon", PA: "Pennsylvania", RI: "Rhode Island", SC: "South Carolina",
  SD: "South Dakota", TN: "Tennessee", TX: "Texas", UT: "Utah", VA: "Virginia",
  VT: "Vermont", WA: "Washington", WI: "Wisconsin", WV: "West Virginia",
  WY: "Wyoming",
};

export interface StateOption {
  code: string;
  name: string;
  rate?: number;
  noTax?: boolean;
}

const BACKEND = process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:8090";

export interface StatesResponse {
  no_tax: string[];
  rates: Record<string, number>;
}

export async function getStates(year: number): Promise<StatesResponse> {
  const r = await fetch(`${BACKEND}/states?year=${year}`);
  if (!r.ok) throw new Error(`states request failed: ${r.status}`);
  return r.json();
}

export function buildStateOptions(s: StatesResponse): StateOption[] {
  const codes = new Set<string>([...s.no_tax, ...Object.keys(s.rates)]);
  const options: StateOption[] = [{ code: "", name: "None / not listed (0%)" }];
  for (const code of Array.from(codes).sort()) {
    const noTax = s.no_tax.includes(code);
    options.push({
      code,
      name: STATE_NAMES[code] ?? code,
      rate: noTax ? undefined : s.rates[code],
      noTax,
    });
  }
  return options;
}


export type OptimizeRequest = Omit<MatrixRequest, "rates_of_return" | "conversion_cases"> & {
  rate_of_return: number;
  target_bracket_rate: number;
  respect_irmaa?: boolean;
  strategy?: "bracket_fill" | "dp";
  rates_per_year?: number[];
};

export interface OptimizePlan {
  plan: Scenario;
  brackets: Bracket[];
  standard_deduction: number;
  state_tax_rate: number;
  target_bracket_rate: number;
  target_bracket_top: number;
  irmaa_tiers?: IRMAATier[];
  respect_irmaa?: boolean;
  strategy?: string;
}

export async function postOptimize(req: OptimizeRequest): Promise<OptimizePlan> {
  const r = await fetch(`${BACKEND}/optimize`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(req),
  });
  if (!r.ok) {
    const text = await r.text();
    throw new Error(`optimize request failed: ${r.status} ${text}`);
  }
  return r.json();
}

export async function postMatrix(req: MatrixRequest): Promise<MatrixResponse> {
  const r = await fetch(`${BACKEND}/matrix`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(req),
  });
  if (!r.ok) {
    const text = await r.text();
    throw new Error(`matrix request failed: ${r.status} ${text}`);
  }
  return r.json();
}

export interface BracketsResponse {
  brackets: Bracket[];
  standard_deduction: number;
}

export async function getBrackets(status: FilingStatus, year: number): Promise<BracketsResponse> {
  const r = await fetch(`${BACKEND}/brackets?status=${status}&year=${year}`);
  if (!r.ok) throw new Error(`brackets request failed: ${r.status}`);
  return r.json();
}

export function pingVisit(): void {
  if (typeof window === "undefined") return;
  if (BACKEND.includes("localhost")) return;
  fetch(`${BACKEND}/visit`, { method: "POST", keepalive: true }).catch(() => {});
}

export function fmtMoney(n: number): string {
  if (Math.abs(n) >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`;
  if (Math.abs(n) >= 1_000) return `$${(n / 1_000).toFixed(0)}k`;
  return `$${Math.round(n)}`;
}

export function fmtPct(n: number): string {
  return `${(n * 100).toFixed(0)}%`;
}

export function parseAmountList(s: string): number[] {
  return s
    .split(/[,\s]+/)
    .map((t) => t.trim())
    .filter((t) => t.length > 0)
    .map((t) => Number(t.replace(/[$,_]/g, "")))
    .filter((n) => !Number.isNaN(n) && n >= 0);
}

export function withBaselineCase(cases: number[]): number[] {
  const seen = new Set<number>();
  const out: number[] = [];
  for (const c of cases) {
    if (!seen.has(c)) {
      seen.add(c);
      out.push(c);
    }
  }
  if (!seen.has(0)) out.push(0);
  out.sort((a, b) => a - b);
  return out;
}

export function parseRateList(s: string): number[] {
  return s
    .split(/[,\s]+/)
    .map((t) => t.trim())
    .filter((t) => t.length > 0)
    .map((t) => {
      const v = Number(t.replace(/%/g, ""));
      return v > 1 ? v / 100 : v;
    })
    .filter((n) => !Number.isNaN(n) && n >= 0);
}
