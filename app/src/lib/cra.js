// CRA filing reference: which forms a return is actually made of, which version
// of each one applies to a given tax year, and when it is due.
//
// Why version years matter. CRA does not reissue every schedule every year. It
// reissues one when the law behind it changes, and the reissued form is headed
// "(20XX and later tax years)". So the correct copy of a schedule for a tax year
// is the newest issue whose year is not after that tax year. Two consequences
// the app has to get right:
//
//   · A 2023 return and a 2025 return are assembled from different stacks. For
//     tax year 2023 Schedule 1 is the 2019 issue; for 2024 and later it is the
//     2024 issue. Handing an accountant the current PDF for an older year is a
//     real error, not a cosmetic one.
//   · Some schedules do not exist before a given year at all (Schedule 130 for
//     EIFEL, the clean economy credits), and some stopped (Schedule 65).
//
// Version lists below are the issue years CRA publishes on each form's page.
// Source: canada.ca/en/revenue-agency/services/forms-publications/forms.html
// (verified against the individual form pages).
//
// Nothing here is advice. Every conditional schedule carries the plain-language
// trigger CRA states, so the user or their accountant decides, not this file.

export const CRA_FORMS_INDEX = "https://www.canada.ca/en/revenue-agency/services/forms-publications/forms.html";
const DAM = "https://www.canada.ca/content/dam/cra-arc/formspubs/pbg";

/** Two digit CRA revision suffix: 2019 -> "19", 1999 -> "99". */
const yy = (year) => String(year).slice(-2);

/** Direct link to a specific issue of a form. */
export function formUrl(slug, versionYear, { fillable = true } = {}) {
  const base = `${DAM}/${slug}/${slug}`;
  return fillable ? `${base}-fill-${yy(versionYear)}e.pdf` : `${base}-${yy(versionYear)}e.pdf`;
}

/** The form's own page on canada.ca, which lists every issue. */
export const formPage = (slug) =>
  `https://www.canada.ca/en/revenue-agency/services/forms-publications/forms/${slug}.html`;

/**
 * The issue of a form that a given tax year files on: the newest issue not
 * later than the tax year. Returns null when the form did not exist yet.
 */
export function versionFor(form, taxYear) {
  const years = [...(form.versions || [])].sort((a, b) => b - a);
  const hit = years.find((y) => y <= taxYear);
  if (hit) return { year: hit, current: hit === years[0], superseded: null };
  // Nothing at or below the tax year: the form is newer than the return.
  return null;
}

/* ================= the T2 package =================
   `need` is why the form is in the return:
     always  · every T2 filer files it
     usually · a small Canadian-controlled private corporation almost always does
     if      · only when the trigger is true, which is written out in `when`   */

export const T2_PACKAGE = [
  {
    code: "T2", slug: "t2", name: "Corporation Income Tax Return",
    versions: [2026, 2025, 2024, 2023, 2022, 2021, 2020, 2019],
    need: "always",
    when: "The return itself. Nine pages of identification, income, tax, and the summary of everything below.",
  },
  {
    code: "T2 Short", slug: "t2short", name: "T2 Short Return",
    versions: [2019, 2017, 2016, 2015, 2013, 2012, 2011, 2010],
    need: "if",
    when: "A two page alternative, open only to a CCPC with a nil or loss year and no complications, or a tax exempt corporation. Most corporations cannot use it. Filing it when you do not qualify means refiling.",
  },
  {
    code: "S100", slug: "t2sch100", name: "Balance Sheet Information (GIFI)",
    versions: [2020, 2018, 2014, 2008, 2006, 2000, 1998],
    need: "always",
    when: "Assets, liabilities, and equity in GIFI codes. This ledger tracks cash movement, not a balance sheet, so these figures come from you or your accountant.",
    fromLedger: false,
  },
  {
    code: "S125", slug: "t2sch125", name: "Income Statement Information (GIFI)",
    versions: [2023, 2020, 2019, 2018, 2014, 2011, 2008, 2006],
    need: "always",
    when: "Revenue and expenses in GIFI codes. This is the schedule Brasstally drafts for you from the year's entries.",
    fromLedger: true,
  },
  {
    code: "S141", slug: "t2sch141", name: "GIFI Additional Information (notes checklist)",
    versions: [2023, 2020, 2018, 2014, 2012, 2011, 2008, 2005],
    need: "always",
    when: "Who prepared the financial statements and on what basis. Short, but the return is incomplete without it.",
  },
  {
    code: "S1", slug: "t2sch1", name: "Net Income (Loss) for Income Tax Purposes",
    versions: [2025, 2024, 2019, 2017, 2016, 2015, 2012, 2010, 2009, 2008, 2006, 2001],
    need: "always",
    when: "Reconciles accounting profit to taxable profit: adds back what is not deductible, such as the non deductible half of meals, amortization, and reserves.",
  },
  {
    code: "S8", slug: "t2sch8", name: "Capital Cost Allowance (CCA)",
    versions: [2026, 2024, 2022, 2020, 2019, 2017, 2014, 2011],
    need: "usually",
    when: "Depreciation for tax. Needed if the corporation owns anything with a life beyond the year: computers, vehicles, equipment, leaseholds, software.",
  },
  {
    code: "S7", slug: "t2sch7", name: "Aggregate Investment Income and Income Eligible for the Small Business Deduction",
    versions: [2025, 2021, 2019, 2017, 2015, 2014, 2012, 2009],
    need: "usually",
    when: "Required for a CCPC claiming the small business deduction, and it is where passive investment income grinds that deduction down.",
  },
  {
    code: "S50", slug: "t2sch50", name: "Shareholder Information",
    versions: [2019, 2006, 2005, 1999, 1998],
    need: "usually",
    when: "Required of a private corporation for every shareholder holding 10% or more of any class of shares.",
  },
  {
    code: "S88", slug: "t2sch88", name: "Internet Business Activities",
    versions: [2020],
    need: "usually",
    when: "Required if the corporation earns any income through a web page, app, or online marketplace. Most software and service businesses do.",
  },
  {
    code: "S3", slug: "t2sch3", name: "Dividends Received, Taxable Dividends Paid, and Part IV Tax",
    versions: [2025, 2022, 2021, 2020, 2019, 2016, 2010, 2005],
    need: "if",
    when: "If the corporation received dividends, or paid any to its shareholders during the year.",
  },
  {
    code: "S4", slug: "t2sch4", name: "Corporation Loss Continuity and Application",
    versions: [2025, 2021, 2015, 2014, 2011, 2010, 2007, 2006],
    need: "if",
    when: "If there are losses from an earlier year being carried forward, or this year's loss is being carried back.",
  },
  {
    code: "S5", slug: "t2sch5", name: "Tax Calculation Supplementary, Corporations",
    versions: [2026, 2025, 2024, 2023, 2022, 2021, 2020, 2019],
    need: "if",
    when: "If the corporation has a permanent establishment in more than one province or territory, or is claiming a provincial or territorial credit.",
  },
  {
    code: "S9", slug: "t2sch9", name: "Related and Associated Corporations",
    versions: [2011, 1999, 1998],
    need: "if",
    when: "If the corporation is related to or associated with any other corporation.",
  },
  {
    code: "S23", slug: "t2sch23", name: "Agreement Among Associated CCPCs to Allocate the Business Limit",
    versions: [2019, 2018, 2015, 2009, 2008, 2006, 2004, 2003],
    need: "if",
    when: "If associated CCPCs share one small business limit. Without this the limit is not allocated and the deduction is denied.",
  },
  {
    code: "S24", slug: "t2sch24", name: "First-time Filer After Incorporation, Amalgamation or Winding-up",
    versions: [2023, 2004, 1999, 1998],
    need: "if",
    when: "First return after incorporating, after an amalgamation, or after winding a subsidiary into a parent.",
  },
  {
    code: "S2", slug: "t2sch2", name: "Charitable Donations and Gifts",
    versions: [2023, 2020, 2019, 2018, 2016, 2007, 2005, 1999],
    need: "if",
    when: "If the corporation made donations to registered charities or other qualified donees.",
  },
  {
    code: "S6", slug: "t2sch6", name: "Summary of Dispositions of Capital Property",
    versions: [2024, 2021, 2019, 2014, 2010, 2008, 2007, 2006],
    need: "if",
    when: "If the corporation sold or otherwise disposed of capital property during the year.",
  },
  {
    code: "S11", slug: "t2sch11", name: "Transactions with Shareholders, Officers or Employees",
    versions: [2000, 1999, 1990],
    need: "if",
    when: "If the corporation transacted with a shareholder, officer, or employee other than paying ordinary salary.",
  },
  {
    code: "S13", slug: "t2sch13", name: "Continuity of Reserves",
    versions: [2022, 2011, 1999, 1998],
    need: "if",
    when: "If the corporation claimed reserves, for example on an amount receivable over more than one year.",
  },
  {
    code: "S53", slug: "t2sch53", name: "General Rate Income Pool (GRIP)",
    versions: [2022, 2019, 2015, 2009, 2008, 2007],
    need: "if",
    when: "If a CCPC designated any dividend as eligible. The GRIP balance is what allows that designation.",
  },
  {
    code: "S54", slug: "t2sch54", name: "Low Rate Income Pool (LRIP)",
    versions: [2024, 2021, 2019, 2017, 2015, 2007],
    need: "if",
    when: "If a corporation that is not a CCPC paid dividends.",
  },
  {
    code: "S55", slug: "t2sch55", name: "Part III.1 Tax on Excessive Eligible Dividend Designations",
    versions: [2019, 2015, 2011, 2007],
    need: "if",
    when: "If more was designated as an eligible dividend than the GRIP allowed.",
  },
  {
    code: "S27", slug: "t2sch27", name: "Canadian Manufacturing and Processing Profits Deduction",
    versions: [2022, 2019, 2017, 2015, 2011, 2008, 2006, 2004],
    need: "if",
    when: "If the corporation manufactures or processes goods for sale or lease in Canada.",
  },
  {
    code: "S31", slug: "t2sch31", name: "Investment Tax Credit, Corporations",
    versions: [2026, 2022, 2021, 2019, 2017, 2016, 2015, 2013],
    need: "if",
    when: "If claiming an investment tax credit, including SR&ED. The SR&ED claim itself is form T661 and has its own hard 18 month deadline.",
  },
  {
    code: "S49", slug: "t2sch49", name: "Agreement Among Associated CCPCs to Allocate the Expenditure Limit",
    versions: [2026, 2019, 2013, 2011, 2009, 2008, 2006, 2003],
    need: "if",
    when: "If associated CCPCs share the SR&ED expenditure limit.",
  },
  {
    code: "S12", slug: "t2sch12", name: "Resource-Related Deductions",
    versions: [2026, 2025, 2019, 2015, 2014, 2007, 2003, 2000],
    need: "if",
    when: "If the corporation has resource expenses: mining, oil and gas, or renewable and conservation expenses.",
  },
  {
    code: "S15", slug: "t2sch15", name: "Deferred Income Plans",
    versions: [2013, 2006, 1999, 1998],
    need: "if",
    when: "If the corporation contributed to a deferred profit sharing plan or a similar plan.",
  },
  {
    code: "S16", slug: "t2sch16", name: "Patronage Dividend Deduction",
    versions: [2021, 2020, 2015, 2009, 2006, 2004],
    need: "if",
    when: "If the corporation is a co-operative paying patronage dividends.",
  },
  {
    code: "S17", slug: "t2sch17", name: "Credit Union Deductions",
    versions: [2022, 2021, 2020, 2019, 2018, 2016, 2015, 2013],
    need: "if",
    when: "Credit unions only.",
  },
  {
    code: "S18", slug: "t2sch18", name: "Federal and Provincial or Territorial Capital Gains Refund",
    versions: [2019, 2017, 2010, 2009, 2003, 2000],
    need: "if",
    when: "Investment corporations and mutual fund corporations claiming a capital gains refund.",
  },
  {
    code: "S19", slug: "t2sch19", name: "Non-Resident Shareholder Information",
    versions: [2009, 1999, 1998],
    need: "if",
    when: "If any shareholder is not resident in Canada.",
  },
  {
    code: "S20", slug: "t2sch20", name: "Part XIV Additional Tax on Non-Resident Corporations",
    versions: [2017, 2014, 2011, 2009, 2008, 2007, 2002],
    need: "if",
    when: "Branch tax, for a non-resident corporation carrying on business in Canada.",
  },
  {
    code: "S21", slug: "t2sch21", name: "Federal and Provincial Foreign Income Tax Credits and Federal Logging Tax Credit",
    versions: [2026, 2019, 2014, 2010, 2009, 2006, 2005, 2001],
    need: "if",
    when: "If foreign tax was paid on foreign income, or logging tax was paid to a province.",
  },
  {
    code: "S25", slug: "t2sch25", name: "Investment in Foreign Affiliates",
    versions: [2020, 1999, 1998],
    need: "if",
    when: "If the corporation holds shares in a foreign affiliate. Form T1134 is usually required alongside it.",
  },
  {
    code: "S28", slug: "t2sch28", name: "Election Not to be Associated Through a Third Corporation",
    versions: [2018, 2008, 1998],
    need: "if",
    when: "If electing out of association that would otherwise arise only through a third corporation.",
  },
  {
    code: "S29", slug: "t2sch29", name: "Payments to Non-Residents",
    versions: [1999, 1998],
    need: "if",
    when: "If the corporation paid management fees, rent, royalties, or interest to a non-resident.",
  },
  {
    code: "S33", slug: "t2sch33", name: "Taxable Capital Employed in Canada, Large Corporations",
    versions: [2015, 2014, 2010, 2007, 2006, 2004, 2002, 1999],
    need: "if",
    when: "If total taxable capital employed in Canada is over $10 million. It is also what grinds the small business deduction between $10M and $50M.",
  },
  {
    code: "S42", slug: "t2sch42", name: "Calculation of Unused Part I Tax Credit",
    versions: [2021, 2010, 2007, 2002, 1999, 1998],
    need: "if",
    when: "If Part I tax credits are being carried over.",
  },
  {
    code: "S43", slug: "t2sch43", name: "Calculation of Parts IV.1 and VI.1 Taxes",
    versions: [2019, 2014, 2011, 2008, 2003, 1999],
    need: "if",
    when: "If taxable preferred or short term preferred shares were held or paid on.",
  },
  {
    code: "S44", slug: "t2sch44", name: "Non-Arm's Length Transactions",
    versions: [2007, 1999, 1998],
    need: "if",
    when: "If the corporation transacted with a person or company it does not deal with at arm's length.",
  },
  {
    code: "S56", slug: "t2sch56", name: "Part II.2 Tax on Repurchases of Equity",
    versions: [2024],
    need: "if",
    when: "Public corporations and certain trusts and partnerships buying back their own equity, for repurchases after 2023.",
  },
  {
    code: "S58", slug: "t2sch58", name: "Canadian Journalism Labour Tax Credit",
    versions: [2024, 2022, 2020],
    need: "if",
    when: "Qualifying journalism organisations. CRA's current issue is headed 2023 and later tax years.",
  },
  {
    code: "S59", slug: "t2sch59", name: "Information Return for Non-Qualified Securities",
    versions: [2021],
    need: "if",
    when: "If the corporation designated employee stock options as non-qualified securities.",
  },
  {
    code: "S63", slug: "t2sch63", name: "Return of Fuel Charge Proceeds to Farmers Tax Credit",
    versions: [2025, 2024, 2022],
    need: "if",
    when: "Farming businesses in a province where the federal fuel charge applied.",
  },
  {
    code: "S71", slug: "t2sch71", name: "Income Inclusion, Members of Single-Tier Partnerships",
    versions: [2019, 2015, 2014, 2012],
    need: "if",
    when: "If the corporation is a member of a partnership with a different fiscal period.",
  },
  {
    code: "S72", slug: "t2sch72", name: "Income Inclusion, Members of Multi-Tier Partnerships",
    versions: [2019, 2015, 2014, 2013],
    need: "if",
    when: "Same as Schedule 71, where the partnership sits under another partnership.",
  },
  {
    code: "S73", slug: "t2sch73", name: "Income Inclusion Summary, Members of Partnerships",
    versions: [2019, 2015, 2014, 2012],
    need: "if",
    when: "Summarises Schedules 71 and 72 when either is filed.",
  },
  {
    code: "S74", slug: "t2sch74", name: "Clean Hydrogen Investment Tax Credit",
    versions: [2024],
    need: "if",
    when: "Clean hydrogen projects. New in the 2024 stack, so it does not exist for earlier years.",
  },
  {
    code: "S75", slug: "t2sch75", name: "Clean Technology Investment Tax Credit",
    versions: [2026, 2025, 2024],
    need: "if",
    when: "Eligible clean technology property. New in the 2024 stack.",
  },
  {
    code: "S76", slug: "t2sch76", name: "Clean Technology Manufacturing Investment Tax Credit",
    versions: [2026],
    need: "if",
    when: "Clean technology manufacturing and critical mineral property.",
  },
  {
    code: "S78", slug: "t2sch78", name: "Carbon Capture, Utilization, and Storage Investment Tax Credit",
    versions: [2025, 2024],
    need: "if",
    when: "CCUS projects. New in the 2024 stack.",
  },
  {
    code: "S89", slug: "t2sch89", name: "Request for Capital Dividend Account Balance Verification",
    versions: [2022, 2021, 2020, 2018, 2016],
    need: "if",
    when: "Before paying a capital dividend, to have CRA confirm the CDA balance.",
  },
  {
    code: "S91", slug: "t2sch91", name: "Information Concerning Claims for Treaty-Based Exemptions",
    versions: [2021, 2014, 2011, 2008],
    need: "if",
    when: "If a non-resident corporation is claiming an exemption under a tax treaty.",
  },
  {
    code: "S97", slug: "t2sch97", name: "Additional Information on Non-Resident Corporations in Canada",
    versions: [2021, 2012, 2008, 2006, 2003],
    need: "if",
    when: "Non-resident corporations carrying on business in Canada.",
  },
  {
    code: "S130", slug: "t2sch130", name: "Excessive Interest and Financing Expenses Limitation (EIFEL)",
    versions: [2024],
    need: "if",
    when: "Interest and financing expense deductibility, for tax years beginning on or after 1 October 2023. There is a group de minimis of $1 million of net interest and financing expenses, and an exclusion for standalone and Canadian group CCPCs under $50 million of taxable capital, so most small corporations are outside it. This schedule does not exist in the 2023 and earlier stacks.",
  },
];

/* ---- provincial and territorial tax calculation ---- */
// Alberta and Quebec collect corporate tax themselves: Alberta form AT1 and
// Quebec form CO-17 are separate returns and are not part of the T2 package.

export const PROVINCIAL_T2 = {
  ON: { code: "S500", slug: "t2sch500", name: "Ontario Corporation Tax Calculation", versions: [2023, 2022, 2020, 2019, 2018, 2017, 2014, 2012] },
  BC: { code: "S427", slug: "t2sch427", name: "British Columbia Corporation Tax Calculation", versions: [2022, 2020, 2019, 2018, 2017, 2015, 2014, 2011] },
  MB: { code: "S383", slug: "t2sch383", name: "Manitoba Corporation Tax Calculation", versions: [2020, 2019, 2018, 2015, 2014, 2011, 2010, 2009] },
  SK: { code: "S411", slug: "t2sch411", name: "Saskatchewan Corporation Tax Calculation", versions: [2024, 2023, 2022, 2021, 2020, 2019, 2018, 2017] },
  NB: { code: "S366", slug: "t2sch366", name: "New Brunswick Corporation Tax Calculation", versions: [2022, 2020, 2019, 2018, 2017, 2016, 2015, 2014] },
  NS: { code: "S346", slug: "t2sch346", name: "Nova Scotia Corporation Tax Calculation", versions: [2025, 2022, 2020, 2019, 2017, 2014, 2012, 2011] },
  PE: { code: "S322", slug: "t2sch322", name: "Prince Edward Island Corporation Tax Calculation", versions: [2025, 2023, 2021, 2020, 2019, 2018, 2016, 2014] },
  NL: { code: "S307", slug: "t2sch307", name: "Newfoundland and Labrador Corporation Tax Calculation", versions: [2024, 2020, 2019, 2016, 2014, 2012] },
  YT: { code: "S443", slug: "t2sch443", name: "Yukon Corporation Tax Calculation", versions: [2022, 2020, 2019, 2014, 2011, 2010, 2009] },
  NT: { code: "S461", slug: "t2sch461", name: "Northwest Territories Corporation Tax Calculation", versions: [2023, 2020, 2019, 2017, 2012] },
  NU: { code: "S481", slug: "t2sch481", name: "Nunavut Corporation Tax Calculation", versions: [2021, 2020, 2019, 2017, 2012] },
  AB: null,
  QC: null,
};

export const PROVINCES = [
  ["ON", "Ontario"], ["BC", "British Columbia"], ["AB", "Alberta"], ["SK", "Saskatchewan"],
  ["MB", "Manitoba"], ["QC", "Quebec"], ["NB", "New Brunswick"], ["NS", "Nova Scotia"],
  ["PE", "Prince Edward Island"], ["NL", "Newfoundland and Labrador"],
  ["YT", "Yukon"], ["NT", "Northwest Territories"], ["NU", "Nunavut"],
];

export const SEPARATE_PROVINCIAL_RETURN = {
  AB: { name: "Alberta AT1", note: "Alberta collects its own corporate tax. File form AT1 with Alberta Tax and Revenue Administration, separately from the T2." },
  QC: { name: "Quebec CO-17", note: "Revenu Quebec collects its own corporate tax. File form CO-17 with Revenu Quebec, separately from the T2." },
};

/* ---- forms that travel with a T2 but are not schedules ---- */

export const T2_COMPANION_FORMS = [
  { code: "T183CORP", name: "Information Return for Corporations Filing Electronically", when: "Signed by an officer of the corporation before an accountant transmits the return. Not sent to CRA, but it must exist." },
  { code: "T661", name: "SR&ED Expenditures Claim", when: "If claiming SR&ED. Due 18 months after year end, and CRA cannot extend it." },
  { code: "T1134", name: "Information Return Relating to Controlled and Non-Controlled Foreign Affiliates", when: "If the corporation holds a foreign affiliate. Due 10 months after year end." },
  { code: "T1135", name: "Foreign Income Verification Statement", when: "If specified foreign property cost more than $100,000 at any point in the year." },
  { code: "T106", name: "Information Return of Non-Arm's Length Transactions with Non-Residents", when: "If non-arm's length transactions with non-residents exceeded $1,000,000." },
  { code: "T5013", name: "Partnership Information Return", when: "If the corporation is a member of a partnership that has to file." },
  { code: "RC59", name: "Business Consent for Offline Access", when: "Only if a representative needs offline access. Online authorisation through Represent a Client is the normal route." },
];

/* ---- the T1 package, for personal ledgers ---- */

export const T1_PACKAGE = [
  { code: "T1", name: "Income Tax and Benefit Return", need: "always", when: "The return itself, plus the provincial or territorial form for where you lived on 31 December." },
  { code: "Schedule 3", name: "Capital Gains (or Losses)", need: "if", when: "If you sold investments, property, or crypto during the year." },
  { code: "Schedule 5", name: "Amounts for Spouse and Dependants", need: "if", when: "If claiming amounts for a spouse, common law partner, or a dependant." },
  { code: "Schedule 6", name: "Canada Workers Benefit", need: "if", when: "If working income was low enough to qualify." },
  { code: "Schedule 7", name: "RRSP, PRPP and SPP Contributions and Transfers", need: "if", when: "If you contributed to an RRSP, or are carrying forward an unused contribution." },
  { code: "Schedule 8", name: "CPP Contributions and Overpayment", need: "usually", when: "Self employed income means CPP on both halves, calculated here." },
  { code: "Schedule 9", name: "Donations and Gifts", need: "if", when: "If you gave to registered charities." },
  { code: "Schedule 11", name: "Federal Tuition, Education and Textbook Amounts", need: "if", when: "If you paid tuition or have a carryforward." },
  { code: "T2125", name: "Statement of Business or Professional Activities", need: "if", when: "Self employment or freelance income. This is where the business side of this ledger lands." },
  { code: "T776", name: "Statement of Real Estate Rentals", need: "if", when: "If you rented out property." },
  { code: "T777", name: "Statement of Employment Expenses", need: "if", when: "If your employer signed a T2200 for expenses you had to pay yourself." },
  { code: "T2209", name: "Federal Foreign Tax Credits", need: "if", when: "If foreign tax was withheld on foreign income." },
  { code: "T1135", name: "Foreign Income Verification Statement", need: "if", when: "If specified foreign property cost more than $100,000 at any point in the year." },
  { code: "T2091", name: "Designation of a Property as a Principal Residence", need: "if", when: "If you sold your home, even when the whole gain is exempt." },
  { code: "T778", name: "Child Care Expenses Deduction", need: "if", when: "If you paid for child care so you could work or study." },
];

/**
 * The package for one tax year, with the issue of each form that year files on.
 *
 * @param taxYear   calendar year the fiscal year ends in, for a T2
 * @param province  two letter code, or null
 */
export function t2PackageFor(taxYear, province = null) {
  const rows = T2_PACKAGE.map((f) => {
    const v = versionFor(f, taxYear);
    return {
      ...f,
      version: v?.year ?? null,
      isCurrentIssue: Boolean(v?.current),
      url: v ? formUrl(f.slug, v.year) : null,
      page: formPage(f.slug),
      notYet: !v,
    };
  });

  const prov = province ? PROVINCIAL_T2[province] : undefined;
  if (prov) {
    const v = versionFor(prov, taxYear);
    rows.push({
      ...prov,
      need: "usually",
      when: `Provincial tax calculation for ${(PROVINCES.find(([k]) => k === province) || [])[1] || province}. Filed with the T2.`,
      version: v?.year ?? null,
      isCurrentIssue: Boolean(v?.current),
      url: v ? formUrl(prov.slug, v.year) : null,
      page: formPage(prov.slug),
      notYet: !v,
    });
  }
  return rows;
}

/**
 * What changed between two tax years' packages: forms that appear, disappear,
 * or sit on a different issue. This is the "2023 is a different stack from
 * 2024" answer, computed rather than asserted.
 */
export function stackDiff(fromYear, toYear, province = null) {
  const a = new Map(t2PackageFor(fromYear, province).map((f) => [f.code, f]));
  const b = new Map(t2PackageFor(toYear, province).map((f) => [f.code, f]));
  const added = [], dropped = [], moved = [];
  for (const [code, f] of b) {
    const prev = a.get(code);
    if (!prev || prev.notYet) { if (!f.notYet) added.push(f); continue; }
    if (!f.notYet && prev.version !== f.version) moved.push({ ...f, from: prev.version });
  }
  for (const [code, f] of a) {
    const next = b.get(code);
    if (!f.notYet && (!next || next.notYet)) dropped.push(f);
  }
  return { added, dropped, moved };
}

/* ================= deadlines ================= */

const MS_DAY = 86400000;
const parseISO = (s) => new Date(`${s}T00:00:00`);
export const isoDate = (d) => d.toISOString().slice(0, 10);

/** Whole days from today to an ISO date. Negative once it is past. */
export function daysUntil(iso, today = new Date()) {
  const t = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  return Math.round((parseISO(iso) - t) / MS_DAY);
}

const addMonthsISO = (iso, months) => {
  const d = parseISO(iso);
  const day = d.getDate();
  d.setMonth(d.getMonth() + months);
  // Clamp a rolled-over day, so 31 August plus 6 months is 28 February, not 3 March.
  if (d.getDate() !== day) d.setDate(0);
  return isoDate(d);
};

export const longDate = (iso) =>
  parseISO(iso).toLocaleDateString("en-CA", { month: "short", day: "numeric", year: "numeric" });

/** How to say a countdown in one phrase. */
export function countdown(days) {
  if (days < 0) return { text: `${Math.abs(days)} ${Math.abs(days) === 1 ? "day" : "days"} overdue`, tone: "late" };
  if (days === 0) return { text: "due today", tone: "late" };
  if (days === 1) return { text: "1 day left", tone: "soon" };
  if (days <= 30) return { text: `${days} days left`, tone: "soon" };
  if (days <= 92) return { text: `${days} days left`, tone: "ok" };
  return { text: `${days} days left`, tone: "far" };
}

/**
 * Corporate deadlines off a fiscal year end.
 *
 * The balance due date is two months after year end, and three for a CCPC that
 * claimed the small business deduction all year. The return itself is six
 * months after year end whether or not tax is owing. SR&ED is eighteen months
 * and cannot be extended.
 */
export function t2Deadlines(fyEndISO, { smallBusinessDeduction = true, sred = false } = {}) {
  const rows = [
    {
      id: "balance",
      date: addMonthsISO(fyEndISO, smallBusinessDeduction ? 3 : 2),
      title: "Balance owing due",
      sub: smallBusinessDeduction
        ? "3 months after year end for a CCPC claiming the small business deduction. Interest runs from this date."
        : "2 months after year end. Interest runs from this date.",
    },
    {
      id: "return",
      date: addMonthsISO(fyEndISO, 6),
      title: "T2 return due",
      sub: "6 months after year end. File even in a loss year, or the late filing penalty applies.",
    },
  ];
  if (sred) {
    rows.push({
      id: "sred",
      date: addMonthsISO(fyEndISO, 18),
      title: "SR&ED claim cutoff (T661)",
      sub: "18 months after year end. CRA cannot extend this one.",
    });
  }
  return rows.map((r) => ({ ...r, days: daysUntil(r.date) }));
}

/** Personal deadlines for a tax year. */
export function t1Deadlines(taxYear, { selfEmployed = false } = {}) {
  const y = taxYear + 1;
  const rows = [
    { id: "rrsp", date: `${y}-03-02`, title: "RRSP contribution deadline", sub: `Contributions in the first 60 days of ${y} can still be deducted on the ${taxYear} return.` },
    { id: "balance", date: `${y}-04-30`, title: "Balance owing due", sub: "Payment deadline for everyone, including the self employed." },
    selfEmployed
      ? { id: "return", date: `${y}-06-15`, title: "Return due (self employed)", sub: "Extra time to file because of self employment income, but any balance was still due 30 April." }
      : { id: "return", date: `${y}-04-30`, title: "Return due", sub: "Filing deadline for most people." },
  ];
  return rows.map((r) => ({ ...r, days: daysUntil(r.date) }));
}

/** The one deadline worth putting at the top: the next one not yet past. */
export function nextDeadline(rows) {
  const upcoming = rows.filter((r) => r.days >= 0).sort((a, b) => a.days - b.days);
  if (upcoming.length) return upcoming[0];
  return [...rows].sort((a, b) => b.days - a.days)[0] || null;
}
