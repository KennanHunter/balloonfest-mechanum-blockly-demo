package com.example.teamcode;

/**
 * Chassis geometry and mecanum kinematics. Body frame: {@code +x = forward,
 * +y = left, +ω = CCW}. Wheel order: {@code [FL, FR, BL, BR]}. Voltages
 * saturate at ±{@link #MAX_VOLT} while preserving the commanded direction.
 */
public final class Chassis {
    /** Half-length (fore/aft) and half-width (lateral) from center, meters. */
    public static final double HALF_LEN = 0.2;
    public static final double HALF_WID = 0.2;

    /** Motor voltage limit. */
    public static final double MAX_VOLT = 12.0;

    private Chassis() {}

    /**
     * Standard mecanum inverse for a 45° roller chassis. Returns wheel
     * voltages {@code [FL, FR, BL, BR]}; scales all four proportionally if
     * any would exceed {@link #MAX_VOLT} so heading and translation aren't
     * distorted by clipping.
     */
    public static double[] wheelVolts(double vx, double vy, double omega) {
        double arm = HALF_LEN + HALF_WID;
        double[] w = {
            vx - vy - omega * arm, // FL
            vx + vy + omega * arm, // FR
            vx + vy - omega * arm, // BL
            vx - vy + omega * arm, // BR
        };
        double max = MAX_VOLT;
        for (double v : w) max = Math.max(max, Math.abs(v));
        double scale = MAX_VOLT / max;
        for (int i = 0; i < 4; i++) w[i] *= scale;
        return w;
    }
}
