package com.example.teamcode;

/** Body-frame velocity: forward, left, and yaw rate. */
public final class BodyVel {
    private final double vx, vy, omega;

    public BodyVel(double vx, double vy, double omega) {
        this.vx = vx;
        this.vy = vy;
        this.omega = omega;
    }

    public double vx() { return vx; }
    public double vy() { return vy; }
    public double omega() { return omega; }

    public static BodyVel zero() { return new BodyVel(0, 0, 0); }
}
