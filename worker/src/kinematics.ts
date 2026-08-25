// Mecanum drive simulation.
//
// Wheel order: [FL, FR, BL, BR]. Body frame: +x forward, +y left, +theta CCW.
// Roller angle is measured from the wheel's forward axis; standard mecanum
// uses 45°, we use 43° per config so the strafe/forward Jacobian is not
// perfectly symmetric.

export type SimParams = {
  rollerDeg: number;
  halfLen: number;        // wheel base half-length (forward), m
  halfWid: number;        // wheel base half-width (lateral), m
  mass: number;           // kg
  yawInertia: number;     // kg m^2
  motorKv: number;        // N per V at zero speed
  motorBackEmf: number;   // (N per V) per (m/s wheel roll velocity)
  maxVolt: number;        // ±V
  linearDrag: number;     // N per (m/s) body linear damping
  angularDrag: number;    // N·m per (rad/s) body yaw damping
};

export const DEFAULT_PARAMS: SimParams = {
  rollerDeg: 43,
  halfLen: 0.2,
  halfWid: 0.2,
  mass: 5,
  yawInertia: 0.05,
  motorKv: 6,
  motorBackEmf: 2,
  maxVolt: 12,
  linearDrag: 4,
  angularDrag: 0.3,
};

export type Pose = { x: number; y: number; theta: number };
export type BodyVel = { vx: number; vy: number; omega: number };
export type WheelVolts = [number, number, number, number];

// Roller sign for each wheel [FL, FR, BL, BR]. With +y=left, spinning FL
// forward pushes the body forward-right — force in (+x, -y). So FL/BR are
// -1 and FR/BL are +1. This is the sign convention consistent with the
// standard mecanum inverse kinematics in bodyToWheelVoltages.
function rollerSigns(): [number, number, number, number] {
  return [-1, +1, +1, -1];
}

function wheelOffsets(p: SimParams): Array<[number, number]> {
  const { halfLen: L, halfWid: W } = p;
  return [
    [+L, +W], // FL
    [+L, -W], // FR
    [-L, +W], // BL
    [-L, -W], // BR
  ];
}

// Roll velocity of each wheel given body velocity (rad-agnostic, m/s along
// the wheel's roll direction, which is the body's +x plus a component from
// yaw at the wheel offset).
export function bodyVelToWheelRollSpeeds(v: BodyVel, p: SimParams): WheelVolts {
  const offs = wheelOffsets(p);
  // Wheel roll direction is body-x; roller can't drive lateral, but the
  // wheel's rolling velocity is dominated by body vx + (omega × offset)_x.
  // (omega × r)_x = -omega * r_y (with r = (rx, ry, 0))
  const speeds: number[] = offs.map(
    ([, ry]) => v.vx - v.omega * ry,
  );
  return speeds as WheelVolts;
}

export function wheelVoltagesToBodyForce(
  volts: WheelVolts,
  bodyVel: BodyVel,
  p: SimParams = DEFAULT_PARAMS,
): { fx: number; fy: number; tau: number } {
  const t = Math.tan((p.rollerDeg * Math.PI) / 180);
  const signs = rollerSigns();
  const offs = wheelOffsets(p);
  const rollSpeeds = bodyVelToWheelRollSpeeds(bodyVel, p);

  let fx = 0;
  let fy = 0;
  let tau = 0;
  for (let i = 0; i < 4; i++) {
    // Motor force along the wheel roll direction (body +x).
    const drive = p.motorKv * volts[i] - p.motorBackEmf * rollSpeeds[i];
    // Ground reaction from the roller redirects force: body-frame force
    // vector is drive * (1, signs[i] * t) normalized... except for mecanum
    // it's already the physical projection, no renormalization needed.
    const fxi = drive;
    const fyi = drive * signs[i] * t;
    fx += fxi;
    fy += fyi;
    const [rx, ry] = offs[i];
    tau += rx * fyi - ry * fxi;
  }
  return { fx, fy, tau };
}

export function bodyToWheelVoltages(
  cmd: BodyVel,
  p: SimParams = DEFAULT_PARAMS,
): WheelVolts {
  const t = Math.tan((p.rollerDeg * Math.PI) / 180);
  const { halfLen: L, halfWid: W } = p;
  // Standard mecanum inverse (with roller factor 1/t on strafe):
  //   FL = vx - vy/t - omega*(L+W)
  //   FR = vx + vy/t + omega*(L+W)
  //   BL = vx + vy/t - omega*(L+W)
  //   BR = vx - vy/t + omega*(L+W)
  // We interpret cmd as target body velocity and scale to volts by a
  // simple gain (1/motorKv-ish); clip to ±maxVolt.
  const k = 1 / p.motorKv;
  const arm = L + W;
  const raw: WheelVolts = [
    (cmd.vx - cmd.vy / t - cmd.omega * arm) * k,
    (cmd.vx + cmd.vy / t + cmd.omega * arm) * k,
    (cmd.vx + cmd.vy / t - cmd.omega * arm) * k,
    (cmd.vx - cmd.vy / t + cmd.omega * arm) * k,
  ];
  const clip = (v: number) => Math.max(-p.maxVolt, Math.min(p.maxVolt, v));
  return [clip(raw[0]), clip(raw[1]), clip(raw[2]), clip(raw[3])];
}

export type SimState = {
  pose: Pose;
  vel: BodyVel; // body-frame linear + yaw
};

export function stepDynamics(
  state: SimState,
  volts: WheelVolts,
  dt: number,
  p: SimParams = DEFAULT_PARAMS,
): SimState {
  const { fx, fy, tau } = wheelVoltagesToBodyForce(volts, state.vel, p);
  // Body-frame accelerations (with viscous damping).
  const ax = (fx - p.linearDrag * state.vel.vx) / p.mass;
  const ay = (fy - p.linearDrag * state.vel.vy) / p.mass;
  const aOmega = (tau - p.angularDrag * state.vel.omega) / p.yawInertia;

  const vx = state.vel.vx + ax * dt;
  const vy = state.vel.vy + ay * dt;
  const omega = state.vel.omega + aOmega * dt;

  // Integrate pose (body → world).
  const c = Math.cos(state.pose.theta);
  const s = Math.sin(state.pose.theta);
  const dxWorld = (c * vx - s * vy) * dt;
  const dyWorld = (s * vx + c * vy) * dt;
  const theta = state.pose.theta + omega * dt;

  return {
    pose: {
      x: state.pose.x + dxWorld,
      y: state.pose.y + dyWorld,
      theta,
    },
    vel: { vx, vy, omega },
  };
}
