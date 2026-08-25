import { createSignal, onCleanup } from 'solid-js';

export type RobotPose = { x: number; y: number; theta: number };
export type PosePoint = { x: number; y: number; theta: number };
export type MotorPower = Record<string, { voltage: number }>;
export type ConnectionStatus = 'connecting' | 'open' | 'closed';

const TRAIL_MAX = 300;

export type PDGains = {
  Kp_t: number;
  Kd_t: number;
  Kp_r: number;
  Kd_r: number;
};

type IncomingMessage =
  | { type: 'robot_position'; x: number; y: number; theta: number }
  | { type: 'target_position'; x: number; y: number; theta: number }
  | { type: 'motor_power'; motors: MotorPower }
  | { type: 'active_block'; id: string | null }
  | { type: 'active_path'; blockId: string | null; path: PosePoint[] };

type OutgoingMessage =
  | { type: 'play'; program: object; gains?: PDGains }
  | { type: 'stop' }
  | { type: 'reset' }
  | { type: 'set_gains'; gains: PDGains };

export function connectRobot(wsUrl: string, healthUrl: string) {
  const [position, setPosition] = createSignal<RobotPose | null>(null);
  const [targetPose, setTargetPose] = createSignal<RobotPose | null>(null);
  const [motorPower, setMotorPower] = createSignal<MotorPower>({});
  const [activeBlockId, setActiveBlockId] = createSignal<string | null>(null);
  const [activePath, setActivePath] = createSignal<PosePoint[]>([]);
  const [trail, setTrail] = createSignal<RobotPose[]>([]);
  const [status, setStatus] = createSignal<ConnectionStatus>('connecting');
  const [healthy, setHealthy] = createSignal(false);

  let socket: WebSocket | null = null;
  let retryDelay = 500;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let healthTimer: ReturnType<typeof setInterval> | null = null;
  let healthAbort: AbortController | null = null;
  let disposed = false;

  const scheduleReconnect = () => {
    if (disposed || reconnectTimer) return;
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      open();
    }, retryDelay);
    retryDelay = Math.min(retryDelay * 2, 10_000);
  };

  const handleMessage = (event: MessageEvent) => {
    let msg: IncomingMessage;
    try {
      msg = JSON.parse(event.data);
    } catch {
      return;
    }
    switch (msg.type) {
      case 'robot_position': {
        const p = { x: msg.x, y: msg.y, theta: msg.theta };
        setPosition(p);
        setTrail((prev) => {
          const next = prev.length >= TRAIL_MAX ? prev.slice(1) : prev.slice();
          next.push(p);
          return next;
        });
        break;
      }
      case 'target_position':
        setTargetPose({ x: msg.x, y: msg.y, theta: msg.theta });
        break;
      case 'motor_power':
        setMotorPower(msg.motors);
        break;
      case 'active_block':
        setActiveBlockId(msg.id);
        break;
      case 'active_path':
        setActivePath(msg.path);
        setTrail([]);
        if (msg.path.length === 0) setTargetPose(null);
        break;
    }
  };

  const open = () => {
    if (disposed) return;
    setStatus('connecting');
    let ws: WebSocket;
    try {
      ws = new WebSocket(wsUrl);
    } catch (err) {
      console.error('WebSocket construction failed', err);
      scheduleReconnect();
      return;
    }
    socket = ws;
    ws.addEventListener('open', () => {
      retryDelay = 500;
      setStatus('open');
    });
    ws.addEventListener('message', handleMessage);
    ws.addEventListener('error', () => {
      // 'close' fires next; handle reconnect there.
    });
    ws.addEventListener('close', () => {
      if (socket === ws) socket = null;
      setStatus('closed');
      setActiveBlockId(null);
      scheduleReconnect();
    });
  };

  const pollHealth = async () => {
    if (disposed) return;
    healthAbort?.abort();
    healthAbort = new AbortController();
    try {
      const res = await fetch(healthUrl, { signal: healthAbort.signal });
      setHealthy(res.ok);
    } catch {
      setHealthy(false);
    }
  };

  queueMicrotask(() => {
    open();
    pollHealth();
    healthTimer = setInterval(pollHealth, 2000);
  });

  const send = (msg: OutgoingMessage) => {
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      console.warn('Dropping message; socket not open', msg.type);
      return false;
    }
    try {
      socket.send(JSON.stringify(msg));
      return true;
    } catch (err) {
      console.error('WebSocket send failed', err);
      return false;
    }
  };

  onCleanup(() => {
    disposed = true;
    if (reconnectTimer) clearTimeout(reconnectTimer);
    if (healthTimer) clearInterval(healthTimer);
    healthAbort?.abort();
    if (socket) {
      socket.close();
      socket = null;
    }
  });

  return {
    status,
    connected: () => status() === 'open',
    healthy,
    position,
    targetPose,
    motorPower,
    activeBlockId,
    activePath,
    trail,
    play: (program: object, gains?: PDGains) =>
      send({ type: 'play', program, gains }),
    stop: () => send({ type: 'stop' }),
    reset: () => send({ type: 'reset' }),
    // Drive back to the canonical start pose by playing a program of
    // exactly one `return_to_start` block. Interrupts any in-flight
    // program because the worker's `play` handler rebuilds state.
    returnToStart: (gains?: PDGains) =>
      send({
        type: 'play',
        program: { commands: [{ op: 'return_to_start', id: 'ui:return-home' }] },
        gains,
      }),
    setGains: (gains: PDGains) => send({ type: 'set_gains', gains }),
  };
}
