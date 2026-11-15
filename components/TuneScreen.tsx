"use client";

import { setPrefs, usePrefs } from "@/lib/prefs";
import { TIME_ZONE_OPTIONS } from "@/lib/time";

export function TuneScreen() {
  const prefs = usePrefs();
  return (
    <div className="page" style={{ maxWidth: 720 }}>
      <div className="page-head"><div><span className="eyebrow">Tune</span><h1>Make it yours</h1></div></div>
      <section className="specular-card card-pad">
        <div className="form-grid">
          <label className="field wide"><span>Display time zone</span>
            <select value={prefs.timeZone} onChange={(event) => setPrefs({ timeZone: event.target.value })}>
              {TIME_ZONE_OPTIONS.map((zone) => <option key={zone.id} value={zone.id}>{zone.label}</option>)}
            </select>
            <span className="hint">Changes how times are shown. Sessions are always computed in exchange time.</span>
          </label>
        </div>
      </section>
    </div>
  );
}
