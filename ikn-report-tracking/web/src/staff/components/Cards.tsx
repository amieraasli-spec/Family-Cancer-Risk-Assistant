/**
 * KPI cards.
 *
 * Every card carries its own captions, because a card is an analytical output in
 * its own right. A rate prints its numerator and denominator; a rate with a zero
 * denominator prints "Not applicable — no eligible cases" and no percentage.
 */
import type { Captions, CountMetric, DistributionMetric, MoneyMetric, RateMetric } from '../types.ts';

export function CountCard({ metric }: { metric: CountMetric }) {
  return (
    <div className="card">
      <span className="card__label">{metric.label}</span>
      <span className="card__value">{metric.value.toLocaleString('en-MY')}</span>
      <span className="card__unit">{metric.unit.replace(/_/g, ' ')}</span>
    </div>
  );
}

export function RateCard({ metric }: { metric: RateMetric }) {
  return (
    <div className="card">
      <span className="card__label">{metric.label}</span>
      {metric.applicable ? (
        <>
          <span className="card__value">{metric.percent.toFixed(1)}%</span>
          <span className="card__parts">{metric.numerator} of {metric.denominator}</span>
          {metric.partialPeriodNotice && (
            <span className="card__note">{metric.partialPeriodNotice}</span>
          )}
        </>
      ) : (
        <span className="card__na">{metric.message}</span>
      )}
    </div>
  );
}

export function DistributionCard({ metric }: { metric: DistributionMetric }) {
  return (
    <div className="card">
      <span className="card__label">{metric.label}</span>
      {metric.applicable ? (
        <>
          <span className="card__value card__value--small">
            {metric.median} <span className="card__unit">median</span>
          </span>
          <span className="card__parts">
            P90 {metric.p90} · n = {metric.sampleSize} · {metric.unit}
          </span>
        </>
      ) : (
        <span className="card__na">{metric.message}</span>
      )}
    </div>
  );
}

export function MoneyCard({ metric }: { metric: MoneyMetric }) {
  return (
    <div className="card">
      <span className="card__label">{metric.label}</span>
      <span className="card__value card__value--small">
        RM {(metric.valueSen / 100).toLocaleString('en-MY', { minimumFractionDigits: 2 })}
      </span>
      {metric.inconsistencies.length > 0 ? (
        <span className="card__parts">
          ⚠ {metric.inconsistencies.length} item
          {metric.inconsistencies.length === 1 ? '' : 's'} where settlement exceeds approval
        </span>
      ) : <span className="card__unit">approved, no settlement evidence</span>}
    </div>
  );
}

/** A ratio card that always shows both counts alongside the percentage. */
export function RatioCard({ metric, label }: { metric: RateMetric; label: string }) {
  return (
    <div className="card">
      <span className="card__label">{label}</span>
      {metric.applicable ? (
        <>
          <span className="card__value">
            {metric.numerator}<span className="card__unit"> / {metric.denominator}</span>
          </span>
          <span className="card__parts">{metric.percent.toFixed(1)}% of the open queue</span>
        </>
      ) : (
        <span className="card__na">{metric.message}</span>
      )}
    </div>
  );
}

export function CardCaptions({ captions }: { captions: Captions }) {
  return (
    <div className="captions">
      <span><span className="captions__label">How to read this:</span> {captions.howToRead}</span>
      <span><span className="captions__label">What this shows:</span> {captions.whatThisShows}</span>
      {captions.dataClassNotice && (
        <span className="captions__notice">{captions.dataClassNotice}</span>
      )}
    </div>
  );
}
