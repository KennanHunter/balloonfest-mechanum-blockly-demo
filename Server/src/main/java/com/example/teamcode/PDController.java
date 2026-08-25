package com.example.teamcode;

/**
 * Pure-function PD step for pose tracking. World-frame position error is
 * rotated into the body frame; body-frame damping (-Kd·v) is subtracted.
 * Mirrors {@code worker/src/controller.ts} so a JVM OpMode using this
 * matches the sim-side PD behavior.
 */
public final class PDController {

    /**
     * One control step. Returns the body-frame velocity command; feed it
     * into {@link Chassis#wheelVolts} to get motor voltages.
     */
    public BodyVel step(Pose target, Pose current, BodyVel vel, Gains g) {
        double dxW = target.x() - current.x();
        double dyW = target.y() - current.y();
        double c = Math.cos(current.theta());
        double s = Math.sin(current.theta());
        // World → body: rotate error by −θ.
        double ex = c * dxW + s * dyW;
        double ey = -s * dxW + c * dyW;
        double eth = wrapPi(target.theta() - current.theta());

        return new BodyVel(
            g.kpTrans() * ex - g.kdTrans() * vel.vx(),
            g.kpTrans() * ey - g.kdTrans() * vel.vy(),
            g.kpRot() * eth - g.kdRot() * vel.omega());
    }

    /** True when both position and heading are within tolerance and the robot is nearly at rest. */
    public boolean reached(Pose target, Pose current, BodyVel vel, Tolerances t) {
        double dxW = target.x() - current.x();
        double dyW = target.y() - current.y();
        double posErr = Math.hypot(dxW, dyW);
        double eth = Math.abs(wrapPi(target.theta() - current.theta()));
        double speed = Math.hypot(vel.vx(), vel.vy());
        return posErr < t.pos()
            && eth < t.angle()
            && speed < t.vel()
            && Math.abs(vel.omega()) < t.omega();
    }

    static double wrapPi(double a) {
        double x = a;
        while (x > Math.PI) x -= 2 * Math.PI;
        while (x <= -Math.PI) x += 2 * Math.PI;
        return x;
    }
}
