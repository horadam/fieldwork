"use client";
import { weeks } from "@/lib/sample-practice";

export const studyTotal = weeks.reduce((n, w) => n + w.items.length, 0);

export function GeneralStudyView({
  study,
  setStudy,
}: {
  study: Record<string, boolean>;
  setStudy: (next: Record<string, boolean>) => void;
}) {
  return (
    <>
      <div className="notice">
        Sample plan · 12h/week: 6h build + 4h interview practice + 2h study. At
        10h, trim polish. At 15h, add practice. Progress is saved in this
        browser.
      </div>
      <div className="grid">
        {weeks.map((week, wi) => (
          <section className="card study-card" key={week.title}>
            <div className="eyebrow">
              Week 0{wi + 1} · {week.dates}
            </div>
            <h2>{week.title}</h2>
            <p className="tiny muted">{week.outcome}</p>
            {week.items.map((item, i) => (
              <label className="study-row" key={item}>
                <input
                  type="checkbox"
                  checked={study[`${wi}-${i}`] || false}
                  onChange={(e) =>
                    setStudy({ ...study, [`${wi}-${i}`]: e.target.checked })
                  }
                />
                <span>{item}</span>
              </label>
            ))}
          </section>
        ))}
      </div>
    </>
  );
}
