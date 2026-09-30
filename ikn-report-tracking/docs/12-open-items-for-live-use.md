# What must be closed before live use

Two separate gates. Nothing here is a code defect: each item needs a decision, a
document or an approval that was not available when this was built.

---

## Gate 1 — before the portal is linked from the IKN website

| # | Item | Owner | Why it blocks |
|---|---|---|---|
| 1 | ICT-approved host, and an approved link or reverse proxy | IKN ICT | The prototype runs on localhost. `deploy.public_host` is unset. |
| 2 | TLS, managed secrets, protected backups | IKN ICT | `IKN_TOKEN_PEPPER` must come from managed secrets; the process refuses to start in production without it. |
| 3 | Security review against IKN ICT and confidentiality requirements | IKN ICT | That document was not supplied, so this build was written to general practice, not to IKN's standard. |
| 4 | Verified Records Unit contact: telephone, e-mail, counter hours | Records Unit | The portal shows a placeholder and says it is unverified. Publishing a guessed number would send applicants to the wrong place. |
| 5 | Bahasa Melayu wording reviewed by Records | Records Unit | The strings in `shared/public-text.ts` are a developer's Malay and should be read by the people who answer the telephone. |
| 6 | An approved messaging gateway | IKN ICT | The adapter is in simulation mode. Until a gateway is approved, no applicant can be notified and the step-up code cannot be delivered. |
| 7 | A decision on the staff-assisted verification route | Records Unit | The portal offers counter verification for applicants who cannot receive a code. The counter procedure behind it must exist. |

---

## Gate 2 — before real patient data is entered

| # | Item | Owner | Why it blocks |
|---|---|---|---|
| 8 | **The starting-day convention** (assumption #2) | Records Unit | It moves every deadline in the system by one working day. This is the single highest-impact unconfirmed value. |
| 9 | **The complete gazetted holiday calendar** | Records Unit + ICT | Only fixed-date Federal Territory holidays are seeded. Variable-date and replacement holidays are deliberately not generated; guessing them would move real applicants' deadlines. Load through Administration → Business calendar. |
| 10 | **The doctor allowance** (assumption #4) | Clinical HODs + Records | The 18 working days in this build were invented for the prototype. 14 and 21 are asserted nowhere. |
| 11 | **The review buffer** (assumption #5) | Records Unit | Prototype value of 3 working days. |
| 12 | **The official KPI specification**: endpoint, cohort, exclusions, target | IKN KPI owner | Until this lands, no figure may be labelled an official KKM KPI or an approved IKN target, and the dashboard does not label any. |
| 13 | **Report-type exceptions** to the 28-working-day allowance | Records Unit | None are configured; all report types get the general allowance. |
| 14 | **Claim eligibility criteria and the remuneration schedule** | Finance + Clinical | `DEMO-ELIG-1` was invented. The system records amounts; it does not compute entitlement, and should not until a real rate table exists. |
| 15 | **The official patient fee schedule** | Finance | The RM 50 / 100 / 250 in this build are fictional amounts from the dummy workbook. |
| 16 | **Whether release may be gated on an unpaid fee** | Records Unit + Finance | Ships **off**, because no policy permitting it was obtained. The mechanism exists and is tested; the switch is `fee.release_requires_settled`. |
| 17 | **Payment evidence definition** | Finance | This build requires reference + amount + paid date + reconciliation. Confirm that matches IKN's standard. |
| 18 | **Finance processing allowance**, if one exists | Finance | Deliberately absent. Finance turnaround is reported without a target rather than judged against an invented one. |
| 19 | **Reminder intervals and the escalation ladder** | Records Unit | 7/3/1 working days and HOD → supervisor → manager are proposals, not verified KKM rules. |
| 20 | **The approved policy document collection** | Document owners | Needed for the recommendation panel's citations: current IKN Records SOP, the applicable KKM guidance (search identifies Surat Pekeliling KPK Bil. 16/2010, whose full text was not retrieved for this brief — obtain the authorised copy and any amendments), the KPI specification, claim and payment circulars, the local escalation policy and the ICT confidentiality requirements. Until then the panel presents no recommendation as a policy requirement. |
| 21 | **Staff SSO and a real second factor** | IKN ICT | Local accounts and a fixed demonstration code exist so the permission model can be exercised. The control is real; the factor is not. |
| 22 | **Attachment virus scanning** | IKN ICT | The flow and the `scan_status` column exist; no scanner is wired. |
| 23 | **A retention and backup policy** | Records Unit + ICT | Not supplied, so nothing is implemented. |
| 24 | **A documented interface to registration and finance**, if one exists | IKN ICT + Finance | Otherwise the validated import path stays, labelled as manual reconciliation. |
| 25 | **A measured baseline for follow-up burden** | Records Unit | Without one, no improvement in telephone or counter volume may be claimed. The indicator shows raw counts only. |

---

## The switch

`IKN_DATA_CLASS=SYNTHETIC` keeps "Demonstration data — not actual IKN performance"
on every page, every chart caption and every export. Setting it to `LIVE` removes
that notice, and is the last step, not the first: it should be turned only once
Gate 2 is closed and the assumptions register shows `CONFIRMED` against the values
a live figure depends on — items 8, 9, 10, 12 above all.

Until then, the honest description of this build is: a working prototype on
synthetic data, with real controls, real arithmetic, and policy-dependent values
that are visibly marked as unconfirmed.
