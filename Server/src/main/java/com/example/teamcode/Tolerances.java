package com.example.teamcode;

/**
 * Convergence tolerances for {@link PDController#reached}. Defaults match
 * worker/src/controller.ts so behavior lines up with the sim-side PD path.
 */
public final class Tolerances {
    private final double pos, angle, vel, omega;

    public Tolerances(double pos, double angle, double vel, double omega) {
        this.pos = pos;
        this.angle = angle;
        this.vel = vel;
        this.omega = omega;
    }

    public double pos() { return pos; }
    public double angle() { return angle; }
    public double vel() { return vel; }
    public double omega() { return omega; }

    public static Tolerances defaults() {
        return new Tolerances(0.02, Math.toRadians(2), 0.05, 0.1);
    }
}
