# Working-day calendar data

The deadline engine reads non-working dates from `business_calendar_days`. Two
files seed that table, and they are kept apart on purpose.

## `holidays-fixed.csv` — seeded

Federal holidays that fall on the **same Gregorian date every year** and apply in
the Federal Territory of Putrajaya. These are safe to generate:

| Date | Holiday |
|---|---|
| 01 Jan | New Year's Day |
| 01 Feb | Federal Territory Day |
| 01 May | Labour Day |
| 31 Aug | National Day (Hari Merdeka) |
| 16 Sep | Malaysia Day |
| 25 Dec | Christmas Day |

## `holidays-variable.csv` — **empty, and must stay empty until gazetted dates are supplied**

Every other applicable holiday moves year to year because it follows the Islamic,
Chinese or Hindu calendar, or because it is set by proclamation:

Chinese New Year · Thaipusam · Hari Raya Aidilfitri · Hari Raya Aidiladha ·
Awal Muharram · Maulidur Rasul · Nuzul Al-Quran · Wesak Day · Deepavali ·
Birthday of the Yang di-Pertuan Agong · Nuzul Al-Quran · plus any officially
recognised **replacement** holiday when one of the above falls on a weekend.

**These dates are deliberately not generated.** Guessing them would move real
deadlines for real applicants by whole working days. They are loaded from the
official Federal Territory gazette through Administration → Business calendar,
which accepts this CSV layout:

```csv
calendar_date,day_kind,label
2027-02-06,PUBLIC_HOLIDAY,Chinese New Year
2027-02-08,REPLACEMENT_HOLIDAY,Replacement for Chinese New Year
```

`day_kind` is one of `PUBLIC_HOLIDAY`, `REPLACEMENT_HOLIDAY`, or
`WORKING_OVERRIDE` (a date that would otherwise be non-working but on which the
Records Unit works).

## Effect on the seeded metrics

Until the variable holidays are loaded, the seeded calendar under-counts
non-working days, so seeded deadlines are marginally **earlier** and seeded
overdue counts marginally **higher** than they would be under the complete
gazette. The calendar version's `verification_state` is `UNVERIFIED` and the
dashboard says so. `docs/09-seed-reconciliation.md` quantifies the difference
against the supplied workbook, which omits holidays entirely.
