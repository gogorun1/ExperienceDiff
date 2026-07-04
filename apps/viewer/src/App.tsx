import { useEffect, useMemo, useRef, useState } from 'react';
import type { ExperienceDiff, FlowComparison, NarrationSegment } from '@experience-diff/contract';
import mockReport from '../../../packages/contract/mock/mock-experience-diff.json';
import mockFollowUp from '../../../packages/contract/mock/mock-followup-response.json';
import { resolveAsset } from './assets';

const report = mockReport as unknown as ExperienceDiff;

function severityClass(severity: NarrationSegment['severity']): string {
  return `severity-${severity}`;
}

function FlowPlayer({ flow, assetBaseUrl }: { flow: FlowComparison; assetBaseUrl?: string }) {
  const beforeRef = useRef<HTMLVideoElement>(null);
  const afterRef = useRef<HTMLVideoElement>(null);
  const [currentSec, setCurrentSec] = useState(0);

  const activeSegment = useMemo(
    () =>
      flow.narration.find(
        (s) => currentSec >= s.startSec && currentSec < (s.endSec ?? s.startSec + 5),
      ),
    [flow.narration, currentSec],
  );

  useEffect(() => {
    const before = beforeRef.current;
    if (!before) return;
    const onTime = () => setCurrentSec(before.currentTime);
    before.addEventListener('timeupdate', onTime);
    return () => before.removeEventListener('timeupdate', onTime);
  }, []);

  const playBoth = () => {
    beforeRef.current?.play();
    afterRef.current?.play();
  };

  const seekTo = (sec: number) => {
    if (beforeRef.current) beforeRef.current.currentTime = sec;
    if (afterRef.current) afterRef.current.currentTime = sec;
  };

  return (
    <section className="flow">
      <header className="flow-header">
        <h2>{flow.flowTitle}</h2>
        <span className="viewport-badge">{flow.viewport}</span>
      </header>

      <div className="videos">
        <figure>
          <video ref={beforeRef} src={resolveAsset(flow.videoBefore, assetBaseUrl)} muted controls />
          <figcaption>Before</figcaption>
        </figure>
        <figure>
          <video ref={afterRef} src={resolveAsset(flow.videoAfter, assetBaseUrl)} muted controls />
          <figcaption>After</figcaption>
        </figure>
      </div>

      <button className="play-both" onClick={playBoth}>
        Play side by side
      </button>

      <div className="subtitle" aria-live="polite">
        {activeSegment ? (
          <p className={severityClass(activeSegment.severity)}>{activeSegment.text}</p>
        ) : (
          <p className="subtitle-idle">Press play to watch the experience diff.</p>
        )}
      </div>

      <div className="timeline">
        {flow.narration.map((seg) => (
          <button
            key={seg.id}
            className={`timeline-marker ${severityClass(seg.severity)} ${
              activeSegment?.id === seg.id ? 'active' : ''
            }`}
            style={{ left: `${(seg.startSec / flow.durationSec) * 100}%` }}
            title={seg.text}
            onClick={() => seekTo(seg.startSec)}
          />
        ))}
      </div>

      <ul className="changes">
        {flow.perceivableChanges.map((change) => (
          <li key={change.id} className={`change ${severityClass(change.severity)}`}>
            <span className="change-severity">{change.severity}</span>
            <span>{change.description}</span>
            <span className="change-evidence" title={change.evidenceIds.join(', ')}>
              {change.evidenceIds.length} evidence events
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

export default function App() {
  const [flows, setFlows] = useState<FlowComparison[]>(report.flows);

  // Follow-up placeholder: appends the mock failure-branch flow the same way
  // the real voice service will (FollowUpResponse.newFlow).
  const askFollowUp = () => {
    const newFlow = (mockFollowUp as { newFlow: unknown }).newFlow as FlowComparison;
    setFlows((f) => (f.some((x) => x.flowId === newFlow.flowId) ? f : [...f, newFlow]));
  };

  return (
    <div className="theater">
      <header className="report-header">
        <p className="pr-branch">
          {report.prMetadata.baseRef} → {report.prMetadata.headRef}
        </p>
        <h1>{report.prMetadata.title}</h1>
        <p className="summary">{report.summary}</p>
        <p className="status-badge">{report.status}</p>
      </header>

      {flows.map((flow) => (
        <FlowPlayer key={flow.flowId} flow={flow} assetBaseUrl={report.assetBaseUrl} />
      ))}

      <footer className="followup">
        <button onClick={askFollowUp} data-testid="followup-fallback-button">
          Ask: what happens if payment fails?
        </button>
        <p className="followup-hint">
          Voice follow-up entry point — wired to services/voice later. This button is also
          fallback Level 2 for the live demo.
        </p>
      </footer>
    </div>
  );
}
