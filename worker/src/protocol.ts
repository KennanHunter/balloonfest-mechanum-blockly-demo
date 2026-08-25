export type PDGains = {
  Kp_t: number;
  Kd_t: number;
  Kp_r: number;
  Kd_r: number;
};

export const DEFAULT_GAINS: PDGains = {
  Kp_t: 4,
  Kd_t: 1.5,
  Kp_r: 6,
  Kd_r: 0.8,
};

export type Command =
  | { op: 'forward'; id: string }
  | { op: 'backward'; id: string }
  | { op: 'strafe_left'; id: string }
  | { op: 'strafe_right'; id: string }
  | { op: 'rotate'; degrees: number; id: string }
  | { op: 'return_to_start'; id: string };

export type Program = {
  name?: string;
  commands: Command[];
};

export type MotorPower = Record<string, { voltage: number }>;

export type ClientToServer =
  | { type: 'play'; program: Program; gains?: PDGains }
  | { type: 'stop' }
  | { type: 'reset' }
  | { type: 'set_gains'; gains: PDGains };

export type PosePoint = { x: number; y: number; theta: number };

export type ServerToClient =
  | { type: 'robot_position'; x: number; y: number; theta: number }
  | { type: 'target_position'; x: number; y: number; theta: number }
  | { type: 'motor_power'; motors: MotorPower }
  | { type: 'active_block'; id: string | null }
  | { type: 'active_path'; blockId: string | null; path: PosePoint[] };
