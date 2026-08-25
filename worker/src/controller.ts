import type { PDGains } from './protocol';
import { bodyToWheelVoltages, type BodyVel, type Pose, type SimParams, type WheelVolts } from './kinematics';

export type PDResult = {
  volts: WheelVolts;
  reached: boolean;
};

const POS_TOL = 0.02;   // 2 cm
const ANG_TOL = (2 * Math.PI) / 180; // 2°
const VEL_TOL = 0.05;   // m/s
const OMEGA_TOL = 0.1;  // rad/s

function wrapPi(a: number): number {
  let x = a;
  while (x > Math.PI) x -= 2 * Math.PI;
  while (x <= -Math.PI) x += 2 * Math.PI;
  return x;
}

export function pdStep(
  pose: Pose,
  vel: BodyVel,
  target: Pose,
  gains: PDGains,
  params: SimParams,
): PDResult {
  // World → body error.
  const dxW = target.x - pose.x;
  const dyW = target.y - pose.y;
  const c = Math.cos(pose.theta);
  const s = Math.sin(pose.theta);
  const ex = c * dxW + s * dyW;
  const ey = -s * dxW + c * dyW;
  const eTheta = wrapPi(target.theta - pose.theta);

  const cmd: BodyVel = {
    vx: gains.Kp_t * ex - gains.Kd_t * vel.vx,
    vy: gains.Kp_t * ey - gains.Kd_t * vel.vy,
    omega: gains.Kp_r * eTheta - gains.Kd_r * vel.omega,
  };

  const volts = bodyToWheelVoltages(cmd, params);

  const posErr = Math.hypot(ex, ey);
  const speed = Math.hypot(vel.vx, vel.vy);
  const reached =
    posErr < POS_TOL &&
    Math.abs(eTheta) < ANG_TOL &&
    speed < VEL_TOL &&
    Math.abs(vel.omega) < OMEGA_TOL;

  return { volts, reached };
}
