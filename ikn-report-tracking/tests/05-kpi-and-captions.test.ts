/**
 * Acceptance checks 7, 8 and 9:
 *   - the due-cohort KPI includes unfinished late reports, handles zero denominators
 *     and matches the exported snapshot;
 *   - chart and table captions match the selected data, and synthetic and unavailable
 *     data are labelled;
 *   - the forecast is withheld when history is insufficient, and the recommendation
 *     panel withholds unsupported policy claims.
 */
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { loadCohort } from '../server/analytics/cohort.ts';
import { dueCohortOnTimeRate, completedCohortOnTimeRate, rate,
  turnaroundDistribution } from '../server/analytics/metrics.ts';
import { overviewPanels, insightsPanels, forecastPanel, actionsPanel,
  type PanelRequest } from '../server/analytics/panels.ts';
import { buildExportBundle, exportAsCsv, freezeSnapshot } from '../server/services/exports.ts';
import { buildForecast, MINIMUM_MONTHS } from '../server/analytics/forecast.ts';
import { applyEvent } from '../server/services/workflow.ts';
import { NOT_APPLICABLE } from '../../ikn-report-tracking/shared/domain.ts';
import { createDoctor, createFixture, principalFor, registerApplication,
  type Fixture } from './harness.ts';

const CUTOFF = '2026-09-27T15:59:59.000Z';

function baseRequest(overrides: Partial<PanelRequest> = {}): PanelRequest {
  return {
    month: '2026-09', trailingMonths: 12, cutoff: CUTOFF,
    departmentLabel: 'all departments', policyClearance: 'STANDARD', ...overrides,
  };
}

describe('the due-cohort KPI counts unfinished late work', () => {
  let fixture: Fixture;

  before(() => {
    fixture = createFixture();
    createDoctor(fixture.handle, 'T-D1', 'Dr One', 'DEPT-RTO');
    const records = principalFor(fixture.handle, 'records1');
    const doctor = principalFor(fixture.handle, 't-d1');

    // Two applications complete on the same day, so both fall in the same due cohort.
    // One finishes on time; the other is simply left unfinished.
    const completeAt = '2026-08-03T02:00:00.000Z';
    const onTime = registerApplication(fixture.handle, { receivedAt: '2026-08-03T01:00:00.000Z' });
    const unfinished = registerApplication(fixture.handle, { receivedAt: '2026-08-03T01:00:00.000Z' });

    for (const { applicationId } of [onTime, unfinished]) {
      applyEvent(fixture.handle, {
        applicationId, event: 'MARK_COMPLETE', actor: records, payload: { completeAt },
      });
      applyEvent(fixture.handle, {
        applicationId, event: 'ASSIGN', actor: records, occurredAt: completeAt,
        payload: { doctorId: 'T-D1' },
      });
    }

    applyEvent(fixture.handle, {
      applicationId: onTime.applicationId, event: 'ACKNOWLEDGE', actor: doctor,
      occurredAt: '2026-08-04T02:00:00.000Z',
    });
    applyEvent(fixture.handle, {
      applicationId: onTime.applicationId, event: 'SUBMIT_SIGNED', actor: doctor,
      occurredAt: '2026-08-20T02:00:00.000Z',
    });
    applyEvent(fixture.handle, {
      applicationId: onTime.applicationId, event: 'BEGIN_RECORDS_CHECK', actor: records,
      occurredAt: '2026-08-21T02:00:00.000Z',
    });
    applyEvent(fixture.handle, {
      applicationId: onTime.applicationId, event: 'ACCEPT_COMPLETION', actor: records,
      occurredAt: '2026-08-24T02:00:00.000Z',
    });
  });
  after(() => fixture.close());

  it('puts the unfinished overdue application in the denominator, not the numerator', () => {
    const cohort = loadCohort(fixture.handle, { cutoff: CUTOFF });
    const dueMonth = cohort.applications[0]!.originalDueMonth!;
    const metric = dueCohortOnTimeRate(cohort, dueMonth);

    assert.ok(metric.applicable);
    assert.equal(metric.denominator, 2, 'both applications are in the due cohort');
    assert.equal(metric.numerator, 1, 'only the completed one is on time');
    assert.equal(metric.percent, 50);
  });

  it('reads better on the completed cohort, which is why that view is supplementary', () => {
    const cohort = loadCohort(fixture.handle, { cutoff: CUTOFF });
    const completedMonth = cohort.applications
      .find((a) => a.completionMonth !== null)!.completionMonth!;
    const supplementary = completedCohortOnTimeRate(cohort, completedMonth);
    assert.ok(supplementary.applicable);
    assert.equal(supplementary.percent, 100,
      'the completed cohort omits the unfinished case, which is the point of the label');
  });

  it('never counts an unknown completion date as on time', () => {
    const cohort = loadCohort(fixture.handle, { cutoff: CUTOFF });
    const unfinished = cohort.applications.find((a) => a.completionDate === null)!;
    assert.equal(unfinished.onTimeAgainstOriginal, false,
      'a missing completion date is late, never on time');
  });

  it('refuses to render a percentage from a zero denominator', () => {
    const empty = rate('test', 'Test', 0, 0);
    assert.equal(empty.applicable, false);
    assert.equal(empty.applicable === false ? empty.message : '', NOT_APPLICABLE);
    assert.ok(!('percent' in empty), 'a not-applicable rate carries no percentage at all');

    const cohort = loadCohort(fixture.handle, { cutoff: CUTOFF });
    const quiet = dueCohortOnTimeRate(cohort, '2024-01');
    assert.equal(quiet.applicable, false, 'a month with no eligible cases is not applicable');
  });

  it('labels a month-to-date figure as such', () => {
    const cohort = loadCohort(fixture.handle, { cutoff: '2026-08-10T15:59:59.000Z' });
    const metric = dueCohortOnTimeRate(cohort, '2026-09');
    if (metric.applicable) {
      assert.ok(metric.partialPeriodNotice,
        'a rate computed before the month ends must say it is month-to-date');
    }
  });

  it('reports no turnaround where either endpoint is missing', () => {
    const cohort = loadCohort(fixture.handle, { cutoff: CUTOFF });
    const distribution = turnaroundDistribution(cohort);
    assert.ok(distribution.applicable);
    assert.equal(distribution.sampleSize, 1,
      'only the completed report has a measurable turnaround');
  });
});

describe('captions, exports and snapshots agree', () => {
  let fixture: Fixture;

  before(() => { fixture = createFixture(true); });
  after(() => fixture.close());

  it('gives every analytical panel both captions', () => {
    const request = baseRequest();
    const panels = {
      ...overviewPanels(fixture.handle, request),
      ...insightsPanels(fixture.handle, request),
      forecast: forecastPanel(fixture.handle, request),
      actions: actionsPanel(fixture.handle, request),
    };
    for (const [key, panel] of Object.entries(panels)) {
      if (!panel || typeof panel !== 'object' || !('captions' in panel)) continue;
      const captions = (panel as { captions: { howToRead: string; whatThisShows: string } }).captions;
      assert.ok(captions.howToRead.length > 20, `${key} has no "how to read this"`);
      assert.ok(captions.whatThisShows.length > 20, `${key} has no "what this shows"`);
    }
  });

  it('states that the data is a demonstration on every finding caption', () => {
    const panels = insightsPanels(fixture.handle, baseRequest());
    for (const [key, panel] of Object.entries(panels)) {
      const captions = panel.captions as { whatThisShows: string; dataClassNotice?: string };
      assert.equal(captions.dataClassNotice, 'Demonstration data — not actual IKN performance.',
        `${key} does not carry the synthetic-data notice`);
      assert.ok(captions.whatThisShows.includes('Demonstration data'),
        `${key}'s finding caption must carry the notice too, so a cropped screenshot keeps it`);
    }
  });

  it('recomputes the finding when the filter changes', () => {
    const all = overviewPanels(fixture.handle, baseRequest());
    const one = overviewPanels(fixture.handle,
      baseRequest({ departmentIds: ['DEPT-RTO'], departmentLabel: 'Radiotherapy & Oncology' }));

    assert.notEqual(all.queueHealth.captions.whatThisShows,
      one.queueHealth.captions.whatThisShows,
      'a caption must be recalculated when the filter changes, not cached');
    assert.ok(one.queueHealth.captions.whatThisShows.includes('Radiotherapy & Oncology'));
    assert.ok(all.queueHealth.captions.whatThisShows.includes('all departments'));
  });

  it('states the finding the data supports, not a flattering one', () => {
    const panels = insightsPanels(fixture.handle, baseRequest());
    const timeliness = panels.timeliness.captions.whatThisShows;
    // The seeded dataset never reaches the 85% reference, and the caption says so.
    assert.match(timeliness, /^0 of \d+ months with eligible cases reached the 85% reference/,
      'the caption reports what the data shows, including when it is unflattering');
  });

  it('marks a heatmap cell with no eligible cases as unavailable, not zero', () => {
    const panels = insightsPanels(fixture.handle, baseRequest({ trailingMonths: 32 }));
    const cells = panels.heatmap.data.cells;
    const blank = cells.filter((c) => c.percent === null);
    assert.ok(blank.length > 0, 'the trailing window reaches months before the data began');
    for (const cell of blank) {
      assert.equal(cell.denominator, 0, 'a null rate means no eligible reports were due');
    }
    assert.match(panels.heatmap.captions.howToRead, /Grey means no eligible reports were due/);
  });

  it('reconciles the export with the dashboard under the same filters', () => {
    const request = baseRequest();
    const overview = overviewPanels(fixture.handle, request);
    const bundle = buildExportBundle(fixture.handle, request);

    const activity = bundle.sections.find((s) => s.key === 'activity')!;
    const value = (metric: string) => Number(
      activity.rows.find((r) => r.metric === metric)!.value);

    assert.equal(value('Received'), overview.cards.data.page1.received.value);
    assert.equal(value('Completed'), overview.cards.data.page1.completed.value);
    assert.equal(value('Open at cutoff'), overview.cards.data.page1.openBacklog.value);
    assert.equal(value('Overdue open'), overview.cards.data.page1.overdueOpen.value);

    const timeliness = bundle.sections.find((s) => s.key === 'timeliness')!;
    const onTime = timeliness.rows.find((r) => r.metric === 'Due-cohort on-time rate')!;
    const card = overview.cards.data.page2.dueCohortOnTime;
    assert.ok(card.applicable);
    assert.equal(Number(onTime.numerator), card.numerator);
    assert.equal(Number(onTime.denominator), card.denominator);
  });

  it('carries both captions into the exported CSV', () => {
    const files = exportAsCsv(buildExportBundle(fixture.handle, baseRequest()));
    for (const file of files) {
      assert.match(file.content, /^# How to read this: .+$/m, `${file.filename} lost a caption`);
      assert.match(file.content, /^# What this shows: .+$/m, `${file.filename} lost a caption`);
      assert.match(file.content, /Demonstration data/,
        `${file.filename} lost the synthetic-data notice`);
    }
  });

  it('freezes a snapshot and refuses to overwrite it silently', () => {
    const director = principalFor(fixture.handle, 'director');
    const request = baseRequest();
    const first = freezeSnapshot(fixture.handle, request, director);
    assert.equal(first.revision, 1);

    assert.throws(
      () => freezeSnapshot(fixture.handle, request, director),
      (err: unknown) => (err as { code?: string }).code === 'SNAPSHOT_EXISTS',
      'a second freeze without a reason must be refused');

    const corrected = freezeSnapshot(fixture.handle, request, director,
      'Completeness dates corrected for four cases');
    assert.equal(corrected.revision, 2);
    assert.equal(corrected.supersedes, first.snapshotId,
      'a correction supersedes rather than overwrites');

    const rows = fixture.handle.all<{ revision: number }>(
      'SELECT revision FROM monthly_snapshot_versions WHERE period_month = ? ORDER BY revision',
      '2026-09');
    assert.deepEqual(rows.map((r) => r.revision), [1, 2],
      'the earlier revision stays readable, so a figure quoted last month is reproducible');
  });

  it('matches the frozen snapshot to the dashboard it was taken from', () => {
    const request = baseRequest();
    const overview = overviewPanels(fixture.handle, request);
    const stored = fixture.handle.get<{ metrics_json: string }>(
      `SELECT metrics_json FROM monthly_snapshot_versions WHERE period_month = ?
       ORDER BY revision DESC LIMIT 1`, '2026-09')!;
    const snapshot = JSON.parse(stored.metrics_json) as ReturnType<typeof buildExportBundle>;
    const activity = snapshot.sections.find((s) => s.key === 'activity')!;
    assert.equal(Number(activity.rows.find((r) => r.metric === 'Received')!.value),
      overview.cards.data.page1.received.value);
  });
});

describe('the forecast and the recommendation panel withhold rather than invent', () => {
  it('withholds a forecast when history is too short', () => {
    const fixture = createFixture();
    try {
      const output = buildForecast(fixture.handle, CUTOFF, 3);
      assert.equal(output.available, false);
      if (!output.available) {
        assert.equal(output.requiredMonths, MINIMUM_MONTHS);
        assert.match(output.message, /Insufficient history for a validated forecast/);
      }
    } finally { fixture.close(); }
  });

  it('produces a validated forecast once there is enough history', () => {
    const fixture = createFixture(true);
    try {
      const output = buildForecast(fixture.handle, CUTOFF, 3);
      assert.equal(output.available, true);
      if (output.available) {
        assert.ok(output.history.length >= MINIMUM_MONTHS);
        // The partial month is excluded from fitting.
        assert.ok(output.trainingTo < '2026-09',
          'a part-finished month must not be fitted as though it were complete');
        assert.ok(output.validation.ets.origins.length > 0,
          'the model must be backtested against held-out months');
        assert.ok(output.validation.baseline.mae > 0);
        // Whichever model wins, the panel names it and shows both errors.
        assert.ok(['ETS_A_Ad_N', 'TRAILING_3_MONTH_MEAN'].includes(output.selectedModel));
        for (const point of output.points) {
          assert.ok(point.lower95 >= 0, 'a count forecast cannot be negative');
          assert.ok(point.lower95 <= point.lower80, '95% must be at least as wide as 80%');
          assert.ok(point.upper80 <= point.upper95);
        }
      }
    } finally { fixture.close(); }
  });

  it('presents no recommendation as a policy requirement without a quoted passage', () => {
    const fixture = createFixture(true);
    try {
      const panel = actionsPanel(fixture.handle, baseRequest());
      assert.equal(panel.data.ragStatus, 'NO_APPROVED_COLLECTION');
      assert.ok(panel.data.recommendations.length > 0, 'the rules panel still serves');
      for (const recommendation of panel.data.recommendations) {
        assert.equal(recommendation.evidenceKind, 'MANAGEMENT_SUGGESTION');
        assert.equal(recommendation.policyCitation, null, 'no citation may be fabricated');
        assert.equal(recommendation.policyGap?.message, 'No verified policy source available.');
        assert.ok(recommendation.policyGap?.routeTo, 'the gap routes to a document owner');
        assert.equal(recommendation.requiresHumanAcceptance, true);
        assert.ok(recommendation.actionOwner.length > 0);
        assert.ok(recommendation.reviewDate.match(/^\d{4}-\d{2}-\d{2}$/));
      }
    } finally { fixture.close(); }
  });
});
