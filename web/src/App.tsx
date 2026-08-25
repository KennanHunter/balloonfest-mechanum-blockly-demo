import { createEffect, createSignal, For, onCleanup, Show } from 'solid-js';
import Editor, { programStorageKey, SCRATCH_KEY } from './Editor';
import { connectRobot, type PDGains } from './robot';
import './App.css';

const PROGRAM_LIST_KEY = 'blockly:program:list';
const CURRENT_PROGRAM_KEY = 'blockly:program:current';
const GAINS_STORAGE_KEY = 'pd:gains';
const DEBUG_OPEN_KEY = 'debug:open';

const DEFAULT_GAINS: PDGains = { Kp_t: 4, Kd_t: 1.5, Kp_r: 6, Kd_r: 0.8 };

const TILE_M = 0.6;
const FIELD_TILES = 6;
const FIELD_M = TILE_M * FIELD_TILES;
const SVG_SIZE = 600;
const M_TO_SVG = SVG_SIZE / FIELD_M;

const loadProgramList = (): string[] => {
  try {
    const raw = localStorage.getItem(PROGRAM_LIST_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed)
      ? parsed.filter((s): s is string => typeof s === 'string' && s.length > 0)
      : [];
  } catch {
    return [];
  }
};

const saveProgramList = (list: string[]) => {
  localStorage.setItem(PROGRAM_LIST_KEY, JSON.stringify(list));
};

const loadCurrentProgram = (): string =>
  localStorage.getItem(CURRENT_PROGRAM_KEY) ?? '';

const loadGains = (): PDGains => {
  try {
    const raw = localStorage.getItem(GAINS_STORAGE_KEY);
    if (!raw) return { ...DEFAULT_GAINS };
    const parsed = JSON.parse(raw);
    return {
      Kp_t: Number(parsed.Kp_t ?? DEFAULT_GAINS.Kp_t),
      Kd_t: Number(parsed.Kd_t ?? DEFAULT_GAINS.Kd_t),
      Kp_r: Number(parsed.Kp_r ?? DEFAULT_GAINS.Kp_r),
      Kd_r: Number(parsed.Kd_r ?? DEFAULT_GAINS.Kd_r),
    };
  } catch {
    return { ...DEFAULT_GAINS };
  }
};

export default function App() {
  const [artifact, setArtifact] = createSignal<object>({ commands: [] });
  const [programs, setPrograms] = createSignal<string[]>(loadProgramList());
  const [current, setCurrentSignal] = createSignal<string>(loadCurrentProgram());
  const [nameInput, setNameInput] = createSignal(current());

  const switchTo = (name: string) => {
    setCurrentSignal(name);
    setNameInput(name);
    localStorage.setItem(CURRENT_PROGRAM_KEY, name);
  };

  const saveAs = () => {
    const name = nameInput().trim();
    if (!name) return;
    // Copy whatever is currently in the editor (stored under the current
    // name, or the scratch key if unnamed) to the new name.
    const srcKey = programStorageKey(current());
    const data = localStorage.getItem(srcKey);
    if (data != null) localStorage.setItem(programStorageKey(name), data);
    if (!programs().includes(name)) {
      const next = [...programs(), name].sort();
      setPrograms(next);
      saveProgramList(next);
    }
    switchTo(name);
    setNameInput('');
  };

  const newProgram = () => {
    localStorage.removeItem(programStorageKey(SCRATCH_KEY));
    switchTo('');
    setNameInput('');
  };

  const deleteCurrent = () => {
    const name = current();
    if (!name) return;
    if (!confirm(`Delete program "${name}"?`)) return;
    localStorage.removeItem(programStorageKey(name));
    const next = programs().filter((n) => n !== name);
    setPrograms(next);
    saveProgramList(next);
    switchTo(next[0] ?? '');
  };

  const [gains, setGainsSignal] = createSignal<PDGains>(loadGains());
  const updateGain = (key: keyof PDGains, value: number) => {
    if (!Number.isFinite(value)) return;
    const next = { ...gains(), [key]: value };
    setGainsSignal(next);
    localStorage.setItem(GAINS_STORAGE_KEY, JSON.stringify(next));
  };

  const [showGains, setShowGains] = createSignal(false);

  const [debugOpen, setDebugOpenSignal] = createSignal(
    localStorage.getItem(DEBUG_OPEN_KEY) === '1',
  );
  const setDebugOpen = (v: boolean) => {
    setDebugOpenSignal(v);
    localStorage.setItem(DEBUG_OPEN_KEY, v ? '1' : '0');
  };

  // Backtick toggles the hidden debug panel — but not while the user is
  // typing (Blockly text fields, name input, gains inputs).
  const onKey = (e: KeyboardEvent) => {
    if (e.key !== '`') return;
    const t = e.target as HTMLElement | null;
    const tag = t?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || t?.isContentEditable) return;
    e.preventDefault();
    setDebugOpen(!debugOpen());
  };
  document.addEventListener('keydown', onKey);
  onCleanup(() => document.removeEventListener('keydown', onKey));

  const wsUrl = `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`;
  const healthUrl = `${location.protocol}//${location.host}/health`;
  const robot = connectRobot(wsUrl, healthUrl);

  // Debounced gains sync to server.
  let gainsTimer: ReturnType<typeof setTimeout> | null = null;
  createEffect(
    () => [gains(), robot.connected()] as const,
    ([g, connected]) => {
      if (!connected) return;
      if (gainsTimer) clearTimeout(gainsTimer);
      gainsTimer = setTimeout(() => robot.setGains(g as PDGains), 150);
    },
  );

  const worldToSvg = (x: number, y: number) => ({
    cx: x * M_TO_SVG,
    // Flip y so up is +y in world coords.
    cy: SVG_SIZE - y * M_TO_SVG,
  });

  return (
    <div class="app-grid">
      <section class="pane">
        <div class="program-bar">
          <label>program</label>
          <select
            value={current()}
            onChange={(e) => switchTo(e.currentTarget.value)}
          >
            <Show when={!current() || !programs().includes(current())}>
              <option value={current()}>
                {current() ? current() : '(unsaved)'}
              </option>
            </Show>
            <For each={programs()}>
              {(name) => <option value={name}>{name}</option>}
            </For>
          </select>
          <input
            type="text"
            placeholder="name"
            value={nameInput()}
            onInput={(e) => setNameInput(e.currentTarget.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') saveAs();
            }}
          />
          <button type="button" onClick={newProgram} title="new opmode">
            new
          </button>
          <button type="button" onClick={saveAs} disabled={!nameInput().trim()}>
            save
          </button>
          <button
            type="button"
            onClick={deleteCurrent}
            disabled={!programs().includes(current())}
            title="delete this program"
          >
            delete
          </button>
        </div>
        <Editor
          programName={current() || SCRATCH_KEY}
          activeBlockId={robot.activeBlockId()}
          onArtifact={setArtifact}
        />
      </section>
      <section class="pane field-pane">
        <svg
          class="field-image"
          viewBox={`0 0 ${SVG_SIZE} ${SVG_SIZE}`}
          xmlns="http://www.w3.org/2000/svg"
          role="img"
          aria-label="6 by 6 field grid"
        >
          <defs>
            <pattern
              id="floor-tile"
              width="20"
              height="20"
              patternUnits="userSpaceOnUse"
            >
              <rect width="20" height="20" fill="#8a8f99" />
              <path
                d="M0 0 L20 0 M0 0 L0 20"
                stroke="#6f747d"
                stroke-width="1"
              />
            </pattern>
          </defs>
          <rect width={SVG_SIZE} height={SVG_SIZE} fill="url(#floor-tile)" />
          <g stroke="#2b2f38" stroke-width="2" fill="none">
            {Array.from({ length: FIELD_TILES + 1 }, (_, i) => (
              <>
                <line
                  x1={(i * SVG_SIZE) / FIELD_TILES}
                  y1="0"
                  x2={(i * SVG_SIZE) / FIELD_TILES}
                  y2={SVG_SIZE}
                />
                <line
                  x1="0"
                  y1={(i * SVG_SIZE) / FIELD_TILES}
                  x2={SVG_SIZE}
                  y2={(i * SVG_SIZE) / FIELD_TILES}
                />
              </>
            ))}
          </g>
          {(() => {
            const path = robot.activePath();
            if (path.length < 2) return null;
            const pts = path
              .map((p) => {
                const { cx, cy } = worldToSvg(p.x, p.y);
                return `${cx},${cy}`;
              })
              .join(' ');
            return (
              <polyline
                points={pts}
                fill="none"
                stroke="#ffd166"
                stroke-width="2"
                stroke-dasharray="6 4"
                stroke-opacity="0.75"
              />
            );
          })()}
          {(() => {
            const t = robot.targetPose();
            if (!t) return null;
            const { cx, cy } = worldToSvg(t.x, t.y);
            const size = 0.4 * M_TO_SVG;
            const half = size / 2;
            const deg = -(t.theta * 180) / Math.PI;
            return (
              <g transform={`translate(${cx} ${cy}) rotate(${deg})`}>
                <rect
                  x={-half}
                  y={-half}
                  width={size}
                  height={size}
                  fill="none"
                  stroke="#ffd166"
                  stroke-width="2"
                  stroke-dasharray="4 3"
                  rx="4"
                />
                <line
                  x1="0"
                  y1="0"
                  x2={half}
                  y2="0"
                  stroke="#ffd166"
                  stroke-width="2"
                />
              </g>
            );
          })()}
          {(() => {
            const trail = robot.trail();
            if (trail.length < 2) return null;
            const pts = trail
              .map((p) => {
                const { cx, cy } = worldToSvg(p.x, p.y);
                return `${cx},${cy}`;
              })
              .join(' ');
            return (
              <polyline
                points={pts}
                fill="none"
                stroke="#4b6cff"
                stroke-width="2"
                stroke-opacity="0.55"
              />
            );
          })()}
          {robot.position() && (() => {
            const p = robot.position()!;
            const { cx, cy } = worldToSvg(p.x, p.y);
            const size = 0.4 * M_TO_SVG;
            const half = size / 2;
            const theta = -(p.theta ?? 0); // SVG y flipped
            const deg = (theta * 180) / Math.PI;
            return (
              <g transform={`translate(${cx} ${cy}) rotate(${deg})`}>
                <rect
                  x={-half}
                  y={-half}
                  width={size}
                  height={size}
                  fill="#4b6cff"
                  fill-opacity="0.75"
                  stroke="#e6e8ee"
                  stroke-width="2"
                  rx="4"
                />
                <line
                  x1="0"
                  y1="0"
                  x2={half}
                  y2="0"
                  stroke="#e6e8ee"
                  stroke-width="3"
                />
              </g>
            );
          })()}
        </svg>
        <div class="field-controls">
          <button
            disabled={!robot.connected()}
            onClick={() => robot.play(artifact(), gains())}
          >
            play
          </button>
          <button disabled={!robot.connected()} onClick={() => robot.stop()}>
            stop
          </button>
          <button
            disabled={!robot.connected()}
            onClick={() => robot.returnToStart(gains())}
            title="drive back to the starting pose"
          >
            return home
          </button>
          <button
            disabled={!robot.connected()}
            onClick={() => robot.reset()}
            title="teleport the sim to the start pose (use when you moved the robot by hand)"
          >
            reset
          </button>
          <span class={`status status-${robot.status()}`}>{robot.status()}</span>
        </div>
        <dl class="telemetry">
          <dt>position</dt>
          <dd>
            {robot.position()
              ? `${robot.position()!.x.toFixed(2)}, ${robot.position()!.y.toFixed(2)}`
              : '—'}
          </dd>
          <dt>target</dt>
          <dd>
            {robot.targetPose()
              ? `${robot.targetPose()!.x.toFixed(2)}, ${robot.targetPose()!.y.toFixed(2)}`
              : '—'}
          </dd>
        </dl>
      </section>
      <Show when={debugOpen()}>
        <aside class="debug-panel">
          <div class="debug-header">
            <strong>debug</strong>
            <button
              type="button"
              class="debug-close"
              onClick={() => setDebugOpen(false)}
              title="close (or press `)"
            >
              ×
            </button>
          </div>
          <dl class="telemetry">
            <dt>ws</dt>
            <dd>{wsUrl}</dd>
            <dt>status</dt>
            <dd class={`status status-${robot.status()}`}>{robot.status()}</dd>
            <dt>health</dt>
            <dd>{robot.healthy() ? 'ok' : '—'}</dd>
            <dt>pose</dt>
            <dd>
              {robot.position()
                ? `${robot.position()!.x.toFixed(3)}, ${robot.position()!.y.toFixed(3)}, ${((robot.position()!.theta ?? 0) * 180 / Math.PI).toFixed(1)}°`
                : '—'}
            </dd>
            <dt>target</dt>
            <dd>
              {robot.targetPose()
                ? `${robot.targetPose()!.x.toFixed(3)}, ${robot.targetPose()!.y.toFixed(3)}, ${(robot.targetPose()!.theta * 180 / Math.PI).toFixed(1)}°`
                : '—'}
            </dd>
            <dt>motors</dt>
            <dd>
              {(() => {
                const m = robot.motorPower();
                const order = ['fl', 'fr', 'bl', 'br'] as const;
                const parts = order
                  .filter((k) => m[k])
                  .map((k) => `${k} ${m[k].voltage.toFixed(2)}`);
                return parts.length ? parts.join('  ') : '—';
              })()}
            </dd>
          </dl>
          <details
            open={showGains()}
            onToggle={(e) => setShowGains(e.currentTarget.open)}
            class="gains-panel"
          >
            <summary>PD gains (sim-side, Blockly)</summary>
            <div class="gains-grid">
              <For
                each={
                  [
                    ['Kp_t', 'Kp translate'],
                    ['Kd_t', 'Kd translate'],
                    ['Kp_r', 'Kp rotate'],
                    ['Kd_r', 'Kd rotate'],
                  ] as Array<[keyof PDGains, string]>
                }
              >
                {([key, label]) => (
                  <label>
                    <span>{label}</span>
                    <input
                      type="number"
                      step="0.1"
                      value={gains()[key]}
                      onInput={(e) =>
                        updateGain(key, Number(e.currentTarget.value))
                      }
                    />
                  </label>
                )}
              </For>
            </div>
          </details>
          <div class="debug-actions">
            <button
              disabled={!robot.connected()}
              onClick={() => robot.reset()}
            >
              reset
            </button>
            <button
              disabled={!robot.connected()}
              onClick={() => robot.returnToStart(gains())}
            >
              return home
            </button>
          </div>
        </aside>
      </Show>
    </div>
  );
}
