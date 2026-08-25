import { createEffect, createSignal, onCleanup } from 'solid-js';
import * as Blockly from 'blockly';
import { javascriptGenerator } from 'blockly/javascript';

Blockly.defineBlocksWithJsonArray([
  {
    type: 'start',
    message0: 'start',
    nextStatement: null,
    colour: 60,
    tooltip: 'program entry point',
  },
  {
    type: 'move_forward',
    message0: 'move forward',
    previousStatement: null,
    nextStatement: null,
    colour: 160,
  },
  {
    type: 'move_backward',
    message0: 'move backward',
    previousStatement: null,
    nextStatement: null,
    colour: 160,
  },
  {
    type: 'strafe_left',
    message0: 'strafe left',
    previousStatement: null,
    nextStatement: null,
    colour: 200,
  },
  {
    type: 'strafe_right',
    message0: 'strafe right',
    previousStatement: null,
    nextStatement: null,
    colour: 200,
  },
  {
    type: 'rotate_left',
    message0: 'rotate left 90°',
    previousStatement: null,
    nextStatement: null,
    colour: 260,
  },
  {
    type: 'rotate_right',
    message0: 'rotate right 90°',
    previousStatement: null,
    nextStatement: null,
    colour: 260,
  },
  {
    type: 'return_to_start',
    message0: 'return to start',
    previousStatement: null,
    nextStatement: null,
    colour: 30,
    tooltip: 'drive back to the starting pose',
  },
  {
    type: 'repeat_n',
    message0: 'repeat %1 times',
    args0: [{ type: 'field_number', name: 'TIMES', value: 3, min: 0, precision: 1 }],
    message1: 'do %1',
    args1: [{ type: 'input_statement', name: 'DO' }],
    previousStatement: null,
    nextStatement: null,
    colour: 20,
  },
]);

javascriptGenerator.forBlock['start'] = () => '';
javascriptGenerator.forBlock['move_forward'] = (block) =>
  `commands.push({ op: "forward", id: ${JSON.stringify(block.id)} });\n`;
javascriptGenerator.forBlock['move_backward'] = (block) =>
  `commands.push({ op: "backward", id: ${JSON.stringify(block.id)} });\n`;
javascriptGenerator.forBlock['strafe_left'] = (block) =>
  `commands.push({ op: "strafe_left", id: ${JSON.stringify(block.id)} });\n`;
javascriptGenerator.forBlock['strafe_right'] = (block) =>
  `commands.push({ op: "strafe_right", id: ${JSON.stringify(block.id)} });\n`;
javascriptGenerator.forBlock['rotate_left'] = (block) =>
  `commands.push({ op: "rotate", degrees: 90, id: ${JSON.stringify(block.id)} });\n`;
javascriptGenerator.forBlock['rotate_right'] = (block) =>
  `commands.push({ op: "rotate", degrees: -90, id: ${JSON.stringify(block.id)} });\n`;
javascriptGenerator.forBlock['return_to_start'] = (block) =>
  `commands.push({ op: "return_to_start", id: ${JSON.stringify(block.id)} });\n`;
javascriptGenerator.forBlock['repeat_n'] = (block) => {
  const times = String(block.getFieldValue('TIMES') ?? 0);
  const branch = javascriptGenerator.statementToCode(block, 'DO');
  return `for (let i = 0; i < ${times}; i++) {\n${branch}}\n`;
};

const TOOLBOX = {
  kind: 'flyoutToolbox',
  contents: [
    { kind: 'block', type: 'start' },
    { kind: 'block', type: 'repeat_n' },
    { kind: 'block', type: 'move_forward' },
    { kind: 'block', type: 'move_backward' },
    { kind: 'block', type: 'strafe_left' },
    { kind: 'block', type: 'strafe_right' },
    { kind: 'block', type: 'rotate_left' },
    { kind: 'block', type: 'rotate_right' },
    { kind: 'block', type: 'return_to_start' },
  ],
};

export const SCRATCH_KEY = '_scratch';
export const programStorageKey = (name: string) =>
  `blockly:program:${name || SCRATCH_KEY}`;

const DEFAULT_WORKSPACE = {
  blocks: {
    languageVersion: 0,
    blocks: [
      {
        type: 'start',
        x: 40,
        y: 40,
        next: { block: { type: 'move_forward' } },
      },
    ],
  },
};

export default function Editor(props: {
  programName: string;
  activeBlockId?: string | null;
  onArtifact?: (a: object) => void;
}) {
  const [container, setContainer] = createSignal<HTMLDivElement | null>(null);
  const [artifact, setArtifact] = createSignal<object>({ commands: [] });
  const [showJson, setShowJson] = createSignal(false);

  createEffect(
    () => container(),
    (el) => {
      if (!el) return;
      const workspace = Blockly.inject(el, {
        toolbox: TOOLBOX as unknown as Blockly.utils.toolbox.ToolboxDefinition,
      });

      let currentName = props.programName;
      let suppress = false;

      const loadFromStorage = (name: string) => {
        suppress = true;
        try {
          workspace.clear();
          const raw = localStorage.getItem(programStorageKey(name));
          const state = raw ? JSON.parse(raw) : DEFAULT_WORKSPACE;
          Blockly.serialization.workspaces.load(state, workspace);
        } catch (err) {
          console.error('Failed to load workspace', err);
        } finally {
          suppress = false;
        }
        regenerate();
      };

      const saveToStorage = () => {
        try {
          const state = Blockly.serialization.workspaces.save(workspace);
          localStorage.setItem(
            programStorageKey(currentName),
            JSON.stringify(state),
          );
        } catch (err) {
          console.error('Failed to save workspace', err);
        }
      };

      const regenerate = () => {
        // Only blocks connected under a `start` block contribute — orphan
        // top-level stacks are ignored, matching the entry-point semantics.
        const commands: unknown[] = [];
        const starts = workspace
          .getTopBlocks(true)
          .filter((b) => b.type === 'start');
        for (const startBlock of starts) {
          const first = startBlock.getNextBlock();
          if (!first) continue;
          const raw = javascriptGenerator.blockToCode(first);
          const code = Array.isArray(raw) ? raw[0] : raw;
          try {
            new Function('commands', code)(commands);
          } catch (err) {
            console.error('Failed to run generated program', err);
          }
        }
        const next = { name: currentName, commands };
        setArtifact(next);
        props.onArtifact?.(next);
      };

      workspace.addChangeListener((e) => {
        if (e.isUiEvent || suppress) return;
        saveToStorage();
        regenerate();
      });

      loadFromStorage(currentName);

      createEffect(
        () => props.programName,
        (name) => {
          if (name === currentName) return;
          currentName = name;
          loadFromStorage(name);
        },
      );

      let lastActive: string | null = null;
      createEffect(
        () => props.activeBlockId ?? null,
        (id) => {
          if (lastActive) {
            try {
              workspace.getBlockById(lastActive)?.removeSelect();
            } catch {}
          }
          if (id) {
            try {
              workspace.getBlockById(id)?.addSelect();
            } catch {}
          }
          lastActive = id;
        },
      );

      onCleanup(() => workspace.dispose());
    },
  );

  return (
    <div style={{ display: 'flex', gap: '12px', flex: '1', 'min-height': '0' }}>
      <div ref={setContainer} style={{ flex: '1', height: '100%' }} />
      <button
        type="button"
        onClick={() => setShowJson(!showJson())}
        title={showJson() ? 'hide artifact json' : 'show artifact json'}
        style={{
          background: '#1f2229',
          color: '#9aa3b8',
          border: '1px solid #3a4054',
          'border-radius': '4px',
          cursor: 'pointer',
          padding: '4px 8px',
          'font-family': 'ui-monospace, monospace',
          'font-size': '12px',
          'align-self': 'flex-start',
        }}
      >
        {showJson() ? '›' : '‹'}
      </button>
      {showJson() && (
        <pre
          style={{
            flex: '0 0 260px',
            margin: '0',
            padding: '12px',
            background: '#111',
            color: '#0f0',
            'border-radius': '4px',
            overflow: 'auto',
            'font-size': '12px',
          }}
        >
          {JSON.stringify(artifact(), null, 2)}
        </pre>
      )}
    </div>
  );
}
