import type { Command, Program } from './protocol';
import type { Pose } from './kinematics';

export const TILE = 0.6;
export const FIELD_TILES = 6;

// Sampling density for compiled paths — the PD reference target steps through
// these samples, so denser paths mean a slower, smoother reference.
const SAMPLE_LEN = 0.02; // 2 cm per translation sample
const SAMPLE_ANG = (2 * Math.PI) / 180; // 2° per rotation sample

export type Block = { path: Pose[]; blockId: string };

export function compileProgram(start: Pose, program: Program): Block[] {
  const blocks: Block[] = [];
  let cur: Pose = { ...start };
  for (const cmd of program.commands) {
    const path = pathFor(cur, cmd);
    blocks.push({ path, blockId: cmd.id });
    if (path.length > 0) cur = { ...path[path.length - 1] };
  }
  return blocks;
}

function pathFor(start: Pose, cmd: Command): Pose[] {
  switch (cmd.op) {
    case 'forward':
    case 'backward':
    case 'strafe_left':
    case 'strafe_right': {
      // Body-frame heading axis for each op. +x=forward, +y=left.
      const bodyAngle =
        cmd.op === 'forward'
          ? 0
          : cmd.op === 'backward'
            ? Math.PI
            : cmd.op === 'strafe_left'
              ? Math.PI / 2
              : -Math.PI / 2;
      const worldAngle = start.theta + bodyAngle;
      const dx = Math.cos(worldAngle) * TILE;
      const dy = Math.sin(worldAngle) * TILE;
      const dist = Math.hypot(dx, dy);
      const n = Math.max(1, Math.ceil(dist / SAMPLE_LEN));
      const path: Pose[] = [];
      for (let i = 1; i <= n; i++) {
        const t = i / n;
        path.push({
          x: start.x + dx * t,
          y: start.y + dy * t,
          theta: start.theta,
        });
      }
      return path;
    }
    case 'rotate': {
      const dtheta = (cmd.degrees * Math.PI) / 180;
      const n = Math.max(1, Math.ceil(Math.abs(dtheta) / SAMPLE_ANG));
      const path: Pose[] = [];
      for (let i = 1; i <= n; i++) {
        const t = i / n;
        path.push({
          x: start.x,
          y: start.y,
          theta: start.theta + dtheta * t,
        });
      }
      return path;
    }
    case 'return_to_start': {
      const goal = startPose();
      const dx = goal.x - start.x;
      const dy = goal.y - start.y;
      const dtheta = wrapPi(goal.theta - start.theta);
      const dist = Math.hypot(dx, dy);
      const n = Math.max(
        1,
        Math.ceil(dist / SAMPLE_LEN),
        Math.ceil(Math.abs(dtheta) / SAMPLE_ANG),
      );
      const path: Pose[] = [];
      for (let i = 1; i <= n; i++) {
        const t = i / n;
        path.push({
          x: start.x + dx * t,
          y: start.y + dy * t,
          theta: start.theta + dtheta * t,
        });
      }
      return path;
    }
  }
}

function wrapPi(a: number): number {
  let x = a;
  while (x > Math.PI) x -= 2 * Math.PI;
  while (x <= -Math.PI) x += 2 * Math.PI;
  return x;
}

// Bottom-center tile, pointing up (+y in world).
export function startPose(): Pose {
  const cx = (FIELD_TILES / 2) * TILE;
  const cy = 0.5 * TILE;
  return { x: cx, y: cy, theta: Math.PI / 2 };
}
