# Permission matrix

Enforcement is **server-side on every request, every attachment download and
every export**. Hiding a menu item is treated as cosmetic only. Each row below
maps to a named permission constant in `server/auth/permissions.ts`; the route
table in `server/http/routes.ts` declares the permission it requires, and the
request pipeline refuses any route that forgot to declare one.

Legend: ● allowed · ◐ allowed within scope · ○ denied

Scope qualifiers:
- **own** — the acting user's own record only (`doctor_id = user.doctor_id`)
- **dept** — the acting user's department only (`department_id ∈ user.departments`)
- **case** — only the application the public token or verified session resolves to

| Permission | Patient / rep | Records officer | Doctor | HOD | Finance officer | Director | System admin |
|---|---|---|---|---|---|---|---|
| `public.status.read` | ◐ case | ○ | ○ | ○ | ○ | ○ | ○ |
| `public.nextaction.detail` | ◐ case, verified | ○ | ○ | ○ | ○ | ○ | ○ |
| `application.register` | ○ | ● | ○ | ○ | ○ | ○ | ○ |
| `application.read` | ○ | ● | ◐ own task | ◐ dept | ◐ claim-linked fields only | ● aggregate + authorised drill-down | ○ |
| `application.completeness.set` | ○ | ● | ○ | ○ | ○ | ○ | ○ |
| `application.authority.verify` | ○ | ● | ○ | ○ | ○ | ○ | ○ |
| `application.assign` | ○ | ● | ○ | ◐ dept | ○ | ○ | ○ |
| `application.reassign` | ○ | ● | ○ | ◐ dept | ○ | ○ | ○ |
| `application.cancel` | ○ | ● | ○ | ○ | ○ | ○ | ○ |
| `application.reopen` | ○ | ◐ supervisor | ○ | ○ | ○ | ○ | ○ |
| `application.extension.grant` | ○ | ○ | ○ | ○ | ○ | ● | ○ |
| `task.read` | ○ | ● | ◐ own | ◐ dept | ○ | ● aggregate | ○ |
| `task.acknowledge` | ○ | ○ | ◐ own | ○ | ○ | ○ | ○ |
| `task.progress.update` | ○ | ○ | ◐ own | ○ | ○ | ○ | ○ |
| `task.submit.signed` | ○ | ○ | ◐ own | ○ | ○ | ○ | ○ |
| `task.completion.accept` | ○ | ● | ○ | ○ | ○ | ○ | ○ |
| `task.return` | ○ | ● | ○ | ○ | ○ | ○ | ○ |
| `release.authorise` | ○ | ● | ○ | ○ | ○ | ○ | ○ |
| `release.record.collection` | ○ | ● | ○ | ○ | ○ | ○ | ○ |
| `fee.set` | ○ | ● | ○ | ○ | ○ | ○ | ○ |
| `fee.payment.record` | ○ | ● | ○ | ○ | ● | ○ | ○ |
| `fee.exemption.grant` | ○ | ● | ○ | ○ | ○ | ○ | ○ |
| `fee.read` | ◐ case, own amount only | ● | ○ | ○ | ● | ● aggregate | ○ |
| `claim.eligibility.assess` | ○ | ● | ○ | ○ | ● | ○ | ○ |
| `claim.submit` | ○ | ○ | ◐ own | ○ | ○ | ○ | ○ |
| `claim.withdraw` | ○ | ○ | ◐ own | ○ | ○ | ○ | ○ |
| `claim.read` | ○ | ○ | ◐ own | ◐ dept aggregate, no amounts per doctor | ● | ● aggregate | ○ |
| `claim.verify` | ○ | ○ | ○ | ○ | ● | ○ | ○ |
| `claim.return` | ○ | ○ | ○ | ○ | ● | ○ | ○ |
| `claim.approve` | ○ | ○ | ○ | ○ | ◐ not own submission | ○ | ○ |
| `payment.instruct` | ○ | ○ | ○ | ○ | ● | ○ | ○ |
| `payment.reconcile` | ○ | ○ | ○ | ○ | ● | ○ | ○ |
| `payment.read` | ○ | ○ | ◐ own status only | ○ | ● | ● aggregate | ○ |
| `metrics.read.hospital` | ○ | ● | ○ | ◐ dept | ◐ finance metrics | ● | ○ |
| `metrics.drilldown` | ○ | ● | ○ | ◐ dept | ◐ finance | ◐ authorised, logged | ○ |
| `export.monthly` | ○ | ● | ○ | ◐ dept | ● | ● | ○ |
| `snapshot.freeze` | ○ | ○ | ○ | ○ | ○ | ● | ○ |
| `forecast.read` | ○ | ● | ○ | ◐ dept | ○ | ● | ○ |
| `recommendations.read` | ○ | ● | ○ | ◐ dept | ● | ● | ○ |
| `recommendations.accept` | ○ | ● | ○ | ◐ dept | ● | ● | ○ |
| `policy.document.read` | ○ | ◐ by clearance | ◐ by clearance | ◐ by clearance | ◐ by clearance | ● | ○ |
| `attachment.download` | ○ | ● | ◐ own task | ◐ dept | ◐ claim forms | ◐ authorised, logged | ○ |
| `admin.users` | ○ | ○ | ○ | ○ | ○ | ○ | ● |
| `admin.calendar` | ○ | ○ | ○ | ○ | ○ | ○ | ● |
| `admin.rules` | ○ | ○ | ○ | ○ | ○ | ○ | ● |
| `admin.integration` | ○ | ○ | ○ | ○ | ○ | ○ | ● |
| `admin.notification.adapter` | ○ | ○ | ○ | ○ | ○ | ○ | ● |
| `import.run` | ○ | ◐ records data | ○ | ○ | ◐ finance data | ○ | ● |

## Hard prohibitions (enforced, not conventions)

1. **`system_admin` never gains patient content, clinical approval or payment
   approval.** The role holds no `application.read`, `claim.approve`,
   `payment.reconcile`, `attachment.download` or `public.*` permission.
2. **Doctors never see** other doctors' performance, other doctors' claims,
   patient fees, patient contact details, or any hospital-level financial
   summary. The doctor scope filter is applied in SQL, not in the view layer.
3. **Patients never see** diagnosis, clinical text, full NRIC, doctor identity,
   doctor performance, internal comments, claims or payments. The public
   response is built by a **strict allowlist serialiser**; a field that is not
   in the allowlist cannot reach the response even if a future query selects it.
4. **Claim submission and claim approval are separate permissions held by
   different roles**, and `claim.approve` additionally refuses when the actor is
   the submitter.
5. **Patient viewing never mutates case status.** Public routes run through a
   read-only database handle.
6. **Every privileged access is recorded** in `audit_events`: director
   drill-down, attachment download, export, import, rule change, snapshot
   freeze, and every denied authorisation attempt.
