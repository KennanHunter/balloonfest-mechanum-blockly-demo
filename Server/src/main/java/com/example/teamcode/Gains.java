package com.example.teamcode;

/**
 * PD gains for pose tracking. Translation gains act on meters of position
 * error, rotation gains act on radians of heading error.
 */
public final class Gains {
    private final double kpTrans, kdTrans, kpRot, kdRot;

    public Gains(double kpTrans, double kdTrans, double kpRot, double kdRot) {
        this.kpTrans = kpTrans;
        this.kdTrans = kdTrans;
        this.kpRot = kpRot;
        this.kdRot = kdRot;
    }

    public double kpTrans() { return kpTrans; }
    public double kdTrans() { return kdTrans; }
    public double kpRot() { return kpRot; }
    public double kdRot() { return kdRot; }

    public static Gains defaults() {
        return new Gains(4.0, 1.5, 6.0, 0.8);
    }
}
