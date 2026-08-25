package org.firstinspires.ftc.teamcode;

import com.qualcomm.hardware.sparkfun.SparkFunOTOS;
import com.qualcomm.robotcore.eventloop.opmode.LinearOpMode;
import com.qualcomm.robotcore.eventloop.opmode.TeleOp;
import com.qualcomm.robotcore.hardware.DcMotor;
import com.qualcomm.robotcore.hardware.DcMotorSimple;

import com.example.teamcode.BodyVel;
import com.example.teamcode.Chassis;
import com.example.teamcode.PDController;
import com.example.teamcode.Pose;

import org.firstinspires.ftc.robotcore.external.navigation.AngleUnit;
import org.firstinspires.ftc.robotcore.external.navigation.DistanceUnit;
import org.firstinspires.ftc.teamserver.ControlSnapshot;
import org.firstinspires.ftc.teamserver.Server;

/**
 * TeleOp that runs the PD control loop for a mecanum + OTOS chassis. The
 * program (which target pose sequence to follow) comes from the Server
 * module's WebSocket clients; the loop itself — read pose → PD → write
 * motors — is here so hardware I/O and control math stay together.
 *
 * Configured hardware names on the RC:
 *   front_left, front_right, rear_left, rear_right (DcMotor)
 *   otos                                            (SparkFunOTOS)
 */
@TeleOp(name = "Server-Driven Mecanum", group = "server")
public class ServerOpMode extends LinearOpMode {

    private static final double MAX_VOLT = 12.0;

    private DcMotor frontLeft, frontRight, rearLeft, rearRight;
    private SparkFunOTOS otos;
    private final PDController pd = new PDController();

    @Override
    public void runOpMode() throws InterruptedException {
        frontLeft  = hardwareMap.get(DcMotor.class, "front_left");
        frontRight = hardwareMap.get(DcMotor.class, "front_right");
        rearLeft   = hardwareMap.get(DcMotor.class, "rear_left");
        rearRight  = hardwareMap.get(DcMotor.class, "rear_right");

        frontRight.setDirection(DcMotorSimple.Direction.REVERSE);
        rearRight.setDirection(DcMotorSimple.Direction.REVERSE);
        for (DcMotor m : new DcMotor[]{frontLeft, frontRight, rearLeft, rearRight}) {
            m.setZeroPowerBehavior(DcMotor.ZeroPowerBehavior.BRAKE);
        }

        otos = hardwareMap.get(SparkFunOTOS.class, "otos");
        otos.setLinearUnit(DistanceUnit.METER);
        otos.setAngularUnit(AngleUnit.RADIANS);
        otos.calibrateImu();
        otos.resetTracking();

        try {
            telemetry.addLine("Waiting for start. Server bridge boots on play.");
            telemetry.update();
            waitForStart();

            // Anchor session start (used as `return_to_start`'s goal) to the
            // pose the OTOS reports right after start — not any field-frame
            // origin, since we can't know where on the field we're placed.
            Pose sessionStart = readPose();
            Server.INSTANCE.registerOpMode(sessionStart);

            while (opModeIsActive()) {
                Pose pose = readPose();
                BodyVel vel = readVelocity();

                ControlSnapshot snap = Server.INSTANCE.snapshot();
                double[] volts;
                if (snap.getTarget() != null) {
                    BodyVel cmd = pd.step(snap.getTarget(), pose, vel, snap.getGains());
                    volts = Chassis.wheelVolts(cmd.vx(), cmd.vy(), cmd.omega());
                } else {
                    volts = new double[]{0, 0, 0, 0};
                }
                applyMotors(volts);
                Server.INSTANCE.reportTick(pose, vel, volts);

                telemetry.addData("block", snap.getBlockId());
                telemetry.addData("target", snap.getTarget());
                telemetry.update();
                idle();
            }
        } finally {
            applyMotors(new double[]{0, 0, 0, 0});
            Server.INSTANCE.unregisterOpMode();
        }
    }

    private Pose readPose() {
        SparkFunOTOS.Pose2D p = otos.getPosition();
        return new Pose(p.x, p.y, p.h);
    }

    private BodyVel readVelocity() {
        // OTOS reports world-frame velocity; rotate into the body frame so
        // the PD damping term matches the body-frame command it produces.
        SparkFunOTOS.Pose2D v = otos.getVelocity();
        Pose pose = readPose();
        double c = Math.cos(pose.theta());
        double s = Math.sin(pose.theta());
        double vx =  c * v.x + s * v.y;
        double vy = -s * v.x + c * v.y;
        return new BodyVel(vx, vy, v.h);
    }

    /** Convert wheel voltages [FL,FR,BL,BR] to DcMotor powers (v/12). */
    private void applyMotors(double[] volts) {
        frontLeft.setPower(volts[0] / MAX_VOLT);
        frontRight.setPower(volts[1] / MAX_VOLT);
        rearLeft.setPower(volts[2] / MAX_VOLT);
        rearRight.setPower(volts[3] / MAX_VOLT);
    }
}
