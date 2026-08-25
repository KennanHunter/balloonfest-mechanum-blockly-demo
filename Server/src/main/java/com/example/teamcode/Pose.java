package com.example.teamcode;

public final class Pose {
    private final double x, y, theta;

    public Pose(double x, double y, double theta) {
        this.x = x;
        this.y = y;
        this.theta = theta;
    }

    public double x() { return x; }
    public double y() { return y; }
    public double theta() { return theta; }
}
