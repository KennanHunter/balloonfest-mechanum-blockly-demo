import { DurableObject } from 'cloudflare:workers';
import {
  DEFAULT_GAINS,
  type ClientToServer,
  type PDGains,
  type ServerToClient,
} from './protocol';
import {
  DEFAULT_PARAMS,
  stepDynamics,
  type Pose,
  type SimState,
  type WheelVolts,
} from './kinematics';

import { pdStep } from './controller';
import { compileProgram, startPose, type Block } from './program';

type Persisted = {
  gains: PDGains;
};

const TICK_MS = 33; // ~30 Hz
const DT = TICK_MS / 1000;
const ZERO_VOLTS: WheelVolts = [0, 0, 0, 0];
// Advance the reference target one sample per tick — with 2 cm / 2° sampling
// that's ~0.6 m/s and ~60°/s nominal, which is fast enough to be visible but
// slow enough that PD has real tracking error to look at.
const SAMPLES_PER_TICK = 1;

type Mode = 'idle' | 'program';

export interface Env {
  ROBOT: DurableObjectNamespace;
  ASSETS: Fetcher;
}

export class RobotSim extends DurableObject<Env> {
  private state: SimState;
  private volts: WheelVolts = [...ZERO_VOLTS] as WheelVolts;
  private blocks: Block[] = [];
  private activeBlockIdx = -1;
  private pathIdx = 0;
  private gains: PDGains = { ...DEFAULT_GAINS };
  private mode: Mode = 'idle';
  private loaded = false;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.state = { pose: startPose(), vel: { vx: 0, vy: 0, omega: 0 } };
  }

  private async ensureLoaded() {
    if (this.loaded) return;
    const stored = await this.ctx.storage.get<Persisted>('persisted');
    if (stored?.gains) this.gains = stored.gains;
    this.loaded = true;
  }

  private async persist() {
    await this.ctx.storage.put<Persisted>('persisted', { gains: this.gains });
  }

  async fetch(request: Request): Promise<Response> {
    await this.ensureLoaded();
    const upgrade = request.headers.get('Upgrade');
    if (upgrade !== 'websocket') {
      return new Response('expected websocket', { status: 426 });
    }
    const pair = new WebSocketPair();
    const [client, server] = [pair[0], pair[1]];
    this.ctx.acceptWebSocket(server);
    await this.scheduleTick();
    this.broadcastActivePath();
    this.broadcastActive();
    this.broadcastPose();
    this.broadcastTarget();
    return new Response(null, { status: 101, webSocket: client });
  }

  private async scheduleTick() {
    const current = await this.ctx.storage.getAlarm();
    if (current === null) {
      await this.ctx.storage.setAlarm(Date.now() + TICK_MS);
    }
  }

  async webSocketMessage(_ws: WebSocket, message: string | ArrayBuffer) {
    await this.ensureLoaded();
    if (typeof message !== 'string') return;
    let msg: ClientToServer;
    try {
      msg = JSON.parse(message);
    } catch {
      return;
    }
    switch (msg.type) {
      case 'play': {
        if (msg.gains) {
          this.gains = msg.gains;
          await this.persist();
        }
        // Play always resets to the canonical start pose so runs are
        // repeatable and "forward" moves the robot up the field.
        this.state = {
          pose: startPose(),
          vel: { vx: 0, vy: 0, omega: 0 },
        };
        this.blocks = compileProgram(this.state.pose, msg.program);
        this.activeBlockIdx = this.blocks.length > 0 ? 0 : -1;
        this.pathIdx = 0;
        this.volts = [...ZERO_VOLTS] as WheelVolts;
        this.mode = 'program';
        this.broadcastPose();
        this.broadcastTarget();
        this.broadcastActivePath();
        this.broadcastActive();
        await this.scheduleTick();
        break;
      }
      case 'stop': {
        this.blocks = [];
        this.activeBlockIdx = -1;
        this.pathIdx = 0;
        this.volts = [...ZERO_VOLTS] as WheelVolts;
        this.state.vel = { vx: 0, vy: 0, omega: 0 };
        this.mode = 'idle';
        this.broadcastActivePath();
        this.broadcastActive();
        this.broadcastMotors();
        this.broadcastTarget();
        break;
      }
      case 'reset': {
        this.state = {
          pose: startPose(),
          vel: { vx: 0, vy: 0, omega: 0 },
        };
        this.blocks = [];
        this.activeBlockIdx = -1;
        this.pathIdx = 0;
        this.volts = [...ZERO_VOLTS] as WheelVolts;
        this.mode = 'idle';
        this.broadcastActivePath();
        this.broadcastActive();
        this.broadcastPose();
        this.broadcastMotors();
        break;
      }
      case 'set_gains': {
        this.gains = msg.gains;
        await this.persist();
        break;
      }
    }
  }

  async webSocketClose(_ws: WebSocket) {
    // Hibernatable close is enough.
  }

  private currentTarget(): Pose | null {
    if (this.activeBlockIdx < 0 || this.activeBlockIdx >= this.blocks.length) {
      return null;
    }
    const block = this.blocks[this.activeBlockIdx];
    if (block.path.length === 0) return null;
    const idx = Math.min(Math.floor(this.pathIdx), block.path.length - 1);
    return block.path[idx];
  }

  async alarm() {
    await this.ensureLoaded();

    if (this.mode === 'program') {
      const target = this.currentTarget();
      if (target) {
        const pd = pdStep(
          this.state.pose,
          this.state.vel,
          target,
          this.gains,
          DEFAULT_PARAMS,
        );
        this.volts = pd.volts;

        const block = this.blocks[this.activeBlockIdx];
        const lastIdx = block.path.length - 1;
        if (this.pathIdx < lastIdx) {
          this.pathIdx = Math.min(this.pathIdx + SAMPLES_PER_TICK, lastIdx);
        } else if (pd.reached) {
          this.activeBlockIdx++;
          this.pathIdx = 0;
          if (this.activeBlockIdx >= this.blocks.length) {
            this.activeBlockIdx = -1;
            this.volts = [...ZERO_VOLTS] as WheelVolts;
            this.mode = 'idle';
          }
          this.broadcastActivePath();
          this.broadcastActive();
        }
      } else {
        this.volts = [...ZERO_VOLTS] as WheelVolts;
        this.mode = 'idle';
      }
    } else {
      this.volts = [...ZERO_VOLTS] as WheelVolts;
    }

    this.state = stepDynamics(this.state, this.volts, DT, DEFAULT_PARAMS);

    this.broadcastPose();
    this.broadcastTarget();
    this.broadcastMotors();

    const sockets = this.ctx.getWebSockets();
    if (sockets.length > 0) {
      await this.ctx.storage.setAlarm(Date.now() + TICK_MS);
    }
  }

  private broadcast(msg: ServerToClient) {
    const data = JSON.stringify(msg);
    for (const ws of this.ctx.getWebSockets()) {
      try {
        ws.send(data);
      } catch {
        // Ignore; hibernatable API will surface close.
      }
    }
  }

  private broadcastPose() {
    this.broadcast({
      type: 'robot_position',
      x: this.state.pose.x,
      y: this.state.pose.y,
      theta: this.state.pose.theta,
    });
  }

  private broadcastTarget() {
    const t = this.currentTarget();
    if (!t) return;
    this.broadcast({
      type: 'target_position',
      x: t.x,
      y: t.y,
      theta: t.theta,
    });
  }

  private broadcastMotors() {
    this.broadcast({
      type: 'motor_power',
      motors: {
        fl: { voltage: round(this.volts[0]) },
        fr: { voltage: round(this.volts[1]) },
        bl: { voltage: round(this.volts[2]) },
        br: { voltage: round(this.volts[3]) },
      },
    });
  }

  private broadcastActivePath() {
    const block =
      this.activeBlockIdx >= 0 && this.activeBlockIdx < this.blocks.length
        ? this.blocks[this.activeBlockIdx]
        : null;
    this.broadcast({
      type: 'active_path',
      blockId: block?.blockId ?? null,
      path: block ? block.path.map((p) => ({ x: p.x, y: p.y, theta: p.theta })) : [],
    });
  }

  private broadcastActive() {
    const id =
      this.activeBlockIdx >= 0 && this.activeBlockIdx < this.blocks.length
        ? this.blocks[this.activeBlockIdx].blockId
        : null;
    this.broadcast({ type: 'active_block', id });
  }
}

function round(v: number): number {
  return Math.round(v * 1000) / 1000;
}
