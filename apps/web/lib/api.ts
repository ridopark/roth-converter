export type FilingStatus = "single" | "mfj" | "hoh" | "mfs";

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
}

export interface ScenarioSummary {
  total_federal_tax: number;
  total_state_tax: number;
  total_converted: number;
  total_rmd: number;
  ending_total: number;
  ending_traditional: number;
  ending_roth: number;
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

export interface MatrixResponse {
  scenarios: Scenario[];
  brackets: Bracket[];
  standard_deduction: number;
  state_tax_rate: number;
}

export const US_STATES: { code: string; name: string; rate?: number; noTax?: boolean }[] = [
  { code: "", name: "None / not listed (0%)" },
  { code: "AK", name: "Alaska", noTax: true },
  { code: "AZ", name: "Arizona", rate: 0.025 },
  { code: "CA", name: "California", rate: 0.133 },
  { code: "CO", name: "Colorado", rate: 0.044 },
  { code: "DC", name: "District of Columbia", rate: 0.1075 },
  { code: "FL", name: "Florida", noTax: true },
  { code: "GA", name: "Georgia", rate: 0.0539 },
  { code: "HI", name: "Hawaii", rate: 0.11 },
  { code: "IL", name: "Illinois", rate: 0.0495 },
  { code: "IN", name: "Indiana", rate: 0.03 },
  { code: "MA", name: "Massachusetts", rate: 0.09 },
  { code: "MD", name: "Maryland", rate: 0.0575 },
  { code: "MI", name: "Michigan", rate: 0.0425 },
  { code: "MN", name: "Minnesota", rate: 0.0985 },
  { code: "MS", name: "Mississippi", rate: 0 },
  { code: "NC", name: "North Carolina", rate: 0.0399 },
  { code: "NH", name: "New Hampshire", noTax: true },
  { code: "NJ", name: "New Jersey", rate: 0.1075 },
  { code: "NV", name: "Nevada", noTax: true },
  { code: "NY", name: "New York", rate: 0.109 },
  { code: "OH", name: "Ohio", rate: 0.035 },
  { code: "OR", name: "Oregon", rate: 0.099 },
  { code: "PA", name: "Pennsylvania", rate: 0 },
  { code: "SD", name: "South Dakota", noTax: true },
  { code: "TN", name: "Tennessee", noTax: true },
  { code: "TX", name: "Texas", noTax: true },
  { code: "VA", name: "Virginia", rate: 0.0575 },
  { code: "VT", name: "Vermont", rate: 0.0875 },
  { code: "WA", name: "Washington", noTax: true },
  { code: "WY", name: "Wyoming", noTax: true },
];

const BACKEND = process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:8090";

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
